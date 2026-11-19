import { beforeEach, describe, expect, it } from "vitest"
import {
  clearStoredJob,
  elapsedSeconds,
  GEN_JOB_STORAGE_KEY,
  GEN_POLL_INTERVAL_MS,
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
})
