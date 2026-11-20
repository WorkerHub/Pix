import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ControlPanel } from "@/components/workbench/control-panel"
import { i18n } from "@/i18n"
import {
  type GenerateSize,
  type GenerationModel,
  MODEL_OPTIONS
} from "@/lib/api-types"
import {
  PROMPT_HEIGHT_DEFAULT,
  PROMPT_HEIGHT_MIN,
  PROMPT_HEIGHT_STORAGE_KEY
} from "@/lib/prompt-height"

function renderControlPanel(
  props?: Partial<React.ComponentProps<typeof ControlPanel>>
) {
  const defaultProps = {
    prompt: "A beautiful scenery",
    onPromptChange: vi.fn(),
    size: "portrait" as GenerateSize,
    onSizeChange: vi.fn(),
    model: "realistic-lcm" as GenerationModel,
    onModelChange: vi.fn(),
    submitting: false,
    generating: false,
    offline: false,
    onSubmit: vi.fn()
  }
  return {
    ...render(<ControlPanel {...defaultProps} {...props} />),
    props: { ...defaultProps, ...props }
  }
}

describe("工作台控制面板 (ControlPanel)", () => {
  const defaultProps = {
    prompt: "",
    onPromptChange: vi.fn(),
    size: "portrait" as const,
    onSizeChange: vi.fn(),
    model: "realistic-lcm" as const,
    onModelChange: vi.fn(),
    submitting: false,
    generating: false,
    offline: false,
    onSubmit: vi.fn()
  }

  const defaultInnerWidth = window.innerWidth
  const defaultInnerHeight = window.innerHeight

  beforeEach(async () => {
    window.innerWidth = defaultInnerWidth
    window.innerHeight = defaultInnerHeight
    localStorage.clear()
    vi.clearAllMocks()
    await i18n.changeLanguage("zh")
  })

  afterEach(() => {
    window.innerWidth = defaultInnerWidth
    window.innerHeight = defaultInnerHeight
    vi.restoreAllMocks()
  })

  describe("字数计数防重叠（验收项 4）", () => {
    it("textarea 预留 pb-8 底部内边距，且字数计数设为 pointer-events-none 避免遮挡文本", () => {
      render(<ControlPanel {...defaultProps} prompt="一段测试提示词" />)

      const textarea = screen.getByPlaceholderText("提示词")
      expect(textarea).toBeInTheDocument()
      // 必须包含 pb-8 保证文本区与右下角计数有充足内边距
      expect(textarea.className).toContain("pb-8")

      const counter = screen.getByTestId("prompt-counter")
      expect(counter).toBeInTheDocument()
      expect(counter).toHaveTextContent("7/1000")
      expect(counter.className).toContain("pointer-events-none")
      expect(counter.className).toContain("absolute right-2.5 bottom-2.5")
    })

    it("输入超长内容达 1000 字符时，计数器正常显示 1000/1000 且文本区始终留出底边距", () => {
      const longPrompt = "a".repeat(1000)
      render(<ControlPanel {...defaultProps} prompt={longPrompt} />)

      const counter = screen.getByTestId("prompt-counter")
      expect(counter).toHaveTextContent("1000/1000")
    })
  })

  describe("拖拽改高与 Pointer Events 交互（验收项 1）", () => {
    it("渲染输入框下边缘拖拽手柄，具备无障碍属性与拖拽标识", () => {
      render(<ControlPanel {...defaultProps} />)

      const handle = screen.getByTestId("prompt-resize-handle")
      expect(handle).toBeInTheDocument()
      expect(handle).toHaveAttribute("role", "slider")
      expect(handle).toHaveAttribute("aria-orientation", "vertical")
      expect(handle).toHaveAttribute(
        "aria-label",
        i18n.t("generate.resizePrompt")
      )
      expect(handle).toHaveAttribute(
        "aria-valuenow",
        `${PROMPT_HEIGHT_DEFAULT}`
      )
    })

    it("鼠标 pointerdown + pointermove 实时调整输入框高度并更新 localStorage", () => {
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      const handle = screen.getByTestId("prompt-resize-handle")

      // 默认高度 112px
      expect(textarea).toHaveStyle({ height: "112px" })

      // 模拟鼠标在 handle 上按下并在 window 上移动 +80px
      fireEvent.pointerDown(handle, { button: 0, clientY: 200, pointerId: 1 })
      fireEvent.pointerMove(window, { clientY: 280, pointerId: 1 })
      fireEvent.pointerUp(window, { pointerId: 1 })

      // 高度变为 112 + 80 = 192px
      expect(textarea).toHaveStyle({ height: "192px" })
      expect(localStorage.getItem(PROMPT_HEIGHT_STORAGE_KEY)).toBe("192")
    })

    it("触屏触摸 pointerdown + pointermove 实时调整高度", () => {
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      const handle = screen.getByTestId("prompt-resize-handle")

      // 模拟触摸事件
      fireEvent.pointerDown(handle, {
        pointerType: "touch",
        clientY: 300,
        pointerId: 2
      })
      fireEvent.pointerMove(window, {
        pointerType: "touch",
        clientY: 350,
        pointerId: 2
      })
      fireEvent.pointerUp(window, { pointerId: 2 })

      // 高度增加 50px -> 162px
      expect(textarea).toHaveStyle({ height: "162px" })
      expect(localStorage.getItem(PROMPT_HEIGHT_STORAGE_KEY)).toBe("162")
    })
  })

  describe("高度上下限钳制与其余控件完全可见（验收项 2）", () => {
    it("初次渲染具有默认高度 112px，且其余控件正常显示", () => {
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      expect(textarea).toHaveStyle({ height: `${PROMPT_HEIGHT_DEFAULT}px` })

      // 其余控件依然在 DOM 中可见
      expect(screen.getByRole("radio", { name: "竖图" })).toBeInTheDocument()
      expect(screen.getByRole("radio", { name: "方图" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "生成" })).toBeInTheDocument()
    })

    it("向上拖动小于默认高度时，严格钳制在下限（112px），无法继续缩小", () => {
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      const handle = screen.getByTestId("prompt-resize-handle")

      // 向上拖动 -200px
      fireEvent.pointerDown(handle, { button: 0, clientY: 300, pointerId: 1 })
      fireEvent.pointerMove(window, { clientY: 100, pointerId: 1 })
      fireEvent.pointerUp(window, { pointerId: 1 })

      // 严格钳制在 PROMPT_HEIGHT_MIN (112px)
      expect(textarea).toHaveStyle({ height: `${PROMPT_HEIGHT_MIN}px` })
      expect(localStorage.getItem(PROMPT_HEIGHT_STORAGE_KEY)).toBe(
        `${PROMPT_HEIGHT_MIN}`
      )
    })

    it("向下拖动超出动态上限时，受最大高度限制，保证其余控件始终可见", () => {
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      const handle = screen.getByTestId("prompt-resize-handle")

      const maxValStr = handle.getAttribute("aria-valuemax")
      expect(maxValStr).not.toBeNull()
      const maxVal = Number.parseInt(maxValStr!, 10)
      expect(maxVal).toBeGreaterThanOrEqual(PROMPT_HEIGHT_MIN)

      // 超大幅度向下拖动 +2000px
      fireEvent.pointerDown(handle, { button: 0, clientY: 100, pointerId: 1 })
      fireEvent.pointerMove(window, { clientY: 2100, pointerId: 1 })
      fireEvent.pointerUp(window, { pointerId: 1 })

      // 输入框高度被上限钳制
      expect(textarea).toHaveStyle({ height: `${maxVal}px` })

      // 其余控件依然在 DOM 中可见
      expect(screen.getByRole("radio", { name: "竖图" })).toBeInTheDocument()
      expect(screen.getByRole("radio", { name: "方图" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "生成" })).toBeInTheDocument()
    })

    it("在包含真实尺寸的 DOM 容器中，上限精确测算手柄、其余控件与历史条，拖拽超幅时严格钳制为已知像素值", () => {
      // 在 DOM 中创建 .wb-root 容器
      const container = document.createElement("div")
      container.className = "wb-root"
      container.style.paddingTop = "16px"
      container.style.paddingBottom = "16px"
      document.body.appendChild(container)

      // 模拟视口根容器 clientHeight = 800px, padding = 32px
      Object.defineProperty(container, "clientHeight", {
        configurable: true,
        value: 800
      })

      // 模拟移动端历史记录条实测占高 150px
      const historyStrip = document.createElement("div")
      historyStrip.className = "wb-panel wb-history-strip"
      Object.defineProperty(historyStrip, "offsetHeight", {
        configurable: true,
        value: 150
      })
      container.appendChild(historyStrip)

      const origInnerWidth = window.innerWidth
      window.innerWidth = 800 // 移动端单列排布 (<1024px)

      try {
        const { unmount } = render(<ControlPanel {...defaultProps} />, {
          container
        })

        const handle = screen.getByTestId("prompt-resize-handle")
        const submitBtn = screen.getByRole("button", { name: "生成" })
        const restControls = submitBtn.parentElement?.querySelector(
          ".flex.flex-col.gap-4"
        ) as HTMLElement

        // 模拟子控件实测高度：手柄 14px、其余控件区 92px、生成按钮 48px
        Object.defineProperty(handle, "offsetHeight", {
          configurable: true,
          value: 14
        })
        if (restControls) {
          Object.defineProperty(restControls, "offsetHeight", {
            configurable: true,
            value: 92
          })
        }
        Object.defineProperty(submitBtn, "offsetHeight", {
          configurable: true,
          value: 48
        })

        // 触发布局测量重算
        fireEvent(window, new Event("resize"))

        // 验证已知精确输入计算结果：
        // effectiveRoot = 800 - 32 = 768
        // availablePanelHeight = 768 - 180 (minCanvas) - 150 (historyStrip) - 24 (gaps) = 414
        // restHeight = 46 (padBorder) + 32 (internalGaps) + 14 (handle) + 92 (restControls) + 48 (btn) = 232
        // expectedMax = 414 - 232 = 182
        expect(handle.getAttribute("aria-valuemax")).toBe("182")

        // 超幅向下拖动至 3000px
        const textarea = screen.getByPlaceholderText("提示词")
        fireEvent.pointerDown(handle, { button: 0, clientY: 100, pointerId: 1 })
        fireEvent.pointerMove(window, { clientY: 3100, pointerId: 1 })
        fireEvent.pointerUp(window, { pointerId: 1 })

        // 非自指断言：高度被精确钳制在 182px
        expect(textarea).toHaveStyle({ height: "182px" })

        unmount()
      } finally {
        container.remove()
        window.innerWidth = origInnerWidth
      }
    })
  })

  describe("持久化恢复（验收项 3）", () => {
    it("初次加载若 localStorage 已有记录，自动恢复上次保存的高度", () => {
      localStorage.setItem(PROMPT_HEIGHT_STORAGE_KEY, "260")
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      expect(textarea).toHaveStyle({ height: "260px" })
    })

    it("在小视口移动端若存有超大历史高度，初次渲染立即钳制在预估上限，杜绝首帧溢出闪烁", () => {
      const origInnerWidth = window.innerWidth
      const origInnerHeight = window.innerHeight

      // 模拟小屏幕移动设备 375x667
      window.innerWidth = 375
      window.innerHeight = 667

      // 用户在桌面大屏曾保存过 500px 高度
      localStorage.setItem(PROMPT_HEIGHT_STORAGE_KEY, "500")

      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      // 验证首帧渲染即已钳制在合理下限/上限，绝不会以 500px 渲染
      const renderedHeight = Number.parseInt(textarea.style.height, 10)
      expect(renderedHeight).toBe(PROMPT_HEIGHT_MIN)

      window.innerWidth = origInnerWidth
      window.innerHeight = origInnerHeight
    })

    it("若 localStorage 存有非法值或越界值，安全回落默认或钳制在合法范围", () => {
      localStorage.setItem(PROMPT_HEIGHT_STORAGE_KEY, "invalid-val")
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      expect(textarea).toHaveStyle({ height: `${PROMPT_HEIGHT_DEFAULT}px` })
    })
  })

  describe("可访问性与键盘微调", () => {
    it("聚焦拖拽手柄时，可通过方向键 ArrowDown / ArrowUp 进行步进微调并持久化", () => {
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      const handle = screen.getByTestId("prompt-resize-handle")

      // 按 ArrowDown 增加 10px
      fireEvent.keyDown(handle, { key: "ArrowDown" })
      expect(textarea).toHaveStyle({ height: "122px" })
      expect(localStorage.getItem(PROMPT_HEIGHT_STORAGE_KEY)).toBe("122")

      // 按 ArrowUp 减少 10px，回到 112px
      fireEvent.keyDown(handle, { key: "ArrowUp" })
      expect(textarea).toHaveStyle({ height: "112px" })
      expect(localStorage.getItem(PROMPT_HEIGHT_STORAGE_KEY)).toBe("112")

      // 再次按 ArrowUp，受下限钳制不再减小
      fireEvent.keyDown(handle, { key: "ArrowUp" })
      expect(textarea).toHaveStyle({ height: "112px" })
    })
  })
})

