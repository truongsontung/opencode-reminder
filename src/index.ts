import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseWhen } from "./when.ts"
import { advance, describe as describeReminder, dueReminders, makeId, type Reminder } from "./store.ts"

const z = tool.schema

const DATA_DIR = join(homedir(), ".local", "share", "opencode-reminders")
const DATA_FILE = join(DATA_DIR, "reminders.json")
const TICK_MS = 15_000

async function load(): Promise<Reminder[]> {
  const file = Bun.file(DATA_FILE)
  if (!(await file.exists())) return []
  const parsed = await file.json().catch(() => [])
  return Array.isArray(parsed) ? (parsed as Reminder[]) : []
}

async function save(list: readonly Reminder[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await Bun.write(DATA_FILE, JSON.stringify(list, null, 2))
}

const WHEN_HELP =
  'Examples: "in 2m", "in 1h30m", "at 14:30", "daily 09:00", "mon 09:00", "every 10m".'

export const ReminderPlugin: Plugin = async ({ client }) => {
  // Fire due reminders by waking their originating session with their agent.
  async function fireDue(): Promise<void> {
    const list = await load()
    const now = Date.now()
    const due = dueReminders(list, now)
    if (due.length === 0) return

    for (const reminder of due) {
      await client.session
        .promptAsync({
          path: { id: reminder.sessionID },
          body: {
            // Dynamic agent captured when the reminder was created — never hardcoded.
            agent: reminder.agent,
            parts: [{ type: "text", text: `⏰ Reminder: ${reminder.text}` }],
          },
        })
        .catch(() => {})
    }

    const advanced = list.map((r) => (due.includes(r) ? advance(r, now) : r))
    await save(advanced)
  }

  const timer = setInterval(() => {
    void fireDue()
  }, TICK_MS)
  // Do not keep the process alive solely for the reminder timer.
  if (typeof timer.unref === "function") timer.unref()

  return {
    dispose: async () => {
      clearInterval(timer)
    },
    tool: {
      reminder_add: tool({
        description: `Create a personal reminder that wakes this session when due. ${WHEN_HELP}`,
        args: {
          when: z.string().describe(`When to fire. ${WHEN_HELP}`),
          text: z.string().describe("What to be reminded about."),
        },
        execute: async (args, context) => {
          const now = Date.now()
          const schedule = parseWhen(args.when, now)
          if (schedule === undefined) {
            return `Could not understand "${args.when}". ${WHEN_HELP}`
          }
          const list = await load()
          const reminder: Reminder = {
            id: makeId(),
            text: args.text,
            schedule,
            nextAt: schedule.kind === "once" ? schedule.at : Date.now(),
            sessionID: context.sessionID,
            agent: context.agent,
            createdAt: now,
            done: false,
          }
          // For repeating schedules, compute the first real fire time.
          const first =
            schedule.kind === "once"
              ? reminder
              : { ...reminder, ...advance(reminder, now - 1) }
          list.push(first)
          await save(list)
          return `Added ${describeReminder(first, now)}`
        },
      }),

      reminder_list: tool({
        description: "List your reminders (pending and completed).",
        args: {
          all: z.boolean().optional().describe("Include completed reminders (default false)."),
        },
        execute: async (args) => {
          const now = Date.now()
          const list = await load()
          const shown = args.all === true ? list : list.filter((r) => !r.done)
          if (shown.length === 0) return "No reminders."
          return shown.map((r) => describeReminder(r, now)).join("\n")
        },
      }),

      reminder_done: tool({
        description: "Mark a reminder as done so it stops firing.",
        args: {
          id: z.string().describe("Reminder id, e.g. r_k3f9a2."),
        },
        execute: async (args) => {
          const list = await load()
          const target = list.find((r) => r.id === args.id)
          if (target === undefined) return `No reminder with id ${args.id}.`
          const updated = list.map((r) => (r.id === args.id ? { ...r, done: true } : r))
          await save(updated)
          return `Marked ${args.id} as done.`
        },
      }),

      reminder_del: tool({
        description: "Delete a reminder permanently.",
        args: {
          id: z.string().describe("Reminder id, e.g. r_k3f9a2."),
        },
        execute: async (args) => {
          const list = await load()
          const exists = list.some((r) => r.id === args.id)
          if (!exists) return `No reminder with id ${args.id}.`
          await save(list.filter((r) => r.id !== args.id))
          return `Deleted ${args.id}.`
        },
      }),
    },
  }
}

export default ReminderPlugin
