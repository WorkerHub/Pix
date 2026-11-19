/**
 * 生图历史记录表 generations 的 SQL 读写（表名一律经 `lib/tables.ts` 拼前缀）。
 */
import { generationsTable } from "../../lib/tables"

export interface GenerationRow {
  id: number
  user_id: number
  job_id: string
  model: string
  prompt_original: string
  prompt_effective: string
  size: "portrait" | "square"
  r2_key: string
  created_at: string
}

export interface InsertGenerationParams {
  userId: number
  jobId: string
  model?: string
  promptOriginal: string
  promptEffective: string
  size: "portrait" | "square"
  r2Key: string
  createdAt?: string
}

const GENERATION_COLUMNS = `id, user_id, job_id, model, prompt_original, prompt_effective, size, r2_key, created_at`

/** 根据机器侧 jobId 查询是否已入库（写入幂等检查）。 */
export async function findGenerationByJobId(
  db: D1Database,
  prefix: string,
  jobId: string
): Promise<GenerationRow | null> {
  return db
    .prepare(
      `SELECT ${GENERATION_COLUMNS} FROM ${generationsTable(prefix)} WHERE job_id = ?`
    )
    .bind(jobId)
    .first<GenerationRow>()
}

/** 插入一条出图历史索引记录，基于 job_id 唯一约束幂等忽略重复。 */
export async function insertGeneration(
  db: D1Database,
  prefix: string,
  params: InsertGenerationParams
): Promise<boolean> {
  const createdAt = params.createdAt ?? new Date().toISOString()
  const model = params.model ?? "realistic-lcm"
  try {
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO ${generationsTable(prefix)}
         (user_id, job_id, model, prompt_original, prompt_effective, size, r2_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.userId,
        params.jobId,
        model,
        params.promptOriginal,
        params.promptEffective,
        params.size,
        params.r2Key,
        createdAt
      )
      .run()
    return (res.meta?.changes ?? 0) > 0
  } catch (err) {
    console.warn("Failed to insert generation record:", err)
    return false
  }
}

/** 根据 id 和所属用户查询单条记录（严格归属校验，防越权与枚举）。 */
export async function findGenerationByIdAndUser(
  db: D1Database,
  prefix: string,
  id: number,
  userId: number
): Promise<GenerationRow | null> {
  return db
    .prepare(
      `SELECT ${GENERATION_COLUMNS} FROM ${generationsTable(prefix)} WHERE id = ? AND user_id = ?`
    )
    .bind(id, userId)
    .first<GenerationRow>()
}

/** 分页查询当前用户的历史记录，按 id 倒序排列。 */
export async function listGenerationsByUser(
  db: D1Database,
  prefix: string,
  userId: number,
  limit: number,
  offset: number
): Promise<{ rows: GenerationRow[]; total: number }> {
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) as total FROM ${generationsTable(prefix)} WHERE user_id = ?`
    )
    .bind(userId)
    .first<{ total: number }>()

  const total = countRow?.total ?? 0

  const res = await db
    .prepare(
      `SELECT ${GENERATION_COLUMNS} FROM ${generationsTable(prefix)}
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(userId, limit, offset)
    .all<GenerationRow>()

  return {
    rows: res.results ?? [],
    total
  }
}

/** 删除当前用户的单条历史索引记录（严格归属校验）。 */
export async function deleteGenerationByIdAndUser(
  db: D1Database,
  prefix: string,
  id: number,
  userId: number
): Promise<boolean> {
  const res = await db
    .prepare(
      `DELETE FROM ${generationsTable(prefix)} WHERE id = ? AND user_id = ?`
    )
    .bind(id, userId)
    .run()
  return (res.meta?.changes ?? 0) > 0
}
