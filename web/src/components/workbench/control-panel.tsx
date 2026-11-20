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
        className="wb-model-tooltip z-50 w-[270px] max-w-[calc(100vw-1rem)] rounded-lg border border-[#26264A] bg-[#26264A] px-2.5 py-1.5 text-left text-white shadow-md"
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

  const canSubmit = !prompt.trim() || submitting || generating || offline

  return (
    <div
      className={cn(
        "wb-panel flex flex-col justify-between gap-4 p-5 text-[#26264A]",
        className
      )}
    >
      <div className="flex flex-col gap-4">
        {/* 提示词输入区：1000 字符限制，生成等待期间仍可继续编辑 */}
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <textarea
              id="gen-prompt"
              maxLength={1000}
              rows={4}
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder={t("generate.prompt")}
              className="w-full resize-none rounded-xl border-2 border-[#26264A] bg-white p-3 text-sm font-medium text-[#26264A] placeholder:text-[#26264A]/40 focus:outline-none focus:ring-2 focus:ring-[#26264A]"
            />
            <div className="absolute right-2.5 bottom-2.5 select-none text-xs font-bold text-[#26264A]/50">
              {prompt.length}/1000
            </div>
          </div>
        </div>

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

      {/* 生成按钮：青绿渐变粗边 */}
      <button
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
