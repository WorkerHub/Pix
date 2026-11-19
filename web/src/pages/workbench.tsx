import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError, genApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import {
  DEFAULT_MODEL,
  type GenerateModel,
  type GenerateSize
} from "@/lib/api-types"
import {
  clearStoredJob,
  elapsedSeconds,
  GEN_POLL_INTERVAL_MS,
  isTimedOut,
  readStoredJob,
  writeStoredJob,
  type GenPhase
} from "@/lib/gen"
import { sndDone, sndStart } from "@/lib/arcade-audio"
import { ArcadeScreen } from "@/components/arcade/arcade-screen"
import { ArcadeDeck } from "@/components/arcade/arcade-deck"
import {
  ArcadeGallery,
  type LootItem
} from "@/components/arcade/arcade-gallery"
import "@/components/arcade/arcade.css"

/**
 * Pix 游戏厅生图控制台（Boss 战街机版）
 */
export function WorkbenchPage() {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState("")
  const [size, setSize] = useState<GenerateSize>("portrait")
  const [model, setModel] = useState<GenerateModel>(DEFAULT_MODEL)
  const [phase, setPhase] = useState<GenPhase>("idle")
  const [jobId, setJobId] = useState<string | null>(null)
  const [submittedAt, setSubmittedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 街机战况状态
  const [score, setScore] = useState(0)
  const [joyVec, setJoyVec] = useState({ x: 0, y: 0 })
  const [attackTrigger, setAttackTrigger] = useState(0)
  const [lootList, setLootList] = useState<LootItem[]>([])
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null)

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null)
    }, 2400)
  }, [])

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
  const modelRef = useRef(model)
  modelRef.current = model
  const scoreRef = useRef(score)
  scoreRef.current = score
  const handleSubmitRef = useRef<(e?: React.FormEvent) => Promise<void>>(() =>
    Promise.resolve()
  )

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
          sndDone()
          // 记录入库战利品
          setLootList((prev) => {
            if (prev.some((item) => item.jobId === currentJobId)) return prev
            return [
              {
                id: currentJobId,
                jobId: currentJobId,
                prompt: promptRef.current,
                score: scoreRef.current,
                elapsed: elapsedSeconds(timestamp),
                size: sizeRef.current,
                model: modelRef.current,
                createdAt: Date.now()
              },
              ...prev
            ]
          })
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

  /** 挂载：初始化与恢复 localStorage 任务 */
  useEffect(() => {
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
  }, [checkHealth, checkJobStatus])

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

  /** 键盘控制与输入隔离 */
  useEffect(() => {
    const keysDown: Record<string, boolean> = {}

    const focusInPrompt = () => {
      const a = document.activeElement
      return (
        a?.id === "gen-prompt" ||
        a?.tagName === "TEXTAREA" ||
        a?.tagName === "INPUT"
      )
    }

    const updateJoyFromKeys = () => {
      let x = 0
      let y = 0
      if (keysDown.ArrowLeft || keysDown.KeyA) x -= 1
      if (keysDown.ArrowRight || keysDown.KeyD) x += 1
      if (keysDown.ArrowUp || keysDown.KeyW) y -= 1
      if (keysDown.ArrowDown || keysDown.KeyS) y += 1
      const m = Math.sqrt(x * x + y * y)
      if (m > 0) {
        setJoyVec({ x: x / m, y: y / m })
      } else {
        setJoyVec({ x: 0, y: 0 })
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusInPrompt()) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault()
          void handleSubmitRef.current()
        }
        return
      }

      if (
        phaseRef.current === "generating" ||
        phaseRef.current === "submitting"
      ) {
        if (
          [
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "KeyA",
            "KeyD",
            "KeyW",
            "KeyS"
          ].includes(e.code)
        ) {
          keysDown[e.code] = true
          if (e.code.startsWith("Arrow")) e.preventDefault()
          updateJoyFromKeys()
        }
        if (e.code === "Space" || e.code === "KeyJ") {
          e.preventDefault()
          setAttackTrigger((prev) => prev + 1)
        }
      } else if (e.key === "Enter") {
        const a = document.activeElement
        if (a?.tagName === "BUTTON") return
        e.preventDefault()
        void handleSubmitRef.current()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      keysDown[e.code] = false
      updateJoyFromKeys()
    }

    const handleBlur = () => {
      for (const k of Object.keys(keysDown)) {
        keysDown[k] = false
      }
      setJoyVec({ x: 0, y: 0 })
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", handleBlur)
    }
  }, [])

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
    setScore(0)
    sndStart()

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
  handleSubmitRef.current = handleSubmit

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
        sndDone()
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
    clearStoredJob()
    setJobId(null)
    setSubmittedAt(null)
    setElapsed(0)
    void handleSubmit()
  }

  /** 回看战利品 */
  const handleSelectLoot = (item: LootItem) => {
    setJobId(item.jobId)
    setPrompt(item.prompt)
    setSize(item.size)
    setElapsed(item.elapsed)
    setScore(item.score)
    setPhase("done")
    document
      .getElementById("cabinet")
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="arcade-room" data-testid="workbench-page">
      <div className="stars arcade-stars" aria-hidden="true" />

      {/* 街机柜机 */}
      <div className="cabinet" id="cabinet">
        <div className="screw tl" aria-hidden="true" />
        <div className="screw tr" aria-hidden="true" />
        <div className="screw bl" aria-hidden="true" />
        <div className="screw br" aria-hidden="true" />

        {/* 顶部跑马灯 */}
        <header className="marquee">
          <div className="bulbs" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <h1>
            PIX <span className="pix">{t("arcade.marquee.title")}</span>
          </h1>
          <div className="sub">
            <b>{t("arcade.marquee.sub1")}</b> · {t("arcade.marquee.sub2")}
          </div>
        </header>

        {/* 屏幕 */}
        <ArcadeScreen
          phase={phase}
          jobId={jobId}
          prompt={prompt}
          size={size}
          model={model}
          submittedAt={submittedAt}
          elapsed={elapsed}
          errorMessage={errorMessage}
          score={score}
          joyVec={joyVec}
          attackTrigger={attackTrigger}
          onScoreUpdate={(s) => setScore(s)}
          onBattleExplode={() => {
            setPhase("done")
            sndDone()
          }}
          onAgain={() => setPhase("idle")}
          onRecheckHealth={() => void handleRecheckHealth()}
          onCheckOnce={() => void handleCheckOnce()}
          onRegenerate={handleRegenerate}
        />

        {/* 操控台 */}
        <form onSubmit={handleSubmit}>
          <ArcadeDeck
            prompt={prompt}
            size={size}
            model={model}
            phase={phase}
            onPromptChange={setPrompt}
            onSizeChange={setSize}
            onModelChange={setModel}
            onSubmit={() => void handleSubmit()}
            onJoyMove={(v) => setJoyVec(v)}
            onJoyEnd={() => setJoyVec({ x: 0, y: 0 })}
            onAttack={() => setAttackTrigger((prev) => prev + 1)}
            onToast={showToast}
          />
        </form>

        {/* 底座 */}
        <div className="cabinet-base">
          <div className="coin-slot" aria-hidden="true">
            <div className="slot" />
            <div className="txt">
              INSERT COIN
              <br />
              <small>{t("arcade.coin.small")}</small>
            </div>
          </div>
          <div className="speaker" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>

      {/* 战利品展示柜 */}
      <ArcadeGallery items={lootList} onSelect={handleSelectLoot} />

      {/* 提示弹泡 */}
      <div
        className={`arcade-toast ${toastMessage ? "show" : ""}`}
        role={toastMessage ? "status" : undefined}
        aria-live="polite"
        aria-atomic="true"
      >
        {toastMessage}
      </div>
    </div>
  )
}
