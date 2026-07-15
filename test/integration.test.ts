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
      { when: "in 1s", text: "check deploy" },
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
      { when: "whenever", text: "nope" },
      ctx as never,
    )
    expect(String(res)).toContain("Could not understand")
  })

  test("fires into correct session even when hidden (no status event seen)", async () => {
    const hiddenSid = "ses_hidden"
    const add = await tools.reminder_add!.execute(
      { when: "in 1s", text: "hidden task" },
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
      { when: "in 1s", text: "resume me" },
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
      { when: "in 1s", text: "flaky" },
      { ...ctx, agent: "plan" } as never,
    )
    await tick(1600) // lần 1 fail, scan tick kế tiếp (50ms) retry thành công
    expect(callsR.find((c) => c.text.includes("flaky"))).toBeDefined()
    await hooks4.dispose?.()
  })
})
