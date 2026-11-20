import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ControlPanel } from "@/components/workbench/control-panel"
import { i18n } from "@/i18n"
import {
  PROMPT_HEIGHT_DEFAULT,
  PROMPT_HEIGHT_MIN,
  PROMPT_HEIGHT_STORAGE_KEY
} from "@/lib/prompt-height"

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

  beforeEach(async () => {
    localStorage.clear()
    vi.clearAllMocks()
    await i18n.changeLanguage("zh")
  })

  afterEach(() => {
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
      expect(handle.className).toContain("cursor-ns-resize")
      expect(handle.className).toContain("touch-none")
    })

    it("用 Pointer Events 鼠标拖拽实时拉高输入框，并持久化到 localStorage", () => {
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      const handle = screen.getByTestId("prompt-resize-handle")

      // 默认初始高度为 112px
      expect(textarea).toHaveStyle({ height: `${PROMPT_HEIGHT_DEFAULT}px` })

      // 模拟 PointerDown（起始 Y = 100）
      fireEvent.pointerDown(handle, {
        button: 0,
        clientY: 100,
        pointerId: 1,
        pointerType: "mouse"
      })

      // 模拟 PointerMove（拖拽至 Y = 180，增加 80px）
      fireEvent.pointerMove(window, {
        clientY: 180,
        pointerId: 1
      })

      // 实时生效：高度变为 192px (112 + 80)
      expect(textarea).toHaveStyle({ height: "192px" })

      // 模拟 PointerUp 结束拖拽
      fireEvent.pointerUp(window, {
        pointerId: 1
      })

      // 持久化存储已写入
      expect(localStorage.getItem(PROMPT_HEIGHT_STORAGE_KEY)).toBe("192")
    })

    it("用 Pointer Events 触屏拖拽（touch）同样能实时拉高并持久化", () => {
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      const handle = screen.getByTestId("prompt-resize-handle")

      fireEvent.pointerDown(handle, {
        button: 0,
        clientY: 200,
        pointerId: 2,
        pointerType: "touch"
      })

      fireEvent.pointerMove(window, {
        clientY: 260,
        pointerId: 2
      })

      expect(textarea).toHaveStyle({ height: "172px" })

      fireEvent.pointerUp(window, {
        pointerId: 2
      })

      expect(localStorage.getItem(PROMPT_HEIGHT_STORAGE_KEY)).toBe("172")
    })
  })

  describe("高度上下限钳制（验收项 2）", () => {
    it("向上拖动小于默认高度时，被严格钳制在下限（112px），无法继续变矮", () => {
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      const handle = screen.getByTestId("prompt-resize-handle")

      fireEvent.pointerDown(handle, {
        button: 0,
        clientY: 200,
        pointerId: 1
      })

      // 大幅向上拖拽 150px
      fireEvent.pointerMove(window, {
        clientY: 50,
        pointerId: 1
      })

      // 钳制在下限 PROMPT_HEIGHT_MIN (112px)
      expect(textarea).toHaveStyle({ height: `${PROMPT_HEIGHT_MIN}px` })

      fireEvent.pointerUp(window, {
        pointerId: 1
      })

      expect(localStorage.getItem(PROMPT_HEIGHT_STORAGE_KEY)).toBe(
        String(PROMPT_HEIGHT_MIN)
      )
    })

    it("向下拖动超过视口允许上限时，被严格钳制在上限，保证其余控件始终完整可见", () => {
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      const handle = screen.getByTestId("prompt-resize-handle")

      fireEvent.pointerDown(handle, {
        button: 0,
        clientY: 100,
        pointerId: 1
      })

      // 超大幅度向下拖拽 3000px
      fireEvent.pointerMove(window, {
        clientY: 3100,
        pointerId: 1
      })

      // 读取 handle 上的 aria-valuemax 确认被钳制在上限
      const maxAttr = handle.getAttribute("aria-valuemax")
      expect(maxAttr).not.toBeNull()
      const maxVal = Number(maxAttr)
      expect(textarea).toHaveStyle({ height: `${maxVal}px` })

      // 其余控件依然在 DOM 中可见
      expect(screen.getByRole("radio", { name: "竖图" })).toBeInTheDocument()
      expect(screen.getByRole("radio", { name: "方图" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "生成" })).toBeInTheDocument()
    })
  })

  describe("持久化恢复（验收项 3）", () => {
    it("初次加载若 localStorage 已有记录，自动恢复上次保存的高度", () => {
      localStorage.setItem(PROMPT_HEIGHT_STORAGE_KEY, "260")
      render(<ControlPanel {...defaultProps} />)

      const textarea = screen.getByPlaceholderText("提示词")
      expect(textarea).toHaveStyle({ height: "260px" })
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
