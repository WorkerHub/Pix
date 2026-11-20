import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import {
  type GenerateSize,
  type GenerationModel,
  MODEL_OPTIONS,
  modelIntroKey,
  modelLabelKey
} from "@/lib/api-types"
import { modelEstimatedDurationText } from "@/lib/gen"
import {
  calculateMaxPromptHeight,
  clampPromptHeight,
  CONTROL_PANEL_REST_HEIGHT_DEFAULT,
  estimateInitialMaxPromptHeight,
  MIN_CANVAS_HEIGHT,
  PROMPT_HEIGHT_MIN,
  PROMPT_RESIZE_HANDLE_HEIGHT,
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

interface ModelOptionItemProps {
  model: GenerationModel
}

function ModelOptionItem({ model }: ModelOptionItemProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)
  const isLongPressRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => clearTimer()
  }, [clearTimer])

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return
    startPosRef.current = { x: e.clientX, y: e.clientY }
    isLongPressRef.current = false
    clearTimer()
    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true
      setOpen(true)
    }, 400)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" || !startPosRef.current) return
    const dx = e.clientX - startPosRef.current.x
    const dy = e.clientY - startPosRef.current.y
    if (Math.hypot(dx, dy) > 10) {
      clearTimer()
    }
  }

  const handlePointerUp = () => {
    clearTimer()
  }

  const handlePointerCancel = () => {
    clearTimer()
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    startPosRef.current = { x: touch.clientX, y: touch.clientY }
    isLongPressRef.current = false
    clearTimer()
    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true
      setOpen(true)
    }, 400)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!startPosRef.current) return
    const touch = e.touches[0]
    const dx = touch.clientX - startPosRef.current.x
    const dy = touch.clientY - startPosRef.current.y
    if (Math.hypot(dx, dy) > 10) {
      clearTimer()
    }
  }

  const handleTouchEnd = () => {
    clearTimer()
  }

  const handleTouchCancel = () => {
    clearTimer()
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isLongPressRef.current) {
      e.preventDefault()
    }
  }

  const handleClickCapture = (e: React.MouseEvent) => {
    if (isLongPressRef.current) {
      e.preventDefault()
      e.stopPropagation()
      setTimeout(() => {
        isLongPressRef.current = false
      }, 0)
    }
  }

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <div className="flex w-full">
          <ToggleGroupItem
            value={model}
            aria-label={t(modelLabelKey(model))}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
            onContextMenu={handleContextMenu}
            onClickCapture={handleClickCapture}
            className="wb-toggle-item h-8 sm:h-9 w-full px-1 text-xs font-bold leading-tight select-none touch-manipulation sm:text-sm"
          >
            <span className="truncate">{t(modelLabelKey(model))}</span>
          </ToggleGroupItem>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        sideOffset={6}
        collisionPadding={8}
        className="wb-model-tooltip z-50 max-w-[220px] rounded-lg border border-[#26264A] bg-[#26264A] px-2.5 py-1.5 text-white shadow-md text-left"
      >
        <div className="flex flex-col gap-0.5 select-none">
          <p className="text-xs font-medium leading-snug text-white">
            {t(modelIntroKey(model))}
          </p>
          <p className="text-[11px] font-bold text-[#FFD23F]">
            {modelEstimatedDurationText(model, t)}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  )
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
  const handleRef = useRef<HTMLDivElement>(null)

  const [maxPromptHeight, setMaxPromptHeight] = useState(
    estimateInitialMaxPromptHeight
  )
  const [promptHeight, setPromptHeight] = useState(() =>
    readStoredPromptHeight(estimateInitialMaxPromptHeight())
  )

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

    let rootPaddingY: number | undefined
    if (rootEl && typeof window !== "undefined") {
      try {
        const rootStyle = window.getComputedStyle(rootEl)
        const pt = parseFloat(rootStyle.paddingTop) || 0
        const pb = parseFloat(rootStyle.paddingBottom) || 0
        if (pt + pb > 0) {
          rootPaddingY = pt + pb
        }
      } catch {
        // fallback
      }
    }

    let historyStripHeight: number | undefined
    if (rootEl && !isDesktop) {
      const historyStripEl =
        rootEl.querySelector<HTMLElement>(".wb-history-strip")
      if (historyStripEl && historyStripEl.offsetHeight > 0) {
        historyStripHeight = historyStripEl.offsetHeight
      }
    }

    let restHeight = CONTROL_PANEL_REST_HEIGHT_DEFAULT
    if (panelEl && submitButtonRef.current && restControlsRef.current) {
      const submitBtnHeight = submitButtonRef.current.offsetHeight
      const restControlsHeight = restControlsRef.current.offsetHeight
      const handleHeight =
        handleRef.current && handleRef.current.offsetHeight > 0
          ? handleRef.current.offsetHeight
          : PROMPT_RESIZE_HANDLE_HEIGHT

      if (submitBtnHeight > 0 && restControlsHeight > 0) {
        let panelPadBorder = 46
        try {
          const panelStyle = window.getComputedStyle(panelEl)
          const pt = parseFloat(panelStyle.paddingTop) || 0
          const pb = parseFloat(panelStyle.paddingBottom) || 0
          const bt = parseFloat(panelStyle.borderTopWidth) || 0
          const bb = parseFloat(panelStyle.borderBottomWidth) || 0
          if (pt + pb + bt + bb > 0) {
            panelPadBorder = pt + pb + bt + bb
          }
        } catch {
          // fallback 46
        }
        // 面板 padding+border (46px) + 手柄高 (handleHeight) + 其余控件区 + 按钮高 + 间隙 (gap-1=4, gap-3=12, gap-4=16，合计 32px)
        restHeight =
          panelPadBorder +
          32 +
          handleHeight +
          restControlsHeight +
          submitBtnHeight
      }
    }

    const calculatedMax = calculateMaxPromptHeight({
      isDesktop,
      rootHeight,
      panelHeight,
      restHeight,
      minCanvasHeight: MIN_CANVAS_HEIGHT,
      minPromptHeight: PROMPT_HEIGHT_MIN,
      historyStripHeight,
      rootPaddingY
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
    if (rootEl) {
      ro.observe(rootEl)
      const historyStripEl = rootEl.querySelector(".wb-history-strip")
      if (historyStripEl) ro.observe(historyStripEl)
    }
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
            ref={handleRef}
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

          {/* 模型切换：九款模型，选中深蓝底黄字 */}
          <div className="flex flex-col gap-1.5">
            <TooltipProvider delayDuration={150} disableHoverableContent>
              <ToggleGroup
                type="single"
                value={model}
                onValueChange={(val) => {
                  if (val) onModelChange(val as GenerationModel)
                }}
                className="grid w-full grid-cols-3 gap-1.5 sm:gap-2"
              >
                {MODEL_OPTIONS.map((item) => (
                  <ModelOptionItem key={item} model={item} />
                ))}
              </ToggleGroup>
            </TooltipProvider>
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
