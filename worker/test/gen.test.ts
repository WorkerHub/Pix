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
import { buildMachineUrl } from "../src/routes/gen"
import {
  activePrefix,
  initializedContext,
  request,
  seedSession,
  type TestContext
} from "./support/app"

const MOCK_SERVER_URL =
  "https://mock-machine.test:8190/base?token=instabox_secret"
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

  it("保留子路径与 query string 中的平台令牌", () => {
    expect(
      buildMachineUrl(
        "https://instabox.example.com/port/8190?token=access_token_abc",
        "/generate"
      )
    ).toBe(
      "https://instabox.example.com/port/8190/generate?token=access_token_abc"
    )
  })

  it("支持不带前置斜杠的子路径", () => {
    expect(buildMachineUrl("http://127.0.0.1:8190", "status/job-1")).toBe(
      "http://127.0.0.1:8190/status/job-1"
    )
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

    // 验证请求机器的 URL 与请求头
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [callUrl, callInit] = fetchMock.mock.calls[0]
    expect(callUrl).toBe(
      "https://mock-machine.test:8190/base/health?token=instabox_secret"
    )
    const reqHeaders = (callInit?.headers ?? {}) as Record<string, string>
    expect(reqHeaders[MACHINE_AUTH_HEADER]).toBe(MOCK_SERVER_SECRET)
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
    expect(body).toEqual({ jobId: "job-abc-456" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [callUrl, callInit] = fetchMock.mock.calls[0]
    expect(callUrl).toBe(
      "https://mock-machine.test:8190/base/generate?token=instabox_secret"
    )
    const reqHeaders = (callInit?.headers ?? {}) as Record<string, string>
    expect(reqHeaders[MACHINE_AUTH_HEADER]).toBe(MOCK_SERVER_SECRET)
    expect(callInit?.body).toBe(
      JSON.stringify({ prompt: "cyberpunk city", size: "square" })
    )
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
    expect(body).toEqual({ jobId: "job-exact-1000" })
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

    for (const expected of states) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
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
})
