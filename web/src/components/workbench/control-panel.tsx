import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  type GenerateSize,
  type GenerationModel,
  MODEL_OPTIONS,
  modelLabelKey
} from "@/lib/api-types"
import {
  calculateMaxPromptHeight,
  clampPromptHeight,
  CONTROL_PANEL_REST_HEIGHT_DEFAULT,
  MIN_CANVAS_HEIGHT,
  PROMPT_HEIGHT_MIN,
  readStoredPromptHeight,
  writeStoredPromptHeight
} from "@/lib/prompt-height"
import { cn } from "cn"

interface ControlPanelProps {
  prompt: string
  onPromptChange: (val: string) => void
  size: GenerateSize
  onSizeChange: (val: GenerateSize) => void
  model: GenerationModel
  onModelChange: (val: GenerationModel) => void
  submitting: boolean
  generating: boolean
  offline: boolean
  onSubmit: () => void
  className?: string
}

export function ControlPanel({
  prompt,
  onPromptChange,
  size,
  onSizeChange,
  model,
  onModelChange,
  submitting,
  generating,
  offline,
  onSubmit,
  className
}: ControlPanelProps) {
  const { t } = useTranslation()

  const panelRef = useRef<HTMLDivElement>(null)
  const restControlsRef = useRef<HTMLDivElement>(null)
  const submitButtonRef = useRef<HTMLButtonElement>(null)

  const [promptHeight, setPromptHeight] = useState(() =>
    readStoredPromptHeight()
  )
  const [maxPromptHeight, setMaxPromptHeight] = useState(600)

  const isDraggingRef = useRef(false)
  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)
  const currentHeightRef = useRef(promptHeight)
  currentHeightRef.current = promptHeight
  const maxPromptHeightRef = useRef(maxPromptHeight)
  maxPromptHeightRef.current = maxPromptHeight

  /**
   * 动态计算提示词输入框允许的最大高度上限，保证：
   * 1. 桌面端：控制面板内尺寸切换、模型选择、生成按钮始终完整可见无溢出；
   * 2. 移动端：维持一屏不滚动（画布区随输入区增高自适应缩小并保留核心最小高度）。
   */
  const updateMaxHeight = useCallback(() => {
    if (typeof window === "undefined") return
    const isDesktop = window.innerWidth >= 1024
    const panelEl = panelRef.current
    const rootEl = panelEl?.closest<HTMLDivElement>(".wb-root")

    const rootHeight = rootEl ? rootEl.clientHeight : window.innerHeight
    const panelHeight = panelEl ? panelEl.clientHeight : 0

    let restHeight = CONTROL_PANEL_REST_HEIGHT_DEFAULT
    if (panelEl && submitButtonRef.current && restControlsRef.current) {
      const submitBtnHeight = submitButtonRef.current.offsetHeight
      const restControlsHeight = restControlsRef.current.offsetHeight
      if (submitBtnHeight > 0 && restControlsHeight > 0) {
        // 面板 padding + border（约 46px）+ 其余控件区 + 间距（16px * 2）+ 按钮高度
        restHeight = 46 + restControlsHeight + 16 + submitBtnHeight + 16
      }
    }

    const calculatedMax = calculateMaxPromptHeight({
      isDesktop,
      rootHeight,
      panelHeight,
      restHeight,
      minCanvasHeight: MIN_CANVAS_HEIGHT,
      minPromptHeight: PROMPT_HEIGHT_MIN
    })

    setMaxPromptHeight(calculatedMax)

    // 若当前高度超过重新测算的视口上限，则收缩钳制至上限并持久化
    setPromptHeight((prev) => {
      const clamped = clampPromptHeight(prev, PROMPT_HEIGHT_MIN, calculatedMax)
      if (clamped !== prev) {
        writeStoredPromptHeight(clamped)
      }
      return clamped
    })
  }, [])

  useEffect(() => {
    updateMaxHeight()
    window.addEventListener("resize", updateMaxHeight)
    return () => {
      window.removeEventListener("resize", updateMaxHeight)
    }
  }, [updateMaxHeight])

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      updateMaxHeight()
    })
    if (panelRef.current) ro.observe(panelRef.current)
    const rootEl = panelRef.current?.closest(".wb-root")
    if (rootEl) ro.observe(rootEl)
    return () => {
      ro.disconnect()
    }
  }, [updateMaxHeight])

  /** Pointer Events 拖拽手柄开始 */
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // 容错处理部分宿主无 setPointerCapture
    }
    isDraggingRef.current = true
    dragStartYRef.current = e.clientY
    dragStartHeightRef.current = currentHeightRef.current
  }

  /** 手柄自身与全局双保险的 PointerMove 拖拽 */
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    const deltaY = e.clientY - dragStartYRef.current
    const next = clampPromptHeight(
      dragStartHeightRef.current + deltaY,
      PROMPT_HEIGHT_MIN,
      maxPromptHeightRef.current
    )
    setPromptHeight(next)
  }

  /** 拖拽结束：持久化最新高度到 localStorage */
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    } catch {
      // 容错
    }
    writeStoredPromptHeight(currentHeightRef.current)
  }

  /** 全局 Pointer 事件双保险（手柄移出边界依然流畅响应并保存） */
  useEffect(() => {
    const onGlobalPointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return
      const deltaY = e.clientY - dragStartYRef.current
      const next = clampPromptHeight(
        dragStartHeightRef.current + deltaY,
        PROMPT_HEIGHT_MIN,
        maxPromptHeightRef.current
      )
      setPromptHeight(next)
    }

    const onGlobalPointerUp = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      writeStoredPromptHeight(currentHeightRef.current)
    }

    window.addEventListener("pointermove", onGlobalPointerMove)
    window.addEventListener("pointerup", onGlobalPointerUp)
    window.addEventListener("pointercancel", onGlobalPointerUp)
    return () => {
      window.removeEventListener("pointermove", onGlobalPointerMove)
      window.removeEventListener("pointerup", onGlobalPointerUp)
      window.removeEventListener("pointercancel", onGlobalPointerUp)
    }
  }, [])

  /** 键盘上下键微调高度（满足无障碍可访问性要求） */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      const next = clampPromptHeight(
        promptHeight + 10,
        PROMPT_HEIGHT_MIN,
        maxPromptHeight
      )
      setPromptHeight(next)
      writeStoredPromptHeight(next)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      const next = clampPromptHeight(
        promptHeight - 10,
        PROMPT_HEIGHT_MIN,
        maxPromptHeight
      )
      setPromptHeight(next)
      writeStoredPromptHeight(next)
    }
  }

  const canSubmit = !prompt.trim() || submitting || generating || offline

  return (
    <div
      ref={panelRef}
      className={cn(
        "wb-panel flex flex-col justify-between gap-4 p-5 text-[#26264A]",
        className
      )}
    >
      <div className="flex flex-col gap-3">
        {/* 提示词输入区：1000 字符限制，生成等待期间仍可继续编辑 */}
        <div className="flex flex-col gap-1">
          <div className="relative">
            <textarea
              id="gen-prompt"
              maxLength={1000}
              rows={4}
              style={{ height: `${promptHeight}px` }}
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder={t("generate.prompt")}
              className="w-full resize-none rounded-xl border-2 border-[#26264A] bg-white pt-3 pl-3 pr-3 pb-8 text-sm font-medium text-[#26264A] placeholder:text-[#26264A]/40 focus:outline-none focus:ring-2 focus:ring-[#26264A]"
            />
            {/* 字数计数：固定在输入框右下角、文本区留出 pb-8 内边距，文字与计数绝不重叠 */}
            <div
              data-testid="prompt-counter"
              className="pointer-events-none absolute right-2.5 bottom-2.5 select-none text-xs font-bold text-[#26264A]/50"
            >
              {prompt.length}/1000
            </div>
          </div>

          {/* 输入框下边缘拖拽手柄：用 Pointer Events 实现鼠标+触屏拖动，键盘上下键微调 */}
          <div
            role="slider"
            aria-label={t("generate.resizePrompt")}
            aria-orientation="vertical"
            aria-valuenow={promptHeight}
            aria-valuemin={PROMPT_HEIGHT_MIN}
            aria-valuemax={maxPromptHeight}
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={handleKeyDown}
            data-testid="prompt-resize-handle"
            className="group flex h-3.5 w-full cursor-ns-resize touch-none items-center justify-center rounded-md py-0.5 transition-colors hover:bg-[#26264A]/10 active:bg-[#26264A]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#26264A]"
          >
            <div className="h-1 w-8 rounded-full bg-[#26264A]/30 transition-colors group-hover:bg-[#26264A]/60" />
          </div>
        </div>

        {/* 尺寸切换与模型选择控件区 */}
        <div ref={restControlsRef} className="flex flex-col gap-4">
          {/* 尺寸比例切换 */}
          <div className="flex flex-col gap-1.5">
            <ToggleGroup
              type="single"
              value={size}
              onValueChange={(val) => {
                if (val) onSizeChange(val as GenerateSize)
              }}
              className="grid w-full grid-cols-2 gap-2"
            >
              <ToggleGroupItem
                value="portrait"
                aria-label={t("generate.sizePortrait")}
                className="wb-toggle-item h-10 w-full text-xs font-bold sm:text-sm"
              >
                {t("generate.sizePortrait")}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="square"
                aria-label={t("generate.sizeSquare")}
                className="wb-toggle-item h-10 w-full text-xs font-bold sm:text-sm"
              >
                {t("generate.sizeSquare")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* 模型切换：五款模型，选中深蓝底黄字 */}
          <div className="flex flex-col gap-1.5">
            <ToggleGroup
              type="single"
              value={model}
              onValueChange={(val) => {
                if (val) onModelChange(val as GenerationModel)
              }}
              className="flex w-full flex-wrap gap-1.5 sm:gap-2"
            >
              {MODEL_OPTIONS.map((item) => (
                <ToggleGroupItem
                  key={item}
                  value={item}
                  aria-label={t(modelLabelKey(item))}
                  className="wb-toggle-item h-9 flex-1 min-w-[70px] px-2 text-xs font-bold sm:text-sm"
                >
                  {t(modelLabelKey(item))}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      </div>

      {/* 生成按钮：青绿渐变粗边 */}
      <button
        ref={submitButtonRef}
        type="button"
        disabled={canSubmit}
        onClick={onSubmit}
        className="wb-btn-generate h-12 w-full text-base font-bold sm:h-14 sm:text-lg"
      >
        {t(
          submitting
            ? "generate.submitting"
            : generating
              ? "generate.generating"
              : "generate.submit"
        )}
      </button>
    </div>
  )
}
