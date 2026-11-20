import { useTranslation } from "react-i18next"
import { genImageUrl } from "@/lib/api"
import type { GenerationModel } from "@/lib/api-types"
import { calcEstimatedProgress, type GenPhase } from "@/lib/gen"
import { cn } from "cn"

interface CanvasProps {
  phase: GenPhase
  jobId: string
  prompt: string
  model?: GenerationModel
  elapsed: number
  errorMessage: string
  onRecheckHealth: () => void
  onCheckOnce: () => void
  onRegenerate: () => void
  className?: string
}

export function Canvas({
  phase,
  jobId,
  prompt,
  model,
  elapsed,
  errorMessage,
  onRecheckHealth,
  onCheckOnce,
  onRegenerate,
  className
}: CanvasProps) {
  const { t } = useTranslation()

  const progress = calcEstimatedProgress(elapsed * 1000, model)

  return (
    <div
      data-testid="gen-output"
      className={cn(
        "wb-canvas relative flex flex-1 min-h-0 w-full flex-col",
        className
      )}
    >
      <div className="wb-canvas-screen relative flex h-full w-full flex-1 min-h-0 items-center justify-center p-4 text-white">
        {/* 待机态：居中卡通字标 */}
        {phase === "idle" && (
          <div className="flex flex-col items-center justify-center select-none">
            <div className="wb-title text-6xl tracking-wider text-[#FFD23F] drop-shadow-[0_4px_0_#26264A] sm:text-7xl">
              PIX
            </div>
            <div className="mt-2 h-2 w-16 rounded-full bg-[#FFD23F]/30" />
          </div>
        )}

        {/* 提交中与生成中过渡态：带缓动进度条与已用时 */}
        {(phase === "submitting" || phase === "generating") && (
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border-2 border-[#26264A] bg-[#26264A]/80 p-6 text-center backdrop-blur-sm shadow-[4px_4px_0_#26264A]">
            <div className="wb-title text-2xl text-[#FFD23F] sm:text-3xl">
              {t(
                phase === "submitting"
                  ? "generate.submitting"
                  : "generate.generating"
              )}
            </div>

            {/* 进度条：封顶 95% */}
            <div className="w-full">
              <div className="relative h-5 w-full overflow-hidden rounded-full border-2 border-[#26264A] bg-[#1E1E3F]">
                <div
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-full rounded-full bg-gradient-to-r from-[#2FE0C8] to-[#FFD23F] transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs font-semibold text-[#FFD23F]">
                <span>{t("generate.elapsed", { seconds: elapsed })}</span>
                <span>{progress}%</span>
              </div>
            </div>
          </div>
        )}

        {/* 生成成功：大图等比展示 */}
        {phase === "done" && jobId && (
          <img
            src={genImageUrl(jobId)}
            alt={prompt || "PIX output"}
            className="h-full w-full object-contain"
          />
        )}

        {/* 异常或机器未就绪状态 */}
        {(phase === "offline" || phase === "starting" || phase === "busy") && (
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border-2 border-[#26264A] bg-[#FFF6E9] p-5 text-center text-[#26264A] shadow-[4px_4px_0_#26264A]">
            <p className="font-bold">
              {t(
                phase === "offline"
                  ? "generate.offline"
                  : phase === "starting"
                    ? "generate.starting"
                    : "generate.busy"
              )}
            </p>
            <button
              type="button"
              onClick={onRecheckHealth}
              className="wb-btn-cartoon px-4 py-1.5 text-xs font-bold"
            >
              {t("generate.recheck")}
            </button>
          </div>
        )}

        {phase === "error" && (
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border-2 border-[#26264A] bg-[#FFF6E9] p-5 text-center text-[#26264A] shadow-[4px_4px_0_#26264A]">
            <p className="font-bold text-red-600">
              {errorMessage || t("generate.error")}
            </p>
            <button
              type="button"
              onClick={onRegenerate}
              className="wb-btn-cartoon px-4 py-1.5 text-xs font-bold"
            >
              {t("generate.regenerate")}
            </button>
          </div>
        )}

        {phase === "timeout" && (
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border-2 border-[#26264A] bg-[#FFF6E9] p-5 text-center text-[#26264A] shadow-[4px_4px_0_#26264A]">
            <p className="font-bold text-amber-600">{t("generate.timeout")}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCheckOnce}
                className="wb-btn-cartoon px-3 py-1.5 text-xs font-bold"
              >
                {t("generate.recheckOnce")}
              </button>
              <button
                type="button"
                onClick={onRegenerate}
                className="wb-btn-cartoon px-3 py-1.5 text-xs font-bold"
              >
                {t("generate.regenerate")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
