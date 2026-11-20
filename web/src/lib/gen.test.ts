import { beforeEach, describe, expect, it } from "vitest"
import {
  calcEstimatedProgress,
  clearStoredJob,
  elapsedSeconds,
  estimatedGenDurationSec,
  GEN_JOB_STORAGE_KEY,
  GEN_POLL_INTERVAL_MS,
  GEN_PROGRESS_CAP,
  GEN_TIMEOUT_MS,
  isTimedOut,
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
})