describe("ControlPanel 模型选项与浮层规格", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh")
  })

  it("渲染 9 款模型且顺序严格对齐规格契约", () => {
    renderControlPanel()

    const expectedModels = [
      { id: "realistic-lcm", label: "写实·极速" },
      { id: "realistic", label: "写实·原版" },
      { id: "majicmix", label: "人像·东方" },
      { id: "photon", label: "人像·光子" },
      { id: "cyberrealistic", label: "写实·纪实" },
      { id: "dreamshaper", label: "通用·梦境" },
      { id: "openjourney", label: "插画·旅程" },
      { id: "counterfeit", label: "动漫" },
      { id: "toonyou", label: "卡通" }
    ]

    expect(MODEL_OPTIONS).toHaveLength(9)

    // 获取所有模型 radio 按钮
    const radios = expectedModels.map((m) =>
      screen.getByRole("radio", { name: m.label })
    )

    for (let i = 0; i < radios.length; i++) {
      expect(radios[i]).toBeInTheDocument()
      expect(radios[i]).toHaveAttribute("data-state", i === 0 ? "on" : "off")
    }
  })

  it("点击模型选项正确触发 onModelChange 回调", async () => {
    const onModelChange = vi.fn()
    const user = userEvent.setup()
    renderControlPanel({ onModelChange })

    const photonBtn = screen.getByRole("radio", { name: "人像·光子" })
    await user.click(photonBtn)
    expect(onModelChange).toHaveBeenCalledWith("photon")

    const toonyouBtn = screen.getByRole("radio", { name: "卡通" })
    await user.click(toonyouBtn)
    expect(onModelChange).toHaveBeenCalledWith("toonyou")
  })

  it("桌面端悬停展示一句话介绍与预估生成时间", async () => {
    const user = userEvent.setup()
    renderControlPanel()

    // 1. realistic-lcm (极速：100 秒)
    const lcmBtn = screen.getByRole("radio", { name: "写实·极速" })
    await user.hover(lcmBtn)
    const tooltip = await screen.findByRole("tooltip")
    expect(tooltip).toHaveTextContent(
      "Realistic Vision 加 LCM 合并，8 步极速出图"
    )
    expect(tooltip).toHaveTextContent("预计约 100 秒")
    expect(tooltip).toHaveClass("wb-model-tooltip", "w-[270px]")
    await user.unhover(lcmBtn)
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    })

    // 2. photon (光子：250 秒 -> 约 4 分钟)
    const photonBtn = screen.getByRole("radio", { name: "人像·光子" })
    await user.hover(photonBtn)
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Photon v1 人像写实，肤质与光影细腻"
    )
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "预计约 4 分钟"
    )
    await user.unhover(photonBtn)
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    })

    // 3. toonyou (卡通：250 秒 -> 约 4 分钟)
    const toonBtn = screen.getByRole("radio", { name: "卡通" })
    await user.hover(toonBtn)
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "ToonYou alpha3，纯卡通画风，线条明快"
    )
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "预计约 4 分钟"
    )
    await user.unhover(toonBtn)
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    })
  })

  it("触屏端长按 400ms 打开浮层且不触发模型切换", async () => {
    vi.useFakeTimers()
    const onModelChange = vi.fn()
    renderControlPanel({ onModelChange })

    const majicmixBtn = screen.getByRole("radio", { name: "人像·东方" })

    // 触屏按住 (touchstart)
    fireEvent.touchStart(majicmixBtn, {
      touches: [{ clientX: 100, clientY: 100 }]
    })

    // 200ms 时浮层尚未触发
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()

    // 满 400ms 触发长按
    act(() => {
      vi.advanceTimersByTime(200)
    })
    const tooltip = screen.getByRole("tooltip")
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent("majicMIX realistic v7，东方人像")
    expect(tooltip).toHaveTextContent("预计约 4 分钟")

    // 释放长按 (touchend + click)
    fireEvent.touchEnd(majicmixBtn)
    fireEvent.click(majicmixBtn)

    // 长按释放不应触发模型选中
    expect(onModelChange).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it("触屏滑动操作 (>10px) 取消长按浮层", async () => {
    vi.useFakeTimers()
    renderControlPanel()

    const dreamBtn = screen.getByRole("radio", { name: "通用·梦境" })

    // 触屏按住
    fireEvent.touchStart(dreamBtn, {
      touches: [{ clientX: 100, clientY: 100 }]
    })

    // 手指滑动 15px
    fireEvent.touchMove(dreamBtn, {
      touches: [{ clientX: 100, clientY: 115 }]
    })

    // 推进时间至 400ms
    act(() => {
      vi.advanceTimersByTime(400)
    })

    // 浮层不应出现
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()

    vi.useRealTimers()
  })

  it("触屏快速短按正常切换模型不触发长按浮层", async () => {
    vi.useFakeTimers()
    const onModelChange = vi.fn()
    renderControlPanel({ onModelChange })

    const counterfeitBtn = screen.getByRole("radio", { name: "动漫" })

    // 触屏按住 100ms 即抬起
    fireEvent.touchStart(counterfeitBtn, {
      touches: [{ clientX: 100, clientY: 100 }]
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    fireEvent.touchEnd(counterfeitBtn)
    fireEvent.click(counterfeitBtn)

    // 正常触发切换
    expect(onModelChange).toHaveBeenCalledWith("counterfeit")

    // 浮层未打开
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()

    vi.useRealTimers()
  })

  it("英文语言环境正确展示英文文案与预估时间", async () => {
    await i18n.changeLanguage("en")
    const user = userEvent.setup()
    renderControlPanel()

    const turboBtn = screen.getByRole("radio", { name: "Realistic Turbo" })
    expect(turboBtn).toBeInTheDocument()

    await user.hover(turboBtn)
    const tooltip = await screen.findByRole("tooltip")
    expect(tooltip).toHaveTextContent(
      "Realistic Vision with LCM merge, 8-step lightning generation"
    )
    expect(tooltip).toHaveTextContent("About 100 seconds")
    await user.unhover(turboBtn)
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    })

    const animeBtn = screen.getByRole("radio", { name: "Anime" })
    await user.hover(animeBtn)
    const animeTooltip = await screen.findByRole("tooltip")
    expect(animeTooltip).toHaveTextContent("Counterfeit-V3.0, 2D anime style")
    expect(animeTooltip).toHaveTextContent("About 4 minutes")
    await user.unhover(animeBtn)
  })
})
