import { describe, expect, test } from "bun:test"
import { advance, dueReminders, makeId, type Reminder } from "../src/store.ts"
import type { Schedule } from "../src/when.ts"

const NOW = new Date(2025, 0, 15, 10, 0, 0, 0).getTime()

function make(id: string, schedule: Schedule, nextAt: number, done = false): Reminder {
  return {
    id,
    text: `note ${id}`,
    schedule,
    nextAt,
    sessionID: "ses_1",
    agent: "build",
    createdAt: NOW,
    done,
  }
}

describe("dueReminders", () => {
  test("returns only reached, not-done reminders", () => {
    const list = [
      make("a", { kind: "once", at: NOW - 1000 }, NOW - 1000),
      make("b", { kind: "once", at: NOW + 1000 }, NOW + 1000),
      make("c", { kind: "once", at: NOW - 1000 }, NOW - 1000, true),
      make("d", { kind: "daily", hour: 9, minute: 0 }, NOW),
    ]
    const due = dueReminders(list, NOW).map((r) => r.id)
    expect(due).toEqual(["a", "d"])
  })
})

describe("advance", () => {
  test("once -> done", () => {
    const r = make("a", { kind: "once", at: NOW }, NOW)
    const next = advance(r, NOW)
    expect(next.done).toBe(true)
    expect(next.lastFired).toBe(NOW)
  })

  test("every -> reschedules forward, stays active", () => {
    const r = make("b", { kind: "every", intervalMs: 600_000 }, NOW)
    const next = advance(r, NOW)
    expect(next.done).toBe(false)
    expect(next.nextAt).toBeGreaterThan(NOW)
    expect(next.lastFired).toBe(NOW)
  })

  test("daily -> next day", () => {
    const r = make("c", { kind: "daily", hour: 8, minute: 0 }, NOW)
    const next = advance(r, NOW)
    expect(next.done).toBe(false)
    expect(next.nextAt).toBe(new Date(2025, 0, 16, 8, 0, 0, 0).getTime())
  })
})

describe("makeId", () => {
  test("prefixed and unique-ish", () => {
    const a = makeId()
    const b = makeId()
    expect(a.startsWith("r_")).toBe(true)
    expect(a).not.toBe(b)
  })
})
