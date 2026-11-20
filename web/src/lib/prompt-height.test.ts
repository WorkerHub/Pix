import { beforeEach, describe, expect, it } from "vitest"
import { GEN_JOB_STORAGE_KEY } from "@/lib/gen"
import {
  calculateMaxPromptHeight,
  clampPromptHeight,
  MIN_CANVAS_HEIGHT,
  PROMPT_HEIGHT_DEFAULT,
  PROMPT_HEIGHT_MIN,
  PROMPT_HEIGHT_STORAGE_KEY,
  readStoredPromptHeight,
  writeStoredPromptHeight
} from "@/lib/prompt-height"

describe("提示词高度与持久化控制 (prompt-height)", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe("存储键隔离与默认值", () => {
    it("存储键使用独立 key，绝不与生图任务存储键冲突", () => {
      expect(PROMPT_HEIGHT_STORAGE_KEY).toBe("app-prompt-height")
      expect(PROMPT_HEIGHT_STORAGE_KEY).not.toBe(GEN_JOB_STORAGE_KEY)
    })

    it("首次无存储记录时返回默认高度 112px，且默认高度等于下限", () => {
      expect(readStoredPromptHeight()).toBe(PROMPT_HEIGHT_DEFAULT)
      expect(PROMPT_HEIGHT_DEFAULT).toBe(PROMPT_HEIGHT_MIN)
    })
  })

  describe("clampPromptHeight 钳制算法", () => {
    it("在正常范围内四舍五入返回整数", () => {
      expect(clampPromptHeight(150.4, 112, 400)).toBe(150)
      expect(clampPromptHeight(150.6, 112, 400)).toBe(151)
    })

    it("低于下限时钳制到下限", () => {
      expect(clampPromptHeight(80, 112, 400)).toBe(112)
      expect(clampPromptHeight(0, 112, 400)).toBe(112)
      expect(clampPromptHeight(-50, 112, 400)).toBe(112)
    })

    it("高于上限时钳制到上限", () => {
      expect(clampPromptHeight(500, 112, 400)).toBe(400)
    })

    it("输入 NaN 或非法数值时回落到下限", () => {
      expect(clampPromptHeight(Number.NaN, 112, 400)).toBe(112)
      expect(clampPromptHeight(Number.POSITIVE_INFINITY, 112, 400)).toBe(112)
    })

    it("若上限小于下限，以下限为准", () => {
      expect(clampPromptHeight(150, 200, 150)).toBe(200)
    })
  })

  describe("持久化读写与防异常", () => {
    it("正确写入并在下次读取时恢复", () => {
      writeStoredPromptHeight(220)
      expect(readStoredPromptHeight()).toBe(220)
      expect(localStorage.getItem(PROMPT_HEIGHT_STORAGE_KEY)).toBe("220")
    })

    it("写入小于下限的值会被钳制在下限", () => {
      writeStoredPromptHeight(50)
      expect(readStoredPromptHeight()).toBe(PROMPT_HEIGHT_MIN)
    })

    it("读取到损坏的非数字时回落默认高度", () => {
      localStorage.setItem(PROMPT_HEIGHT_STORAGE_KEY, "not-a-number")
      expect(readStoredPromptHeight()).toBe(PROMPT_HEIGHT_DEFAULT)
    })

    it("读取到小于下限的值时自动钳制到下限", () => {
      localStorage.setItem(PROMPT_HEIGHT_STORAGE_KEY, "60")
      expect(readStoredPromptHeight()).toBe(PROMPT_HEIGHT_MIN)
    })

    it("操作提示词高度不影响生图任务 app-gen-job 数据", () => {
      localStorage.setItem(
        GEN_JOB_STORAGE_KEY,
        JSON.stringify({ jobId: "job-xyz", submittedAt: Date.now() })
      )

      writeStoredPromptHeight(180)
      expect(readStoredPromptHeight()).toBe(180)
      expect(localStorage.getItem(GEN_JOB_STORAGE_KEY)).toContain("job-xyz")
    })
  })

  describe("calculateMaxPromptHeight 动态上限计算", () => {
    it("桌面端：根据控制面板高度与其余控件占高计算可用上限", () => {
      // 假设面板高 700px，其余控件占高 280px
      const maxH = calculateMaxPromptHeight({
        isDesktop: true,
        rootHeight: 744,
        panelHeight: 700,
        restHeight: 280
      })
      expect(maxH).toBe(420)
    })

    it("移动端：页面总高扣除画布最小高度(180px)、间距与其余控件，保持一屏不滚动", () => {
      // 假设移动端视口内容高 600px，扣除内边距 24px = 576px
      // 扣除画布 180px 与 gap 12px = 384px 可用面板总高
      // 扣除其余控件 280px = 104px，由于低于下限 112px，保证不低于下限
      const maxH = calculateMaxPromptHeight({
        isDesktop: false,
        rootHeight: 600,
        restHeight: 280,
        minCanvasHeight: MIN_CANVAS_HEIGHT
      })
      expect(maxH).toBe(PROMPT_HEIGHT_MIN)
    })

    it("较长移动端屏幕（如 800px）有合理的增高空间", () => {
      // 800px 扣除 24 = 776px
      // 776 - 180 - 12 = 584px
      // 584 - 280 = 304px
      const maxH = calculateMaxPromptHeight({
        isDesktop: false,
        rootHeight: 800,
        restHeight: 280,
        minCanvasHeight: 180
      })
      expect(maxH).toBe(304)
    })

    it("视口过小或计算结果异常时，上限始终不低于下限", () => {
      const maxH = calculateMaxPromptHeight({
        isDesktop: true,
        rootHeight: 200,
        panelHeight: 200,
        restHeight: 280
      })
      expect(maxH).toBe(PROMPT_HEIGHT_MIN)
    })
  })
})
