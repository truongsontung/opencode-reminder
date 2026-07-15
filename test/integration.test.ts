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
    // fireDue will promptAsync directly (no session status gate in this version).
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
})
