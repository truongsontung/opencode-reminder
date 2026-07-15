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
const OUTBOX_FILE = join(DATA_DIR, "outbox.json")
const TICK_MS = Number(process.env.OPENCODE_REMINDERS_TICK_MS ?? "15000")

// ════════════════════════════════════════════════════════════════════════
// Cơ chế bơm vào inline prompt — y hệt agent-teamwork-scheduler:
//   - Bơm ĐÚNG session tạo reminder (reminder.sessionID) qua promptAsync,
//     NGAY CẢ KHI session đó đang ẩn / không dùng đến (giúp agent tiếp tục
//     chạy nhiệm vụ user giao). Không chặn flush vì session ẩn.
//   - Chỉ giữ lại trong outbox khi promptAsync THẬT SỰ fail (lỗi network/
//     client mất). Khi fail → retry mỗi tick cho tới khi bơm được.
//   - outbox được PERSIST xuống đĩa: khi user Ctrl-C exit rồi mở lại
//     session, plugin load outbox dang dở và tiếp tục flush (resume).
//   - clock chỉ chạy khi có thứ để bơm (outbox/reminder due). Dừng hẳn khi
//     user exit (dispose / process exit).
// ════════════════════════════════════════════════════════════════════════

// ── Module-level shared state (một instance plugin) ──────────────────────
const sessionStatus = new Map<string, string>()
const outbox = new Map<string, { text: string; agent: string }[]>()
let flushChain: Promise<void> = Promise.resolve()
let clockTimer: any = null
let running = false

// Ref đến fireDue (được gán bên trong ReminderPlugin để tránh scope issue).
let fireDueRef: () => Promise<void> = async () => {}

// ── Outbox persistence (resume sau khi mở lại session) ────────────────────
function saveOutbox() {
  try {
    const fs = require("fs")
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(OUTBOX_FILE, JSON.stringify([...outbox.entries()]))
  } catch {}
}
function loadOutbox() {
  try {
    const fs = require("fs")
    const arr = JSON.parse(fs.readFileSync(OUTBOX_FILE, "utf8"))
    if (Array.isArray(arr)) {
      outbox.clear()
      for (const [sid, q] of arr) outbox.set(sid, q)
    }
    try { fs.unlinkSync(OUTBOX_FILE) } catch {}
  } catch {}
}

function isIdle(sid: string | undefined): boolean {
  if (!sid) return false
  const st = sessionStatus.get(sid)
  return st !== "busy" && st !== "thinking" && st !== "running"
}

function ensureRunning(): boolean {
  if (!running) {
    running = true
    clockTimer = setInterval(() => { void fireDueRef() }, TICK_MS)
    if (typeof clockTimer.unref === "function") clockTimer.unref()
    return true
  }
  return false
}
function stopClockIfIdle() {
  // Chỉ dừng clock khi KHÔNG còn gì để làm: outbox rỗng VÀ không còn reminder
  // pending (chưa done, chưa tới hạn nhưng sẽ tới). Nếu còn reminder chưa
  // tới hạn → giữ clock để quét tới lúc bơm (không tắt sớm).
  if (outbox.size > 0) return
  if (running) {
    clearInterval(clockTimer)
    clockTimer = null
    running = false
  }
}

function scheduleFlush(sid: string, client: any) {
  flushChain = flushChain.then(() => flushOutbox(sid, client)).catch(() => {})
}

async function flushOutbox(sid: string, client: any) {
  const q = outbox.get(sid)
  if (!q || q.length === 0) return
  // Bơm NGAY dù session ẩn (không chặn bằng sessionStatus/knownSessions).
  // Chỉ giữ lại item khi promptAsync fail → retry tick sau.
  const pending = [...q]
  outbox.set(sid, [])
  for (const item of pending) {
    if (!client?.session?.promptAsync) { // client chưa sẵn → giữ lại
      const cur = outbox.get(sid) ?? []
      cur.push(item); outbox.set(sid, cur)
      continue
    }
    await client.session
      .promptAsync({
        path: { id: sid },
        body: { agent: item.agent, parts: [{ type: "text", text: `⏰ Reminder: ${item.text}` }] },
      })
      .then(() => { void markFired(sid, item.agent, item.text) })
      .catch(() => {
        const cur = outbox.get(sid) ?? []
        cur.push(item); outbox.set(sid, cur)
      })
  }
  saveOutbox()
  stopClockIfIdle()
}

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

