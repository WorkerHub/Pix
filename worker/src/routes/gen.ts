/**
 * 生图接口（规格 §5）：对自托管机器侧代理的单次转发。
 *
 * 契约对齐机器侧代理（§4.4）：
 * - GET /health：转问机器 /health，单次超时 4 秒；连不上或超时 → {"online":false}；
 *   通了且 ComfyUI 就绪 → {"online":true,"ready":true}；通了但未就绪 → {"online":true,"ready":false}。
 *   任何情况下不抛 5xx 给前端白屏。
 * - POST /：提交生图，除未登录 401 外一律 HTTP 200，前端只认形状——
 *   成功 {"jobId":"..."}；机器忙 {"busy":true}；机器不可达 {"online":false}；
 *   机器未就绪 {"ready":false}（代理 ComfyUI 不可达回 503，映射为此形状）。
 * - GET /status/:jobId：转发机器状态。
 * - GET /image/:jobId：流式透传 image/png，不落存储、不加公共缓存。
 *
 * 硬规则：Worker 侧绝不主动发起任何请求——无 cron、无后台轮询、无预热；
 * 每次对机器的调用直接响应浏览器的一次请求。
 */
import { Hono } from "hono"
import { MACHINE_AUTH_HEADER, PROJECT_SLUG } from "../config/project"
import {
  deleteGenerationByIdAndUser,
  findGenerationByIdAndUser,
  findGenerationByJobId,
  insertGeneration,
  listGenerationsByUser
} from "../db/queries/generations"
import { currentUserId } from "../lib/account"
import { readJsonBody } from "../lib/http"
import { getTablePrefix } from "../lib/table-prefix"
import { resolvePrompt } from "../lib/translate"
import type { HonoEnv } from "../types"

export const genRoutes = new Hono<HonoEnv>()

export const ALLOWED_MODELS = [
  "realistic-lcm",
  "realistic",
  "majicmix",
  "dreamshaper",
  "counterfeit"
] as const

export type GenerationModel = (typeof ALLOWED_MODELS)[number]

export const DEFAULT_MODEL: GenerationModel = "realistic-lcm"

export function isValidModel(model: unknown): model is GenerationModel {
  return (
    typeof model === "string" &&
    (ALLOWED_MODELS as readonly string[]).includes(model)
  )
}

export interface GenerateRequestBody {
  prompt: string
  size: "portrait" | "square"
  model?: string
}

/**
 * 拼装机器侧 URL：去除基地址中的 query 与 hash，拼装干净的子路径 URL。
 */
