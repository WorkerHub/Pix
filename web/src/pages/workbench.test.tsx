import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { i18n } from "@/i18n"
import { GEN_JOB_STORAGE_KEY, writeStoredJob } from "@/lib/gen"
import { WorkbenchPage } from "@/pages/workbench"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    genApi: {
      health: vi.fn(),
      submit: vi.fn(),
      status: vi.fn()
    }
  }
})

const { genApi, ApiError } = await import("@/lib/api")

function renderPage() {
  return render(<WorkbenchPage />)
}

describe("生图页（规格 §5，单页，UI 极简）", () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(genApi.health).mockResolvedValue({ online: true, ready: true })
    await i18n.changeLanguage("zh")
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("页面仅包含核心元素，默认竖图与待机输出区，无说明性填充", async () => {
    renderPage()

    // 1. 大提示词输入框
    const textarea = screen.getByPlaceholderText("提示词")
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveValue("")

    // 2. 方图/竖图分段选择（默认 portrait）
    const portraitItem = screen.getByRole("radio", { name: "竖图" })
    const squareItem = screen.getByRole("radio", { name: "方图" })
    expect(portraitItem).toHaveAttribute("data-state", "on")
    expect(squareItem).toHaveAttribute("data-state", "off")

    // 3. 生成按钮（提示词为空时禁用）
    const submitBtn = screen.getByRole("button", { name: "生成" })
    expect(submitBtn).toBeDisabled()

    // 4. 图片输出区：默认 portrait 对应 aspect-[2/3]
    const output = screen.getByTestId("gen-output")
    expect(output).toHaveClass("aspect-[2/3]")

    // 切换方图后更新长宽比
    fireEvent.click(squareItem)
    expect(squareItem).toHaveAttribute("data-state", "on")
    expect(output).toHaveClass("aspect-square")

    // 页面健康检查被调用
    await waitFor(() => {
      expect(genApi.health).toHaveBeenCalledTimes(1)
    })
  })

  it("输入提示词后启用生成按钮，空格无法绕过", async () => {
    const user = userEvent.setup()
    renderPage()

    const textarea = screen.getByPlaceholderText("提示词")
    const submitBtn = screen.getByRole("button", { name: "生成" })

    await user.type(textarea, "   ")
    expect(submitBtn).toBeDisabled()

    await user.type(textarea, "一只可爱的猫咪")
    expect(submitBtn).toBeEnabled()

    await user.clear(textarea)
    expect(submitBtn).toBeDisabled()
  })

  it("健康检查发现机器离线：明确离线提示、禁用生成按钮、支持重新检查", async () => {
    vi.mocked(genApi.health).mockResolvedValue({ online: false })
    renderPage()

    expect(await screen.findByRole("alert")).toHaveTextContent("机器离线")
    const recheckBtn = screen.getByRole("button", { name: "重新检查" })
    expect(recheckBtn).toBeInTheDocument()

    // 提示词有内容但离线态依然禁用生成
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

    expect(await screen.findByRole("status")).toHaveTextContent("机器启动中")
    expect(screen.getByRole("button", { name: "重新检查" })).toBeInTheDocument()
  })

  it("提交生图：提交中状态 → 成功生成中（秒数递增、按钮禁用、写入 localStorage）", async () => {
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
        model: "realistic"
      })
    })

    // 进入生成中状态
    expect(await screen.findByText("生成中")).toBeInTheDocument()
    expect(submitBtn).toBeDisabled()

    // 检查 localStorage 记录
    const stored = JSON.parse(localStorage.getItem(GEN_JOB_STORAGE_KEY) || "{}")
    expect(stored.jobId).toBe("job-abc")
    expect(stored.prompt).toBe("赛博朋克城市")
    expect(stored.size).toBe("portrait")

    // 时间推进，秒数递增
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText(/已等 3 秒/)).toBeInTheDocument()

    vi.useRealTimers()
  })

  it("轮询完成：完成时展示真实 <img> 且 src 符合契约", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-done-1" })
    vi.mocked(genApi.status).mockResolvedValue({ state: "done" })

    renderPage()

    const textarea = screen.getByPlaceholderText("提示词")
    fireEvent.change(textarea, { target: { value: "晨曦森林" } })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByText("生成中")).toBeInTheDocument()
      expect(localStorage.getItem(GEN_JOB_STORAGE_KEY)).not.toBeNull()
    })

    // 推进 5 秒触发轮询
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    // 轮询返回 done，应该展示 <img>
    await waitFor(() => {
      const img = screen.getByRole("img")
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute("src", "/api/gen/image/job-done-1")
      expect(img).toHaveAttribute("alt", "晨曦森林")
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
      expect(screen.getByText("生成中")).toBeInTheDocument()
      expect(localStorage.getItem(GEN_JOB_STORAGE_KEY)).not.toBeNull()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("生成失败")
      expect(
        screen.getByRole("button", { name: "重新生成" })
      ).toBeInTheDocument()
    })

    // 失败会清理 storage
    expect(localStorage.getItem(GEN_JOB_STORAGE_KEY)).toBeNull()
  })

  it("提交返回机器忙碌 / 启动中 / 离线等异常态正确呈现", async () => {
    // 1. busy
    vi.mocked(genApi.submit).mockResolvedValueOnce({ busy: true })
    const view1 = renderPage()
    fireEvent.change(screen.getByPlaceholderText("提示词"), {
      target: { value: "test" }
    })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))
    expect(await screen.findByText("机器忙碌")).toBeInTheDocument()
    view1.unmount()

    // 2. ready: false
    vi.mocked(genApi.submit).mockResolvedValueOnce({ ready: false })
    const view2 = renderPage()
    fireEvent.change(screen.getByPlaceholderText("提示词"), {
      target: { value: "test" }
    })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))
    expect(await screen.findByText("机器启动中")).toBeInTheDocument()
    view2.unmount()

    // 3. online: false
    vi.mocked(genApi.submit).mockResolvedValueOnce({ online: false })
    const view3 = renderPage()
    fireEvent.change(screen.getByPlaceholderText("提示词"), {
      target: { value: "test" }
    })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))
    expect(await screen.findByText("机器离线")).toBeInTheDocument()
    view3.unmount()
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
      expect(screen.getByText("生成中")).toBeInTheDocument()
    })

    // 前进 12 分钟 (720 秒)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 60 * 1000)
    })

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("生成超时")
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
      const img = screen.getByRole("img")
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute("src", "/api/gen/image/job-timeout-1")
    })

    vi.useRealTimers()
  })

  it("任务续查：页面重进从 localStorage 恢复未完成任务", async () => {
    const now = Date.now() - 30000 // 30 秒前提交
    writeStoredJob({
      jobId: "job-stored-pending",
      prompt: "恢复的任务",
      size: "square",
      submittedAt: now
    })

    vi.mocked(genApi.status).mockResolvedValue({ state: "running" })
    renderPage()

    // 输入框与尺寸恢复
    expect(screen.getByPlaceholderText("提示词")).toHaveValue("恢复的任务")
    expect(screen.getByRole("radio", { name: "方图" })).toHaveAttribute(
      "data-state",
      "on"
    )

    // 直接进入生成中态
    await waitFor(() => {
      expect(screen.getByText("生成中")).toBeInTheDocument()
      expect(genApi.status).toHaveBeenCalledWith("job-stored-pending")
    })
  })

  it("任务续查：已完成任务重进页面直接取图", async () => {
    const now = Date.now() - 60000
    writeStoredJob({
      jobId: "job-stored-done",
      prompt: "已完成的图",
      size: "portrait",
      submittedAt: now
    })

    vi.mocked(genApi.status).mockResolvedValue({ state: "done" })
    renderPage()

    await waitFor(() => {
      const img = screen.getByRole("img")
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute("src", "/api/gen/image/job-stored-done")
    })
  })

  it("任务续查：超 12 分钟任务重进页面直接进超时态", async () => {
    const now = Date.now() - 13 * 60 * 1000 // 13 分钟前
    writeStoredJob({
      jobId: "job-stored-timeout",
      prompt: "超时任务",
      size: "portrait",
      submittedAt: now
    })

    renderPage()

    expect(await screen.findByRole("alert")).toHaveTextContent("生成超时")
    expect(screen.getByRole("button", { name: "再查一次" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重新生成" })).toBeInTheDocument()
  })

  it("前后台切换：切回前台补查单次健康检查与正在进行中的任务", async () => {
    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-vis-1" })
    vi.mocked(genApi.status).mockResolvedValue({ state: "running" })

    renderPage()

    fireEvent.change(screen.getByPlaceholderText("提示词"), {
      target: { value: "前台切换测试" }
    })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByText("生成中")).toBeInTheDocument()
    })

    expect(genApi.health).toHaveBeenCalledTimes(1)
    const initialStatusCalls = vi.mocked(genApi.status).mock.calls.length

    // 模拟切回前台 visibilitychange 事件
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible"
    })
    fireEvent(document, new Event("visibilitychange"))

    await waitFor(() => {
      // 健康检查补查一次
      expect(genApi.health).toHaveBeenCalledTimes(2)
      // 任务状态立即补查一次
      expect(vi.mocked(genApi.status).mock.calls.length).toBeGreaterThan(
        initialStatusCalls
      )
    })
  })

  it("完成态切后台且机器离线，切回前台时不被离线态覆盖图", async () => {
    localStorage.setItem(
      GEN_JOB_STORAGE_KEY,
      JSON.stringify({
        jobId: "done-job-1",
        prompt: "测试图",
        size: "portrait",
        submittedAt: Date.now() - 5000
      })
    )
    vi.mocked(genApi.status).mockResolvedValue({ state: "done" })

    renderPage()

    expect(await screen.findByRole("img")).toBeInTheDocument()

    // 机器变为离线
    vi.mocked(genApi.health).mockResolvedValue({ online: false })

    // 模拟切回前台 visibilitychange
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible"
    })
    fireEvent(document, new Event("visibilitychange"))

    await act(async () => {
      await Promise.resolve()
    })

    // 图依然在，不被「机器离线」覆盖
    expect(screen.getByRole("img")).toBeInTheDocument()
    expect(screen.queryByText("机器离线")).not.toBeInTheDocument()
  })

  it("查询任务返回 404：展示本地化任务失效文案并清理本地存储", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-404" })
    vi.mocked(genApi.status).mockRejectedValue(
      new ApiError({ status: 404, message: "job not found" })
    )

    renderPage()

    fireEvent.change(screen.getByPlaceholderText("提示词"), {
      target: { value: "丢失任务" }
    })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(screen.getByText("生成中")).toBeInTheDocument()
      expect(localStorage.getItem(GEN_JOB_STORAGE_KEY)).not.toBeNull()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("任务不存在或已失效")
      expect(
        screen.getByRole("button", { name: "重新生成" })
      ).toBeInTheDocument()
    })

    expect(localStorage.getItem(GEN_JOB_STORAGE_KEY)).toBeNull()
  })

  it("支持英文双语展示", async () => {
    await i18n.changeLanguage("en")
    renderPage()

    expect(screen.getByPlaceholderText("Prompt")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Portrait" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Square" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument()
  })

  it("模型选择器：默认选中 realistic，点击切换并随提交发送", async () => {
    vi.mocked(genApi.submit).mockResolvedValue({ jobId: "job-model-1" })
    renderPage()

    const realisticItem = screen.getByRole("radio", { name: "写实·原版" })
    const counterfeitItem = screen.getByRole("radio", { name: "动漫" })
    expect(realisticItem).toHaveAttribute("data-state", "on")
    expect(counterfeitItem).toHaveAttribute("data-state", "off")

    fireEvent.click(counterfeitItem)
    expect(counterfeitItem).toHaveAttribute("data-state", "on")
    expect(realisticItem).toHaveAttribute("data-state", "off")

    const textarea = screen.getByPlaceholderText("提示词")
    fireEvent.change(textarea, { target: { value: "二次元美少女" } })
    fireEvent.click(screen.getByRole("button", { name: "生成" }))

    await waitFor(() => {
      expect(genApi.submit).toHaveBeenCalledWith({
        prompt: "二次元美少女",
        size: "portrait",
        model: "counterfeit"
      })
    })
  })
})
