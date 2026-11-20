import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ControlPanel } from "@/components/workbench/control-panel"
import { i18n } from "@/i18n"
import {
  MODEL_OPTIONS,
  type GenerationModel,
  type GenerateSize
} from "@/lib/api-types"

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
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Realistic Vision 加 LCM 合并，8 步极速出图"
    )
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "预计约 100 秒"
    )
    await user.unhover(lcmBtn)
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    })

    // 2. photon (光子：250 秒 -> 约 4 分钟)
    const photonBtn = screen.getByRole("radio", { name: "人像·光子" })
    await user.hover(photonBtn)
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "人像写实，肤质与光影细腻"
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
      "纯卡通画风，线条明快"
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
    expect(tooltip).toHaveTextContent("东方人像写实")
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
    expect(animeTooltip).toHaveTextContent("2D anime style")
    expect(animeTooltip).toHaveTextContent("About 4 minutes")
    await user.unhover(animeBtn)
  })
})
