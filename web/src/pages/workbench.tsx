import { AlertCircleIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ApiError, genApi, genImageUrl } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { GenerateSize } from "@/lib/api-types"
import {
  clearStoredJob,
  elapsedSeconds,
  GEN_POLL_INTERVAL_MS,
  isTimedOut,
  readStoredJob,
  writeStoredJob
} from "@/lib/gen"
import { cn } from "@/lib/utils"

export type GenPhase =
  | "idle"
  | "submitting"
  | "generating"
  | "done"
  | "offline"
  | "starting"
  | "busy"
  | "error"
  | "timeout"

/**
 * 登录后生图页（规格 §5，单页，UI 极简）。
 * 元素仅：大提示词输入框、方图/竖图分段选择（默认 portrait）、生成按钮、下方图片输出区。
 */
export function WorkbenchPage() {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState("")
  const [size, setSize] = useState<GenerateSize>("portrait")
  const [phase, setPhase] = useState<GenPhase>("idle")
  const [jobId, setJobId] = useState<string | null>(null)
  const [submittedAt, setSubmittedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const jobIdRef = useRef(jobId)
  jobIdRef.current = jobId
  const submittedAtRef = useRef(submittedAt)
  submittedAtRef.current = submittedAt
  const promptRef = useRef(prompt)
  promptRef.current = prompt
  const sizeRef = useRef(size)
  sizeRef.current = size

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
          setPhase("done")
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
    [t]
  )

  /**
   * 页面挂载初始化：
   * 1. 恢复本地任务（未完成继续轮询，已完成直接取图，超 12 分钟入超时态）；
   * 2. 无本地任务时执行打开页面单次健康检查。
   */
  useEffect(() => {
    const stored = readStoredJob()
    if (stored) {
      setJobId(stored.jobId)
      setSize(stored.size)
      if (stored.prompt) setPrompt(stored.prompt)
      setSubmittedAt(stored.submittedAt)
      const sec = elapsedSeconds(stored.submittedAt)
      setElapsed(sec)

      if (isTimedOut(stored.submittedAt)) {
        setPhase("timeout")
      } else {
        setPhase("generating")
        void checkJobStatus(stored.jobId, stored.submittedAt)
      }
    } else {
      void checkHealth()
    }
  }, [checkHealth, checkJobStatus])

  /**
   * 任务轮询与秒数递增计时：
   * - 仅在 generating 态激活；
   * - 每秒递增已等秒数，达 12 分钟进入超时态；
   * - 每 5 秒轮询一次状态；页面不可见时跳过。
   */
  useEffect(() => {
    if (phase !== "generating" || !jobId || !submittedAt) {
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
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return
      }
      void checkJobStatus(jobId, submittedAt)
    }, GEN_POLL_INTERVAL_MS)

    return () => {
      clearInterval(timerInterval)
      clearInterval(pollInterval)
    }
  }, [phase, jobId, submittedAt, checkJobStatus])

  /**
   * 前后台切换监听：
   * - 切回前台单次健康检查；
   * - 若有进行中的生图任务，切回前台立即补查一次。
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkHealth()

        if (
          phaseRef.current === "generating" &&
          jobIdRef.current &&
          submittedAtRef.current
        ) {
          if (isTimedOut(submittedAtRef.current)) {
            setPhase("timeout")
          } else {
            setElapsed(elapsedSeconds(submittedAtRef.current))
            void checkJobStatus(jobIdRef.current, submittedAtRef.current)
          }
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

    try {
      const res = await genApi.submit({ prompt: trimmed, size })

      if ("jobId" in res && res.jobId) {
        const now = Date.now()
        const newJob = {
          jobId: res.jobId,
          prompt: trimmed,
          size,
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
        setPhase("done")
        return
      }
      if (res.state === "error") {
        setPhase("error")
        setErrorMessage(t("generate.error"))
        clearStoredJob()
        return
      }
      // running 或 queued 仍停留在超时态待用户决定
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
    clearStoredJob()
    setJobId(null)
    setSubmittedAt(null)
    setElapsed(0)
    void handleSubmit()
  }

  const isFormDisabled = phase === "submitting" || phase === "generating"
  const isSubmitDisabled =
    !prompt.trim() ||
    phase === "submitting" ||
    phase === "generating" ||
    phase === "offline"

  return (
    <div
      className="mx-auto flex w-full max-w-xl flex-col gap-4"
      data-testid="workbench-page"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <Label htmlFor="gen-prompt" className="sr-only">
            {t("generate.prompt")}
          </Label>
          <Textarea
            id="gen-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                void handleSubmit()
              }
            }}
            placeholder={t("generate.prompt")}
            rows={3}
            disabled={isFormDisabled}
            className="resize-none"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <ToggleGroup
            type="single"
            value={size}
            onValueChange={(val) => {
              if (val === "portrait" || val === "square") {
                setSize(val)
              }
            }}
            aria-label={t("generate.size")}
            disabled={isFormDisabled}
          >
            <ToggleGroupItem value="portrait" size="sm">
              {t("generate.sizePortrait")}
            </ToggleGroupItem>
            <ToggleGroupItem value="square" size="sm">
              {t("generate.sizeSquare")}
            </ToggleGroupItem>
          </ToggleGroup>

          <Button type="submit" disabled={isSubmitDisabled}>
            {phase === "submitting"
              ? t("generate.submitting")
              : t("generate.submit")}
          </Button>
        </div>
      </form>

      {/* 图片输出区：按所选尺寸固定长宽比占位（竖图 2:3，方图 1:1），图未到不跳版 */}
      <div
        data-testid="gen-output"
        className={cn(
          "relative flex w-full items-center justify-center overflow-hidden rounded-xl border bg-muted/20 transition-all",
          size === "square" ? "aspect-square" : "aspect-[2/3]"
        )}
      >
        {phase === "done" && jobId ? (
          <img
            src={genImageUrl(jobId)}
            alt={prompt || t("generate.title")}
            className="h-full w-full object-contain"
          />
        ) : null}

        {phase === "generating" ? (
          <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
            <Loader2Icon
              className="size-8 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">{t("generate.generating")}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {t("generate.elapsed", { seconds: elapsed })}
            </p>
          </div>
        ) : null}

        {phase === "submitting" ? (
          <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
            <Loader2Icon
              className="size-8 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">{t("generate.submitting")}</p>
          </div>
        ) : null}

        {phase === "offline" ? (
          <div
            role="alert"
            className="flex flex-col items-center justify-center gap-3 p-4 text-center"
          >
            <AlertCircleIcon
              className="size-8 text-destructive"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-destructive">
              {t("generate.offline")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleRecheckHealth()}
            >
              <RefreshCwIcon className="size-3.5" aria-hidden="true" />
              {t("generate.recheck")}
            </Button>
          </div>
        ) : null}

        {phase === "starting" ? (
          <div
            role="status"
            className="flex flex-col items-center justify-center gap-3 p-4 text-center"
          >
            <Loader2Icon
              className="size-8 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">{t("generate.starting")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleRecheckHealth()}
            >
              <RefreshCwIcon className="size-3.5" aria-hidden="true" />
              {t("generate.recheck")}
            </Button>
          </div>
        ) : null}

        {phase === "busy" ? (
          <div
            role="status"
            className="flex flex-col items-center justify-center gap-3 p-4 text-center"
          >
            <AlertCircleIcon
              className="size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">{t("generate.busy")}</p>
            <Button type="button" size="sm" onClick={() => void handleSubmit()}>
              {t("generate.regenerate")}
            </Button>
          </div>
        ) : null}

        {phase === "error" ? (
          <div
            role="alert"
            className="flex flex-col items-center justify-center gap-3 p-4 text-center"
          >
            <AlertCircleIcon
              className="size-8 text-destructive"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-destructive">
              {errorMessage || t("generate.error")}
            </p>
            <Button type="button" size="sm" onClick={() => void handleSubmit()}>
              {t("generate.regenerate")}
            </Button>
          </div>
        ) : null}

        {phase === "timeout" ? (
          <div
            role="alert"
            className="flex flex-col items-center justify-center gap-3 p-4 text-center"
          >
            <AlertCircleIcon
              className="size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">{t("generate.timeout")}</p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCheckOnce()}
              >
                {t("generate.recheckOnce")}
              </Button>
              <Button type="button" size="sm" onClick={handleRegenerate}>
                {t("generate.regenerate")}
              </Button>
            </div>
          </div>
        ) : null}

        {phase === "idle" ? (
          <div className="text-muted-foreground/30" aria-hidden="true" />
        ) : null}
      </div>
    </div>
  )
}