export function buildMachineUrl(baseUrl: string, subPath: string): string {
  try {
    const url = new URL(baseUrl)
    const basePath = url.pathname.replace(/\/+$/, "")
    const normalizedSub = subPath.startsWith("/") ? subPath : `/${subPath}`
    url.pathname = `${basePath}${normalizedSub}`
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    const cleanBase = baseUrl.split(/[?#]/)[0].replace(/\/+$/, "")
    const normalizedSub = subPath.startsWith("/") ? subPath : `/${subPath}`
    return `${cleanBase}${normalizedSub}`
  }
}

/**
 * 从机器侧基地址解析平台令牌（_token 参数）。
 */
export function extractMachineToken(baseUrl?: string): string | null {
  if (!baseUrl) {
    return null
  }
  try {
    const url = new URL(baseUrl)
    const token = url.searchParams.get("_token")
    if (token && token.trim().length > 0) {
      return token.trim()
    }
    return null
  } catch {
    const match = baseUrl.match(/[?&]_token=([^&#]*)/)
    if (match?.[1]) {
      const decoded = decodeURIComponent(match[1]).trim()
      return decoded.length > 0 ? decoded : null
    }
    return null
  }
}

/**
 * 构造发送给机器侧代理的请求头：
 * - 携带机器代理密钥头（若配置了 PIX_SERVER_SECRET）；
 * - 携带 Authorization: Bearer <token>（若 PIX_SERVER_URL 携带 _token 查询参数）。
 */
export function machineHeaders(
  baseUrl?: string,
  secret?: string
): Record<string, string> {
  const headers: Record<string, string> = {}
  if (secret) {
    headers[MACHINE_AUTH_HEADER] = secret
  }
  const token = extractMachineToken(baseUrl)
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

/**
 * 1. 探活：转问机器 /health，单次超时 4 秒。
 * 连不上或超时 → {"online":false}
 * 通了且 ComfyUI 就绪 → {"online":true,"ready":true}
 * 通了但未就绪 → {"online":true,"ready":false}
 * 任何情况下不抛 5xx。
 */
genRoutes.get("/health", async (c) => {
  const machineUrl = c.env.PIX_SERVER_URL
  if (!machineUrl) {
    return c.json({ online: false }, 200)
  }

  try {
    const targetUrl = buildMachineUrl(machineUrl, "/health")
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: machineHeaders(machineUrl, c.env.PIX_SERVER_SECRET),
      signal: AbortSignal.timeout(4000)
    })

    if (res.status !== 200) {
      return c.json({ online: false }, 200)
    }

    const data = (await res.json().catch(() => null)) as {
      ok?: unknown
      comfyReady?: unknown
    } | null

    if (data && data.ok === true && data.comfyReady === true) {
      return c.json({ online: true, ready: true }, 200)
    }

    if (data && data.ok === true && data.comfyReady === false) {
      return c.json({ online: true, ready: false }, 200)
    }

    return c.json({ online: false }, 200)
  } catch {
    return c.json({ online: false }, 200)
  }
})

/**
 * 2. 提交生图：服务端校验与机器侧同规则（prompt 非空、≤1000 字符；size 只接受 portrait/square）。
 * 不合规直接 400 不转发。
 * 除未登录 401 外一律 HTTP 200、前端只认形状。
 */
genRoutes.post("/", async (c) => {
  const body = await readJsonBody<Partial<GenerateRequestBody>>(c)
  if (!body) {
    return c.json({ error: "Invalid request body" }, 400)
  }

  if (
    typeof body.prompt !== "string" ||
    body.prompt.trim().length === 0 ||
    body.prompt.length > 1000
  ) {
    return c.json(
      {
        error: "Invalid prompt: must be non-empty and at most 1000 characters"
      },
      400
    )
  }

  if (body.size !== "portrait" && body.size !== "square") {
    return c.json(
      { error: "Invalid size: must be 'portrait' or 'square'" },
      400
    )
  }

  if (
    body.model !== undefined &&
    body.model !== null &&
    !isValidModel(body.model)
  ) {
    return c.json(
      {
        error: `Invalid model: must be one of ${ALLOWED_MODELS.join(", ")}`
      },
      400
    )
  }

  const selectedModel: GenerationModel =
    body.model === undefined || body.model === null ? DEFAULT_MODEL : body.model

  const { translated, effectivePrompt } = await resolvePrompt(
    c.env.AI,
    body.prompt
  )

  const machineUrl = c.env.PIX_SERVER_URL
  if (!machineUrl) {
    return c.json({ online: false }, 200)
  }

  try {
    const targetUrl = buildMachineUrl(machineUrl, "/generate")
    const headers = {
      ...machineHeaders(machineUrl, c.env.PIX_SERVER_SECRET),
      "Content-Type": "application/json"
    }

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: effectivePrompt,
        size: body.size,
        model: selectedModel
      }),
      signal: AbortSignal.timeout(10000)
    })

    if (res.status === 202) {
      const data = (await res.json().catch(() => null)) as {
        jobId?: unknown
      } | null
      if (data && typeof data.jobId === "string" && data.jobId.length > 0) {
        const jobId = data.jobId
        const userId = currentUserId(c)
        if (c.env.IMAGES) {
          try {
            await c.env.IMAGES.put(
              `_pending/${jobId}.json`,
              JSON.stringify({
                userId,
                promptOriginal: body.prompt,
                promptEffective: effectivePrompt,
                size: body.size,
                model: selectedModel,
                createdAt: new Date().toISOString()
              })
            )
          } catch (err) {
            console.warn("Failed to stage pending metadata:", err)
          }
        }
        return c.json(
          {
            jobId,
            translated,
            effectivePrompt
          },
          200
        )
      }
      return c.json({ online: false }, 200)
    }

    if (res.status === 409) {
      return c.json({ busy: true }, 200)
    }

    if (res.status === 503) {
      return c.json({ ready: false }, 200)
    }

    return c.json({ online: false }, 200)
  } catch {
    return c.json({ online: false }, 200)
  }
})

