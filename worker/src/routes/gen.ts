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
import { MACHINE_AUTH_HEADER } from "../config/project"
import { readJsonBody } from "../lib/http"
import type { HonoEnv } from "../types"

export const genRoutes = new Hono<HonoEnv>()

export interface GenerateRequestBody {
  prompt: string
  size: "portrait" | "square"
}

/**
 * 拼装机器侧 URL：保留基地址中可能携带的路径与平台令牌（query string）。
 */
export function buildMachineUrl(baseUrl: string, subPath: string): string {
  try {
    const url = new URL(baseUrl)
    const basePath = url.pathname.replace(/\/+$/, "")
    const normalizedSub = subPath.startsWith("/") ? subPath : `/${subPath}`
    url.pathname = `${basePath}${normalizedSub}`
    return url.toString()
  } catch {
    const trimmed = baseUrl.replace(/\/+$/, "")
    const normalizedSub = subPath.startsWith("/") ? subPath : `/${subPath}`
    return `${trimmed}${normalizedSub}`
  }
}

function machineHeaders(secret?: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (secret) {
    headers[MACHINE_AUTH_HEADER] = secret
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
      headers: machineHeaders(c.env.PIX_SERVER_SECRET),
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

  const machineUrl = c.env.PIX_SERVER_URL
  if (!machineUrl) {
    return c.json({ online: false }, 200)
  }

  try {
    const targetUrl = buildMachineUrl(machineUrl, "/generate")
    const headers = {
      ...machineHeaders(c.env.PIX_SERVER_SECRET),
      "Content-Type": "application/json"
    }

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: body.prompt, size: body.size }),
      signal: AbortSignal.timeout(10000)
    })

    if (res.status === 202) {
      const data = (await res.json().catch(() => null)) as {
        jobId?: unknown
      } | null
      if (data && typeof data.jobId === "string" && data.jobId.length > 0) {
        return c.json({ jobId: data.jobId }, 200)
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
      headers: machineHeaders(c.env.PIX_SERVER_SECRET),
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
      headers: machineHeaders(c.env.PIX_SERVER_SECRET),
      signal: AbortSignal.timeout(15000)
    })

    if (res.status === 200) {
      return new Response(res.body, {
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
