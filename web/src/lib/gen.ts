import {
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

/**
 * 进度估算曲线：ease-out 缓动，真图到达前 95% 封顶。
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
