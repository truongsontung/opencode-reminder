import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const workDir = await mkdtemp(join(tmpdir(), "reminders-it-"))
process.env.OPENCODE_REMINDERS_DIR = workDir
process.env.OPENCODE_REMINDERS_TICK_MS = "50"

const { ReminderPlugin } = await import("../src/index.ts")

type PromptCall = { id: string; text: string }

const allCalls: PromptCall[] = []

function makeClient(failOnce = false) {
  let failed = false
  return {
    session: {
      promptAsync: async (o: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
        if (failOnce && !failed) { failed = true; throw new Error("fail once") }
        allCalls.push({ id: o.path.id, text: o.body.parts.map((p) => p.text).join("") })
        return { data: undefined }
      },
    },
  }
}

function callsFor(sid: string) {
  return allCalls.filter(c => c.id === sid)
}

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true })
})

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("end-to-end plugin flow", () => {
  test("add -> list -> fire -> done (one-time)", async () => {
    allCalls.length = 0
    const sid = "ses_1"
    const client = makeClient()
    const hooks = await ReminderPlugin({ client } as any)
    await hooks.event?.({ event: { properties: { sessionID: sid } } })
    const t = hooks.tool!

    const add = await t.reminder_add!.execute(
      { when: "in 1s", label: "check deploy" },
      { ...{}, sessionID: sid } as never,
    )
    expect(String(add)).toContain("check deploy")

    const list = await t.reminder_list!.execute({}, { sessionID: sid } as never)
    expect(String(list)).toContain("check deploy")

    await wait(1400)

    const fired = callsFor(sid).find(c => c.text.includes("check deploy"))
    expect(fired).toBeDefined()
    expect(fired!.text).toContain("!ev remind:")

    const done = await t.reminder_done!.execute({ id: "r-1" }, { sessionID: sid } as never)
    expect(String(done)).toContain("đã xóa")

    const after = await t.reminder_list!.execute({}, { sessionID: sid } as never)
    expect(String(after)).toBe("(trống)")
    await hooks.dispose?.()
  })

  test("reject invalid when", async () => {
    allCalls.length = 0
    const client = makeClient()
    const hooks = await ReminderPlugin({ client } as any)
    const res = await hooks.tool!.reminder_add!.execute(
      { when: "whenever", label: "nope" },
      {} as never,
    )
    expect(String(res)).toContain("định dạng thời gian không hợp lệ")
    await hooks.dispose?.()
  })

  test("fires into correct session", async () => {
    allCalls.length = 0
    const sid = "ses_correct"
    const client = makeClient()
    const hooks = await ReminderPlugin({ client } as any)
    await hooks.event?.({ event: { properties: { sessionID: sid } } })
    const t = hooks.tool!

    await t.reminder_add!.execute(
      { when: "in 1s", label: "correct session" },
      { sessionID: sid } as never,
    )
    await wait(1400)

    const fired = callsFor(sid).find(c => c.text.includes("correct session"))
    expect(fired).toBeDefined()
    await hooks.dispose?.()
  })

  test("persists and resumes after plugin restart", async () => {
    allCalls.length = 0
    const sid = "ses_resume"

    // Phase 1: broken client → push fails, but reminder saved to disk
    const brokenClient = { session: null }
    const hooks2 = await ReminderPlugin({ client: brokenClient } as any)
    await hooks2.event?.({ event: { properties: { sessionID: sid } } })
    await hooks2.tool!.reminder_add!.execute(
      { when: "in 1s", label: "resume me" },
      { sessionID: sid } as never,
    )
    await wait(1200)
    await hooks2.dispose?.()

    // Phase 2: fresh client → load from disk → push succeeds
    const freshCalls: PromptCall[] = []
    const freshClient = {
      session: {
        promptAsync: async (o: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
          freshCalls.push({ id: o.path.id, text: o.body.parts.map((p) => p.text).join("") })
          return { data: undefined }
        },
      },
    }
    const hooks3 = await ReminderPlugin({ client: freshClient } as any)
    await hooks3.event?.({ event: { properties: { sessionID: sid } } })
    await wait(1400)

    const resumed = freshCalls.find(c => c.id === sid && c.text.includes("resume me"))
    expect(resumed).toBeDefined()
    await hooks3.dispose?.()
  })

  test("failed push retries on next tick (not same tick)", async () => {
    allCalls.length = 0
    const sid = "ses_flaky"
    const client = makeClient(true) // failOnce
    const hooks = await ReminderPlugin({ client } as any)
    await hooks.event?.({ event: { properties: { sessionID: sid } } })
    await hooks.tool!.reminder_add!.execute(
      { when: "in 1s", label: "flaky" },
      { sessionID: sid } as never,
    )
    await wait(1600)
    expect(callsFor(sid).find(c => c.text.includes("flaky"))).toBeDefined()
    await hooks.dispose?.()
  })

  test("add with explicit id keeps that id (update not create new)", async () => {
    allCalls.length = 0
    const client = makeClient()
    const hooks = await ReminderPlugin({ client } as any)
    const t = hooks.tool!

    const add1 = await t.reminder_add!.execute(
      { when: "every 2h", label: "original", id: "r-testid" },
      {} as never,
    )
    expect(String(add1)).toContain("r-testid")
    expect(String(add1)).toContain("created")

    let list = await t.reminder_list!.execute({}, {} as never)
    expect(String(list)).toContain("r-testid")

    const add2 = await t.reminder_add!.execute(
      { when: "every 2h", label: "updated", id: "r-testid" },
      {} as never,
    )
    expect(String(add2)).toContain("r-testid")
    expect(String(add2)).toContain("updated")

    list = await t.reminder_list!.execute({}, {} as never)
    expect(String(list)).toContain("updated")
    expect(String(list)).not.toContain("original")
    const matches = String(list).split("\n").filter((l) => l.includes("r-testid"))
    expect(matches.length).toBe(1)
    await hooks.dispose?.()
  })

  test("recurring reminder: done -> next occurrence, not deleted", async () => {
    allCalls.length = 0
    const client = makeClient()
    const hooks = await ReminderPlugin({ client } as any)
    const t = hooks.tool!

    await t.reminder_add!.execute(
      { when: "every 2h", label: "recur-task", id: "r-recur" },
      {} as never,
    )
    const list0 = String(await t.reminder_list!.execute({}, {} as never))
    expect(list0).toContain("r-recur")

    const done = await t.reminder_done!.execute({ id: "r-recur" }, {} as never)
    expect(String(done)).toContain("kỳ kế")

    const list1 = String(await t.reminder_list!.execute({}, {} as never))
    expect(list1).toContain("r-recur")
    expect(list1).not.toContain("chờ xác nhận")
    await hooks.dispose?.()
  })

  test("nag pushes resum for overdue due=true reminders", async () => {
    allCalls.length = 0
    const sid = "ses_nag"
    const client = makeClient()
    const hooks = await ReminderPlugin({ client } as any)
    await hooks.event?.({ event: { properties: { sessionID: sid } } })
    const t = hooks.tool!

    await t.reminder_add!.execute(
      { when: "in 1s", label: "nag-test", id: "r-nag" },
      { sessionID: sid } as never,
    )

    // Wait for tick to fire (remind)
    await wait(1400)
    const remind = callsFor(sid).find(c => c.text.includes("!ev remind:") && c.text.includes("nag-test"))
    expect(remind).toBeDefined()

    // Verify due state
    const list = String(await t.reminder_list!.execute({}, { sessionID: sid } as never))
    expect(list).toContain("chờ xác nhận")

    // done to clean up
    await t.reminder_done!.execute({ id: "r-nag" }, { sessionID: sid } as never)
    await hooks.dispose?.()
  })

  test("reminder_done on one-time deletes, on recurring advances", async () => {
    allCalls.length = 0
    const client = makeClient()
    const hooks = await ReminderPlugin({ client } as any)
    const t = hooks.tool!

    await t.reminder_add!.execute(
      { when: "in 1h", label: "once-task", id: "r-once" },
      {} as never,
    )
    const done1 = await t.reminder_done!.execute({ id: "r-once" }, {} as never)
    expect(String(done1)).toContain("đã xóa")

    await t.reminder_add!.execute(
      { when: "daily 09:00", label: "daily-task", id: "r-daily" },
      {} as never,
    )
    const done2 = await t.reminder_done!.execute({ id: "r-daily" }, {} as never)
    expect(String(done2)).toContain("kỳ kế")
    expect(String(done2)).not.toContain("đã xóa")

    await hooks.dispose?.()
  })
})
