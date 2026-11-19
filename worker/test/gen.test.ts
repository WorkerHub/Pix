/**
 * 生图接口（规格 §5）与机器契约（§4.4）转发自动化测试。
 *
 * 覆盖：
 * 1. 4 个接口必须全部要求登录态（未登录 401 JSON + no-store）；
 * 2. GET /api/gen/health：转问机器 /health，超时与异常映射为 {"online":false}，就绪状态映射；
 * 3. POST /api/gen：服务端参数校验（prompt 非空、≤1000 字符；size 枚举），不合规直接 400 不转发；
 * 4. POST /api/gen：机器响应映射（202 → jobId, 409 → busy, 503 → ready:false, 连不上 → online:false），一律 HTTP 200；
 * 5. GET /api/gen/status/:jobId：状态透传（200 / 404 / 502）；
 * 6. GET /api/gen/image/:jobId：流式透传 image/png、不加公共缓存、未完成 409 / 404；
 * 7. buildMachineUrl 基地址与 query string（平台令牌）拼装；
 * 8. 机器代理密钥请求头传递。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MACHINE_AUTH_HEADER } from "../src/config/project"
import { findGenerationByJobId } from "../src/db/queries/generations"
import {
  buildMachineUrl,
  extractMachineToken,
  machineHeaders
} from "../src/routes/gen"
import {
  activePrefix,
  initializedContext,
  request,
  seedSession,
  type TestContext
} from "./support/app"
import { MockAi } from "./support/mock-ai"
import type { MockR2Bucket } from "./support/mock-r2"

const MOCK_SERVER_URL =
  "https://mock-machine.test:8190/base?_token=instabox_secret"
const MOCK_SERVER_SECRET = "shared-secret-123"

describe("buildMachineUrl", () => {
  it("正确处理末尾无斜杠的基地址", () => {
    expect(buildMachineUrl("http://127.0.0.1:8190", "/health")).toBe(
      "http://127.0.0.1:8190/health"
    )
  })

  it("正确处理末尾有斜杠的基地址", () => {
    expect(buildMachineUrl("http://127.0.0.1:8190/", "/health")).toBe(
      "http://127.0.0.1:8190/health"
    )
  })

  it("拼装子路径时去除基地址中的 query string 平台令牌（生成干净 URL）", () => {
    expect(
      buildMachineUrl(
        "https://instabox.example.com/port/8190?_token=access_token_abc",
        "/generate"
      )
    ).toBe("https://instabox.example.com/port/8190/generate")
  })

  it("支持不带前置斜杠的子路径", () => {
    expect(buildMachineUrl("http://127.0.0.1:8190", "status/job-1")).toBe(
      "http://127.0.0.1:8190/status/job-1"
    )
  })
})

describe("extractMachineToken", () => {
  it("成功从带 _token 的基地址中提取平台令牌", () => {
    expect(
      extractMachineToken(
        "https://instabox.example.com/port/8190?_token=secret_tok_123"
      )
    ).toBe("secret_tok_123")
  })

  it("基地址包含多个查询参数时正确提取 _token", () => {
    expect(
      extractMachineToken(
        "https://instabox.example.com/port/8190?foo=bar&_token=secret_tok_123&baz=qux"
      )
    ).toBe("secret_tok_123")
  })

  it("无 _token 或 _token 为空时返回 null", () => {
    expect(
      extractMachineToken("https://instabox.example.com/port/8190")
    ).toBeNull()
    expect(
      extractMachineToken(
        "https://instabox.example.com/port/8190?token=legacy_without_underscore"
      )
    ).toBeNull()
    expect(
      extractMachineToken("https://instabox.example.com/port/8190?_token=")
    ).toBeNull()
    expect(extractMachineToken(undefined)).toBeNull()
  })
})

describe("machineHeaders", () => {
  it("同时提供 secret 与带 _token 的基地址时同时携带两个头", () => {
    const headers = machineHeaders(
      "https://mock-machine.test:8190?_token=my_bearer_token",
      "my_secret"
    )
    expect(headers).toEqual({
      [MACHINE_AUTH_HEADER]: "my_secret",
      Authorization: "Bearer my_bearer_token"
    })
  })

  it("基地址不带 _token 时仅携带机器代理密钥头，不带 Authorization 头", () => {
    const headers = machineHeaders("http://127.0.0.1:8190", "my_secret")
    expect(headers).toEqual({
      [MACHINE_AUTH_HEADER]: "my_secret"
    })
    expect(headers.Authorization).toBeUndefined()
  })

  it("未提供 secret 时仅携带 Authorization 头", () => {
    const headers = machineHeaders(
      "https://mock-machine.test:8190?_token=my_bearer_token"
    )
    expect(headers).toEqual({
      Authorization: "Bearer my_bearer_token"
    })
    expect(headers[MACHINE_AUTH_HEADER]).toBeUndefined()
  })

  it("既无 secret 也无 _token 时返回空请求头对象", () => {
    expect(machineHeaders("http://127.0.0.1:8190")).toEqual({})
  })
})

describe("生图接口权限守卫（未登录 401 JSON + no-store）", () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await initializedContext({
      PIX_SERVER_URL: MOCK_SERVER_URL,
      PIX_SERVER_SECRET: MOCK_SERVER_SECRET
    })
  })

  it("GET /api/gen/health 未登录返回 401", async () => {
    const res = await request(ctx.env, "/api/gen/health")
    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toContain("no-store")
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe("Unauthorized")
  })

  it("POST /api/gen 未登录返回 401", async () => {
    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a cat", size: "portrait" })
    })
    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toContain("no-store")
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe("Unauthorized")
  })

  it("GET /api/gen/status/:jobId 未登录返回 401", async () => {
    const res = await request(ctx.env, "/api/gen/status/job-test")
    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toContain("no-store")
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe("Unauthorized")
  })

  it("GET /api/gen/image/:jobId 未登录返回 401", async () => {
    const res = await request(ctx.env, "/api/gen/image/job-test")
    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toContain("no-store")
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe("Unauthorized")
  })
})

describe("GET /api/gen/health", () => {
  let ctx: TestContext
  let authCookie: string

  beforeEach(async () => {
    ctx = await initializedContext({
      PIX_SERVER_URL: MOCK_SERVER_URL,
      PIX_SERVER_SECRET: MOCK_SERVER_SECRET
    })
    const session = await seedSession(ctx.db, activePrefix(ctx.env))
    authCookie = session.cookie
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('通了且 ComfyUI 就绪 → 200 {"online":true,"ready":true}', async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, comfyReady: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    )

    const res = await request(ctx.env, "/api/gen/health", {
      headers: { Cookie: authCookie }
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ online: true, ready: true })

    // 验证请求机器的 URL 与请求头（干净 URL + Bearer 鉴权头）
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [callUrl, callInit] = fetchMock.mock.calls[0]
    expect(callUrl).toBe("https://mock-machine.test:8190/base/health")
    const reqHeaders = (callInit?.headers ?? {}) as Record<string, string>
    expect(reqHeaders[MACHINE_AUTH_HEADER]).toBe(MOCK_SERVER_SECRET)
    expect(reqHeaders.Authorization).toBe("Bearer instabox_secret")
  })

  it("当 PIX_SERVER_URL 不含 _token 时，健康检查不携带 Authorization 头", async () => {
    const plainCtx = await initializedContext({
      PIX_SERVER_URL: "http://127.0.0.1:8190",
      PIX_SERVER_SECRET: MOCK_SERVER_SECRET
    })
    const session = await seedSession(plainCtx.db, activePrefix(plainCtx.env))

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, comfyReady: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    )

    const res = await request(plainCtx.env, "/api/gen/health", {
      headers: { Cookie: session.cookie }
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [callUrl, callInit] = fetchMock.mock.calls[0]
    expect(callUrl).toBe("http://127.0.0.1:8190/health")
    const reqHeaders = (callInit?.headers ?? {}) as Record<string, string>
    expect(reqHeaders[MACHINE_AUTH_HEADER]).toBe(MOCK_SERVER_SECRET)
    expect(reqHeaders.Authorization).toBeUndefined()
  })

  it('通了但 ComfyUI 未就绪 → 200 {"online":true,"ready":false}', async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, comfyReady: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    )

    const res = await request(ctx.env, "/api/gen/health", {
      headers: { Cookie: authCookie }
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ online: true, ready: false })
  })

  it('机器返回非 200（如 502/500）→ 200 {"online":false}，不抛 5xx', async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Bad Gateway", { status: 502 })
    )

    const res = await request(ctx.env, "/api/gen/health", {
      headers: { Cookie: authCookie }
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ online: false })
  })

  it('机器连接超时或抛出网络异常 → 200 {"online":false}，不抛 5xx', async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network timeout or connection refused")
    )

    const res = await request(ctx.env, "/api/gen/health", {
      headers: { Cookie: authCookie }
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ online: false })
  })

  it('未配置 PIX_SERVER_URL → 200 {"online":false}', async () => {
    const noUrlCtx = await initializedContext({
      PIX_SERVER_URL: undefined
    })
    const session = await seedSession(noUrlCtx.db, activePrefix(noUrlCtx.env))

    const res = await request(noUrlCtx.env, "/api/gen/health", {
      headers: { Cookie: session.cookie }
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ online: false })
  })
})

describe("POST /api/gen 服务端校验", () => {
  let ctx: TestContext
  let authCookie: string

  beforeEach(async () => {
    ctx = await initializedContext({
      PIX_SERVER_URL: MOCK_SERVER_URL,
      PIX_SERVER_SECRET: MOCK_SERVER_SECRET
    })
    const session = await seedSession(ctx.db, activePrefix(ctx.env))
    authCookie = session.cookie
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("请求体非 JSON 或为空时返回 400 不转发", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "text/plain" },
      body: "invalid-json"
    })

    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("prompt 缺失或非字符串返回 400 不转发", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ size: "portrait" })
    })

    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("prompt 为空串或纯空白字符返回 400 不转发", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "   \n\t  ", size: "portrait" })
    })

    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("prompt 超过 1000 字符返回 400 不转发", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const longPrompt = "a".repeat(1001)
    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: longPrompt, size: "portrait" })
    })

    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("size 缺失或不在枚举（portrait / square）中返回 400 不转发", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    // 缺少 size
    let res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "valid prompt" })
    })
    expect(res.status).toBe(400)

    // 非法 size 枚举
    res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "valid prompt", size: "landscape" })
    })
    expect(res.status).toBe(400)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("model 非法（不在五个允许 ID 中）返回 400 不转发", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "valid prompt",
        size: "portrait",
        model: "not-a-model"
      })
    })

    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("POST /api/gen 正常转发与形状映射（一律 HTTP 200）", () => {
  let ctx: TestContext
  let authCookie: string

  beforeEach(async () => {
    ctx = await initializedContext({
      PIX_SERVER_URL: MOCK_SERVER_URL,
      PIX_SERVER_SECRET: MOCK_SERVER_SECRET
    })
    const session = await seedSession(ctx.db, activePrefix(ctx.env))
    authCookie = session.cookie
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('成功：机器回 202 {"jobId":"..."} → 200 {"jobId":"..."}', async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jobId: "job-abc-456" }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      })
    )

    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "cyberpunk city", size: "square" })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({
      jobId: "job-abc-456",
      translated: false,
      effectivePrompt: "cyberpunk city"
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [callUrl, callInit] = fetchMock.mock.calls[0]
    expect(callUrl).toBe("https://mock-machine.test:8190/base/generate")
    const reqHeaders = (callInit?.headers ?? {}) as Record<string, string>
    expect(reqHeaders[MACHINE_AUTH_HEADER]).toBe(MOCK_SERVER_SECRET)
    expect(reqHeaders.Authorization).toBe("Bearer instabox_secret")
    expect(callInit?.body).toBe(
      JSON.stringify({
        prompt: "cyberpunk city",
        size: "square",
        model: "realistic-lcm"
      })
    )
  })

  it("显式 model 透传给机器请求体", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jobId: "job-model-1" }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      })
    )

    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "a cat",
        size: "portrait",
        model: "dreamshaper"
      })
    })

    expect(res.status).toBe(200)
    const [, callInit] = fetchMock.mock.calls[0]
    expect(callInit?.body).toBe(
      JSON.stringify({
        prompt: "a cat",
        size: "portrait",
        model: "dreamshaper"
      })
    )
  })

  it("当 PIX_SERVER_URL 不含 _token 时，生图请求不携带 Authorization 头", async () => {
    const plainCtx = await initializedContext({
      PIX_SERVER_URL: "http://127.0.0.1:8190",
      PIX_SERVER_SECRET: MOCK_SERVER_SECRET
    })
    const session = await seedSession(plainCtx.db, activePrefix(plainCtx.env))

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jobId: "job-plain-1" }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      })
    )

    const res = await request(plainCtx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: session.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a cat", size: "portrait" })
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [callUrl, callInit] = fetchMock.mock.calls[0]
    expect(callUrl).toBe("http://127.0.0.1:8190/generate")
    const reqHeaders = (callInit?.headers ?? {}) as Record<string, string>
    expect(reqHeaders[MACHINE_AUTH_HEADER]).toBe(MOCK_SERVER_SECRET)
    expect(reqHeaders.Authorization).toBeUndefined()
  })

  it("正好 1000 字符 prompt 能够成功转发", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jobId: "job-exact-1000" }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      })
    )

    const exactPrompt = "p".repeat(1000)
    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: exactPrompt, size: "portrait" })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({
      jobId: "job-exact-1000",
      translated: false,
      effectivePrompt: exactPrompt
    })
  })

  it("中文 prompt 触发 Workers AI 翻译，返回 translated=true 及有效英文提示词，并向机器发送翻译后提示词", async () => {
    const ai = new MockAi(async () => ({
      translated_text: "Cyberpunk panda warrior"
    }))
    const aiCtx = await initializedContext({
      PIX_SERVER_URL: MOCK_SERVER_URL,
      PIX_SERVER_SECRET: MOCK_SERVER_SECRET,
      AI: ai as unknown as Ai
    })
    const session = await seedSession(aiCtx.db, activePrefix(aiCtx.env))

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jobId: "job-panda-1" }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      })
    )

    const res = await request(aiCtx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: session.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "赛博朋克熊猫战士", size: "portrait" })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({
      jobId: "job-panda-1",
      translated: true,
      effectivePrompt: "Cyberpunk panda warrior"
    })

    const [, callInit] = fetchMock.mock.calls[0]
    expect(callInit?.body).toBe(
      JSON.stringify({
        prompt: "Cyberpunk panda warrior",
        size: "portrait",
        model: "realistic-lcm"
      })
    )

    const r2 = aiCtx.env.IMAGES as unknown as MockR2Bucket
    const pendingObj = await r2.get("_pending/job-panda-1.json")
    expect(pendingObj).not.toBeNull()
    const meta = await pendingObj?.json()
    expect(meta).toMatchObject({
      userId: session.userId,
      promptOriginal: "赛博朋克熊猫战士",
      promptEffective: "Cyberpunk panda warrior",
      size: "portrait"
    })
  })

  it('机器忙：机器回 409 → 200 {"busy":true}', async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "busy" }), {
        status: 409,
        headers: { "Content-Type": "application/json" }
      })
    )

    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a cute cat", size: "portrait" })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ busy: true })
  })

  it('机器未就绪：机器回 503 → 200 {"ready":false}', async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "starting" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      })
    )

    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a cute cat", size: "portrait" })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ ready: false })
  })

  it('机器不可达（超时 / 网络错误）→ 200 {"online":false}', async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Connection refused")
    )

    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a cute cat", size: "portrait" })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ online: false })
  })

  it('机器返回其他状态码（如 500 / 401 密钥错）→ 200 {"online":false}', async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 })
    )

    const res = await request(ctx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: authCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a cute cat", size: "portrait" })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ online: false })
  })

  it('未配置 PIX_SERVER_URL → 200 {"online":false}', async () => {
    const noUrlCtx = await initializedContext({
      PIX_SERVER_URL: undefined
    })
    const session = await seedSession(noUrlCtx.db, activePrefix(noUrlCtx.env))

    const res = await request(noUrlCtx.env, "/api/gen", {
      method: "POST",
      headers: { Cookie: session.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a cute cat", size: "portrait" })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ online: false })
  })
})

describe("GET /api/gen/status/:jobId 状态转发", () => {
  let ctx: TestContext
  let authCookie: string

  beforeEach(async () => {
    ctx = await initializedContext({
      PIX_SERVER_URL: MOCK_SERVER_URL,
      PIX_SERVER_SECRET: MOCK_SERVER_SECRET
    })
    const session = await seedSession(ctx.db, activePrefix(ctx.env))
    authCookie = session.cookie
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("转发机器正常状态（queued / running / done / error）", async () => {
    const states = [
      { state: "queued" },
      { state: "running" },
      { state: "done" },
      { state: "error", error: "OOM killed" }
    ]

    for (const [index, expected] of states.entries()) {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(expected), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )

      const res = await request(ctx.env, "/api/gen/status/job-123", {
        headers: { Cookie: authCookie }
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body).toEqual(expected)

      if (index === 0) {
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [callUrl, callInit] = fetchMock.mock.calls[0]
        expect(callUrl).toBe(
          "https://mock-machine.test:8190/base/status/job-123"
        )
        const reqHeaders = (callInit?.headers ?? {}) as Record<string, string>
        expect(reqHeaders[MACHINE_AUTH_HEADER]).toBe(MOCK_SERVER_SECRET)
        expect(reqHeaders.Authorization).toBe("Bearer instabox_secret")
      }
    }
  })

  it("机器返回 404 时透传 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      })
    )

    const res = await request(ctx.env, "/api/gen/status/unknown-job", {
      headers: { Cookie: authCookie }
    })

    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ error: "Job not found" })
  })

  it("机器连不上或异常时返回 502", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Connection refused")
    )

    const res = await request(ctx.env, "/api/gen/status/job-123", {
      headers: { Cookie: authCookie }
    })

    expect(res.status).toBe(502)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe("Machine unreachable")
  })

  it("未配置 PIX_SERVER_URL 时返回 502", async () => {
    const noUrlCtx = await initializedContext({
      PIX_SERVER_URL: undefined
    })
    const session = await seedSession(noUrlCtx.db, activePrefix(noUrlCtx.env))

    const res = await request(noUrlCtx.env, "/api/gen/status/job-123", {
      headers: { Cookie: session.cookie }
    })

    expect(res.status).toBe(502)
  })
})

describe("GET /api/gen/image/:jobId 取图流式透传与无公共缓存", () => {
  let ctx: TestContext
  let authCookie: string

  beforeEach(async () => {
    ctx = await initializedContext({
      PIX_SERVER_URL: MOCK_SERVER_URL,
      PIX_SERVER_SECRET: MOCK_SERVER_SECRET
    })
    const session = await seedSession(ctx.db, activePrefix(ctx.env))
    authCookie = session.cookie
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("完成时：流式透传 image/png，带 no-store / private 缓存头", async () => {
    const fakeImageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(fakeImageData, {
        status: 200,
        headers: { "Content-Type": "image/png" }
      })
    )

    const res = await request(ctx.env, "/api/gen/image/job-finished", {
      headers: { Cookie: authCookie }
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    const cacheControl = res.headers.get("cache-control") || ""
    expect(cacheControl).toContain("no-store")
    expect(cacheControl).toContain("private")

    const arrayBuffer = await res.arrayBuffer()
    expect(new Uint8Array(arrayBuffer)).toEqual(fakeImageData)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [callUrl, callInit] = fetchMock.mock.calls[0]
    expect(callUrl).toBe(
      "https://mock-machine.test:8190/base/image/job-finished"
    )
    const reqHeaders = (callInit?.headers ?? {}) as Record<string, string>
    expect(reqHeaders[MACHINE_AUTH_HEADER]).toBe(MOCK_SERVER_SECRET)
    expect(reqHeaders.Authorization).toBe("Bearer instabox_secret")
  })

  it("未完成时：机器返回 409 透传 409", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "image not ready" }), {
        status: 409,
        headers: { "Content-Type": "application/json" }
      })
    )

    const res = await request(ctx.env, "/api/gen/image/job-pending", {
      headers: { Cookie: authCookie }
    })

    expect(res.status).toBe(409)
  })

  it("未知任务：机器返回 404 透传 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "job not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      })
    )

    const res = await request(ctx.env, "/api/gen/image/job-not-found", {
      headers: { Cookie: authCookie }
    })

    expect(res.status).toBe(404)
  })

  it("机器不可达时返回 502", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Connection reset")
    )

    const res = await request(ctx.env, "/api/gen/image/job-test", {
      headers: { Cookie: authCookie }
    })

    expect(res.status).toBe(502)
  })

  it("未配置 PIX_SERVER_URL 时返回 502", async () => {
    const noUrlCtx = await initializedContext({
      PIX_SERVER_URL: undefined
    })
    const session = await seedSession(noUrlCtx.db, activePrefix(noUrlCtx.env))

    const res = await request(noUrlCtx.env, "/api/gen/image/job-test", {
      headers: { Cookie: session.cookie }
    })

    expect(res.status).toBe(502)
  })

  it("完成时：持久化图片到 R2 与 D1，消费并清理 pending 元数据，且幂等", async () => {
    const r2 = ctx.env.IMAGES as unknown as MockR2Bucket
    const prefix = activePrefix(ctx.env)
    const session = await seedSession(ctx.db, prefix, {
      email: "persist-user@example.test"
    })

    // 预先存入 pending 元数据
    await r2.put(
      "_pending/job-persist-1.json",
      JSON.stringify({
        userId: session.userId,
        promptOriginal: "赛博猫",
        promptEffective: "cyber cat",
        size: "portrait",
        createdAt: "2026-11-19T10:00:00.000Z"
      })
    )

    const fakeImageData = new Uint8Array([137, 80, 78, 71, 99, 88])
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(fakeImageData, {
          status: 200,
          headers: { "Content-Type": "image/png" }
        })
    )

    const res = await request(ctx.env, "/api/gen/image/job-persist-1", {
      headers: { Cookie: session.cookie }
    })
    expect(res.status).toBe(200)

    // R2 中已持久化到 <userId>/<jobId>.png
    const savedObj = await r2.get(`${session.userId}/job-persist-1.png`)
    expect(savedObj).not.toBeNull()
    expect(new Uint8Array(await savedObj!.arrayBuffer())).toEqual(fakeImageData)

    // D1 记录已落库
    const record = await findGenerationByJobId(
      ctx.env.DB,
      prefix,
      "job-persist-1"
    )
    expect(record).not.toBeNull()
    expect(record).toMatchObject({
      user_id: session.userId,
      job_id: "job-persist-1",
      prompt_original: "赛博猫",
      prompt_effective: "cyber cat",
      size: "portrait",
      r2_key: `${session.userId}/job-persist-1.png`
    })

    // pending 元数据已清理
    expect(await r2.get("_pending/job-persist-1.json")).toBeNull()

    // 再次调用该接口：幂等，不会抛错或重复插入
    const res2 = await request(ctx.env, "/api/gen/image/job-persist-1", {
      headers: { Cookie: session.cookie }
    })
    expect(res2.status).toBe(200)
  })

  it("pending 元数据缺失时不记历史：照常回图，不落 R2 / D1 空记录", async () => {
    const r2 = ctx.env.IMAGES as unknown as MockR2Bucket
    const prefix = activePrefix(ctx.env)
    const session = await seedSession(ctx.db, prefix, {
      email: "no-pending@example.test"
    })

    const fakeImageData = new Uint8Array([9, 9, 9])
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(fakeImageData, {
        status: 200,
        headers: { "Content-Type": "image/png" }
      })
    )

    const res = await request(ctx.env, "/api/gen/image/job-no-pending", {
      headers: { Cookie: session.cookie }
    })
    expect(res.status).toBe(200)

    // 不落任何 R2 对象、不写 D1 记录（不产生 prompt 为空的废记录）
    expect(await r2.get(`${session.userId}/job-no-pending.png`)).toBeNull()
    const record = await findGenerationByJobId(
      ctx.env.DB,
      prefix,
      "job-no-pending"
    )
    expect(record).toBeNull()
  })

  it("当 R2 或 D1 持久化发生异常时，不阻塞图片正常流式返回（容错保障）", async () => {
    const r2 = ctx.env.IMAGES as unknown as MockR2Bucket
    const prefix = activePrefix(ctx.env)
    const session = await seedSession(ctx.db, prefix, {
      email: "fail-storage@example.test"
    })

    // 预存 pending 元数据，确保代码走到 R2 put 路径（而非 pending 缺失提前返回）
    await r2.put(
      "_pending/job-fail-storage.json",
      JSON.stringify({
        userId: session.userId,
        promptOriginal: "fail storage",
        promptEffective: "fail storage",
        size: "square"
      })
    )

    // 破坏 put 方法以模拟 R2 故障
    vi.spyOn(r2, "put").mockRejectedValue(new Error("R2 storage unavailable"))

    const fakeImageData = new Uint8Array([1, 2, 3, 4])
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(fakeImageData, {
        status: 200,
        headers: { "Content-Type": "image/png" }
      })
    )

    const res = await request(ctx.env, "/api/gen/image/job-fail-storage", {
      headers: { Cookie: session.cookie }
    })

    // 即使存储异常，向客户端依然返回 200 与图片流
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes).toEqual(fakeImageData)
  })
})
