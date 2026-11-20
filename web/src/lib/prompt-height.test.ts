import { beforeEach, describe, expect, it } from "vitest"
import { GEN_JOB_STORAGE_KEY } from "@/lib/gen"
import {
  calculateMaxPromptHeight,
  clampPromptHeight,
  CONTROL_PANEL_REST_HEIGHT_DEFAULT,
  DEFAULT_HISTORY_STRIP_HEIGHT,
  estimateInitialMaxPromptHeight,
  MIN_CANVAS_HEIGHT,
  PROMPT_HEIGHT_DEFAULT,
  PROMPT_HEIGHT_MIN,
  PROMPT_HEIGHT_STORAGE_KEY,
  PROMPT_RESIZE_HANDLE_HEIGHT,
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

    it("readStoredPromptHeight 支持传入上限，读取过大值时立即钳制，杜绝首帧渲染闪烁", () => {
      localStorage.setItem(PROMPT_HEIGHT_STORAGE_KEY, "500")
      // 传入上限 200
      expect(readStoredPromptHeight(200)).toBe(200)
      // 未传上限时返回原始值
      expect(readStoredPromptHeight()).toBe(500)
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
    it("桌面端：精确扣除手柄高度、其余控件、间距与内边距，确保生成按钮不被裁切", () => {
      // 实际真实尺寸模型：
      // restControlsHeight = 92, submitBtnHeight = 48, handleHeight = 14
      // panelPadBorder = 46, gaps (4 + 12 + 16) = 32
      // restHeight = 46 + 32 + 14 + 92 + 48 = 232px
      const panelPadBorder = 46
      const internalGaps = 32
      const handleHeight = PROMPT_RESIZE_HANDLE_HEIGHT // 14
      const restControlsHeight = 92
      const submitBtnHeight = 48
      const restHeight =
        panelPadBorder +
        internalGaps +
        handleHeight +
        restControlsHeight +
        submitBtnHeight
      expect(restHeight).toBe(232)

      // 面板总高 700px 时，上限 = 700 - 232 = 468px
      const maxH = calculateMaxPromptHeight({
        isDesktop: true,
        rootHeight: 744,
        panelHeight: 700,
        restHeight
      })
      expect(maxH).toBe(468)

      // 若未纳入手柄 14px，则误算为 482px，导致实际内容超高裁切按钮
      const buggyRestWithoutHandle =
        panelPadBorder + internalGaps + restControlsHeight + submitBtnHeight
      expect(700 - buggyRestWithoutHandle).toBe(482)
      expect(maxH).toBe(482 - handleHeight)
    })

    it("移动端：精确扣除历史条实测高度、画布核心最小高度(180px)、两处容器间距与视口内边距", () => {
      // 已知输入条件：
      // rootHeight = 800, sm 内边距 = 32
      // minCanvasHeight = 180, historyStripHeight = 150, MOBILE_VERTICAL_GAPS = 24
      // restHeight = 232 (包含其余控件、按钮与手柄)
      // 计算过程：
      // 1. effectiveRoot = 800 - 32 = 768px
      // 2. availablePanelHeight = 768 - 180 - 150 - 24 = 414px
      // 3. maxPromptHeight = 414 - 232 = 182px
      const maxH = calculateMaxPromptHeight({
        isDesktop: false,
        rootHeight: 800,
        rootPaddingY: 32,
        historyStripHeight: 150,
        minCanvasHeight: MIN_CANVAS_HEIGHT,
        restHeight: 232
      })
      expect(maxH).toBe(182)

      // 验证当 promptHeight 达到该上限时，画布高度恰好严格等于 180px
      const totalPanelHeight = 182 + 232 // 414px
      const remainingForCanvas = 768 - 24 - 150 - totalPanelHeight
      expect(remainingForCanvas).toBe(MIN_CANVAS_HEIGHT)
    })

    it("移动端历史条不同高度(如 160px)时，上限自适应扣减历史条增量", () => {
      // 768 - 180 - 160 - 24 = 404
      // 404 - 232 = 172
      const maxH = calculateMaxPromptHeight({
        isDesktop: false,
        rootHeight: 800,
        rootPaddingY: 32,
        historyStripHeight: 160,
        minCanvasHeight: 180,
        restHeight: 232
      })
      expect(maxH).toBe(172)
    })

    it("移动端历史条与其余控件占满小视口时，上限安全回落至下限 112px", () => {
      // effectiveRoot = 600 - 24 = 576px
      // 576 - 180 - 150 - 24 = 222px availablePanel
      // 222 - 280 = -58px < 112px
      const maxH = calculateMaxPromptHeight({
        isDesktop: false,
        rootHeight: 600,
        rootPaddingY: 24,
        historyStripHeight: DEFAULT_HISTORY_STRIP_HEIGHT,
        restHeight: CONTROL_PANEL_REST_HEIGHT_DEFAULT,
        minCanvasHeight: MIN_CANVAS_HEIGHT
      })
      expect(maxH).toBe(PROMPT_HEIGHT_MIN)
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

  describe("estimateInitialMaxPromptHeight 首帧防闪烁预估", () => {
    it("在桌面端估算结果满足合理区间", () => {
      const origWidth = window.innerWidth
      const origHeight = window.innerHeight

      window.innerWidth = 1200
      window.innerHeight = 900
      const est = estimateInitialMaxPromptHeight()
      expect(est).toBeGreaterThanOrEqual(PROMPT_HEIGHT_MIN)
      expect(est).toBeLessThanOrEqual(900)

      window.innerWidth = origWidth
      window.innerHeight = origHeight
    })

    it("在移动端小屏估算结果受画布和历史条保护，不输出过大值", () => {
      const origWidth = window.innerWidth
      const origHeight = window.innerHeight

      window.innerWidth = 375
      window.innerHeight = 667
      const est = estimateInitialMaxPromptHeight()
      expect(est).toBeGreaterThanOrEqual(PROMPT_HEIGHT_MIN)
      // 667 - 56 (nav) - 24 (pad) = 587; 587 - 180 - 150 - 24 - 280 = -51 -> 112
      expect(est).toBe(PROMPT_HEIGHT_MIN)

      window.innerWidth = origWidth
      window.innerHeight = origHeight
    })
  })
})