/**
 * 3. 查任务状态：转发机器状态。
 */
genRoutes.get("/status/:jobId", async (c) => {
  const jobId = c.req.param("jobId")
  if (!jobId || typeof jobId !== "string" || jobId.trim().length === 0) {
    return c.json({ error: "Invalid jobId" }, 400)
  }

  const machineUrl = c.env.PIX_SERVER_URL
  if (!machineUrl) {
    return c.json({ error: "Machine unreachable" }, 502)
  }

  try {
    const targetUrl = buildMachineUrl(
      machineUrl,
      `/status/${encodeURIComponent(jobId)}`
    )
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: machineHeaders(machineUrl, c.env.PIX_SERVER_SECRET),
      signal: AbortSignal.timeout(8000)
    })

    const data = (await res.json().catch(() => null)) as unknown
    if (data !== null) {
      return c.json(data, res.status as any)
    }
    return c.json({ error: "Machine returned non-JSON response" }, 502)
  } catch {
    return c.json({ error: "Machine unreachable" }, 502)
  }
})

/**
 * 4. 取图：流式透传 image/png，不落存储、不加公共缓存。
 */
genRoutes.get("/image/:jobId", async (c) => {
  const jobId = c.req.param("jobId")
  if (!jobId || typeof jobId !== "string" || jobId.trim().length === 0) {
    return c.json({ error: "Invalid jobId" }, 400)
  }

  const machineUrl = c.env.PIX_SERVER_URL
  if (!machineUrl) {
    return c.json({ error: "Machine unreachable" }, 502)
  }

  try {
    const targetUrl = buildMachineUrl(
      machineUrl,
      `/image/${encodeURIComponent(jobId)}`
    )
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: machineHeaders(machineUrl, c.env.PIX_SERVER_SECRET),
      signal: AbortSignal.timeout(15000)
    })

    if (res.status === 200) {
      const imageBytes = await res.arrayBuffer()

      const persistPromise = (async () => {
        try {
          const prefix = getTablePrefix(c.env)
          const existing = await findGenerationByJobId(c.env.DB, prefix, jobId)
          if (existing || !c.env.IMAGES) {
            return
          }

          const pendingKey = `_pending/${jobId}.json`
          const pendingObj = await c.env.IMAGES.get(pendingKey).catch(
            () => null
          )
          let userId = currentUserId(c)
          let promptOriginal = ""
          let promptEffective = ""
          let size: "portrait" | "square" = "square"
          let model: GenerationModel = DEFAULT_MODEL
          let createdAt = new Date().toISOString()

          if (pendingObj) {
            const meta = (await pendingObj.json().catch(() => null)) as {
              userId?: number
              promptOriginal?: string
              promptEffective?: string
              size?: "portrait" | "square"
              model?: string
              createdAt?: string
            } | null
            if (meta) {
              if (typeof meta.userId === "number") userId = meta.userId
              if (typeof meta.promptOriginal === "string")
                promptOriginal = meta.promptOriginal
              if (typeof meta.promptEffective === "string")
                promptEffective = meta.promptEffective
              if (meta.size === "portrait" || meta.size === "square")
                size = meta.size
              if (isValidModel(meta.model)) model = meta.model
              if (typeof meta.createdAt === "string") createdAt = meta.createdAt
            }
          }

          const r2Key = `${userId}/${jobId}.png`
          await c.env.IMAGES.put(r2Key, imageBytes, {
            httpMetadata: { contentType: "image/png" }
          })

          await insertGeneration(c.env.DB, prefix, {
            userId,
            jobId,
            model,
            promptOriginal,
            promptEffective,
            size,
            r2Key,
            createdAt
          })

          if (pendingObj) {
            await c.env.IMAGES.delete(pendingKey).catch(() => null)
          }
        } catch (err) {
          console.warn("Failed to persist generation to R2/D1:", err)
        }
      })()

      try {
        c.executionCtx.waitUntil(persistPromise)
      } catch {
        await persistPromise
      }

      return new Response(imageBytes, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, no-cache, no-store, must-revalidate"
        }
      })
    }

    const contentType = res.headers.get("content-type") || "application/json"
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      }
    })
  } catch {
    return c.json({ error: "Machine unreachable" }, 502)
  }
})

