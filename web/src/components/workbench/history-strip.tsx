import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { genHistoryImageUrl } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { GenerationHistoryItem } from "@/lib/api-types"
import { formatHistoryMeta } from "@/lib/gen"
import { cn } from "cn"

interface HistoryStripProps {
  items: GenerationHistoryItem[]
  loading: boolean
  error: string
  page: number
  totalPages: number
  onLoadMore: () => void
  onDelete: (id: number) => Promise<boolean>
  className?: string
}

export function HistoryStrip({
  items,
  loading,
  error,
  page,
  totalPages,
  onLoadMore,
  onDelete,
  className
}: HistoryStripProps) {
  const { t } = useTranslation()
  const [selectedItem, setSelectedItem] =
    useState<GenerationHistoryItem | null>(null)
  const [deleteTarget, setDeleteTarget] =
    useState<GenerationHistoryItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setDeleteError("")
    try {
      const ok = await onDelete(deleteTarget.id)
      if (ok) {
        setDeleteTarget(null)
      } else {
        setDeleteError(t("history.deleteError"))
      }
    } catch (err) {
      setDeleteError(describeApiError(t, err) || t("history.deleteError"))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className={cn(
        "wb-panel flex shrink-0 flex-col gap-2 p-3 text-[#26264A]",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="wb-title text-sm tracking-wide sm:text-base">
          {t("history.title")}
        </h3>
        {loading && items.length > 0 && (
          <span className="text-xs font-bold text-[#26264A]/60">
            {t("common.loading")}
          </span>
        )}
      </div>

      {/* 历史卡片横向滚动条 */}
      <TooltipProvider delayDuration={200}>
        <div className="flex min-h-[96px] w-full items-center gap-3 overflow-x-auto pb-1">
          {items.length === 0 && !loading && (
            <div className="flex w-full items-center justify-center py-4 text-xs font-medium text-[#26264A]/60">
              {t("history.empty")}
            </div>
          )}

          {items.length === 0 && loading && (
            <div className="flex w-full items-center justify-center py-4 text-xs font-medium text-[#26264A]/60">
              {t("common.loading")}
            </div>
          )}

          {items.map((item) => {
            const sizeLabel =
              item.size === "portrait"
                ? t("generate.sizePortrait")
                : item.size === "square"
                  ? t("generate.sizeSquare")
                  : item.size

            return (
              <div
                key={item.id}
                className="wb-history-card flex w-[230px] shrink-0 items-center gap-2.5 p-2 sm:w-[260px]"
              >
                {/* 缩略图：点击打开原图灯箱，鼠标悬浮显示元信息浮层 */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setSelectedItem(item)}
                      aria-label={t("history.view")}
                      className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 border-[#26264A] bg-[#1E1E3F] transition-opacity hover:opacity-90"
                    >
                      <img
                        src={genHistoryImageUrl(item.id)}
                        alt={item.prompt_original}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="center">
                    {formatHistoryMeta(item, t)}
                  </TooltipContent>
                </Tooltip>

                {/* 信息区 */}
                <div className="flex min-w-0 flex-1 flex-col justify-between self-stretch py-0.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="wb-title text-xs font-bold text-[#26264A]">
                      #{item.id}
                    </span>
                    <span className="rounded bg-[#26264A]/10 px-1 py-0.2 text-[10px] font-bold text-[#26264A]">
                      {sizeLabel}
                    </span>
                  </div>

                  <p
                    className="truncate text-xs font-medium text-[#26264A]/80"
                    title={item.prompt_original}
                  >
                    {item.prompt_original}
                  </p>

                  {/* 动作按钮：下载原图与删除 */}
                  <div className="mt-1 flex items-center gap-1.5">
                    <a
                      href={genHistoryImageUrl(item.id, true)}
                      download
                      title={t("history.download")}
                      className="wb-btn-cartoon flex h-6 items-center px-2 text-[11px] font-bold"
                    >
                      {t("history.download")}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError("")
                        setDeleteTarget(item)
                      }}
                      title={t("history.delete")}
                      className="wb-btn-cartoon flex h-6 items-center px-2 text-[11px] font-bold text-red-600 hover:bg-red-50"
                    >
                      {t("history.delete")}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {/* 加载更多 */}
          {page < totalPages && (
            <button
              type="button"
              disabled={loading}
              onClick={onLoadMore}
              className="wb-btn-cartoon flex h-20 w-24 shrink-0 flex-col items-center justify-center gap-1 p-2 text-xs font-bold"
            >
              {loading ? t("common.loading") : t("history.loadMore")}
            </button>
          )}
        </div>
      </TooltipProvider>

      {error && <p className="text-xs font-bold text-red-600">{error}</p>}

      {/* 原图灯箱 Dialog */}
      <Dialog
        open={!!selectedItem}
        onOpenChange={(open) => !open && setSelectedItem(null)}
      >
        <DialogContent className="wb-dialog-cartoon max-w-2xl p-5">
          <DialogHeader>
            <DialogTitle className="wb-title text-base text-[#26264A] sm:text-lg">
              {selectedItem ? formatHistoryMeta(selectedItem, t) : ""}
            </DialogTitle>
            {selectedItem?.prompt_original && (
              <DialogDescription className="max-h-24 overflow-y-auto whitespace-pre-wrap text-xs font-medium text-[#26264A]/80">
                {selectedItem.prompt_original}
              </DialogDescription>
            )}
          </DialogHeader>

          {selectedItem && (
            <div className="my-2 flex max-h-[65vh] w-full items-center justify-center overflow-hidden rounded-xl border-2 border-[#26264A] bg-[#1E1E3F]">
              <img
                src={genHistoryImageUrl(selectedItem.id)}
                alt={selectedItem.prompt_original}
                className="max-h-[65vh] w-full object-contain"
              />
            </div>
          )}

          <DialogFooter className="flex flex-row items-center justify-between sm:justify-between">
            {selectedItem && (
              <a
                href={genHistoryImageUrl(selectedItem.id, true)}
                download
                className="wb-btn-generate flex h-9 items-center px-4 text-xs font-bold"
              >
                {t("history.download")}
              </a>
            )}
            <DialogClose asChild>
              <button
                type="button"
                className="wb-btn-cartoon h-9 px-4 text-xs font-bold"
              >
                {t("common.actions.close")}
              </button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setDeleteError("")
          }
        }}
      >
        <DialogContent className="wb-dialog-cartoon max-w-sm p-5">
          <DialogHeader>
            <DialogTitle className="wb-title text-base text-[#26264A]">
              {t("history.deleteTitle")}
            </DialogTitle>
            <DialogDescription className="text-xs font-medium text-[#26264A]/80">
              {t("history.deleteConfirm")}
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <p className="text-xs font-bold text-red-600">{deleteError}</p>
          )}

          <DialogFooter className="mt-3 flex gap-2">
            <DialogClose asChild>
              <button
                type="button"
                disabled={deleting}
                className="wb-btn-cartoon h-9 px-3 text-xs font-bold"
              >
                {t("common.actions.cancel")}
              </button>
            </DialogClose>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleConfirmDelete()}
              className="wb-btn-cartoon h-9 border-red-600 bg-red-600 px-3 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? t("common.loading") : t("history.delete")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
