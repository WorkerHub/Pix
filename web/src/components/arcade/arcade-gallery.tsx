import { useTranslation } from "react-i18next"
import { genImageUrl } from "@/lib/api"
import {
  modelLabelKey,
  type GenerateModel,
  type GenerateSize
} from "@/lib/api-types"
import { sndClick } from "@/lib/arcade-audio"

export interface LootItem {
  id: string
  jobId: string
  prompt: string
  score: number
  elapsed: number
  size: GenerateSize
  model?: GenerateModel
  createdAt: number
}

export interface ArcadeGalleryProps {
  items: LootItem[]
  onSelect: (item: LootItem) => void
}

export function ArcadeGallery({ items, onSelect }: ArcadeGalleryProps) {
  const { t } = useTranslation()
  return (
    <section
      className="gallery"
      id="gallery"
      aria-label={t("arcade.gallery.aria")}
    >
      <h2>{t("arcade.gallery.title")}</h2>
      {items.length === 0 ? (
        <p className="empty" id="galleryEmpty">
          {t("arcade.gallery.empty")}
        </p>
      ) : (
        <div className="thumbs" id="thumbs">
          {items.map((item, idx) => {
            const timeStr = new Date(item.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit"
            })
            const modelLabel = t(modelLabelKey(item.model))
            const sizeLabel = t(
              item.size === "portrait"
                ? "generate.sizePortrait"
                : "generate.sizeSquare"
            )
            const displayId = item.jobId
              ? `#${item.jobId.slice(-4)}`
              : `#${idx + 1}`

            return (
              <button
                key={item.id}
                className="thumb"
                type="button"
                onClick={() => {
                  sndClick()
                  onSelect(item)
                }}
                title={`[${displayId}] 「${item.prompt}」- ${modelLabel} · ${sizeLabel} · ${t(
                  "arcade.done.score"
                )} ${item.score}`}
              >
                <img src={genImageUrl(item.jobId)} alt="" loading="lazy" />
                <span className="thumb-prompt">{item.prompt}</span>
                <div className="thumb-badges">
                  <span className="thumb-model">{modelLabel}</span>
                  <span className="thumb-size">{sizeLabel}</span>
                </div>
                <div className="thumb-footer">
                  <span className="thumb-id">{displayId}</span>
                  <span className="thumb-time">{timeStr}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
