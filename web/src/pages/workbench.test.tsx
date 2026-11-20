import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { i18n } from "@/i18n"
import type { GenerationHistoryItem } from "@/lib/api-types"
import {
  formatHistoryMeta,
  GEN_JOB_STORAGE_KEY,
  HISTORY_POLL_DELAYS,
  writeStoredJob
} from "@/lib/gen"
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

const { genApi, ApiError } = await import("@/lib/api")

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
    imageUrl: "/api/gen/history/101/image",
    duration_seconds: 65
  },
  {
    id: 102,
    job_id: "job-102",
    model: "counterfeit",
    prompt_original: "未来城市夜景",
    prompt_effective: "cyberpunk city night",
    size: "square",
    created_at: "2026-11-20T10:05:00Z",
    imageUrl: "/api/gen/history/102/image",
    duration_seconds: null
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

  it("首屏防误显超时：挂载时若存在已超时残留 job，清除存储并保持空闲态", async () => {
    // 模拟上一会话遗留的旧任务（如 15 分钟前提交，早已超时）
    const staleTime = Date.now() - 15 * 60 * 1000
    writeStoredJob({
      jobId: "job-stale-timeout",
      prompt: "上一会话遗留提示词",
      size: "square",
      submittedAt: staleTime
    })

    renderPage()

    // 1. 首屏不得出现「生成超时」或「再查一次」
    expect(screen.queryByText("生成超时")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "再查一次" })
    ).not.toBeInTheDocument()

    // 2. 画布处于正常待机态（PIX 字标）
    expect(screen.getByText("PIX")).toBeInTheDocument()

    // 3. 提示词不强制回填旧残留，保持空白可直接输入
    const textarea = screen.getByPlaceholderText("提示词")
    expect(textarea).toHaveValue("")
    expect(screen.getByRole("button", { name: "生成" })).toBeDisabled()

    // 4. 残留存储已被自动清理，避免后续刷新再次受影响
    expect(localStorage.getItem(GEN_JOB_STORAGE_KEY)).toBeNull()

    // 5. 触发了健康检查且未发起过期任务的单次状态查询
    expect(genApi.health).toHaveBeenCalled()
    expect(genApi.status).not.toHaveBeenCalled()
  })

  it("已完成任务自动清理存储：轮询出图完成后清空存储，再次进入首屏为空闲态且历史条可见", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const completedItem: GenerationHistoryItem = {
      id: 201,
      job_id: "job-done-cleanup",
      model: "realistic-lcm",
      prompt_original: "已完成的图",
      prompt_effective: "finished image",
      size: "portrait",
      created_at: "2026-11-20T10:00:00Z",
      imageUrl: "/api/gen/history/201/image"
    }

    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-done-cleanup" })
    vi.mocked(genApi.status).mockResolvedValue({ state: "done" })
    vi.mocked(genApi.history).mockResolvedValue({
      items: [completedItem],
      total: 1,
      page: 1,
      pageSize: 12,
      totalPages: 1
    })

    const { unmount } = renderPage()

    // 提交生图并进入 done 态
    const textarea = screen.getByPlaceholderText("提示词")
    fireEvent.change(textarea, { target: { value: "已完成的图" } })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成中" })).toBeInTheDocument()
    })

    // 推进 5 秒出图
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await waitFor(() => {
      const output = screen.getByTestId("gen-output")
      expect(output.querySelector("img")).toHaveAttribute(
        "src",
        "/api/gen/image/job-done-cleanup"
      )
    })

    // 出图后存储已被清除
    expect(localStorage.getItem(GEN_JOB_STORAGE_KEY)).toBeNull()

    // 卸载并模拟用户「关闭页面后再次进入生图页」
    unmount()
    vi.useRealTimers()

    renderPage()

    // 再次进入：画布为空闲待机态，绝不误显「生成超时」，历史条正常可见
    expect(screen.queryByText("生成超时")).not.toBeInTheDocument()
    expect(screen.getByText("PIX")).toBeInTheDocument()
    expect(await screen.findByText("#201")).toBeInTheDocument()
    expect(screen.getByText("已完成的图")).toBeInTheDocument()
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

    // 3. 悬浮展示 Tooltip 元信息浮层，点击缩略图打开原图灯箱 Dialog 展示元信息与提示词原文
    const user = userEvent.setup()
    const viewThumbnails = screen.getAllByRole("button", { name: "查看原图" })
    const meta101 = formatHistoryMeta(mockHistoryItems[0], i18n.t)

    await user.hover(viewThumbnails[0])
    expect(await screen.findByRole("tooltip")).toHaveTextContent(meta101)
    await user.unhover(viewThumbnails[0])

    fireEvent.click(viewThumbnails[0])

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(meta101)).toBeInTheDocument()
    expect(within(dialog).getByText("小狗在沙滩冲浪")).toBeInTheDocument()

    // 灯箱内关闭
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }))
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })

    // 测试老记录（#102，duration_seconds 为 null）打开灯箱展示元信息（省略耗时段）与提示词
    fireEvent.click(viewThumbnails[1])
    const dialog102 = await screen.findByRole("dialog")
    const meta102 = formatHistoryMeta(mockHistoryItems[1], i18n.t)
    expect(within(dialog102).getByText(meta102)).toBeInTheDocument()
    expect(meta102).not.toContain("秒")
    expect(meta102).not.toContain("分")
    expect(within(dialog102).getByText("未来城市夜景")).toBeInTheDocument()
    fireEvent.click(within(dialog102).getByRole("button", { name: "关闭" }))
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })

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

  it("删除历史项失败（如 404）时触发 refreshHistory 对齐服务端状态", async () => {
    vi.mocked(genApi.history).mockResolvedValueOnce({
      items: mockHistoryItems,
      total: 2,
      page: 1,
      pageSize: 12,
      totalPages: 1
    })

    renderPage()

    expect(await screen.findByText("#101")).toBeInTheDocument()

    // 模拟服务端 404（已在其他端被删除）
    vi.mocked(genApi.deleteHistory).mockRejectedValueOnce(
      new ApiError({ status: 404, message: "Not found" })
    )
    // 触发的 refreshHistory 返回只剩 #102
    vi.mocked(genApi.history).mockResolvedValueOnce({
      items: [mockHistoryItems[1]],
      total: 1,
      page: 1,
      pageSize: 12,
      totalPages: 1
    })

    const deleteButtons = screen.getAllByRole("button", { name: "删除" })
    fireEvent.click(deleteButtons[0])

    const confirmDeleteBtn = screen
      .getAllByRole("button", { name: "删除" })
      .pop()!
    fireEvent.click(confirmDeleteBtn)

    await waitFor(() => {
      expect(genApi.deleteHistory).toHaveBeenCalledWith(101)
      expect(genApi.history).toHaveBeenCalledTimes(2)
      expect(screen.queryByText("#101")).not.toBeInTheDocument()
      expect(screen.getByText("#102")).toBeInTheDocument()
    })
  })

  it("时序竞态处理：出图后首次历史未落库，退避重试拉取到新图后立即进历史并停轮询", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-race-1" })
    vi.mocked(genApi.status).mockResolvedValue({ state: "done" })

    // 1st call (mount) returns empty
    vi.mocked(genApi.history).mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 12,
      totalPages: 0
    })
    // 2nd call (attempt 0 immediately on done) returns empty (未落库)
    vi.mocked(genApi.history).mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 12,
      totalPages: 0
    })
    // 3rd call (attempt 1 after 500ms) returns the newly persisted item
    const newItem: GenerationHistoryItem = {
      id: 201,
      job_id: "job-race-1",
      model: "realistic-lcm",
      prompt_original: "竞态生图测试",
      prompt_effective: "race prompt",
      size: "portrait",
      created_at: "2026-11-20T10:10:00Z",
      imageUrl: "/api/gen/history/201/image"
    }
    vi.mocked(genApi.history).mockResolvedValueOnce({
      items: [newItem],
      total: 1,
      page: 1,
      pageSize: 12,
      totalPages: 1
    })

    renderPage()

    const textarea = screen.getByPlaceholderText("提示词")
    fireEvent.change(textarea, { target: { value: "竞态生图测试" } })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成中" })).toBeInTheDocument()
    })

    // 推进 5 秒，触发 status 轮询判定完成并触发 attempt 0 刷新历史
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await waitFor(() => {
      expect(genApi.history).toHaveBeenCalledTimes(2)
      // 此时尚未落库，不展示 #201
      expect(screen.queryByText("#201")).not.toBeInTheDocument()
    })

    // 推进 500ms（第 1 次退避重试）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    await waitFor(() => {
      expect(genApi.history).toHaveBeenCalledTimes(3)
      // 目标记录已落库，自动展示在历史区中
      expect(screen.getByText("#201")).toBeInTheDocument()
      expect(screen.getByTitle("竞态生图测试")).toBeInTheDocument()
    })

    // 再推进时间，验证命中目标后已停轮询，不再产生额外请求
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(genApi.history).toHaveBeenCalledTimes(3)
  })

  it("时序竞态有界性：若持续未落库，达到退避上限后停止重试，不发起多余请求", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-max-retry" })
    vi.mocked(genApi.status).mockResolvedValue({ state: "done" })

    // 所有 history 调用均返回空（模拟后端一直未写库）
    vi.mocked(genApi.history).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 12,
      totalPages: 0
    })

    renderPage()

    const textarea = screen.getByPlaceholderText("提示词")
    fireEvent.change(textarea, { target: { value: "上限测试" } })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成中" })).toBeInTheDocument()
    })

    // 推进 5 秒：status 完成，attempt 0 触发
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await waitFor(() => {
      expect(genApi.history).toHaveBeenCalledTimes(2)
    })

    // 依次推进所有退避间隔（共 11 次，总计 25.5s）
    for (const delay of HISTORY_POLL_DELAYS) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay)
      })
    }

    const expectedCalls = 2 + HISTORY_POLL_DELAYS.length
    expect(genApi.history).toHaveBeenCalledTimes(expectedCalls)

    // 达到上限后停止：再推 10 秒，请求数保持不变
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(genApi.history).toHaveBeenCalledTimes(expectedCalls)
  })

  it("连续生图：按 jobId 确定性去重合并，多次生图后新老记录均进入历史且无重复", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const item1: GenerationHistoryItem = {
      id: 301,
      job_id: "job-seq-1",
      model: "realistic-lcm",
      prompt_original: "第一张图",
      prompt_effective: "first",
      size: "portrait",
      created_at: "2026-11-20T10:00:00Z",
      imageUrl: "/api/gen/history/301/image"
    }
    const item2: GenerationHistoryItem = {
      id: 302,
      job_id: "job-seq-2",
      model: "realistic-lcm",
      prompt_original: "第二张图",
      prompt_effective: "second",
      size: "portrait",
      created_at: "2026-11-20T10:05:00Z",
      imageUrl: "/api/gen/history/302/image"
    }

    // 首次挂载历史空
    vi.mocked(genApi.history).mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 12,
      totalPages: 0
    })

    renderPage()

    // 1. 生成第一张图
    vi.mocked(genApi.submit).mockResolvedValueOnce({ jobId: "job-seq-1" })
    vi.mocked(genApi.status).mockResolvedValueOnce({ state: "done" })
    vi.mocked(genApi.history).mockResolvedValueOnce({
      items: [item1],
      total: 1,
      page: 1,
      pageSize: 12,
      totalPages: 1
    })

    const textarea = screen.getByPlaceholderText("提示词")
    fireEvent.change(textarea, { target: { value: "第一张图" } })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成中" })).toBeInTheDocument()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await waitFor(() => {
      expect(screen.getByText("#301")).toBeInTheDocument()
      expect(screen.getByTitle("第一张图")).toBeInTheDocument()
    })

    // 2. 生成第二张图（返回包含 item2 与 item1，且带一条相同 job_id 重复记录）
    vi.mocked(genApi.submit).mockResolvedValueOnce({ jobId: "job-seq-2" })
    vi.mocked(genApi.status).mockResolvedValueOnce({ state: "done" })
    vi.mocked(genApi.history).mockResolvedValueOnce({
      items: [item2, { ...item2, id: 999 }, item1],
      total: 2,
      page: 1,
      pageSize: 12,
      totalPages: 1
    })

    fireEvent.change(textarea, { target: { value: "第二张图" } })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成中" })).toBeInTheDocument()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await waitFor(() => {
      expect(screen.getByText("#302")).toBeInTheDocument()
      expect(screen.getByTitle("第二张图")).toBeInTheDocument()
      expect(screen.getByText("#301")).toBeInTheDocument()
      expect(screen.getByTitle("第一张图")).toBeInTheDocument()
      // #999 因重复 job-seq-2 被去重，不出现
      expect(screen.queryByText("#999")).not.toBeInTheDocument()
    })
  })

  it("发起新生成或重置时立即终止上一次未完的历史轮询", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-cancel-1" })
    vi.mocked(genApi.status).mockResolvedValue({ state: "done" })

    // 挂载与首次 done 返回空，触发退避计划
    vi.mocked(genApi.history).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 12,
      totalPages: 0
    })

    renderPage()

    const textarea = screen.getByPlaceholderText("提示词")
    fireEvent.change(textarea, { target: { value: "取消测试" } })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成中" })).toBeInTheDocument()
    })

    // 推进 5 秒触发完成与 attempt 0
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await waitFor(() => {
      expect(genApi.history).toHaveBeenCalledTimes(2)
    })

    // 在 500ms 重试触发前，用户再次点击生成新的任务
    vi.mocked(genApi.submit).mockResolvedValueOnce({ jobId: "job-cancel-2" })
    fireEvent.change(textarea, { target: { value: "新任务" } })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    // 推进 500ms（原本旧轮询的下一次执行时间），验证不会产生旧任务的轮询调用
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    // 依然只有 2 次（旧轮询已被 stopHistoryPolling 销毁）
    expect(genApi.history).toHaveBeenCalledTimes(2)
  })

  it("并发守卫：挂载时较晚返回的 loadHistory(1) 不覆盖正在进行或已完成的 refreshHistory 记录", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const itemDone: GenerationHistoryItem = {
      id: 501,
      job_id: "job-concurrent-done",
      model: "realistic-lcm",
      prompt_original: "并发新图",
      prompt_effective: "concurrent prompt",
      size: "portrait",
      created_at: "2026-11-20T10:15:00Z",
      imageUrl: "/api/gen/history/501/image"
    }

    // 模拟挂载时 loadHistory(1) 响应延迟
    let resolveMountHistory!: (val: any) => void
    const mountHistoryPromise = new Promise((resolve) => {
      resolveMountHistory = resolve
    })

    vi.mocked(genApi.history).mockImplementation((page = 1) => {
      if (page === 1) {
        return mountHistoryPromise as any
      }
      return Promise.resolve({
        items: [],
        total: 0,
        page: 1,
        pageSize: 12,
        totalPages: 0
      }) as any
    })

    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-concurrent-done" })
    vi.mocked(genApi.status).mockResolvedValue({ state: "done" })

    renderPage()

    // 提交生图并进入 done 态
    const textarea = screen.getByPlaceholderText("提示词")
    fireEvent.change(textarea, { target: { value: "并发新图" } })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成中" })).toBeInTheDocument()
    })

    // 切换 genApi.history 为立即返回已落库记录的 mock，供 refreshHistory 使用（设 total: 20 以验证多页状态）
    vi.mocked(genApi.history).mockResolvedValue({
      items: [itemDone],
      total: 20,
      page: 1,
      pageSize: 12,
      totalPages: 2
    })

    // 推进 5 秒，checkJobStatus 完成，触发 refreshHistory
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await waitFor(() => {
      expect(screen.getByText("#501")).toBeInTheDocument()
      expect(screen.getByTitle("并发新图")).toBeInTheDocument()
    })

    // 此时挂载阶段旧的 loadHistory(1) 终于返回（返回空列表或旧数据）
    await act(async () => {
      resolveMountHistory({
        items: [],
        total: 0,
        page: 1,
        pageSize: 12,
        totalPages: 0
      })
    })

    // 验证新图 #501 依然存在，未被慢返回的旧 loadHistory(1) 覆盖冲掉
    expect(screen.getByText("#501")).toBeInTheDocument()
    expect(screen.getByTitle("并发新图")).toBeInTheDocument()

    // 验证 historyLoading 已在 refreshHistory 时正确复位：顶部未残留「加载中」，且「加载更多」按钮正常可用（未被 disabled）
    expect(screen.queryByText("加载中")).not.toBeInTheDocument()
    const loadMoreBtn = screen.getByRole("button", { name: "加载更多" })
    expect(loadMoreBtn).toBeInTheDocument()
    expect(loadMoreBtn).not.toBeDisabled()
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

  it("历史条目元信息：支持未知模型回退原始 id 与秒级耗时展示", async () => {
    const customItems: GenerationHistoryItem[] = [
      {
        id: 201,
        job_id: "job-201",
        model: "special-custom-model",
        prompt_original: "未知模型的特殊生成图",
        prompt_effective: "special prompt",
        size: "portrait",
        created_at: "2026-11-20T10:10:00Z",
        imageUrl: "/api/gen/history/201/image",
        duration_seconds: 45
      }
    ]

    vi.mocked(genApi.history).mockResolvedValueOnce({
      items: customItems,
      total: 1,
      page: 1,
      pageSize: 12,
      totalPages: 1
    })

    renderPage()

    const viewThumbnails = await screen.findAllByRole("button", {
      name: "查看原图"
    })
    const meta = formatHistoryMeta(customItems[0], i18n.t)
    expect(meta).toContain("special-custom-model")
    expect(meta).toContain("45秒")

    const user = userEvent.setup()
    await user.hover(viewThumbnails[0])
    expect(await screen.findByRole("tooltip")).toHaveTextContent(meta)
    await user.unhover(viewThumbnails[0])

    fireEvent.click(viewThumbnails[0])
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(meta)).toBeInTheDocument()
    expect(within(dialog).getByText("未知模型的特殊生成图")).toBeInTheDocument()
  })
})
