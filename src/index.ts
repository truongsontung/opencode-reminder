import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseWhen } from "./when.ts"
import { advance, describe as describeReminder, dueReminders, makeId, type Reminder } from "./store.ts"

const z = tool.schema

const DATA_DIR = process.env.OPENCODE_REMINDERS_DIR ?? join(homedir(), ".local", "share", "opencode-reminders")
const DATA_FILE = join(DATA_DIR, "reminders.json")
const TICK_MS = Number(process.env.OPENCODE_REMINDERS_TICK_MS ?? "15000")

// Gate bơm ev: chỉ bơm vào session đang idle để tránh event rớt vào pending
// queue của session đang bận → steer API reroute sang session khác (lạc event).
// Quan trọng: KHÔNG duy trì trạng thái idle/busy qua event map (dễ kẹt busy vĩnh
// viễn nếu event idle bị sót). Thay vào đó, mỗi lần bơm ta QUERY TRỰC TIẾP
// client.session.status() để lấy trạng thái THỰC TẾ của session tại thời điểm đó.

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

    // Query trạng thái THỰC TẾ của mọi session 1 lần duy nhất (tránh gọi API
    // nhiều lần). Key = sessionID, value = SessionStatus { type: idle|busy|retry }.
    const statuses = await client.session
      .status()
      .then((r: any) => (r?.data ?? r) as Record<string, { type?: string }>)
      .catch(() => ({}) as Record<string, { type?: string }>)

    // Chỉ HOÃN khi CHẮC CHẮN session đang bận (busy/retry). Mọi trường hợp còn
    // lại (idle, không có trong map, lỗi query) → bơm, vì mất reminder tệ hơn
    // reroute. Reminder không advance khi hoãn → tự bơm lại khi session rảnh.
    const fired: Reminder[] = []
    for (const reminder of due) {
      const st = statuses[reminder.sessionID]?.type
      if (st === "busy" || st === "retry") continue
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
      // promptAsync bơm vào hội thoại chạy ngầm → TUI không tự refresh đến khi
      // mở lại session. Hiện toast để reminder THỰC SỰ hiện lên màn hình TUI.
      await client.tui
        .showToast({ title: "⏰ Reminder", message: reminder.text, variant: "info" })
        .catch(() => {})
      fired.push(reminder)
    }

    if (fired.length === 0) return
    const firedSet = new Set(fired)
    const advanced = list.map((r) => (firedSet.has(r) ? advance(r, now) : r))
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
    event: async ({ event }: any) => {
      // Session bị xoá → xoá luôn reminder của session đó để không bắn vào
      // session đã chết (fireDue bắt lỗi nhưng reminder lặp vẫn ghi file vô ích).
      const sid = event?.properties?.sessionID
        || event?.properties?.info?.sessionID
        || event?.properties?.info?.id
      if (event?.type === "session.deleted" && sid) {
        const list = await load()
        const filtered = list.filter((r) => r.sessionID !== sid)
        if (filtered.length !== list.length) await save(filtered)
      }
    },
    tool: {
      reminder_add: tool({
        description: `Create a personal reminder that wakes THIS session when due (injects "⏰ Reminder: <text>"). SUPPORTS BOTH one-time AND repeating — e.g. when="in 30m" (once) or when="every 5m" / "daily 09:00" / "mon 09:00" (repeat automatically: no cron, no re-create). Repeating ones auto-advance each cycle; stop them with reminder_done / reminder_del. Use this tool directly — do NOT read plugin source. ${WHEN_HELP}`,
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
        description: "List YOUR reminders for the current session (pending and completed).",
        args: {
          all: z.boolean().optional().describe("Include completed reminders (default false)."),
          global: z.boolean().optional().describe("Show reminders of ALL sessions instead of just this session."),
        },
        execute: async (args, context) => {
          const now = Date.now()
          const list = await load()
          // Chỉ hiện reminder của session hiện tại để không lẫn lộn với session
          // khác (mỗi reminder đã lưu sẵn sessionID). Dùng global:true để xem hết.
          const sid = context?.sessionID
          const mine = (!args.global && sid) ? list.filter((r) => r.sessionID === sid) : list
          const shown = args.all === true ? mine : mine.filter((r) => !r.done)
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
