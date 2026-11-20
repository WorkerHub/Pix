import type { TFunction } from "i18next"
import {
  type GenerationHistoryItem,
  type GenerationModel,
  type GenerateSize,
  MODEL_OPTIONS
} from "@/lib/api-types"

/** 前端生图页状态机阶段（纯展示层，不涉及后端契约） */
export type GenPhase =
  | "idle"
  | "submitting"
  | "generating"
  | "done"
  | "offline"
  | "starting"
  | "busy"
  | "error"
  | "timeout"

/** 轮询间隔：5 秒 */
export const GEN_POLL_INTERVAL_MS = 5000

/** 超时阈值：12 分钟 */
export const GEN_TIMEOUT_MS = 12 * 60 * 1000

/** localStorage 任务持久化存储键 */
export const GEN_JOB_STORAGE_KEY = "app-gen-job"

export interface StoredJob {
  jobId: string
  prompt?: string
  size: GenerateSize
  model?: GenerationModel
  submittedAt: number
}

/** 读本地未完成或已完成任务：校验字段完整性，异常回落 null。 */
export function readStoredJob(): StoredJob | null {
  try {
    const raw = localStorage.getItem(GEN_JOB_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredJob>
    if (
      typeof parsed.jobId === "string" &&
      parsed.jobId.length > 0 &&
      (parsed.size === "portrait" || parsed.size === "square") &&
      typeof parsed.submittedAt === "number" &&
      Number.isFinite(parsed.submittedAt)
    ) {
      return {
        jobId: parsed.jobId,
        prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
        size: parsed.size,
        model:
          typeof parsed.model === "string" &&
          MODEL_OPTIONS.includes(parsed.model as GenerationModel)
            ? (parsed.model as GenerationModel)
            : undefined,
        submittedAt: parsed.submittedAt
      }
    }
    return null
  } catch {
    return null
  }
}

/** 写任务到本地存储（隐私模式下忽略异常，不阻塞流程）。 */
export function writeStoredJob(job: StoredJob): void {
  try {
    localStorage.setItem(GEN_JOB_STORAGE_KEY, JSON.stringify(job))
  } catch {
    // 忽略存储失败
  }
}

/** 清理本地任务记录。 */
export function clearStoredJob(): void {
  try {
    localStorage.removeItem(GEN_JOB_STORAGE_KEY)
  } catch {
    // 忽略清理失败
  }
}

/** 计算已等秒数（非负有限整数）。 */
export function elapsedSeconds(submittedAt: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - submittedAt) / 1000))
}

/** 检查是否达到 12 分钟超时。 */
export function isTimedOut(submittedAt: number, now = Date.now()): boolean {
  return now - submittedAt >= GEN_TIMEOUT_MS
}

/** 各模型预估生成时长（秒）——写实·极速 100，其余 250。 */
export function estimatedGenDurationSec(model?: GenerationModel): number {
  return model === "realistic-lcm" ? 100 : 250
}

/** 进度封顶（真图到达前最多 95%）。 */
export const GEN_PROGRESS_CAP = 95

/** 进度估算曲线：ease-out 缓动，真图到达前 95% 封顶。
 * 沿用 #16 曲线口径，按模型分档时长。
 */
export function calcEstimatedProgress(
  elapsedMs: number,
  model?: GenerationModel
): number {
  const expected = estimatedGenDurationSec(model) * 1000 * 1.28
  const raw = Math.min(1, Math.max(0, elapsedMs) / expected)
  return Math.min(
    GEN_PROGRESS_CAP,
    Math.floor((1 - (1 - raw) ** 1.6) * GEN_PROGRESS_CAP)
  )
}

/**
 * 历史入库轮询退避间隔（毫秒）：上限 11 次，总计 25.5 秒窗口（≥20s）。
 * 覆盖取图接口最坏情况下的 15s 机器超时（AbortSignal.timeout(15000)）以及后续 R2 / D1 异步落库耗时，
 * 同时保持严格有界（上限 11 次退避），一旦目标 jobId 出现即刻停止。
 */
export const HISTORY_POLL_DELAYS: readonly number[] = [
  500, 1000, 1500, 2000, 2500, 3000, 3000, 3000, 3000, 3000, 3000
]

/**
 * 合并刷新历史记录：将 incoming（第 1 页拉取结果）优先置于前部，
 * 优先按 job_id 去重（兜底按 id 去重），并剔除 prev 中的同项及潜在重复项。
 */
