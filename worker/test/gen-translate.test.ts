import { describe, expect, it, vi } from "vitest"
import { containsCjk, resolvePrompt } from "../src/lib/translate"
import { MockAi } from "./support/mock-ai"

describe("containsCjk", () => {
  it("识别常见中文文本", () => {
    expect(containsCjk("赛博朋克城市")).toBe(true)
    expect(containsCjk("一只可爱的猫咪，戴着太阳眼镜")).toBe(true)
    expect(containsCjk("cyberpunk 城市 4k")).toBe(true)
    expect(containsCjk("繁體中文測試")).toBe(true)
  })

  it("纯英文、数字、符号与 emoji 不触发 CJK 检测", () => {
    expect(containsCjk("cyberpunk city")).toBe(false)
    expect(
      containsCjk("a cute cat wearing sunglasses, 8k, photorealistic")
    ).toBe(false)
    expect(containsCjk("1234567890 !@#$%^&*()_+-=[]{}|;':\",./<>?")).toBe(false)
    expect(containsCjk("")).toBe(false)
    expect(containsCjk("   ")).toBe(false)
    expect(containsCjk("🐱 🚀 🏙️")).toBe(false)
  })
})

describe("resolvePrompt", () => {
  it("非中文 prompt 直接透传原词，不调用 AI 绑定", async () => {
    const ai = new MockAi()
    const runSpy = vi.spyOn(ai, "run")

    const res = await resolvePrompt(
      ai as unknown as Ai,
      "a beautiful landscape"
    )
    expect(res).toEqual({
      translated: false,
      effectivePrompt: "a beautiful landscape"
    })
    expect(runSpy).not.toHaveBeenCalled()
  })

  it("中文 prompt 成功调用 Workers AI @cf/meta/m2m100-1.2b 翻译", async () => {
    const ai = new MockAi(async (model, inputs) => {
      expect(model).toBe("@cf/meta/m2m100-1.2b")
      expect(inputs).toEqual({
        text: "赛博朋克城市，霓虹灯",
        source_lang: "zh",
        target_lang: "en"
      })
      return { translated_text: "Cyberpunk city, neon lights" }
    })

    const res = await resolvePrompt(ai as unknown as Ai, "赛博朋克城市，霓虹灯")
    expect(res).toEqual({
      translated: true,
      effectivePrompt: "Cyberpunk city, neon lights"
    })
  })

  it("未绑定 AI 时优雅回退至原提示词", async () => {
    const res = await resolvePrompt(undefined, "赛博朋克城市")
    expect(res).toEqual({
      translated: false,
      effectivePrompt: "赛博朋克城市"
    })
  })

  it("Workers AI 抛出异常（超时、限流等）时静默回退至原提示词", async () => {
    const ai = new MockAi(async () => {
      throw new Error("AI rate limit exceeded or timeout")
    })

    const res = await resolvePrompt(ai as unknown as Ai, "未来科技感跑车")
    expect(res).toEqual({
      translated: false,
      effectivePrompt: "未来科技感跑车"
    })
  })

  it("Workers AI 返回空字符串或纯空白时优雅回退", async () => {
    const emptyAi = new MockAi(async () => ({ translated_text: "" }))
    const resEmpty = await resolvePrompt(emptyAi as unknown as Ai, "水墨画竹子")
    expect(resEmpty).toEqual({
      translated: false,
      effectivePrompt: "水墨画竹子"
    })

    const whitespaceAi = new MockAi(async () => ({
      translated_text: "   \n  "
    }))
    const resWhitespace = await resolvePrompt(
      whitespaceAi as unknown as Ai,
      "水墨画竹子"
    )
    expect(resWhitespace).toEqual({
      translated: false,
      effectivePrompt: "水墨画竹子"
    })
  })

  it("Workers AI 返回异常响应结构（缺少 translated_text）时回退", async () => {
    const malformedAi = new MockAi(
      async () => ({}) as unknown as { translated_text: string }
    )
    const res = await resolvePrompt(malformedAi as unknown as Ai, "深海鲸鱼")
    expect(res).toEqual({
      translated: false,
      effectivePrompt: "深海鲸鱼"
    })
  })
})
