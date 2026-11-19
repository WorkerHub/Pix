import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { genImageUrl } from "@/lib/api"
import {
  modelLabelKey,
  type GenerationModel,
  type GenerateSize
} from "@/lib/api-types"
import {
  type BattleStageInfo,
  BATTLE_STAGES,
  formatGameTime
} from "@/lib/arcade-engine"
import { sndClick, sndCoin } from "@/lib/arcade-audio"
import { ArcadeBattleCanvas } from "./arcade-battle-canvas"
import type { GenPhase } from "@/lib/gen"

export interface ArcadeScreenProps {
  phase: GenPhase
  jobId: string | null
  prompt: string
  size: GenerateSize
  model?: GenerationModel
  submittedAt: number | null
  elapsed: number
  errorMessage: string | null
  score: number
  joyVec: { x: number; y: number }
  attackTrigger: number
  isDone?: boolean
  onScoreUpdate: (score: number, hits: number, hurts: number) => void
  onBattleExplode: () => void
  onAgain: () => void
  onRecheckHealth: () => void
  onCheckOnce: () => void
  onRegenerate: () => void
}

const SEG = 20
const SEG_KEYS = Array.from({ length: SEG }, (_, i) => `hp-seg-${i + 1}`)

export function ArcadeScreen({
  phase,
  jobId,
  prompt,
  size,
  model,
  submittedAt,
  elapsed,
  errorMessage,
  score,
  joyVec,
  attackTrigger,
  isDone,
  onScoreUpdate,
  onBattleExplode,
  onAgain,
  onRecheckHealth,
  onCheckOnce,
  onRegenerate
}: ArcadeScreenProps) {
  const { t } = useTranslation()
  const [battleProgress, setBattleProgress] = useState(0)
  const [battleStage, setBattleStage] = useState<BattleStageInfo>(
    BATTLE_STAGES[0]
  )
  const [screenFlicker, setScreenFlicker] = useState(false)
  const [screenShake, setScreenShake] = useState(false)
  const [confettiPieces, setConfettiPieces] = useState<
    { id: number; left: string; bg: string; dur: string; delay: string }[]
  >([])

  // 画面状态切换时闪烁一次 CRT
  useEffect(() => {
    if (!phase) return
    setScreenFlicker(true)
    const t = setTimeout(() => setScreenFlicker(false), 200)
    return () => clearTimeout(t)
  }, [phase])

  // 完成态抛洒彩带
  useEffect(() => {
    if (phase === "done") {
      const colors = [
        "#ffc61a",
        "#17c3b2",
        "#ff6a52",
        "#7dff8a",
        "#ffd1ec",
        "#8fe3ff"
      ]
      const pieces = Array.from({ length: 36 }).map((_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        bg: colors[i % colors.length],
        dur: `${0.9 + Math.random() * 1.1}s`,
        delay: `${Math.random() * 0.2}s`
      }))
      setConfettiPieces(pieces)
    } else {
      setConfettiPieces([])
    }
  }, [phase])

  const handleScreenShake = () => {
    setScreenShake(true)
    setTimeout(() => setScreenShake(false), 300)
  }

  const handleDownload = () => {
    if (!jobId) return
    sndCoin()
    const link = document.createElement("a")
    link.href = genImageUrl(jobId)
    link.download = `boss-${jobId}.png`
    link.target = "_blank"
    link.rel = "noreferrer"
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  // 20 格 Boss 血条
  const filledSegs = Math.round(((100 - battleProgress) / 100) * SEG)

  // 屏幕 HUD 状态文案
  let hudStateText = "READY"
  let hudLedBusy = false
  if (phase === "submitting" || phase === "generating") {
    hudStateText = "BATTLE!"
    hudLedBusy = true
  } else if (phase === "done") {
    hudStateText = "CLEAR!"
  } else if (phase === "offline") {
    hudStateText = "OFFLINE"
    hudLedBusy = true
  } else if (phase === "error" || phase === "timeout") {
    hudStateText = "ALERT!"
    hudLedBusy = true
  }

  const isGeneratingOrSubmitting =
    phase === "generating" || phase === "submitting"

  return (
    <div className="bezel">
      <div
        className={`screen ${size === "square" ? "aspect-square" : "aspect-[2/3]"} ${screenFlicker ? "flicker" : ""} ${
          screenShake ? "shakeit" : ""
        }`}
        id="screen"
        data-testid="gen-output"
      >
        {/* HUD 顶部仪表条 */}
        <div className="hud">
          <div className="hud-item">
            <span>1P SCORE</span>
            <span>{String(score).padStart(6, "0")}</span>
          </div>
          <div className="hud-item">
            <span>PIX TIME</span>
            <span>{formatGameTime(elapsed * 1000)}</span>
            {isGeneratingOrSubmitting && (
              <span className="sr-only">
                {t("generate.elapsed", { seconds: elapsed })}
              </span>
            )}
          </div>
          <div className="hud-item">
            <span>STATUS</span>
            <span>
              <i className={`led ${hudLedBusy ? "busy" : ""}`} />
              {hudStateText}
            </span>
          </div>
        </div>

        {/* 1. 待机画面 IDLE */}
        {phase === "idle" && (
          <section className="view" aria-label={t("arcade.idle.aria")}>
            <svg
              className="mascot"
              viewBox="0 0 24 24"
              shapeRendering="crispEdges"
              aria-hidden="true"
            >
              <rect x="7" y="3" width="10" height="2" fill="#17c3b2" />
              <rect x="5" y="5" width="14" height="2" fill="#17c3b2" />
              <rect x="5" y="7" width="14" height="8" fill="#2ee6d6" />
              <rect x="7" y="9" width="3" height="4" fill="#101c2e" />
              <rect x="14" y="9" width="3" height="4" fill="#101c2e" />
              <rect x="8" y="9" width="1" height="1" fill="#fff" />
              <rect x="15" y="9" width="1" height="1" fill="#fff" />
              <rect x="10" y="14" width="4" height="1" fill="#101c2e" />
              <rect x="3" y="8" width="2" height="5" fill="#17c3b2" />
              <rect x="19" y="8" width="2" height="5" fill="#17c3b2" />
              <rect x="7" y="15" width="4" height="3" fill="#0d8f83" />
              <rect x="13" y="15" width="4" height="3" fill="#0d8f83" />
              <rect x="6" y="18" width="5" height="2" fill="#ffc61a" />
              <rect x="13" y="18" width="5" height="2" fill="#ffc61a" />
              <rect x="11" y="1" width="2" height="2" fill="#ffc61a" />
            </svg>
            <div className="idle-title">{t("arcade.idle.title")}</div>
            <p className="idle-desc">
              {t("arcade.idle.desc")}
              <br />
              <b>{t("arcade.idle.move")}</b>
              {t("arcade.idle.dodge")}
              <b className="atk">{t("arcade.idle.fire")}</b>
              {t("arcade.idle.finish")}
            </p>
            <div className="press-start">— INSERT PROMPT —</div>
            <div className="idle-hint">{t("arcade.idle.keyHint")}</div>
          </section>
        )}

        {/* 2. 生成中 Boss 战画面 BATTLE */}
        {isGeneratingOrSubmitting && (
          <section className="view" aria-label={t("arcade.battle.aria")}>
            {/* 包含无障碍/测试用「生成中」文案 */}
            <span className="sr-only">{t("generate.generating")}</span>
            <div className="battle-stage">
              <ArcadeBattleCanvas
                prompt={prompt}
                submittedAt={submittedAt}
                isDone={Boolean(isDone)}
                joyVec={joyVec}
                attackTrigger={attackTrigger}
                onScoreUpdate={onScoreUpdate}
                onProgressUpdate={(p, stage) => {
                  setBattleProgress(p)
                  setBattleStage(stage)
                }}
                onBattleExplode={onBattleExplode}
                onScreenShake={handleScreenShake}
              />
            </div>
            <div className="battle-status">{t(battleStage.textKey)}</div>
            <p className="battle-sub">{battleStage.step}</p>
            <div className="bossbar-label">
              <span>{t("arcade.battle.hpLabel")}</span>
              <span className="pct">{battleProgress}%</span>
            </div>
            <div className="hpbar" aria-hidden="true">
              {SEG_KEYS.map((segKey, i) => (
                <i
                  key={segKey}
                  className={
                    i < filledSegs ? `fill${filledSegs <= 5 ? " low" : ""}` : ""
                  }
                />
              ))}
            </div>
            <div className="battle-nums">
              <div className="elapsed">
                <small>{t("arcade.battle.elapsed")}</small>
                <span>{formatGameTime(elapsed * 1000)}</span>
              </div>
              <div className="bscore">
                <small>BATTLE SCORE</small>
                <span>{score}</span>
              </div>
            </div>
          </section>
        )}

        {/* 3. 结算画面 DONE */}
        {phase === "done" && jobId && (
          <section className="view" aria-label={t("arcade.done.aria")}>
            <div className="done-badge">★ BOSS DOWN! STAGE CLEAR! ★</div>
            <div className="done-frame">
              <img
                src={genImageUrl(jobId)}
                alt={prompt || t("generate.title")}
                className="block max-h-[500px] w-auto max-w-full object-contain"
              />
              <div className="confetti" aria-hidden="true">
                {confettiPieces.map((p) => (
                  <i
                    key={p.id}
                    style={{
                      left: p.left,
                      backgroundColor: p.bg,
                      animationDuration: p.dur,
                      animationDelay: p.delay
                    }}
                  />
                ))}
              </div>
            </div>
            <p className="done-prompt">「{prompt}」</p>
            <p className="done-meta">
              {t("arcade.done.time")} <span className="gold">{elapsed}</span>{" "}
              {t("arcade.done.seconds")} · {t("arcade.done.score")}{" "}
              <span className="gold">{score}</span>
              <br />
              {size === "square"
                ? t("generate.sizeSquare")
                : t("generate.sizePortrait")}{" "}
              · <span className="gold">{t(modelLabelKey(model))}</span> ·{" "}
              {t("arcade.done.loot")}
            </p>
            <div className="done-actions">
              <button
                className="btn-arcade"
                type="button"
                onClick={() => {
                  sndClick()
                  onAgain()
                }}
              >
                {t("arcade.done.again")}
              </button>
              <button
                className="btn-arcade ghost"
                type="button"
                onClick={handleDownload}
              >
                {t("arcade.done.download")}
              </button>
            </div>
          </section>
        )}

        {/* 4. 离线态 OFFLINE */}
        {phase === "offline" && (
          <section className="view">
            <div role="alert" className="terminal-box">
              <div className="terminal-title">! SYSTEM OFFLINE !</div>
              <p className="terminal-msg">{t("generate.offline")}</p>
              <div className="terminal-actions">
                <button
                  className="btn-arcade ghost"
                  type="button"
                  onClick={() => {
                    sndClick()
                    onRecheckHealth()
                  }}
                >
                  {t("generate.recheck")}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* 5. 开机启动态 STARTING */}
        {phase === "starting" && (
          <section className="view">
            <div role="status" className="terminal-box warning">
              <div className="terminal-title">▸ SYSTEM BOOTING…</div>
              <p className="terminal-msg">{t("generate.starting")}</p>
              <div className="terminal-actions">
                <button
                  className="btn-arcade ghost"
                  type="button"
                  onClick={() => {
                    sndClick()
                    onRecheckHealth()
                  }}
                >
                  {t("generate.recheck")}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* 6. 机器正忙态 BUSY */}
        {phase === "busy" && (
          <section className="view">
            <div role="status" className="terminal-box warning">
              <div className="terminal-title">▸ SYSTEM BUSY</div>
              <p className="terminal-msg">{t("generate.busy")}</p>
              <div className="terminal-actions">
                <button
                  className="btn-arcade"
                  type="button"
                  onClick={() => {
                    sndClick()
                    onRegenerate()
                  }}
                >
                  {t("generate.regenerate")}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* 7. 生成错误态 ERROR */}
        {phase === "error" && (
          <section className="view">
            <div role="alert" className="terminal-box">
              <div className="terminal-title">! GENERATION ERROR !</div>
              <p className="terminal-msg">
                {errorMessage || t("generate.error")}
              </p>
              <div className="terminal-actions">
                <button
                  className="btn-arcade"
                  type="button"
                  onClick={() => {
                    sndClick()
                    onRegenerate()
                  }}
                >
                  {t("generate.regenerate")}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* 8. 生成超时态 TIMEOUT */}
        {phase === "timeout" && (
          <section className="view">
            <div role="alert" className="terminal-box warning">
              <div className="terminal-title">! TIME OVER !</div>
              <p className="terminal-msg">{t("generate.timeout")}</p>
              <div className="terminal-actions">
                <button
                  className="btn-arcade ghost"
                  type="button"
                  onClick={() => {
                    sndClick()
                    onCheckOnce()
                  }}
                >
                  {t("generate.recheckOnce")}
                </button>
                <button
                  className="btn-arcade"
                  type="button"
                  onClick={() => {
                    sndClick()
                    onRegenerate()
                  }}
                >
                  {t("generate.regenerate")}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* 屏幕底部装饰标线与电源灯 */}
        <div className="screen-foot">
          <span>
            <i className="power-dot" />
            POWER
          </span>
          <span>PIX ENGINE · CRT-3000</span>
          <span>1 PLAYER</span>
        </div>
      </div>
    </div>
  )
}
