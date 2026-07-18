import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Configure the plugin BEFORE importing it: isolated data dir + fast tick.
const workDir = await mkdtemp(join(tmpdir(), "reminders-it-"))
process.env.OPENCODE_REMINDERS_DIR = workDir
process.env.OPENCODE_REMINDERS_TICK_MS = "50"

const { ReminderPlugin } = await import("../src/index.ts")

type PromptCall = { id: string; agent?: string; text: string }

const calls: PromptCall[] = []

const fakeClient = {
  session: {
    promptAsync: async (options: {
      path: { id: string }
      body: { agent?: string; parts: Array<{ type: string; text: string }> }
    }) => {
      calls.push({
        id: options.path.id,
        agent: options.body.agent,
        text: options.body.parts.map((p) => p.text).join(""),
      })
      return { data: undefined }
    },
  },
}

const ctx = {
  sessionID: "ses_live",
  messageID: "msg_1",
  agent: "plan", // dynamic agent under test — must be echoed back on fire
  directory: workDir,
  worktree: workDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hooks = await ReminderPlugin({ client: fakeClient } as any)
const tools = hooks.tool ?? {}

afterAll(async () => {
  await hooks.dispose?.()
  await rm(workDir, { recursive: true, force: true })
})

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("end-to-end plugin flow", () => {
  test("add -> list -> fire with dynamic agent -> reschedule/complete", async () => {
    const add = await tools.reminder_add!.execute(
      { when: "in 1s", label: "check deploy" },
      ctx as never,
    )
    expect(String(add)).toContain("check deploy")

    const list = await tools.reminder_list!.execute({}, ctx as never)
    expect(String(list)).toContain("check deploy")

    // Wait past the 1s due time; tick runs every 50ms.
    // fireDue checks isIdle(sessionID) — unknown session → idle → bơm trực tiếp.
    await tick(1400)

    expect(calls.length).toBeGreaterThanOrEqual(1)
    const fired = calls[0]!
    expect(fired.id).toBe("ses_live")
    expect(fired.agent).toBe("plan") // dynamic agent preserved, not hardcoded
    expect(fired.text).toContain("check deploy")

    // Once-reminder should now be gone from the default (pending) list.
    const after = await tools.reminder_list!.execute({}, ctx as never)
    expect(String(after)).toBe("No reminders.")
  })

  test("reject invalid when", async () => {
    const res = await tools.reminder_add!.execute(
      { when: "whenever", label: "nope" },
      ctx as never,
    )
    expect(String(res)).toContain("định dạng thời gian không hợp lệ")
  })

  test("fires into correct session even when hidden (no status event seen)", async () => {
    const hiddenSid = "ses_hidden"
    const add = await tools.reminder_add!.execute(
      { when: "in 1s", label: "hidden task" },
      { ...ctx, sessionID: hiddenSid, agent: "build" } as never,
    )
    expect(String(add)).toContain("hidden task")
    // Không gửi bất kỳ event session.status/idle nào → session được coi ẩn.
    await tick(1400)
    const fired = calls.find((c) => c.id === hiddenSid)
    expect(fired).toBeDefined()
    expect(fired!.agent).toBe("build")
    expect(fired!.text).toContain("hidden task")
  })

  test("persists outbox and resumes after plugin restart (Ctrl-C -> reopen)", async () => {
    const resumeSid = "ses_resume"
    // Tạo reminder đến hạn ngay, nhưng client sẽ fail (không có promptAsync).
    const brokenClient = { session: null }
    const hooks2 = await ReminderPlugin({ client: brokenClient } as any)
    await hooks2.tool!.reminder_add!.execute(
      { when: "in 1s", label: "resume me" },
      { ...ctx, sessionID: resumeSid, agent: "plan" } as never,
    )
    await tick(1200) // due + scan, nhưng promptAsync fail → giữ outbox + persist

    // Giả lập user Ctrl-C exit rồi mở lại: dispose (save) + khởi tạo lại plugin
    // với client mới (khôi phục từ outbox.json).
    await hooks2.dispose?.()

    const callsAfter: PromptCall[] = []
    const freshClient = {
      session: {
        promptAsync: async (o: { path: { id: string }; body: { agent?: string; parts: Array<{ type: string; text: string }> } }) => {
          callsAfter.push({ id: o.path.id, agent: o.body.agent, text: o.body.parts.map((p) => p.text).join("") })
          return { data: undefined }
        },
      },
    }
    const hooks3 = await ReminderPlugin({ client: freshClient } as any)
    await tick(200) // init loadOutbox → ensureRunning → flush tiếp tục

    const resumed = callsAfter.find((c) => c.id === resumeSid)
    expect(resumed).toBeDefined()
    expect(resumed!.text).toContain("resume me")
    await hooks3.dispose?.()
  })

  test("retries on next scan tick when promptAsync fails once", async () => {
    let failOnce = true
    const callsR: PromptCall[] = []
    const flakyClient = {
      session: {
        promptAsync: async (o: { path: { id: string }; body: { agent?: string; parts: Array<{ type: string; text: string }> } }) => {
          if (failOnce) { failOnce = false; throw new Error("network down") }
          callsR.push({ id: o.path.id, agent: o.body.agent, text: o.body.parts.map((p) => p.text).join("") })
          return { data: undefined }
        },
      },
    }
    const hooks4 = await ReminderPlugin({ client: flakyClient } as any)
    await hooks4.tool!.reminder_add!.execute(
      { when: "in 1s", label: "flaky" },
      { ...ctx, agent: "plan" } as never,
    )
    await tick(1600) // lần 1 fail, scan tick kế tiếp (50ms) retry thành công
    expect(callsR.find((c) => c.text.includes("flaky"))).toBeDefined()
    await hooks4.dispose?.()
  })

  test("add with explicit id keeps that id (update not create new)", async () => {
    const hooks5 = await ReminderPlugin({ client: fakeClient } as any)
    const add1 = await hooks5.tool!.reminder_add!.execute(
      { when: "every 2h", label: "original r-4", id: "r-testid" },
      { ...ctx, agent: "plan" } as never,
    )
    expect(String(add1)).toContain("r-testid")
    expect(String(add1)).toContain("created")
    let list = await hooks5.tool!.reminder_list!.execute({}, ctx as never)
    expect(String(list)).toContain("r-testid")

    // Update cùng id → phải update tại chỗ, KHÔNG tạo id mới.
    const add2 = await hooks5.tool!.reminder_add!.execute(
      { when: "every 2h", label: "updated r-testid", id: "r-testid" },
      { ...ctx, agent: "plan" } as never,
    )
    expect(String(add2)).toContain("r-testid")
    expect(String(add2)).toContain("updated")

    list = await hooks5.tool!.reminder_list!.execute({}, ctx as never)
    expect(String(list)).toContain("updated r-testid")
    expect(String(list)).not.toContain("original r-testid")
    // đảm bảo chỉ có đúng 1 dòng chứa r-testid
    const matches = String(list).split("\n").filter((l) => l.includes("r-testid"))
    expect(matches.length).toBe(1)
    await hooks5.dispose?.()
  })

  test("failed push does NOT drop the reminder (retries next tick)", async () => {
    const callsF: Array<{ text: string }> = []
    let failOnce = true
    const flakyClient = {
      session: {
        promptAsync: async (o: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
          if (failOnce) { failOnce = false; throw new Error("agent busy") }
          callsF.push({ text: o.body.parts.map((p) => p.text).join("") })
          return { data: undefined }
        },
      },
    }
    const hooks6 = await ReminderPlugin({ client: flakyClient } as any)
    // kích hoạt session để push có _sid (plugin set _sid qua event handler)
    await hooks6.event?.({ event: { properties: { sessionID: "ses_retry" } } })
    await hooks6.tool!.reminder_add!.execute(
      { when: "in 1s", label: "must-survive", id: "r-retry" },
      { ...ctx, agent: "plan" } as never,
    )
    // Đủ thời gian để reminder due (1s) + qua ít nhất 2 tick (mỗi 50ms).
    // Tick đầu push fail (failOnce) → reminder KHÔNG bị drop, thử lại tick sau → ok.
    await new Promise((r) => setTimeout(r, 1500))
    const delivered = callsF.find((c) => c.text.includes("must-survive"))
    expect(delivered).toBeDefined()
    // Chỉ đúng 1 lần delivered (không bị duplicate do lastRemindAt bug cũ)
    const count = callsF.filter((c) => c.text.includes("must-survive")).length
    expect(count).toBe(1)
    await hooks6.dispose?.()
  })
})