export function mergeHistoryItems(
  incoming: GenerationHistoryItem[],
  prev: GenerationHistoryItem[]
): GenerationHistoryItem[] {
  const seenJobIds = new Set<string>()
  const seenIds = new Set<number>()
  const result: GenerationHistoryItem[] = []

  for (const item of incoming) {
    const hasJobId = Boolean(item.job_id && item.job_id.trim().length > 0)
    const jobIdKey = hasJobId ? item.job_id.trim() : null

    if (
      (jobIdKey && seenJobIds.has(jobIdKey)) ||
      (typeof item.id === "number" && seenIds.has(item.id))
    ) {
      continue
    }

    if (jobIdKey) seenJobIds.add(jobIdKey)
    if (typeof item.id === "number") seenIds.add(item.id)
    result.push(item)
  }

  for (const item of prev) {
    const hasJobId = Boolean(item.job_id && item.job_id.trim().length > 0)
    const jobIdKey = hasJobId ? item.job_id.trim() : null

    if (
      (jobIdKey && seenJobIds.has(jobIdKey)) ||
      (typeof item.id === "number" && seenIds.has(item.id))
    ) {
      continue
    }

    if (jobIdKey) seenJobIds.add(jobIdKey)
    if (typeof item.id === "number") seenIds.add(item.id)
    result.push(item)
  }

  return result
}

/**
 * 分页追加历史记录：将 incoming 追加到 existing 之后，
 * 优先按 job_id 去重（兜底按 id 去重）。
 */
export function appendHistoryItems(
  existing: GenerationHistoryItem[],
  incoming: GenerationHistoryItem[]
): GenerationHistoryItem[] {
  const seenJobIds = new Set<string>()
  const seenIds = new Set<number>()
  const result: GenerationHistoryItem[] = []

  for (const item of existing) {
    const hasJobId = Boolean(item.job_id && item.job_id.trim().length > 0)
    const jobIdKey = hasJobId ? item.job_id.trim() : null

    if (
      (jobIdKey && seenJobIds.has(jobIdKey)) ||
      (typeof item.id === "number" && seenIds.has(item.id))
    ) {
      continue
    }

    if (jobIdKey) seenJobIds.add(jobIdKey)
    if (typeof item.id === "number") seenIds.add(item.id)
    result.push(item)
  }

  for (const item of incoming) {
    const hasJobId = Boolean(item.job_id && item.job_id.trim().length > 0)
    const jobIdKey = hasJobId ? item.job_id.trim() : null

    if (
      (jobIdKey && seenJobIds.has(jobIdKey)) ||
      (typeof item.id === "number" && seenIds.has(item.id))
    ) {
      continue
    }

    if (jobIdKey) seenJobIds.add(jobIdKey)
    if (typeof item.id === "number") seenIds.add(item.id)
    result.push(item)
  }

  return result
}

/** 历史条目生成时间格式化为 MM-DD HH:mm（按浏览器本地时区）。 */
export function formatHistoryDate(createdAt: string | number | Date): string {
  const d = new Date(createdAt)
  if (isNaN(d.getTime())) return ""
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const h = String(d.getHours()).padStart(2, "0")
  const min = String(d.getMinutes()).padStart(2, "0")
  return `${m}-${day} ${h}:${min}`
}

/**
 * 格式化模型显示名：按模型 id 查前端模型注册表映射，未知 id 显示原始 id。
 */
export function formatModelDisplayName(
  model: string | null | undefined,
  t: TFunction
): string {
  if (!model) return ""
  const key = `generate.model.${model}`
  return t(key, { defaultValue: model })
}

/**
 * 格式化历史耗时：
 * 满 1 分钟显示 X分XX秒，不足 1 分钟显示 XX秒。
 * 无耗时（null / undefined / 非正数）返回 null。
 */
export function formatHistoryDuration(
  seconds: number | null | undefined,
  t: TFunction
): string | null {
  if (
    seconds === null ||
    seconds === undefined ||
    typeof seconds !== "number" ||
    isNaN(seconds) ||
    seconds < 0
  ) {
    return null
  }
  const totalSeconds = Math.floor(seconds)
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60)
    const remSeconds = String(totalSeconds % 60).padStart(2, "0")
    return t("history.durationMinutesSeconds", {
      minutes,
      seconds: remSeconds
    })
  }
  const secStr = String(totalSeconds).padStart(2, "0")
  return t("history.durationSeconds", { seconds: secStr })
}

/**
 * 拼接历史条目元信息：`#编号 · 生成时间 · 模型显示名 · 耗时`。
 * 老记录无耗时省略耗时段、其余照常。
 */
export function formatHistoryMeta(
  item: {
    id: number
    created_at?: string
    model?: string
    duration_seconds?: number | null
  },
  t: TFunction
): string {
  const parts: string[] = []
  parts.push(`#${item.id}`)
  if (item.created_at) {
    const dateStr = formatHistoryDate(item.created_at)
    if (dateStr) parts.push(dateStr)
  }
  if (item.model) {
    const modelStr = formatModelDisplayName(item.model, t)
    if (modelStr) parts.push(modelStr)
  }
  const durationStr = formatHistoryDuration(item.duration_seconds, t)
  if (durationStr) {
    parts.push(durationStr)
  }
  return parts.join(" · ")
}
