import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { i18n } from "@/i18n"
import type { GenerationHistoryItem } from "@/lib/api-types"
import { GEN_JOB_STORAGE_KEY, writeStoredJob } from "@/lib/gen"
import { WorkbenchPage } from "@/pages/workbench"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    genApi: {
      health: vi.fn(),
      submit: vi.fn(),
      status: vi.fn(),
      history: vi.fn(),
      deleteHistory: vi.fn()
    }
  }
})

const { genApi } = await import("@/lib/api")

function renderPage() {
  return render(<WorkbenchPage />)
}

const mockHistoryItems: GenerationHistoryItem[] = [
  {
    id: 101,
    job_id: "job-101",
    model: "realistic-lcm",
    prompt_original: "小狗在沙滩冲浪",
    prompt_effective: "surfing dog",
    size: "portrait",
    created_at: "2026-11-20T10:00:00Z",
    imageUrl: "/api/gen/history/101/image"
  },
  {
    id: 102,
    job_id: "job-102",
    model: "counterfeit",
    prompt_original: "未来城市夜景",
    prompt_effective: "cyberpunk city night",
    size: "square",
    created_at: "2026-11-20T10:05:00Z",
    imageUrl: "/api/gen/history/102/image"
  }
]

describe("卡通风格生图页（并入 #14 历史区）", () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(genApi.health).mockResolvedValue({ online: true, ready: true })
    vi.mocked(genApi.history).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 12,
      totalPages: 0
    })
    vi.mocked(genApi.deleteHistory).mockResolvedValue({ success: true })
    await i18n.changeLanguage("zh")
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("页面仅包含核心元素，默认竖图与待机输出区，提示词限 1000 字符", async () => {
    renderPage()

    // 1. 提示词输入框（maxLength 1000，字数计数）
    const textarea = screen.getByPlaceholderText("提示词")
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveValue("")
    expect(textarea).toHaveAttribute("maxLength", "1000")
    expect(screen.getByText("0/1000")).toBeInTheDocument()

    // 2. 方图/竖图切换（默认 portrait）
    const portraitItem = screen.getByRole("radio", { name: "竖图" })
    const squareItem = screen.getByRole("radio", { name: "方图" })
    expect(portraitItem).toHaveAttribute("data-state", "on")
    expect(squareItem).toHaveAttribute("data-state", "off")

    // 切换方图
    fireEvent.click(squareItem)
    expect(squareItem).toHaveAttribute("data-state", "on")

    // 3. 模型切换（默认 realistic-lcm）
    const lcmModel = screen.getByRole("radio", { name: "写实·极速" })
    expect(lcmModel).toHaveAttribute("data-state", "on")

    // 4. 生成按钮（提示词为空时禁用）
    const submitBtn = screen.getByRole("button", { name: "生成" })
    expect(submitBtn).toBeDisabled()

    // 5. 画布输出区：待机显示 PIX 字标
    const output = screen.getByTestId("gen-output")
    expect(output).toBeInTheDocument()
    expect(screen.getByText("PIX")).toBeInTheDocument()

    // 6. 历史区标题与空态
    expect(screen.getByText("生成历史")).toBeInTheDocument()
    await waitFor(() => {
      expect(genApi.history).toHaveBeenCalledWith(1, 12)
    })
  })

  it("输入提示词后启用生成按钮，空格无法绕过", async () => {
    const user = userEvent.setup()
    renderPage()

    const textarea = screen.getByPlaceholderText("提示词")
    const submitBtn = screen.getByRole("button", { name: "生成" })

    await user.type(textarea, "   ")
    expect(submitBtn).toBeDisabled()

    await user.clear(textarea)
    await user.type(textarea, "一只可爱的猫咪")
    expect(submitBtn).toBeEnabled()
    expect(screen.getByText("7/1000")).toBeInTheDocument()

    await user.clear(textarea)
    expect(submitBtn).toBeDisabled()
  })

  it("健康检查发现机器离线：明确离线提示、禁用生成按钮、支持重新检查", async () => {
    vi.mocked(genApi.health).mockResolvedValue({ online: false })
    renderPage()

    expect(await screen.findByText("机器离线")).toBeInTheDocument()
    const recheckBtn = screen.getByRole("button", { name: "重新检查" })
    expect(recheckBtn).toBeInTheDocument()

    const textarea = screen.getByPlaceholderText("提示词")
    fireEvent.change(textarea, { target: { value: "test" } })
    const submitBtn = screen.getByRole("button", { name: "生成" })
    expect(submitBtn).toBeDisabled()

    // 点击重新检查恢复
    vi.mocked(genApi.health).mockResolvedValue({ online: true, ready: true })
    fireEvent.click(recheckBtn)

    await waitFor(() => {
      expect(screen.queryByText("机器离线")).not.toBeInTheDocument()
    })
    expect(submitBtn).toBeEnabled()
  })

  it("健康检查发现机器启动中：显示启动中提示与重新检查按钮", async () => {
    vi.mocked(genApi.health).mockResolvedValue({ online: true, ready: false })
    renderPage()

    expect(await screen.findByText("机器启动中")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重新检查" })).toBeInTheDocument()
  })

  it("提交生图：提交中状态 → 成功生成中（进度条缓动、95% 封顶、等待期间允许编辑提示词）", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-abc" })
    vi.mocked(genApi.status).mockResolvedValue({ state: "running" })

    renderPage()

    const textarea = screen.getByPlaceholderText("提示词")
    fireEvent.change(textarea, { target: { value: "赛博朋克城市" } })

    const submitBtn = screen.getByRole("button", { name: "生成" })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(genApi.submit).toHaveBeenCalledWith({
        prompt: "赛博朋克城市",
        size: "portrait",
        model: "realistic-lcm"
      })
    })

    // 进入生成中状态
    expect(
      await screen.findByRole("button", { name: "生成中" })
    ).toBeInTheDocument()
    expect(submitBtn).toBeDisabled()

    // 等待期间提示词输入框不被禁用，允许继续编辑
    expect(textarea).not.toBeDisabled()
    fireEvent.change(textarea, { target: { value: "修改后的下一张提示词" } })
    expect(textarea).toHaveValue("修改后的下一张提示词")

    // 检查 localStorage 记录保存的是提交时的 prompt
    const stored = JSON.parse(localStorage.getItem(GEN_JOB_STORAGE_KEY) || "{}")
    expect(stored.jobId).toBe("job-abc")
    expect(stored.prompt).toBe("赛博朋克城市")

    // 推进时间，断言进度条递增
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText(/已等 3 秒/)).toBeInTheDocument()

    // 进度条封顶 95%（即使等了极长时间）
    act(() => {
      vi.advanceTimersByTime(600 * 1000)
    })
    const progressbar = screen.getByRole("progressbar")
    expect(
      Number(progressbar.getAttribute("aria-valuenow"))
    ).toBeLessThanOrEqual(95)

    vi.useRealTimers()
  })

  it("轮询完成：完成时展示真实 <img> 并刷新历史列表", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-done-1" })
    vi.mocked(genApi.status).mockResolvedValue({ state: "done" })

    renderPage()

    const textarea = screen.getByPlaceholderText("提示词")
    fireEvent.change(textarea, { target: { value: "完成测试" } })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成中" })).toBeInTheDocument()
      expect(localStorage.getItem(GEN_JOB_STORAGE_KEY)).not.toBeNull()
    })

    // 推进 5 秒触发轮询
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    // 轮询返回 done，应该展示 <img> 且调用 refreshHistory
    await waitFor(() => {
      const img = screen.getByRole("img", { name: "完成测试" })
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute("src", "/api/gen/image/job-done-1")
      // 首次加载 1 次 + 出图刷新 1 次 = 2 次
      expect(genApi.history).toHaveBeenCalledTimes(2)
    })
  })

  it("轮询出错：展示错误文案并允许重新生成", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-err-1" })
    vi.mocked(genApi.status).mockResolvedValue({
      state: "error",
      error: "ComfyUI GPU OOM"
    })

    renderPage()

    const textarea = screen.getByPlaceholderText("提示词")
    fireEvent.change(textarea, { target: { value: "复杂大图" } })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成中" })).toBeInTheDocument()
      expect(localStorage.getItem(GEN_JOB_STORAGE_KEY)).not.toBeNull()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await waitFor(() => {
      expect(screen.getByText("生成失败")).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "重新生成" })
      ).toBeInTheDocument()
    })

    expect(localStorage.getItem(GEN_JOB_STORAGE_KEY)).toBeNull()
  })

  it("12 分钟超时：停轮询进入超时态，提供「再查一次」与「重新生成」", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-timeout-1" })
    vi.mocked(genApi.status).mockResolvedValue({ state: "running" })

    renderPage()

    fireEvent.change(screen.getByPlaceholderText("提示词"), {
      target: { value: "长耗时任务" }
    })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成中" })).toBeInTheDocument()
    })

    // 前进 12 分钟 (720 秒)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 60 * 1000)
    })

    await waitFor(() => {
      expect(screen.getByText("生成超时")).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "再查一次" })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "重新生成" })
      ).toBeInTheDocument()
    })

    // 再查一次：若后端已完成，立即呈现图片
    vi.mocked(genApi.status).mockResolvedValueOnce({ state: "done" })
    fireEvent.click(screen.getByRole("button", { name: "再查一次" }))

    await waitFor(() => {
      const img = screen.getByRole("img", { name: "长耗时任务" })
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute("src", "/api/gen/image/job-timeout-1")
    })

    vi.useRealTimers()
  })

  it("任务续查：页面重进从 localStorage 恢复未完成任务", async () => {
    const now = Date.now() - 30000
    writeStoredJob({
      jobId: "job-stored-pending",
      prompt: "恢复的任务",
      size: "square",
      submittedAt: now
    })

    vi.mocked(genApi.status).mockResolvedValue({ state: "running" })
    renderPage()

    expect(screen.getByPlaceholderText("提示词")).toHaveValue("恢复的任务")
    expect(screen.getByRole("radio", { name: "方图" })).toHaveAttribute(
      "data-state",
      "on"
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成中" })).toBeInTheDocument()
      expect(genApi.status).toHaveBeenCalledWith("job-stored-pending")
    })
  })

  it("历史区：展示历史卡片、原图灯箱查看、下载链接与删除确认", async () => {
    vi.mocked(genApi.history).mockResolvedValue({
      items: mockHistoryItems,
      total: 2,
      page: 1,
      pageSize: 12,
      totalPages: 1
    })

    renderPage()

    // 1. 列表展示编号与提示词
    expect(await screen.findByText("#101")).toBeInTheDocument()
    expect(screen.getByText("小狗在沙滩冲浪")).toBeInTheDocument()
    expect(screen.getByText("#102")).toBeInTheDocument()
    expect(screen.getByText("未来城市夜景")).toBeInTheDocument()

    // 2. 下载链接属性断言
    const downloadLinks = screen.getAllByRole("link", { name: "下载原图" })
    expect(downloadLinks[0]).toHaveAttribute(
      "href",
      "/api/gen/history/101/image?download=1"
    )

    // 3. 点击缩略图打开原图灯箱 Dialog
    const viewThumbnails = screen.getAllByTitle("查看原图")
    fireEvent.click(viewThumbnails[0])

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    })
    // 灯箱内关闭
    fireEvent.click(screen.getByRole("button", { name: "关闭" }))

    // 4. 删除历史项确认流程
    const deleteButtons = screen.getAllByRole("button", { name: "删除" })
    fireEvent.click(deleteButtons[0]) // 点击 #101 的删除

    await waitFor(() => {
      expect(
        screen.getByText("确定要删除这条生成记录吗？删除后不可恢复。")
      ).toBeInTheDocument()
    })

    // 在确认弹窗中点击确认删除
    const confirmDeleteBtn = screen
      .getAllByRole("button", { name: "删除" })
      .pop()!
    fireEvent.click(confirmDeleteBtn)

    await waitFor(() => {
      expect(genApi.deleteHistory).toHaveBeenCalledWith(101)
      expect(screen.queryByText("#101")).not.toBeInTheDocument()
      // #102 依然保留且编号不变
      expect(screen.getByText("#102")).toBeInTheDocument()
    })
  })

  it("支持英文双语展示", async () => {
    await i18n.changeLanguage("en")
    renderPage()

    expect(screen.getByPlaceholderText("Prompt")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Portrait" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Square" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument()
    expect(screen.getByText("History")).toBeInTheDocument()
  })
})
