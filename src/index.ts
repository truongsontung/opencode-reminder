import { z } from "zod"
function tool(def: any) { return def }
tool.schema = z

// ════════════════════════════════════════════════════════════════════════
//  reminder plugin — bộ nhắc cá nhân, lưu per-session <sid>.reminder.json.
// ════════════════════════════════════════════════════════════════════════

let _client: any = null

const REMIND_INTERVAL_MS = 5 * 60 * 1000   // throttle nhắc thường
const BATCH_WINDOW_MS = 60 * 1000          // cửa sổ gộp: nhắc luôn mục đến trong 1 phút tới

const STATE_DIR = `${process.env.HOME}/.local/share/opencode-reminders`

function reminderFile() {
  return _sid ? `${STATE_DIR}/${_sid}.reminder.json` : undefined
}

function saveReminders() {
  try {
    const f = reminderFile()
    if (!f) return
    const fs = require("fs")
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(f, JSON.stringify([...reminders.values()]))
  } catch {}
}
function loadReminders() {
  try {
    const f = reminderFile()
    if (!f) return
    const fs = require("fs")
    const data = JSON.parse(fs.readFileSync(f, "utf8"))
    const now = Date.now()
    reminders.clear()
    for (const ev of (data || [])) {
      if (ev.repeat !== "none" && ev.nextAt <= now && !ev.due) ev.nextAt = nextOccurrence(ev, now)
      reminders.set(ev.id, ev)
    }
  } catch {}
}

interface Reminder {
  id: string
  label: string
  nextAt: number
  repeat: "none" | "daily" | "weekly" | "interval"
  hour: number
  minute: number
  dow?: number
  intervalMs?: number
  lastRemindAt?: number
  due?: boolean
  dueAt?: number
}

const reminders = new Map<string, Reminder>()
let seq = 0
let clockTimer: any = null
let pendingBatch: string[] = []
let verbose = false

let pushQueue: Promise<void> = Promise.resolve()
async function push(msg: string, sid?: string) {
  const target = sid || _sid
  if (!target || !_client?.session?.promptAsync) return
  pushQueue = pushQueue
    .then(async () => {
      await _client.session.promptAsync({
        path: { id: target },
        body: { parts: [{ type: "text", text: msg }] },
      })
    })
    .catch(() => {})
  await pushQueue
}

let _sid: string | undefined

