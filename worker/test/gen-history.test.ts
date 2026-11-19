import { beforeEach, describe, expect, it } from "vitest"
import { PROJECT_SLUG } from "../src/config/project"
import { insertGeneration } from "../src/db/queries/generations"
import {
  activePrefix,
  initializedContext,
  request,
  seedSession,
  type TestContext
} from "./support/app"
import type { MockR2Bucket } from "./support/mock-r2"

describe("生图历史接口（GET /api/gen/history, GET /image, DELETE）", () => {
  let ctx: TestContext
  let prefix: string
  let userA: { userId: number; cookie: string }
  let userB: { userId: number; cookie: string }
  let r2: MockR2Bucket

  beforeEach(async () => {
    ctx = await initializedContext()
    prefix = activePrefix(ctx.env)
    userA = await seedSession(ctx.db, prefix, { email: "userA@example.test" })
    userB = await seedSession(ctx.db, prefix, { email: "userB@example.test" })
    r2 = ctx.env.IMAGES as unknown as MockR2Bucket
  })

  describe("认证拦截（401）", () => {
    it("未登录请求 history 接口返回 401", async () => {
      const res = await request(ctx.env, "/api/gen/history")
      expect(res.status).toBe(401)
    })

    it("未登录请求 history/:id/image 接口返回 401", async () => {
      const res = await request(ctx.env, "/api/gen/history/1/image")
      expect(res.status).toBe(401)
    })

    it("未登录请求 DELETE history/:id 接口返回 401", async () => {
      const res = await request(ctx.env, "/api/gen/history/1", {
        method: "DELETE"
      })
      expect(res.status).toBe(401)
    })
  })

  describe("GET /api/gen/history 列表与分页", () => {
    it("无历史记录时返回空列表与默认分页元数据", async () => {
      const res = await request(ctx.env, "/api/gen/history", {
        headers: { Cookie: userA.cookie }
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 12,
        totalPages: 0
      })
    })

    it("只返回当前用户的记录，严格隔离其他用户", async () => {
      // 为 userA 插入 2 条，为 userB 插入 1 条
      await insertGeneration(ctx.env.DB, prefix, {
        userId: userA.userId,
        jobId: "job-a-1",
        promptOriginal: "赛博朋克猫",
        promptEffective: "cyberpunk cat",
        size: "square",
        r2Key: `${userA.userId}/job-a-1.png`,
        createdAt: "2026-11-19T10:00:00.000Z"
      })
      await insertGeneration(ctx.env.DB, prefix, {
        userId: userA.userId,
        jobId: "job-a-2",
        promptOriginal: "星际飞船",
        promptEffective: "starship",
        size: "portrait",
        r2Key: `${userA.userId}/job-a-2.png`,
        createdAt: "2026-11-19T10:05:00.000Z"
      })
      await insertGeneration(ctx.env.DB, prefix, {
        userId: userB.userId,
        jobId: "job-b-1",
        promptOriginal: "森林小屋",
        promptEffective: "cabin in the woods",
        size: "square",
        r2Key: `${userB.userId}/job-b-1.png`,
        createdAt: "2026-11-19T10:10:00.000Z"
      })

      const resA = await request(ctx.env, "/api/gen/history", {
        headers: { Cookie: userA.cookie }
      })
      expect(resA.status).toBe(200)
      const dataA = (await resA.json()) as {
        items: Array<{
          id: number
          job_id: string
          model: string
          prompt_original: string
          imageUrl: string
        }>
        total: number
      }
      expect(dataA.total).toBe(2)
      expect(dataA.items).toHaveLength(2)
      expect(dataA.items[0].job_id).toBe("job-a-2") // 倒序
      expect(dataA.items[0].model).toBe("realistic-lcm")
      expect(dataA.items[0].imageUrl).toBe(
        `/api/gen/history/${dataA.items[0].id}/image`
      )
      expect(dataA.items[1].job_id).toBe("job-a-1")

      const resB = await request(ctx.env, "/api/gen/history", {
        headers: { Cookie: userB.cookie }
      })
      expect(resB.status).toBe(200)
      const dataB = (await resB.json()) as {
        items: Array<{ job_id: string }>
        total: number
      }
      expect(dataB.total).toBe(1)
      expect(dataB.items[0].job_id).toBe("job-b-1")
    })

    it("支持分页、每页大小与边界限制（pageSize 上限 100）", async () => {
      // 插入 5 条
      for (let i = 1; i <= 5; i++) {
        await insertGeneration(ctx.env.DB, prefix, {
          userId: userA.userId,
          jobId: `job-p-${i}`,
          promptOriginal: `prompt ${i}`,
          promptEffective: `prompt ${i}`,
          size: "square",
          r2Key: `${userA.userId}/job-p-${i}.png`
        })
      }

      // page 1, pageSize 2
      const resPage1 = await request(
        ctx.env,
        "/api/gen/history?page=1&pageSize=2",
        {
          headers: { Cookie: userA.cookie }
        }
      )
      const data1 = (await resPage1.json()) as {
        items: Array<{ job_id: string }>
        total: number
        page: number
        pageSize: number
        totalPages: number
      }
      expect(data1.page).toBe(1)
      expect(data1.pageSize).toBe(2)
      expect(data1.total).toBe(5)
      expect(data1.totalPages).toBe(3)
      expect(data1.items).toHaveLength(2)

      // page 3, pageSize 2 (最后一页，只有 1 条)
      const resPage3 = await request(
        ctx.env,
        "/api/gen/history?page=3&pageSize=2",
        {
          headers: { Cookie: userA.cookie }
        }
      )
      const data3 = (await resPage3.json()) as {
        items: Array<{ job_id: string }>
      }
      expect(data3.items).toHaveLength(1)

      // 超出 100 的 pageSize 被收敛为 100
      const resBig = await request(ctx.env, "/api/gen/history?pageSize=500", {
        headers: { Cookie: userA.cookie }
      })
      const dataBig = (await resBig.json()) as { pageSize: number }
      expect(dataBig.pageSize).toBe(100)

      // 非法 page / pageSize 参数优雅兜底
      const resInvalid = await request(
        ctx.env,
        "/api/gen/history?page=-1&pageSize=abc",
        {
          headers: { Cookie: userA.cookie }
        }
      )
      const dataInvalid = (await resInvalid.json()) as {
        page: number
        pageSize: number
      }
      expect(dataInvalid.page).toBe(1)
      expect(dataInvalid.pageSize).toBe(12)
    })
  })

  describe("GET /api/gen/history/:id/image 历史图片读取与下载", () => {
    it("成功流出 R2 图片，默认带有私有不缓存响应头", async () => {
      const fakeImage = new Uint8Array([1, 2, 3, 4, 5])
      const r2Key = `${userA.userId}/job-img-1.png`
      await r2.put(r2Key, fakeImage)

      await insertGeneration(ctx.env.DB, prefix, {
        userId: userA.userId,
        jobId: "job-img-1",
        promptOriginal: "test prompt",
        promptEffective: "test prompt",
        size: "square",
        r2Key
      })

      const listRes = await request(ctx.env, "/api/gen/history", {
        headers: { Cookie: userA.cookie }
      })
      const listData = (await listRes.json()) as {
        items: Array<{ id: number }>
      }
      const item = listData.items[0]

      const res = await request(ctx.env, `/api/gen/history/${item.id}/image`, {
        headers: { Cookie: userA.cookie }
      })
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("image/png")
      const cacheControl = res.headers.get("cache-control") || ""
      expect(cacheControl).toContain("no-store")
      expect(cacheControl).toContain("private")
      expect(res.headers.get("content-disposition")).toBeNull()

      const bodyBytes = new Uint8Array(await res.arrayBuffer())
      expect(bodyBytes).toEqual(fakeImage)
    })

    it('携带 ?download=1 时增加 Content-Disposition: attachment; filename="<slug>-<id>.png"', async () => {
      const fakeImage = new Uint8Array([10, 20, 30])
      const r2Key = `${userA.userId}/job-dl-1.png`
      await r2.put(r2Key, fakeImage)

      await insertGeneration(ctx.env.DB, prefix, {
        userId: userA.userId,
        jobId: "job-dl-1",
        promptOriginal: "download prompt",
        promptEffective: "download prompt",
        size: "portrait",
        r2Key
      })

      const listRes = await request(ctx.env, "/api/gen/history", {
        headers: { Cookie: userA.cookie }
      })
      const { items } = (await listRes.json()) as {
        items: Array<{ id: number }>
      }
      const id = items[0].id

      const res = await request(
        ctx.env,
        `/api/gen/history/${id}/image?download=1`,
        {
          headers: { Cookie: userA.cookie }
        }
      )
      expect(res.status).toBe(200)
      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="${PROJECT_SLUG}-${id}.png"`
      )
    })

    it("访问不存在的 id 返回 404", async () => {
      const res = await request(ctx.env, "/api/gen/history/99999/image", {
        headers: { Cookie: userA.cookie }
      })
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data).toEqual({ error: "Generation not found" })
    })

    it("访问非数字或负数 id 返回 404", async () => {
      const res1 = await request(ctx.env, "/api/gen/history/invalid-id/image", {
        headers: { Cookie: userA.cookie }
      })
      expect(res1.status).toBe(404)

      const res2 = await request(ctx.env, "/api/gen/history/-1/image", {
        headers: { Cookie: userA.cookie }
      })
      expect(res2.status).toBe(404)
    })

    it("访问其他用户的记录严格返回 404（防枚举，禁止 403）", async () => {
      await insertGeneration(ctx.env.DB, prefix, {
        userId: userB.userId,
        jobId: "job-b-secret",
        promptOriginal: "secret",
        promptEffective: "secret",
        size: "square",
        r2Key: `${userB.userId}/job-b-secret.png`
      })

      const listRes = await request(ctx.env, "/api/gen/history", {
        headers: { Cookie: userB.cookie }
      })
      const { items } = (await listRes.json()) as {
        items: Array<{ id: number }>
      }
      const userBItemId = items[0].id

      // userA 尝试读取 userB 的图片
      const res = await request(
        ctx.env,
        `/api/gen/history/${userBItemId}/image`,
        {
          headers: { Cookie: userA.cookie }
        }
      )
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "Generation not found" })
    })

    it("R2 对象丢失时返回 404", async () => {
      await insertGeneration(ctx.env.DB, prefix, {
        userId: userA.userId,
        jobId: "job-missing-r2",
        promptOriginal: "missing",
        promptEffective: "missing",
        size: "square",
        r2Key: `${userA.userId}/missing.png`
      })

      const listRes = await request(ctx.env, "/api/gen/history", {
        headers: { Cookie: userA.cookie }
      })
      const { items } = (await listRes.json()) as {
        items: Array<{ id: number }>
      }
      const id = items[0].id

      const res = await request(ctx.env, `/api/gen/history/${id}/image`, {
        headers: { Cookie: userA.cookie }
      })
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "Image not found" })
    })
  })

  describe("DELETE /api/gen/history/:id 删除历史与物理文件", () => {
    it("成功删除：同时清理 R2 文件与 D1 记录", async () => {
      const fakeImage = new Uint8Array([99, 88, 77])
      const r2Key = `${userA.userId}/job-del-1.png`
      await r2.put(r2Key, fakeImage)

      await insertGeneration(ctx.env.DB, prefix, {
        userId: userA.userId,
        jobId: "job-del-1",
        promptOriginal: "delete test",
        promptEffective: "delete test",
        size: "square",
        r2Key
      })

      const listRes = await request(ctx.env, "/api/gen/history", {
        headers: { Cookie: userA.cookie }
      })
      const { items } = (await listRes.json()) as {
        items: Array<{ id: number }>
      }
      const id = items[0].id

      // 验证 R2 确实存在
      expect(await r2.get(r2Key)).not.toBeNull()

      // 执行删除
      const delRes = await request(ctx.env, `/api/gen/history/${id}`, {
        method: "DELETE",
        headers: { Cookie: userA.cookie }
      })
      expect(delRes.status).toBe(200)
      expect(await delRes.json()).toEqual({ success: true })

      // R2 对象已被清除
      expect(await r2.get(r2Key)).toBeNull()

      // 再次查询 history，记录已被清除
      const checkRes = await request(ctx.env, "/api/gen/history", {
        headers: { Cookie: userA.cookie }
      })
      const checkData = (await checkRes.json()) as { total: number }
      expect(checkData.total).toBe(0)

      // 再次读取该图返回 404
      const imageRes = await request(ctx.env, `/api/gen/history/${id}/image`, {
        headers: { Cookie: userA.cookie }
      })
      expect(imageRes.status).toBe(404)
    })

    it("删除他人记录严格返回 404，且不删除他人的 R2 与 D1 数据", async () => {
      const fakeImage = new Uint8Array([55, 66])
      const r2Key = `${userB.userId}/job-b-keep.png`
      await r2.put(r2Key, fakeImage)

      await insertGeneration(ctx.env.DB, prefix, {
        userId: userB.userId,
        jobId: "job-b-keep",
        promptOriginal: "userB keep",
        promptEffective: "userB keep",
        size: "portrait",
        r2Key
      })

      const listRes = await request(ctx.env, "/api/gen/history", {
        headers: { Cookie: userB.cookie }
      })
      const { items } = (await listRes.json()) as {
        items: Array<{ id: number }>
      }
      const userBId = items[0].id

      // userA 尝试删除 userB 的记录
      const delRes = await request(ctx.env, `/api/gen/history/${userBId}`, {
        method: "DELETE",
        headers: { Cookie: userA.cookie }
      })
      expect(delRes.status).toBe(404)
      expect(await delRes.json()).toEqual({ error: "Generation not found" })

      // userB 的数据依然完好无损
      expect(await r2.get(r2Key)).not.toBeNull()
      const bList = await request(ctx.env, "/api/gen/history", {
        headers: { Cookie: userB.cookie }
      })
      const bData = (await bList.json()) as { total: number }
      expect(bData.total).toBe(1)
    })

    it("删除不存在或非法 id 返回 404", async () => {
      const res1 = await request(ctx.env, "/api/gen/history/99999", {
        method: "DELETE",
        headers: { Cookie: userA.cookie }
      })
      expect(res1.status).toBe(404)

      const res2 = await request(ctx.env, "/api/gen/history/invalid", {
        method: "DELETE",
        headers: { Cookie: userA.cookie }
      })
      expect(res2.status).toBe(404)
    })
  })
})
