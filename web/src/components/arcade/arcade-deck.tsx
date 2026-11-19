import type React from "react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  MODEL_OPTIONS,
  modelLabelKey,
  type GenerateModel,
  type GenerateSize
} from "@/lib/api-types"
import { PRESET_PROMPT_KEYS, JOY_DRAG_MAX_PX } from "@/lib/arcade-engine"
import {
  isSoundEnabled,
  setSoundEnabled,
  sndCoin,
  sndClick,
  sndError
} from "@/lib/arcade-audio"
import type { GenPhase } from "@/lib/gen"

export interface ArcadeDeckProps {
  prompt: string
  size: GenerateSize
  model: GenerateModel
  phase: GenPhase
  onPromptChange: (val: string) => void
  onSizeChange: (val: GenerateSize) => void
  onModelChange: (val: GenerateModel) => void
  onSubmit: (e?: React.FormEvent) => void
  onJoyMove: (vec: { x: number; y: number }) => void
  onJoyEnd: () => void
  onAttack: () => void
  onToast: (msg: string) => void
}

export function ArcadeDeck({
  prompt,
  size,
  model,
  phase,
  onPromptChange,
  onSizeChange,
  onModelChange,
  onSubmit,
  onJoyMove,
  onJoyEnd,
  onAttack,
  onToast
}: ArcadeDeckProps) {
  const { t } = useTranslation()
  const [soundOn, setSoundOn] = useState(isSoundEnabled())
  const [consoleShake, setConsoleShake] = useState(false)
  const [attackPressed, setAttackPressed] = useState(false)

  // 摇杆 DOM 引用
  const joyBaseRef = useRef<HTMLDivElement | null>(null)
  const joyStickRef = useRef<HTMLDivElement | null>(null)
  const joyBallRef = useRef<HTMLDivElement | null>(null)
  const joyDragState = useRef({
    active: false,
    pointerId: null as number | null,
    startX: 0,
    startY: 0
  })

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const isFormDisabled = phase === "submitting" || phase === "generating"
  const isSubmitDisabled =
    !prompt.trim() ||
    phase === "submitting" ||
    phase === "generating" ||
    phase === "offline"

  // 摇杆拖拽逻辑
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const base = joyBaseRef.current
    if (!base) return
    joyDragState.current.active = true
    joyDragState.current.pointerId = e.pointerId
    joyDragState.current.startX = e.clientX
    joyDragState.current.startY = e.clientY
    base.setPointerCapture(e.pointerId)
    handlePointerMove(e)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!joyDragState.current.active) return
    if (joyDragState.current.pointerId !== e.pointerId) return
    const base = joyBaseRef.current
    const stick = joyStickRef.current
    const ball = joyBallRef.current
    if (!base || !stick || !ball) return

    let dx = (e.clientX - joyDragState.current.startX) / JOY_DRAG_MAX_PX
    let dy = (e.clientY - joyDragState.current.startY) / JOY_DRAG_MAX_PX
    const m = Math.sqrt(dx * dx + dy * dy)
    if (m > 1) {
      dx /= m
      dy /= m
    }

    onJoyMove({ x: dx, y: dy })

    const rect = base.getBoundingClientRect()
    const maxOff = Math.max(20, rect.width / 2 - 32)
    const ox = dx * maxOff
    const oy = dy * maxOff
    const len = Math.sqrt(ox * ox + oy * oy)
    const ang = (Math.atan2(oy, ox) * 180) / Math.PI

    stick.style.width = `${len}px`
    stick.style.transform = `rotate(${ang}deg)`
    ball.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`
  }

  const handlePointerUp = () => {
    joyDragState.current.active = false
    joyDragState.current.pointerId = null
    const stick = joyStickRef.current
    const ball = joyBallRef.current
    if (stick && ball) {
      stick.style.width = "0px"
      stick.style.transform = ""
      ball.style.transform = "translate(-50%, -50%)"
    }
    onJoyEnd()
  }

  // 快捷词点击
  const handleChipClick = (preset: string) => {
    onPromptChange(preset)
    sndCoin()
    textareaRef.current?.focus()
  }

  // 骰子随机词
  const handleDiceClick = () => {
    const presets = PRESET_PROMPT_KEYS.map((key) => t(key))
    const randomPrompt = presets[Math.floor(Math.random() * presets.length)]
    onPromptChange(randomPrompt)
    sndCoin()
    onToast(t("arcade.deck.toast.dice"))
    textareaRef.current?.focus()
  }

  // 音效开关
  const handleSoundToggle = () => {
    const next = !soundOn
    setSoundOn(next)
    setSoundEnabled(next)
    if (next) sndClick()
    onToast(
      next ? t("arcade.deck.toast.soundOn") : t("arcade.deck.toast.soundOff")
    )
  }

  // 触发开局流程（供按钮点击与回车共用）
  const triggerStart = () => {
    if (isFormDisabled || phase === "offline") return
    if (!prompt.trim()) {
      setConsoleShake(true)
      setTimeout(() => setConsoleShake(false), 400)
      sndError()
      onToast(t("arcade.deck.toast.empty"))
      textareaRef.current?.focus()
      return
    }
    sndCoin()
    textareaRef.current?.blur()
    onSubmit()
  }

  const presets = PRESET_PROMPT_KEYS.map((key) => t(key))

  return (
    <div className="deck">
      {/* 1. 摇杆区（仅负责移动） */}
      <section className="joy-zone" aria-label={t("arcade.deck.joyAria")}>
        <div
          className="joy-base"
          ref={joyBaseRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="joy-stick" ref={joyStickRef} />
          <div className="joy-ball" ref={joyBallRef} />
        </div>
        <div className="deck-label">{t("arcade.deck.joyLabel")}</div>
        <div className="joy-hint">
          {t("arcade.deck.joyHint1")}
          <br />
          {t("arcade.deck.joyHint2")}
        </div>
      </section>

      {/* 2. 提示词控制台 */}
      <div className={`console-box ${consoleShake ? "shake" : ""}`}>
        <div className="console-head">
          <div className="t">
            <span className="coin">P</span> {t("arcade.deck.promptHead")}
          </div>
          <span style={{ fontSize: "12px", color: "#8a8474", fontWeight: 700 }}>
            {prompt.length} / 120
          </span>
        </div>

        <textarea
          ref={textareaRef}
          id="gen-prompt"
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              triggerStart()
            }
          }}
          placeholder={t("generate.prompt")}
          maxLength={120}
          disabled={isFormDisabled}
          rows={3}
        />

        <div className="chips">
          {presets.slice(0, 4).map((preset) => (
            <button
              key={preset}
              className="chip"
              type="button"
              onClick={() => handleChipClick(preset)}
              disabled={isFormDisabled}
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="opt-row">
          <div className="opt-group">
            <div className="g-label">{t("arcade.deck.sizeLabel")}</div>
            <ToggleGroup
              type="single"
              value={size}
              onValueChange={(val) => {
                if (val === "portrait" || val === "square") {
                  onSizeChange(val)
                  sndClick()
                }
              }}
              aria-label={t("generate.size")}
              disabled={isFormDisabled}
              className="pill-row"
            >
              <ToggleGroupItem
                value="portrait"
                size="sm"
                className="pill"
                data-state={size === "portrait" ? "on" : "off"}
              >
                {t("generate.sizePortrait")}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="square"
                size="sm"
                className="pill"
                data-state={size === "square" ? "on" : "off"}
              >
                {t("generate.sizeSquare")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="opt-group">
            <div className="g-label">{t("arcade.deck.modelLabel")}</div>
            <ToggleGroup
              type="single"
              value={model}
              onValueChange={(val) => {
                if (val) {
                  onModelChange(val as GenerateModel)
                  sndClick()
                }
              }}
              aria-label={t("arcade.deck.modelAria")}
              disabled={isFormDisabled}
              className="pill-row"
            >
              {MODEL_OPTIONS.map((id) => (
                <ToggleGroupItem
                  key={id}
                  value={id}
                  size="sm"
                  className="pill"
                  data-state={model === id ? "on" : "off"}
                >
                  {t(modelLabelKey(id))}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

        <button
          type="submit"
          className="start-entry"
          disabled={isSubmitDisabled}
          onClick={(e) => {
            e.preventDefault()
            triggerStart()
          }}
          aria-label={
            phase === "submitting"
              ? t("generate.submitting")
              : t("generate.submit")
          }
        >
          <span>
            {phase === "submitting"
              ? t("generate.submitting")
              : t("generate.submit")}{" "}
            · {t("arcade.deck.summon")}
          </span>{" "}
          <small>START</small>
        </button>
      </div>

      {/* 3. 按钮区（仅负责攻击与辅助） */}
      <div className="btn-zone">
        <button
          className={`big-attack ${attackPressed ? "pressed" : ""}`}
          type="button"
          aria-label={t("arcade.deck.attackAria")}
          onPointerDown={() => {
            setAttackPressed(true)
            onAttack()
          }}
          onPointerUp={() => setAttackPressed(false)}
          onPointerLeave={() => setAttackPressed(false)}
          onPointerCancel={() => setAttackPressed(false)}
          onClick={onAttack}
        >
          {t("arcade.deck.attack")}
          <small>ATTACK</small>
        </button>

        <div className="mini-row">
          <button
            className="mini-btn dice"
            type="button"
            aria-label={t("arcade.deck.diceAria")}
            title={t("arcade.deck.diceTitle")}
            onClick={handleDiceClick}
            disabled={isFormDisabled}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle
                cx="8.5"
                cy="8.5"
                r="1.6"
                fill="currentColor"
                stroke="none"
              />
              <circle
                cx="15.5"
                cy="15.5"
                r="1.6"
                fill="currentColor"
                stroke="none"
              />
              <circle
                cx="15.5"
                cy="8.5"
                r="1.6"
                fill="currentColor"
                stroke="none"
              />
              <circle
                cx="8.5"
                cy="15.5"
                r="1.6"
                fill="currentColor"
                stroke="none"
              />
            </svg>
          </button>

          <button
            className={`mini-btn sound ${soundOn ? "" : "off"}`}
            type="button"
            aria-label={t("arcade.deck.soundAria")}
            title={t("arcade.deck.soundTitle")}
            onClick={handleSoundToggle}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path
                d="M11 5 6 9H3v6h3l5 4z"
                fill="currentColor"
                stroke="none"
              />
              {soundOn && (
                <>
                  <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  <path d="M18 6a8.5 8.5 0 0 1 0 12" />
                </>
              )}
            </svg>
          </button>
        </div>
        <div className="mini-caption">
          {t("arcade.deck.caption1")}
          <br />
          {t("arcade.deck.caption2")}
        </div>
      </div>
    </div>
  )
}
