/**
 * 提示词自动翻译层（规格 §5）：
 * - prompt 含 CJK（中文/汉字）字符才触发翻译，纯英文直接原样提交；
 * - 经 Cloudflare Workers AI 绑定调用模型 @cf/meta/m2m100-1.2b（源 zh、目标 en）；
 * - 不走公网出口、不新增 secret、走账号每日免费额度；
 * - 失败（模型抛错、空译文、额度耗尽）时优雅降级为原文提交；
 * - 译文原样提交不做扩写加工。
 */

export interface TranslationResult {
  translated: boolean
  effectivePrompt: string
}

/**
 * 判断文本中是否包含 CJK 汉字字符。
 */
export function containsCjk(text: string): boolean {
  return /\p{Script=Han}/u.test(text)
}

/**
 * 对提示词进行处理：如果包含汉字且配置了 Workers AI 绑定，则尝试翻译为英文；
 * 否则或翻译失败时回落到原文。
 */
export async function resolvePrompt(
  ai: Ai | undefined,
  prompt: string
): Promise<TranslationResult> {
  if (!containsCjk(prompt)) {
    return { translated: false, effectivePrompt: prompt }
  }

  if (!ai) {
    return { translated: false, effectivePrompt: prompt }
  }

  try {
    const res = await ai.run("@cf/meta/m2m100-1.2b", {
      text: prompt,
      source_lang: "zh",
      target_lang: "en"
    })

    const translatedText =
      res && typeof res === "object" && "translated_text" in res
        ? (res as { translated_text?: unknown }).translated_text
        : null

    if (
      typeof translatedText === "string" &&
      translatedText.trim().length > 0
    ) {
      return {
        translated: true,
        effectivePrompt: translatedText.trim()
      }
    }

    return { translated: false, effectivePrompt: prompt }
  } catch (err) {
    console.warn(
      "Workers AI translation failed, falling back to original prompt:",
      err
    )
    return { translated: false, effectivePrompt: prompt }
  }
}
