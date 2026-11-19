import type { GenerateSize } from "@/lib/api-types"

/** 轮询间隔：5 秒 */
export const GEN_POLL_INTERVAL_MS = 5000

/** 超时阈值：12 分钟 */
export const GEN_TIMEOUT_MS = 12 * 60 * 1000

/** localStorage 任务持久化存储键 */
export const GEN_JOB_STORAGE_KEY = "pix.gen-job"

export interface StoredJob {
  jobId: string
  prompt?: string
  size: GenerateSize
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
