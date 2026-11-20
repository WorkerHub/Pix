import { beforeEach, describe, expect, it } from "vitest"
import { i18n } from "@/i18n"
import type { GenerationHistoryItem } from "@/lib/api-types"
import {
  appendHistoryItems,
  calcEstimatedProgress,
  clearStoredJob,
  elapsedSeconds,
  estimatedGenDurationSec,
  formatHistoryDate,
  formatHistoryDuration,
  formatHistoryMeta,
  formatModelDisplayName,
  GEN_JOB_STORAGE_KEY,
  GEN_POLL_INTERVAL_MS,
  GEN_PROGRESS_CAP,
  GEN_TIMEOUT_MS,
  HISTORY_POLL_DELAYS,
  isTimedOut,
  mergeHistoryItems,
  readStoredJob,
  writeStoredJob
} from "@/lib/gen"

describe("gen helpers", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("常量定义符合契约", () => {
    expect(GEN_POLL_INTERVAL_MS).toBe(5000)
    expect(GEN_TIMEOUT_MS).toBe(12 * 60 * 1000)
    expect(GEN_JOB_STORAGE_KEY).toBe("app-gen-job")
  })

  describe("readStoredJob / writeStoredJob / clearStoredJob", () => {
    it("空存储返回 null", () => {
      expect(readStoredJob()).toBeNull()
    })

    it("成功存取合规任务", () => {
      const now = Date.now()
      writeStoredJob({
        jobId: "job-123",
        prompt: "a cute cat",
        size: "portrait",
        submittedAt: now
      })

      const read = readStoredJob()
      expect(read).toEqual({
        jobId: "job-123",
        prompt: "a cute cat",
        size: "portrait",
        submittedAt: now
      })
    })

    it("支持方图 size", () => {
      const now = Date.now()
      writeStoredJob({
        jobId: "job-456",
        prompt: "",
        size: "square",
        submittedAt: now
      })

      const read = readStoredJob()
      expect(read?.size).toBe("square")
    })

    it("损坏的 JSON 返回 null", () => {
      localStorage.setItem(GEN_JOB_STORAGE_KEY, "invalid-json{")
      expect(readStoredJob()).toBeNull()
    })

    it("缺失关键字段返回 null", () => {
      localStorage.setItem(
        GEN_JOB_STORAGE_KEY,
        JSON.stringify({ jobId: "job-1", size: "invalid" })
      )
      expect(readStoredJob()).toBeNull()

      localStorage.setItem(
        GEN_JOB_STORAGE_KEY,
        JSON.stringify({ jobId: "", size: "portrait", submittedAt: Date.now() })
      )
      expect(readStoredJob()).toBeNull()
    })

    it("clearStoredJob 正确清理存储", () => {
      writeStoredJob({
        jobId: "job-123",
        size: "portrait",
        submittedAt: Date.now()
      })
      expect(readStoredJob()).not.toBeNull()

      clearStoredJob()
      expect(readStoredJob()).toBeNull()
    })
  })

  describe("elapsedSeconds", () => {
    it("正确计算已等秒数", () => {
      const start = 100000
      expect(elapsedSeconds(start, start + 5000)).toBe(5)
      expect(elapsedSeconds(start, start + 300)).toBe(0)
      expect(elapsedSeconds(start, start + 120000)).toBe(120)
    })

    it("时间倒流或未来时间返回 0 不返回负数", () => {
      const start = 100000
      expect(elapsedSeconds(start, start - 5000)).toBe(0)
    })
  })

  describe("isTimedOut", () => {
    it("不足 12 分钟返回 false", () => {
      const start = 100000
      expect(isTimedOut(start, start + 11 * 60 * 1000)).toBe(false)
      expect(isTimedOut(start, start + 12 * 60 * 1000 - 1)).toBe(false)
    })

    it("达到或超过 12 分钟返回 true", () => {
      const start = 100000
      expect(isTimedOut(start, start + 12 * 60 * 1000)).toBe(true)
      expect(isTimedOut(start, start + 15 * 60 * 1000)).toBe(true)
    })
  })

  describe("estimatedGenDurationSec & calcEstimatedProgress", () => {
    it("预估时长按模型分两档", () => {
      expect(estimatedGenDurationSec("realistic-lcm")).toBe(100)
      expect(estimatedGenDurationSec("realistic")).toBe(250)
      expect(estimatedGenDurationSec("majicmix")).toBe(250)
      expect(estimatedGenDurationSec("dreamshaper")).toBe(250)
      expect(estimatedGenDurationSec("counterfeit")).toBe(250)
      expect(estimatedGenDurationSec(undefined)).toBe(250)
    })

    it("进度估算初始为 0，单调递增且封顶 95%", () => {
      expect(GEN_PROGRESS_CAP).toBe(95)
      expect(calcEstimatedProgress(0, "realistic-lcm")).toBe(0)

      const p30 = calcEstimatedProgress(30 * 1000, "realistic-lcm")
      const p60 = calcEstimatedProgress(60 * 1000, "realistic-lcm")
      const p100 = calcEstimatedProgress(100 * 1000, "realistic-lcm")
      const p300 = calcEstimatedProgress(300 * 1000, "realistic-lcm")
      const p1000 = calcEstimatedProgress(1000 * 1000, "realistic-lcm")

      expect(p30).toBeGreaterThan(0)
      expect(p60).toBeGreaterThan(p30)
      expect(p100).toBeGreaterThan(p60)
      expect(p300).toBeGreaterThanOrEqual(p100)
      expect(p1000).toBe(95)
      expect(calcEstimatedProgress(99999999, "realistic-lcm")).toBe(95)
      expect(calcEstimatedProgress(99999999, "realistic")).toBe(95)
    })

    it("相同耗时下 realistic-lcm 进度快于其他 250s 模型", () => {
      const pFast = calcEstimatedProgress(50 * 1000, "realistic-lcm")
      const pSlow = calcEstimatedProgress(50 * 1000, "realistic")
      expect(pFast).toBeGreaterThan(pSlow)
    })
  })

  describe("HISTORY_POLL_DELAYS", () => {
    it("定义了 11 次有界退避间隔，总窗口 25.5 秒（≥20s），覆盖最坏落库时延", () => {
      expect(HISTORY_POLL_DELAYS).toEqual([
        500, 1000, 1500, 2000, 2500, 3000, 3000, 3000, 3000, 3000, 3000
      ])
      const total = HISTORY_POLL_DELAYS.reduce((a, b) => a + b, 0)
      expect(total).toBe(25500)
      expect(total).toBeGreaterThanOrEqual(20000)
    })
  })

  describe("mergeHistoryItems & appendHistoryItems", () => {
    const makeItem = (
      id: number,
      jobId: string,
      prompt = "prompt"
    ): GenerationHistoryItem => ({
      id,
      job_id: jobId,
      model: "realistic-lcm",
      prompt_original: prompt,
      prompt_effective: prompt,
      size: "portrait",
      created_at: "2026-11-20T10:00:00Z",
      imageUrl: `/api/gen/history/${id}/image`
    })

    describe("mergeHistoryItems", () => {
      it("处理空数组", () => {
        const item1 = makeItem(1, "job-1")
        expect(mergeHistoryItems([], [])).toEqual([])
        expect(mergeHistoryItems([item1], [])).toEqual([item1])
        expect(mergeHistoryItems([], [item1])).toEqual([item1])
      })

      it("新条目优先置前，并按 job_id 去除 prev 中的旧同名条目", () => {
        const old1 = makeItem(1, "job-1", "旧条目1")
        const old2 = makeItem(2, "job-2", "旧条目2")
        const new1 = makeItem(10, "job-1", "更新后的条目1")
        const new3 = makeItem(3, "job-3", "全新条目3")

        const merged = mergeHistoryItems([new3, new1], [old1, old2])

        // new3 和 new1 必须排在头部，old1 因 job-1 重复被剔除，保留 old2
        expect(merged).toHaveLength(3)
        expect(merged[0].job_id).toBe("job-3")
        expect(merged[1].job_id).toBe("job-1")
        expect(merged[1].prompt_original).toBe("更新后的条目1")
        expect(merged[2].job_id).toBe("job-2")
      })

      it("按 id 去重（兜底无 job_id 或跨 job 冲突）", () => {
        const old1 = makeItem(100, "", "id 为 100 无 jobId")
        const new1 = makeItem(100, "job-new", "新条目 id 仍为 100")

        const merged = mergeHistoryItems([new1], [old1])
        expect(merged).toHaveLength(1)
        expect(merged[0].job_id).toBe("job-new")
      })

      it("过滤 incoming 与 prev 各自内部的重复项", () => {
        const in1 = makeItem(1, "job-1")
        const in2 = makeItem(2, "job-1") // 重复 job_id
        const prev1 = makeItem(3, "job-3")
        const prev2 = makeItem(4, "job-3") // 重复 job_id

        const merged = mergeHistoryItems([in1, in2], [prev1, prev2])
        expect(merged).toHaveLength(2)
        expect(merged.map((it) => it.job_id)).toEqual(["job-1", "job-3"])
      })
    })

    describe("appendHistoryItems", () => {
      it("追加新页，按 job_id 与 id 过滤已存在的条目", () => {
        const existing1 = makeItem(1, "job-1")
        const existing2 = makeItem(2, "job-2")
        const incomingDup = makeItem(10, "job-1") // job-1 重复
        const incomingNew = makeItem(3, "job-3")

        const appended = appendHistoryItems(
          [existing1, existing2],
          [incomingDup, incomingNew]
        )

        expect(appended).toHaveLength(3)
        expect(appended.map((it) => it.job_id)).toEqual([
          "job-1",
          "job-2",
          "job-3"
        ])
        expect(appended[0].id).toBe(1) // 保留 existing 中的版本
      })
    })
  })

  describe("历史条目元信息格式化", () => {
    beforeEach(async () => {
      await i18n.changeLanguage("zh")
    })

    describe("formatHistoryDate", () => {
      it("按本地时区格式化为 MM-DD HH:mm", () => {
        // 创建固定本地时区的时间
        const date = new Date(2026, 10, 20, 18, 5) // 2026-11-20 18:05
        expect(formatHistoryDate(date)).toBe("11-20 18:05")
      })

      it("非法日期返回空串", () => {
        expect(formatHistoryDate("invalid-date")).toBe("")
      })
    })

    describe("formatModelDisplayName", () => {
      it("已知模型查 i18n 映射", () => {
        expect(formatModelDisplayName("realistic-lcm", i18n.t)).toBe(
          "写实·极速"
        )
        expect(formatModelDisplayName("counterfeit", i18n.t)).toBe("动漫")
      })

      it("未知模型回退原始 id", () => {
        expect(formatModelDisplayName("custom-unknown-model", i18n.t)).toBe(
          "custom-unknown-model"
        )
      })

      it("空值回退空串", () => {
        expect(formatModelDisplayName(null, i18n.t)).toBe("")
        expect(formatModelDisplayName(undefined, i18n.t)).toBe("")
      })
    })

    describe("formatHistoryDuration", () => {
      it("空值/负值/非法数值返回 null", () => {
        expect(formatHistoryDuration(null, i18n.t)).toBeNull()
        expect(formatHistoryDuration(undefined, i18n.t)).toBeNull()
        expect(formatHistoryDuration(-1, i18n.t)).toBeNull()
        expect(formatHistoryDuration(NaN, i18n.t)).toBeNull()
        expect(formatHistoryDuration(Infinity, i18n.t)).toBeNull()
        expect(formatHistoryDuration(-Infinity, i18n.t)).toBeNull()
      })

      it("不足 1 分钟补零显示 XX秒", () => {
        expect(formatHistoryDuration(0, i18n.t)).toBe("00秒")
        expect(formatHistoryDuration(5, i18n.t)).toBe("05秒")
        expect(formatHistoryDuration(45, i18n.t)).toBe("45秒")
        expect(formatHistoryDuration(59.8, i18n.t)).toBe("59秒")
      })

      it("满 1 分钟显示 X分XX秒", () => {
        expect(formatHistoryDuration(60, i18n.t)).toBe("1分00秒")
        expect(formatHistoryDuration(65, i18n.t)).toBe("1分05秒")
        expect(formatHistoryDuration(125, i18n.t)).toBe("2分05秒")
        expect(formatHistoryDuration(3661, i18n.t)).toBe("61分01秒")
      })

      it("英文语言环境下格式化", async () => {
        await i18n.changeLanguage("en")
        expect(formatHistoryDuration(5, i18n.t)).toBe("05s")
        expect(formatHistoryDuration(65, i18n.t)).toBe("1m 05s")
      })
    })

    describe("formatHistoryMeta", () => {
      it("完整字段包含耗时", () => {
        const localDate = new Date(2026, 10, 20, 18, 5).toISOString()
        const expectedDate = formatHistoryDate(localDate)
        const meta = formatHistoryMeta(
          {
            id: 101,
            created_at: localDate,
            model: "realistic-lcm",
            duration_seconds: 65
          },
          i18n.t
        )
        expect(meta).toBe(`#101 · ${expectedDate} · 写实·极速 · 1分05秒`)
      })

      it("老记录无耗时（duration_seconds 为 null / undefined）时自动省略耗时段", () => {
        const localDate = new Date(2026, 10, 20, 18, 5).toISOString()
        const expectedDate = formatHistoryDate(localDate)
        const meta = formatHistoryMeta(
          {
            id: 102,
            created_at: localDate,
            model: "realistic-lcm",
            duration_seconds: null
          },
          i18n.t
        )
        expect(meta).toBe(`#102 · ${expectedDate} · 写实·极速`)
      })

      it("未知模型回退原始 id", () => {
        const localDate = new Date(2026, 10, 20, 18, 5).toISOString()
        const expectedDate = formatHistoryDate(localDate)
        const meta = formatHistoryMeta(
          {
            id: 103,
            created_at: localDate,
            model: "custom-special-model",
            duration_seconds: 45
          },
          i18n.t
        )
        expect(meta).toBe(
          `#103 · ${expectedDate} · custom-special-model · 45秒`
        )
      })
    })
  })
})
