import { useTranslation } from "react-i18next"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  type GenerateSize,
  type GenerationModel,
  MODEL_OPTIONS,
  modelLabelKey
} from "@/lib/api-types"
import type { GenPhase } from "@/lib/gen"
import { cn } from "cn"

interface ControlPanelProps {
  prompt: string
  onPromptChange: (val: string) => void
  size: GenerateSize
  onSizeChange: (val: GenerateSize) => void
  model: GenerationModel
  onModelChange: (val: GenerationModel) => void
  phase: GenPhase
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
