import { describe, expect, test } from "bun:test"
import { nextFire, parseDuration, parseWhen, type Schedule } from "../src/when.ts"

// Fixed reference: 2025-01-15 (Wed) 10:00:00 local time.
const NOW = new Date(2025, 0, 15, 10, 0, 0, 0).getTime()

describe("parseDuration", () => {
  test("single units", () => {
    expect(parseDuration("45s")).toBe(45_000)
    expect(parseDuration("2m")).toBe(120_000)
    expect(parseDuration("1h")).toBe(3_600_000)
    expect(parseDuration("2d")).toBe(172_800_000)
  })

  test("compound", () => {
    expect(parseDuration("1h30m")).toBe(5_400_000)
    expect(parseDuration("1h 30m")).toBe(5_400_000)
  })

  test("invalid", () => {
    expect(parseDuration("")).toBeUndefined()
    expect(parseDuration("soon")).toBeUndefined()
    expect(parseDuration("10x")).toBeUndefined()
  })
})

describe("parseWhen", () => {
  test("in -> once relative", () => {
    expect(parseWhen("in 2m", NOW)).toEqual({ kind: "once", at: NOW + 120_000 })
    expect(parseWhen("in 1h30m", NOW)).toEqual({ kind: "once", at: NOW + 5_400_000 })
  })

  test("in rejects zero / negative / junk", () => {
    expect(parseWhen("in 0m", NOW)).toBeUndefined()
    expect(parseWhen("in later", NOW)).toBeUndefined()
  })

  test("at -> next occurrence today", () => {
    const s = parseWhen("at 14:30", NOW)
    expect(s).toEqual({ kind: "once", at: new Date(2025, 0, 15, 14, 30, 0, 0).getTime() })
  })

  test("at -> rolls to tomorrow when time already passed", () => {
    const s = parseWhen("at 09:00", NOW)
    expect(s).toEqual({ kind: "once", at: new Date(2025, 0, 16, 9, 0, 0, 0).getTime() })
  })

  test("daily", () => {
    expect(parseWhen("daily 09:00", NOW)).toEqual({ kind: "daily", hour: 9, minute: 0 })
  })

  test("every", () => {
    expect(parseWhen("every 10m", NOW)).toEqual({ kind: "every", intervalMs: 600_000 })
  })

  test("day of week", () => {
    expect(parseWhen("mon 09:00", NOW)).toEqual({ kind: "dow", dow: 1, hour: 9, minute: 0 })
    expect(parseWhen("FRI 18:15", NOW)).toEqual({ kind: "dow", dow: 5, hour: 18, minute: 15 })
  })

  test("invalid clocks + garbage", () => {
    expect(parseWhen("at 25:00", NOW)).toBeUndefined()
    expect(parseWhen("daily 10:99", NOW)).toBeUndefined()
    expect(parseWhen("", NOW)).toBeUndefined()
    expect(parseWhen("whenever", NOW)).toBeUndefined()
  })
})

describe("nextFire", () => {
  test("once returns absolute at", () => {
    const s: Schedule = { kind: "once", at: NOW + 5000 }
    expect(nextFire(s, NOW)).toBe(NOW + 5000)
  })

  test("every advances past now using last", () => {
    const s: Schedule = { kind: "every", intervalMs: 600_000 }
    expect(nextFire(s, NOW)).toBe(NOW + 600_000)
    // last far in the past -> still returns a future time
    expect(nextFire(s, NOW, NOW - 5_000_000)).toBeGreaterThan(NOW)
  })

  test("daily -> today if still ahead, else tomorrow", () => {
    expect(nextFire({ kind: "daily", hour: 14, minute: 0 }, NOW)).toBe(
      new Date(2025, 0, 15, 14, 0, 0, 0).getTime(),
    )
    expect(nextFire({ kind: "daily", hour: 8, minute: 0 }, NOW)).toBe(
      new Date(2025, 0, 16, 8, 0, 0, 0).getTime(),
    )
  })

  test("dow -> next matching weekday", () => {
    // NOW is Wed (3). Next Mon (1) is 2025-01-20.
    expect(nextFire({ kind: "dow", dow: 1, hour: 9, minute: 0 }, NOW)).toBe(
      new Date(2025, 0, 20, 9, 0, 0, 0).getTime(),
    )
    // Same weekday, later time today -> today.
    expect(nextFire({ kind: "dow", dow: 3, hour: 14, minute: 0 }, NOW)).toBe(
      new Date(2025, 0, 15, 14, 0, 0, 0).getTime(),
    )
    // Same weekday, earlier time -> next week.
    expect(nextFire({ kind: "dow", dow: 3, hour: 8, minute: 0 }, NOW)).toBe(
      new Date(2025, 0, 22, 8, 0, 0, 0).getTime(),
    )
  })
})