// ── When parsing (copy nguyên từ scheduler) ───────────────────────────────
const DAY_MAP: any = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
function parseWhen(when: string, now: number): Reminder {
  const tokens = when.trim().split(/\s+/)
  let repeat: "none" | "daily" | "weekly" = "none"
  let i = 0
  if (tokens[i] === "daily") { repeat = "daily"; i++ }
  else if (tokens[i] === "weekly") { repeat = "weekly"; i++ }
  if (tokens[i]?.toLowerCase() === "in") {
    const rel = (tokens[i + 1] ?? "").match(/^(\d+)(m|h)$/i)
    if (rel) {
      const n = parseInt(rel[1]!)
      const ms = rel[2]!.toLowerCase() === "h" ? n * 3600000 : n * 60000
      return { id: "", label: "", nextAt: now + ms, repeat: "none", hour: 0, minute: 0 }
    }
    throw new Error("định dạng thời gian không hợp lệ. VD: 14:30 | daily 09:00 | in 30m")
  }
  if (tokens[i]?.toLowerCase() === "every") {
    const rel = (tokens[i + 1] ?? "").match(/^(\d+)(m|h)$/i)
    if (rel) {
      const n = parseInt(rel[1]!)
      const ms = rel[2]!.toLowerCase() === "h" ? n * 3600000 : n * 60000
      if (ms < 60000) throw new Error("chu kỳ lặp tối thiểu 1 phút")
      return { id: "", label: "", nextAt: now + ms, repeat: "interval", intervalMs: ms, hour: 0, minute: 0 }
    }
    throw new Error("định dạng chu kỳ không hợp lệ. VD: every 90m | every 30m | every 2h")
  }
  let dow: number | undefined
  const dowKey = tokens[i]?.toLowerCase()
  if (dowKey !== undefined && DAY_MAP[dowKey] !== undefined) {
    dow = DAY_MAP[dowKey]
    if (repeat === "none") repeat = "weekly"
    i++
  }
  const hm = (tokens[i] ?? "").match(/^(\d{1,2}):(\d{2})$/)
  if (!hm) throw new Error("định dạng thời gian không hợp lệ. VD: 14:30 | daily 09:00 | in 30m")
  const hour = parseInt(hm[1]!); const minute = parseInt(hm[2]!)
  const d = new Date(now); d.setSeconds(0, 0); d.setMilliseconds(0)
  d.setHours(hour, minute, 0, 0)
  if (repeat === "weekly") {
    let guard = 0
    while ((d.getTime() <= now || d.getDay() !== dow) && guard < 8) { d.setDate(d.getDate() + 1); d.setHours(hour, minute, 0, 0); guard++ }
  } else {
    if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  }
  return { id: "", label: "", nextAt: d.getTime(), repeat, hour, minute, dow }
}
function repeatLabel(ev: Reminder): string {
  if (ev.repeat !== "interval") return ev.repeat
  const m = Math.round((ev.intervalMs || 0) / 60000)
  return m % 60 === 0 ? `every ${m / 60}h` : `every ${m}m`
}
function fmtTime(ms: number) {
  const d = new Date(ms)
  // Lấy giờ local + mã timezone thực tế (vd "GMT+7", "GMT+9") từ hệ thống.
  const t = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit",
    timeZoneName: "shortOffset", hour12: false,
  }).formatToParts(d)
  const hhmm = `${t.find(p => p.type === "hour")!.value}:${t.find(p => p.type === "minute")!.value}`
  const tz = t.find(p => p.type === "timeZoneName")!.value
  return `${hhmm} ${tz}`
}
function nextOccurrence(ev: Reminder, now: number): number {
  if (ev.repeat === "interval") {
    const step = ev.intervalMs || 60000
    let n = now + step
    while (n <= now) n += step
    return n
  }
  if (ev.repeat === "daily") {
    const d = new Date(now); d.setSeconds(0, 0); d.setMilliseconds(0); d.setHours(ev.hour, ev.minute, 0, 0)
    if (d.getTime() <= now) d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  if (ev.repeat === "weekly") {
    const d = new Date(now); d.setSeconds(0, 0); d.setMilliseconds(0)
    let guard = 0
    while (d.getDay() !== ev.dow && guard < 8) { d.setDate(d.getDate() + 1); guard++ }
    d.setHours(ev.hour, ev.minute, 0, 0)
    return d.getTime()
  }
  return ev.nextAt
}

// ── Clock loop (mỗi phút, copy nguyên scheduler) ─────────────────────────
function startClock() {
  if (clockTimer) return
  scheduleNext()
}
function scheduleNext() {
  clockTimer = setTimeout(async () => {
    try {
      await tick()
    } finally {
      scheduleNext()
    }
  }, 60_000)
}
function stopClock() {
  if (clockTimer) { clearTimeout(clockTimer); clockTimer = null }
}

async function tick() {
  const now = Date.now()
  pendingBatch = []
  const near: Reminder[] = []
  let trulyDue = 0

  for (const [id, ev] of reminders) {
    if (ev.due) {
      if (!ev.lastRemindAt || now - ev.lastRemindAt >= REMIND_INTERVAL_MS) {
        const late = Math.max(0, Math.round((now - (ev.dueAt || now)) / 60000))
        pendingBatch.push(`reminder ${id} ${ev.label} @${fmtTime(ev.dueAt || ev.nextAt)}${late ? ` (trễ ${late}m) — gọi reminder_done xác nhận` : ""}`)
        ev.lastRemindAt = now
        trulyDue++
      }
    } else if (now >= ev.nextAt) {
      ev.due = true; ev.dueAt = ev.nextAt; ev.lastRemindAt = now
      pendingBatch.push(`reminder ${id} ${ev.label} @${fmtTime(ev.nextAt)}`)
      trulyDue++
    } else if (ev.nextAt <= now + BATCH_WINDOW_MS) {
      near.push(ev)
    }
  }

  if (trulyDue > 0) {
    for (const ev of near) {
      if (ev.lastRemindAt && now - ev.lastRemindAt < REMIND_INTERVAL_MS) continue
      pendingBatch.push(`reminder ${ev.id} ${ev.label} @${fmtTime(ev.nextAt)} (~${Math.max(1, Math.round((ev.nextAt - now) / 1000))}s)`)
      ev.lastRemindAt = now
    }
  }

  if (pendingBatch.length) {
    await push(`!ev remind ${pendingBatch.length}: ` + pendingBatch.join(" | "))
  }

  if (verbose) {
    const ts = new Date(now).toTimeString().slice(0, 8)
    const lines = [`[tick ${ts}]`]
    if (reminders.size === 0) lines.push("  reminders: (empty)")
    else for (const ev of reminders.values()) {
      const till = Math.round((ev.nextAt - now) / 1000)
      lines.push(`  ${ev.id} "${ev.label}" [${repeatLabel(ev)}] in=${till}s`)
    }
    lines.push(`  trulyDue=${trulyDue} batch=${pendingBatch.length}`)
    await push(lines.join("\n"))
  }

  saveReminders()
}

// ── Tools (y hệt style scheduler: tool() + tool.schema.string()) ──────────
const tools = {
  reminder_add: tool({
    description: 'Add reminder. when: HH:MM | in <N>m|h | daily HH:MM | <dow> HH:MM | every <N>m|h (any interval, 1.5h=90m).',
    args: { label: tool.schema.string(), when: tool.schema.string() },
    async execute(args: any) {
      if (ensureRunning()) push("!ev reminder ready")
      const ev = parseWhen(args.when, Date.now())
      ev.id = `r-${++seq}`
      ev.label = args.label
      reminders.set(ev.id, ev)
      saveReminders()
      return `+${ev.id} ${new Date(ev.nextAt).toTimeString().slice(0, 5)} [${repeatLabel(ev)}] ${ev.label}`
    },
  }),

  reminder_list: tool({
    description: "Liệt kê tất cả nhắc (trạng thái: upcoming / chờ xác nhận).",
    args: {},
    async execute() {
      if (reminders.size === 0) return "(trống)"
      const now = Date.now()
      return [...reminders.values()].map(ev => {
        const st = ev.due
          ? `🔔 chờ xác nhận (trễ ${Math.max(0, Math.round((now - (ev.dueAt || now)) / 60000))}m)`
          : `⏰ ${new Date(ev.nextAt).toTimeString().slice(0, 5)}`
        return `${ev.id} ${st} [${repeatLabel(ev)}] ${ev.label}`
      }).join("\n")
    },
  }),

  reminder_done: tool({
    description: "Confirm reminder done (this occurrence), on !ev reminder due. One-time->deleted; repeat->next occurrence.",
    args: { id: tool.schema.string() },
    async execute(args: any) {
      const ev = reminders.get(args.id)
      if (!ev) return "(không tìm thấy)"
      if (ev.repeat === "none") {
        reminders.delete(args.id)
        saveReminders()
        return `done ${args.id} (đã xóa)`
      }
      ev.nextAt = nextOccurrence(ev, Date.now())
      ev.due = false; ev.dueAt = undefined; ev.lastRemindAt = undefined
      saveReminders()
      return `done ${args.id} → kỳ kế ${new Date(ev.nextAt).toTimeString().slice(0, 5)}`
    },
  }),

  reminder_del: tool({
    description: "Xóa nhắc vĩnh viễn.",
    args: { id: tool.schema.string() },
    async execute(args: any) {
      if (reminders.delete(args.id)) { saveReminders(); return `-${args.id}` }
      return "(không tìm thấy)"
    },
  }),

  reminder_verbose: tool({
    description: "Bật/tắt log debug mỗi phút [on|off].",
    args: { on: tool.schema.string().optional() },
    async execute(args: any) {
      if (args.on === "on" || args.on === "1" || args.on === "true") verbose = true
      else if (args.on === "off" || args.on === "0" || args.on === "false") verbose = false
      else verbose = !verbose
      return `verbose ${verbose ? "ON" : "OFF"}`
    },
  }),

  reminder_start: tool({
    description: "Khởi chạy clock nhắc nếu chưa chạy.",
    args: {},
    async execute() {
      const started = ensureRunning()
      if (started) push("!ev reminder ready")
      return clockTimer ? (started ? "reminder ready" : "reminder running") : "reminder stopped"
    },
  }),
}

function ensureRunning(): boolean {
  if (!clockTimer) {
    startClock()
    return true
  }
  return false
}

export const ReminderPlugin = async ({ client }: { client: any }) => {
  _client = client
  loadReminders()
  if (reminders.size > 0) ensureRunning()

  return {
    async dispose() {
      stopClock()
    },
    event: async ({ event }: { event: any }) => {
      const sid = event?.properties?.sessionID
        || event?.properties?.info?.sessionID
        || event?.properties?.info?.id
      if (sid && typeof sid === "string" && sid.startsWith("ses_")) {
        _sid = sid
        loadReminders()
        if (reminders.size > 0) ensureRunning()
      }
    },
    tool: tools,
  }
}