// Mark một reminder đã bơm thành công (chỉ gọi sau khi promptAsync OK).
// Một lần → done; lặp → dời kỳ kế. Nếu reminder không tìm thấy → bỏ qua.
async function markFired(sid: string, agent: string, text: string): Promise<void> {
  const list = await load()
  const now = Date.now()
  const idx = list.findIndex(
    (r) => r.sessionID === sid && r.agent === agent && r.text === text && !r.done,
  )
  if (idx < 0) return
  list[idx] = advance(list[idx]!, now)
  await save(list)
}

const WHEN_HELP =
  'Examples: "in 2m", "in 1h30m", "at 14:30", "daily 09:00", "mon 09:00", "every 10m".'

export const ReminderPlugin: Plugin = async ({ client }) => {
  // Resume: nạp outbox dang dở từ lần chạy trước (nếu có) và tiếp tục bơm.
  loadOutbox()
  if (outbox.size > 0) ensureRunning()

  async function fireDue(): Promise<void> {
    const list = await load()
    const now = Date.now()
    const due = dueReminders(list, now)
    if (due.length === 0) {
      // Chưa có gì đến hạn, NHƯNG vẫn còn reminder pending → giữ clock chạy
      // để quét tới lúc bơm. Chỉ dừng hẳn khi không còn reminder nào.
      const pending = list.filter((r) => !r.done)
      if (pending.length === 0 && outbox.size === 0) stopClockIfIdle()
      return
    }

    // Đưa EVERY due reminder vào outbox của ĐÚNG session tạo nó.
    // Không quan tâm session có đang ẩn/active — scheduler vẫn bơm ev vào
    // đúng session để agent tiếp tục chạy.
    // (Chưa mark done ở đây — chỉ mark sau khi bơm THÀNH CÔNG trong
    //  flushOutbox → markFired, để fail thì retry, không bỏ sót.)
    for (const reminder of due) {
      const sid = reminder.sessionID
      if (!sid) continue
      const q = outbox.get(sid) ?? []
      q.push({ text: reminder.text, agent: reminder.agent })
      outbox.set(sid, q)
    }

    saveOutbox()
    ensureRunning()
    for (const sid of outbox.keys()) {
      scheduleFlush(sid, client)
    }
  }
  fireDueRef = fireDue

  function applySessionStatus(event: any): void {
    const sid = event?.properties?.sessionID
      || event?.properties?.info?.sessionID
      || event?.properties?.info?.id
    if (!sid) return
    // Khi session vừa wakeup (idle), flush ngay outbox của nó.
    const type = event?.type
    if (type === "session.idle" || type === "session.next.prompted") {
      sessionStatus.set(sid, "idle"); scheduleFlush(sid, client); return
    }
    if (type === "session.next.step.started") {
      sessionStatus.set(sid, "busy"); return
    }
    if (type === "session.status") {
      const raw = event?.properties?.status ?? event?.properties?.info?.status
      const st = typeof raw === "string" ? raw : raw?.type
      if (st === "idle") sessionStatus.set(sid, "idle")
      else if (st === "busy" || st === "thinking" || st === "running") sessionStatus.set(sid, st)
    }
  }

  return {
    dispose: async () => {
      // User exit: dừng clock. Outbox đã persist → mở lại sẽ resume.
      if (clockTimer) { clearInterval(clockTimer); clockTimer = null }
      running = false
      saveOutbox()
    },
    event: async ({ event }: any) => {
      applySessionStatus(event)
      const et = event?.type
      const sid = event?.properties?.sessionID
        || event?.properties?.info?.sessionID
        || event?.properties?.info?.id
      if (et === "session.deleted" && sid) {
        sessionStatus.delete(sid)
        outbox.delete(sid)
        saveOutbox()
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
          const first =
            schedule.kind === "once"
              ? reminder
              : { ...reminder, ...advance(reminder, now - 1) }
          list.push(first)
          await save(list)
          ensureRunning()
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
