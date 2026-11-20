import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Canvas } from "@/components/workbench/canvas"
import { ControlPanel } from "@/components/workbench/control-panel"
import { HistoryStrip } from "@/components/workbench/history-strip"
import "@/components/workbench/workbench.css"
import { ApiError, genApi, genImageUrl } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import {
  DEFAULT_MODEL,
  type GenerationHistoryItem,
  type GenerationModel,
  type GenerateSize
} from "@/lib/api-types"
import {
  appendHistoryItems,
  clearStoredJob,
  elapsedSeconds,
  GEN_POLL_INTERVAL_MS,
  HISTORY_POLL_DELAYS,
  isTimedOut,
  mergeHistoryItems,
  readStoredJob,
  writeStoredJob,
  type GenPhase
} from "@/lib/gen"

/**
 * 卡通风格生图工作台
 * 桌面 2 列（画布 + 历史条，右控制面板）；移动端紧凑单列，100dvh 一屏完整显示无页面滚动。
 */
export function WorkbenchPage() {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState("")
  const [size, setSize] = useState<GenerateSize>("portrait")
  const [model, setModel] = useState<GenerationModel>(DEFAULT_MODEL)
  const [phase, setPhase] = useState<GenPhase>("idle")
  const [jobId, setJobId] = useState<string | null>(null)
  const [submittedAt, setSubmittedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 历史记录状态
  const [historyItems, setHistoryItems] = useState<GenerationHistoryItem[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotalPages, setHistoryTotalPages] = useState(1)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState("")

  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const jobIdRef = useRef(jobId)
  jobIdRef.current = jobId
  const submittedAtRef = useRef(submittedAt)
  submittedAtRef.current = submittedAt

  // 历史追踪轮询计时器与序列号
  const historyPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyPollSeqRef = useRef<number>(0)
  const loadHistorySeqRef = useRef<number>(0)

  const stopHistoryPolling = useCallback(() => {
    if (historyPollTimerRef.current !== null) {
      clearTimeout(historyPollTimerRef.current)
      historyPollTimerRef.current = null
    }
    historyPollSeqRef.current += 1
  }, [])

  useEffect(() => {
    return () => {
      stopHistoryPolling()
    }
  }, [stopHistoryPolling])

  /** 加载历史列表 */
  const loadHistory = useCallback(
    async (pageToLoad = 1) => {
      setHistoryLoading(true)
      setHistoryError("")
      const seq = ++loadHistorySeqRef.current
      try {
        const res = await genApi.history(pageToLoad, 12)
        if (loadHistorySeqRef.current !== seq) return
        setHistoryPage(res.page)
        setHistoryTotalPages(Math.max(1, Math.ceil(res.total / res.pageSize)))
        if (pageToLoad === 1) {
          setHistoryItems((prev) => mergeHistoryItems(res.items, prev))
        } else {
          setHistoryItems((prev) => appendHistoryItems(prev, res.items))
        }
      } catch (err) {
        if (loadHistorySeqRef.current !== seq) return
        setHistoryError(describeApiError(t, err) || t("common.loading"))
      } finally {
        if (loadHistorySeqRef.current === seq) {
          setHistoryLoading(false)
        }
      }
    },
    [t]
  )

  /**
   * 刷新历史条目（取第 1 页并按 jobId / id 去重合并至头部）。
   * 若传入 targetJobId，则在目标记录未落库时使用有界退避策略轮询，直至新图入库或达到重试上限。
   */
  const refreshHistory = useCallback(
    (targetJobId?: string) => {
      stopHistoryPolling()
      // 使在途未完成的 loadHistory（如挂载时发起的初次拉取）失效，避免晚到覆盖
      loadHistorySeqRef.current += 1
      setHistoryLoading(false)
      const seq = historyPollSeqRef.current

      let attempt = 0

      const poll = async () => {
        if (historyPollSeqRef.current !== seq) return

        try {
          const res = await genApi.history(1, 12)
          if (historyPollSeqRef.current !== seq) return

          setHistoryTotalPages(Math.max(1, Math.ceil(res.total / res.pageSize)))
          setHistoryItems((prev) => mergeHistoryItems(res.items, prev))

          // 未指定目标 jobId，单次刷新即完成
          if (!targetJobId) {
            return
          }

          // 检查目标 jobId 是否已在返回列表里
          const found = res.items.some((it) => it.job_id === targetJobId)
          if (found) {
            return
          }

          // 未命中且仍有重试次数：按退避延迟等待下一次重试
          if (attempt < HISTORY_POLL_DELAYS.length) {
            const delay = HISTORY_POLL_DELAYS[attempt]
            attempt += 1
            historyPollTimerRef.current = setTimeout(() => {
              void poll()
            }, delay)
          }
        } catch {
          // 网络或服务端临时异常：若有剩余重试次数则按退避继续，不中断流程
          if (targetJobId && attempt < HISTORY_POLL_DELAYS.length) {
            const delay = HISTORY_POLL_DELAYS[attempt]
            attempt += 1
            historyPollTimerRef.current = setTimeout(() => {
              void poll()
            }, delay)
          }
        }
      }

      void poll()
    },
    [stopHistoryPolling]
  )

  /** 删除单条历史 */
  const handleDeleteHistory = useCallback(
    async (id: number): Promise<boolean> => {
      try {
        await genApi.deleteHistory(id)
        setHistoryItems((prev) => prev.filter((it) => it.id !== id))
        return true
      } catch (err) {
        // 删除失败（如已在其他标签页删除返回 404）时，刷新列表对齐服务端状态
        if (err instanceof ApiError && err.status === 404) {
          setHistoryItems((prev) => prev.filter((it) => it.id !== id))
        }
        void refreshHistory()
        throw err
      }
    },
    [refreshHistory]
  )

  /** 加载更多历史 */
  const handleLoadMoreHistory = useCallback(() => {
    if (historyPage < historyTotalPages && !historyLoading) {
      void loadHistory(historyPage + 1)
    }
  }, [historyPage, historyTotalPages, historyLoading, loadHistory])

  /**
   * 单次健康检查：
   * - 离线时设 offline，生成按钮禁用；
   * - 启动中仅在空闲/离线时迁移至 starting；
   * - 就绪时仅在离线/启动中时恢复至 idle；
   * - 绝不覆盖生成中、完成、超时等已有任务状态。
   */
  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      const res = await genApi.health()
      if (!res.online) {
        setPhase((prev) =>
          prev === "idle" || prev === "offline" || prev === "starting"
            ? "offline"
            : prev
        )
        return false
      }
      if (res.ready === false) {
        setPhase((prev) =>
          prev === "idle" || prev === "offline" ? "starting" : prev
        )
        return false
      }
      setPhase((prev) =>
        prev === "offline" || prev === "starting" ? "idle" : prev
      )
      return true
    } catch {
      setPhase((prev) =>
        prev === "idle" || prev === "offline" || prev === "starting"
          ? "offline"
          : prev
      )
      return false
    }
  }, [])

  /** 单次查询生图任务状态 */
  const checkJobStatus = useCallback(
    async (currentJobId: string, timestamp: number) => {
      if (isTimedOut(timestamp)) {
        setPhase("timeout")
        return
      }

      try {
        const res = await genApi.status(currentJobId)
        if (res.state === "done") {
          if (typeof Image !== "undefined") {
            const img = new Image()
            img.src = genImageUrl(currentJobId)
          }
          setPhase("done")
          refreshHistory(currentJobId)
          return
        }
        if (res.state === "error") {
          setPhase("error")
          setErrorMessage(t("generate.error"))
          clearStoredJob()
          return
        }
        // state === "running" | "queued"
        setPhase("generating")
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setPhase("error")
            setErrorMessage(t("generate.jobNotFound"))
            clearStoredJob()
            return
          }
          if (err.status === 502 || err.status === 0) {
            setPhase("offline")
            return
          }
        }
        setPhase("error")
        setErrorMessage(describeApiError(t, err))
      }
    },
    [t, refreshHistory]
  )

  /** 挂载：初始化、恢复 localStorage 任务与拉取历史 */
  useEffect(() => {
    void loadHistory(1)

    const stored = readStoredJob()
    if (stored) {
      setJobId(stored.jobId)
      setSubmittedAt(stored.submittedAt)
      if (stored.prompt) setPrompt(stored.prompt)
      setSize(stored.size)
      if (stored.model) {
        setModel(stored.model)
      }
      setElapsed(elapsedSeconds(stored.submittedAt))

      if (isTimedOut(stored.submittedAt)) {
        setPhase("timeout")
        return
      }

      setPhase("generating")
      void checkJobStatus(stored.jobId, stored.submittedAt)
    } else {
      void checkHealth()
    }
  }, [checkHealth, checkJobStatus, loadHistory])

  /** 轮询与计时器 */
  useEffect(() => {
    if (phase !== "generating" || !submittedAt || !jobId) {
      return
    }

    const timerInterval = setInterval(() => {
      const sec = elapsedSeconds(submittedAt)
      setElapsed(sec)

      if (isTimedOut(submittedAt)) {
        setPhase("timeout")
      }
    }, 1000)

    const pollInterval = setInterval(() => {
      void checkJobStatus(jobId, submittedAt)
    }, GEN_POLL_INTERVAL_MS)

    return () => {
      clearInterval(timerInterval)
      clearInterval(pollInterval)
    }
  }, [phase, submittedAt, jobId, checkJobStatus])

  /** 前后台切换处理 */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (phaseRef.current !== "done") {
          void checkHealth()
        }
        if (
          phaseRef.current === "generating" &&
          jobIdRef.current &&
          submittedAtRef.current
        ) {
          void checkJobStatus(jobIdRef.current, submittedAtRef.current)
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [checkHealth, checkJobStatus])

  /** 提交生图 */
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = prompt.trim()
    if (
      !trimmed ||
      phase === "submitting" ||
      phase === "generating" ||
      phase === "offline"
    ) {
      return
    }

    setPhase("submitting")
    setErrorMessage(null)
    stopHistoryPolling()

    try {
      const res = await genApi.submit({ prompt: trimmed, size, model })

      if ("jobId" in res && res.jobId) {
        const now = Date.now()
        const newJob = {
          jobId: res.jobId,
          prompt: trimmed,
          size,
          model,
          submittedAt: now
        }
        writeStoredJob(newJob)
        setJobId(res.jobId)
        setSubmittedAt(now)
        setElapsed(0)
        setPhase("generating")
        return
      }

      if ("busy" in res && res.busy) {
        setPhase("busy")
        return
      }

      if ("ready" in res && res.ready === false) {
        setPhase("starting")
        return
      }

      if ("online" in res && res.online === false) {
        setPhase("offline")
        return
      }

      setPhase("error")
      setErrorMessage(t("generate.error"))
    } catch (err) {
      if (err instanceof ApiError && (err.status === 502 || err.status === 0)) {
        setPhase("offline")
        return
      }
      setPhase("error")
      setErrorMessage(describeApiError(t, err))
    }
  }

  /** 离线态或启动态「重新检查」按钮点击 */
  const handleRecheckHealth = async () => {
    try {
      const res = await genApi.health()
      if (res.online) {
        if (res.ready === false) {
          setPhase("starting")
        } else {
          if (
            jobIdRef.current &&
            submittedAtRef.current &&
            !isTimedOut(submittedAtRef.current)
          ) {
            void checkJobStatus(jobIdRef.current, submittedAtRef.current)
          } else {
            setPhase("idle")
          }
        }
      }
    } catch {
      // 保持 offline
    }
  }

  /** 超时态「再查一次」 */
  const handleCheckOnce = async () => {
    if (!jobId) return
    try {
      const res = await genApi.status(jobId)
      if (res.state === "done") {
        if (typeof Image !== "undefined") {
          const img = new Image()
          img.src = genImageUrl(jobId)
        }
        setPhase("done")
        refreshHistory(jobId)
        return
      }
      if (res.state === "error") {
        setPhase("error")
        setErrorMessage(t("generate.error"))
        clearStoredJob()
        return
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setPhase("error")
          setErrorMessage(t("generate.jobNotFound"))
          clearStoredJob()
          return
        }
        if (err.status === 502 || err.status === 0) {
          setPhase("offline")
          return
        }
      }
      setPhase("error")
      setErrorMessage(describeApiError(t, err))
    }
  }

  /** 超时态或异常态「重新生成」 */
  const handleRegenerate = () => {
    stopHistoryPolling()
    clearStoredJob()
    setJobId(null)
    setSubmittedAt(null)
    setElapsed(0)
    void handleSubmit()
  }

  return (
    <div
      data-testid="workbench-page"
      className="wb-root -m-4 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden p-3 sm:p-4"
    >
      <div className="flex h-full min-h-0 w-full flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* 左列：大图画布 + 底部历史条 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:h-full">
          <Canvas
            phase={phase}
            jobId={jobId ?? ""}
            prompt={prompt}
            model={model}
            elapsed={elapsed}
            errorMessage={errorMessage ?? ""}
            onRecheckHealth={handleRecheckHealth}
            onCheckOnce={handleCheckOnce}
            onRegenerate={handleRegenerate}
          />
          <HistoryStrip
            items={historyItems}
            loading={historyLoading}
            error={historyError}
            page={historyPage}
            totalPages={historyTotalPages}
            onLoadMore={handleLoadMoreHistory}
            onDelete={handleDeleteHistory}
          />
        </div>

        {/* 右列：控制面板（移动端紧凑单列排布） */}
        <ControlPanel
          prompt={prompt}
          onPromptChange={setPrompt}
          size={size}
          onSizeChange={setSize}
          model={model}
          onModelChange={setModel}
          submitting={phase === "submitting"}
          generating={phase === "generating"}
          offline={phase === "offline"}
          onSubmit={() => void handleSubmit()}
          className="shrink-0 lg:h-full"
        />
      </div>
    </div>
  )
}