/**
 * 5. 历史列表：GET /api/gen/history?page=&pageSize=
 * 当前用户历史列表，按 id 倒序；项含 id（编号）、prompt_original、prompt_effective、size、created_at、imageUrl。
 */
genRoutes.get("/history", async (c) => {
  const prefix = getTablePrefix(c.env)
  const userId = currentUserId(c)

  const pageParam = parseInt(c.req.query("page") || "1", 10)
  const page = Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam

  const pageSizeParam = parseInt(c.req.query("pageSize") || "12", 10)
  const pageSize =
    Number.isNaN(pageSizeParam) || pageSizeParam < 1
      ? 12
      : Math.min(100, pageSizeParam)

  const offset = (page - 1) * pageSize
  const { rows, total } = await listGenerationsByUser(
    c.env.DB,
    prefix,
    userId,
    pageSize,
    offset
  )

  const totalPages = Math.ceil(total / pageSize)

  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      job_id: r.job_id,
      model: r.model,
      prompt_original: r.prompt_original,
      prompt_effective: r.prompt_effective,
      size: r.size,
      created_at: r.created_at,
      imageUrl: `/api/gen/history/${r.id}/image`
    })),
    total,
    page,
    pageSize,
    totalPages
  })
})

/**
 * 6. 历史取图：GET /api/gen/history/:id/image
 * 从 R2 流出原图；?download=1 加 Content-Disposition: attachment，文件名 <slug>-<编号>.png。
 * 只能读自己的，非本人或不存在返回 404。
 */
genRoutes.get("/history/:id/image", async (c) => {
  const id = parseInt(c.req.param("id"), 10)
  if (Number.isNaN(id) || id <= 0) {
    return c.json({ error: "Generation not found" }, 404)
  }

  const prefix = getTablePrefix(c.env)
  const userId = currentUserId(c)
  const item = await findGenerationByIdAndUser(c.env.DB, prefix, id, userId)
  if (!item) {
    return c.json({ error: "Generation not found" }, 404)
  }

  if (!c.env.IMAGES) {
    return c.json({ error: "Image not found" }, 404)
  }

  const obj = await c.env.IMAGES.get(item.r2_key)
  if (!obj) {
    return c.json({ error: "Image not found" }, 404)
  }

  const headers: Record<string, string> = {
    "Content-Type": "image/png",
    "Cache-Control": "private, no-cache, no-store, must-revalidate"
  }

  if (c.req.query("download") === "1") {
    headers["Content-Disposition"] =
      `attachment; filename="${PROJECT_SLUG}-${item.id}.png"`
  }

  return new Response(obj.body, {
    status: 200,
    headers
  })
})

/**
 * 7. 删除历史：DELETE /api/gen/history/:id
 * 删 R2 对象 + 索引行；只能删自己的，非本人或不存在返回 404。
 */
genRoutes.delete("/history/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10)
  if (Number.isNaN(id) || id <= 0) {
    return c.json({ error: "Generation not found" }, 404)
  }

  const prefix = getTablePrefix(c.env)
  const userId = currentUserId(c)
  const item = await findGenerationByIdAndUser(c.env.DB, prefix, id, userId)
  if (!item) {
    return c.json({ error: "Generation not found" }, 404)
  }

  if (c.env.IMAGES) {
    try {
      await c.env.IMAGES.delete(item.r2_key)
    } catch (err) {
      console.warn("Failed to delete R2 object:", err)
    }
  }

  await deleteGenerationByIdAndUser(c.env.DB, prefix, id, userId)

  return c.json({ success: true }, 200)
})
