import { z } from "zod"
function tool(def: any) { return def }
tool.schema = z

// ════════════════════════════════════════════════════════════════════════
//  reminder plugin — bộ nhắc cá nhân, lưu per-session <sid>.reminder.json.
//  State machine: idle → due → overdue → done
// ════════════════════════════════════════════════════════════════════════

let _client: any = null
let _sid: string | undefined

const TICK_MS = (() => {
  const v = parseInt(process.env.OPENCODE_REMINDERS_TICK_MS || "", 10)
  return Number.isFinite(v) && v > 0 ? v : 60_000
})()
const NAG_MS = 3 * 60 * 1000

const STATE_DIR = process.env.OPENCODE_REMINDERS_DIR || `${process.env.HOME}/.local/share/opencode-reminders`

interface Reminder {
  id: string
  label: string
  nextAt: number
  repeat: "none" | "daily" | "weekly" | "interval"
  hour: number
  minute: number
  dow?: number
  intervalMs?: number
  state: "idle" | "due" | "overdue"
}

const reminders = new Map<string, Reminder>()
let seq = 0
let clockTimer: any = null
let nagTimer: any = null
let verbose = false

// ── Persistence ─────────────────────────────────────────────────────────

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
    reminders.clear()
    seq = 0
    if (!f) return
    const fs = require("fs")
    const data = JSON.parse(fs.readFileSync(f, "utf8"))
    for (const ev of (data || [])) {
      if (!ev.state) ev.state = "idle"
      reminders.set(ev.id, ev)
      const m = /^r-(\d+)$/.exec(ev.id)
      if (m) seq = Math.max(seq, parseInt(m[1]!, 10))
    }
  } catch {}
}

// ── Push ────────────────────────────────────────────────────────────────

async function push(msg: string, sid?: string): Promise<boolean> {
  const target = sid || _sid
  if (!target || !_client?.session?.promptAsync) return false
  try {
    await _client.session.promptAsync({
      path: { id: target },
      body: { parts: [{ type: "text", text: msg }] },
    })
    return true
  } catch {
    return false
  }
}

// ── When parsing ────────────────────────────────────────────────────────

const DAY_MAP: any = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

function parseWhen(when: string, now: number): Reminder {
  const tokens = when.trim().split(/\s+/)
  let repeat: "none" | "daily" | "weekly" = "none"
  let i = 0
  if (tokens[i] === "daily") { repeat = "daily"; i++ }
  else if (tokens[i] === "weekly") { repeat = "weekly"; i++ }
  if (tokens[i]?.toLowerCase() === "in") {
    const rel = (tokens[i + 1] ?? "").match(/^(\d+)(m|h|s)$/i)
    if (rel) {
      const n = parseInt(rel[1]!)
      const unit = rel[2]!.toLowerCase()
      const ms = unit === "h" ? n * 3600000 : unit === "m" ? n * 60000 : n * 1000
      return { id: "", label: "", nextAt: now + ms, repeat: "none", hour: 0, minute: 0, state: "idle" }
    }
    throw new Error("định dạng thời gian không hợp lệ. VD: 14:30 | daily 09:00 | in 30m")
  }
  if (tokens[i]?.toLowerCase() === "every") {
    const rel = (tokens[i + 1] ?? "").match(/^(\d+)(m|h)$/i)
    if (rel) {
      const n = parseInt(rel[1]!)
      const ms = rel[2]!.toLowerCase() === "h" ? n * 3600000 : n * 60000
      if (ms < 60000) throw new Error("chu kỳ lặp tối thiểu 1 phút")
      return { id: "", label: "", nextAt: now + ms, repeat: "interval", intervalMs: ms, hour: 0, minute: 0, state: "idle" }
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
  return { id: "", label: "", nextAt: d.getTime(), repeat, hour, minute, dow, state: "idle" }
}

function repeatLabel(ev: Reminder): string {
  if (ev.repeat !== "interval") return ev.repeat
  const m = Math.round((ev.intervalMs || 0) / 60000)
  return m % 60 === 0 ? `every ${m / 60}h` : `every ${m}m`
}

function fmtTime(ms: number) {
  const d = new Date(ms)
  const t = new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short",
    hour: "2-digit", minute: "2-digit",
    timeZoneName: "shortOffset", hour12: false,
  }).formatToParts(d)
  const get = (type: string) => t.find(p => p.type === type)!.value
  const date = `${get("year")}-${get("month")}-${get("day")}`
  const dow = get("weekday")
  const hhmm = `${get("hour")}:${get("minute")}`
  const tz = get("timeZoneName")
  return `${date} ${dow} ${hhmm} ${tz}`
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

// ── Tick + Nag ──────────────────────────────────────────────────────────

function startClock() {
  if (clockTimer) return
  scheduleTick()
  scheduleNag()
}

function scheduleTick() {
  clockTimer = setTimeout(async () => {
    try { await tick() } finally { scheduleTick() }
  }, TICK_MS)
}

function scheduleNag() {
  nagTimer = setTimeout(async () => {
    try { await nag() } finally { scheduleNag() }
  }, NAG_MS)
}

function stopClock() {
  if (clockTimer) { clearTimeout(clockTimer); clockTimer = null }
  if (nagTimer) { clearTimeout(nagTimer); nagTimer = null }
}

function ensureRunning(): boolean {
  if (!clockTimer) { startClock(); return true }
  return false
}

async function tick() {
  const now = Date.now()
  let pushed = 0

  for (const [id, ev] of reminders) {
    if (ev.state === "idle" && now >= ev.nextAt) {
      ev.state = "due"
    }
    if (ev.state === "due") {
      const ok = await push(`!ev remind: reminder ${id} ${ev.label} @${fmtTime(ev.nextAt)} — gọi reminder_done`)
      if (ok) {
        ev.state = "overdue"
        pushed++
      }
    }
  }

  if (verbose) {
    const ts = new Date(now).toTimeString().slice(0, 8)
    const lines = [`[tick ${ts}] ${reminders.size} reminders, ${pushed} pushed`]
    for (const ev of reminders.values()) {
      const till = Math.round((ev.nextAt - now) / 1000)
      lines.push(`  ${ev.id} "${ev.label}" [${repeatLabel(ev)}] state=${ev.state}${ev.state === "idle" ? ` in ${till}s` : ""}`)
    }
    await push(lines.join("\n"))
  }

  saveReminders()
}

async function nag() {
  const now = Date.now()
  let pushed = 0

  for (const [id, ev] of reminders) {
    if (ev.state === "overdue") {
      const late = Math.max(0, Math.round((now - ev.nextAt) / 60000))
      const ok = await push(`!ev resum: reminder ${id} ${ev.label} @${fmtTime(ev.nextAt)}${late ? ` (trễ ${late}m)` : ""} — gọi reminder_done`)
      if (ok) pushed++
    }
  }

  if (verbose && pushed > 0) {
    const ts = new Date(now).toTimeString().slice(0, 8)
    await push(`[nag ${ts}] ${pushed} resum pushed`)
  }

  if (pushed > 0) saveReminders()
}

// ── Tools ───────────────────────────────────────────────────────────────

const tools = {
  reminder_add: tool({
    description: 'Add or update a reminder. when: HH:MM | in <N>m|h|s | daily HH:MM | <dow> HH:MM | every <N>m|h. Optional `id`: giữ nguyên id nếu đã tồn tại.',
    args: {
      label: tool.schema.string(),
      when: tool.schema.string(),
      id: tool.schema.string({ required: false }),
    },
    async execute(args: any) {
      if (ensureRunning()) push("!ev reminder ready")
      if (!args || typeof args.when !== "string") {
        return "! lỗi: thiếu tham số `when` (VD: 14:30 | in 30m | daily 09:00 | every 2h)"
      }
      const id = args.id
      let parsed
      try {
        parsed = parseWhen(args.when, Date.now())
      } catch (e: any) {
        return `! lỗi: ${e?.message || e}`
      }
      if (id) {
        const existed = reminders.has(id)
        const ev = reminders.get(id) || parsed
        ev.id = id
        ev.label = args.label
        ev.repeat = parsed.repeat
        ev.hour = parsed.hour
        ev.minute = parsed.minute
        ev.dow = parsed.dow
        ev.intervalMs = parsed.intervalMs
        ev.nextAt = parsed.nextAt
        ev.state = "idle"
        reminders.set(id, ev)
        const m = /^r-(\d+)$/.exec(id)
        if (m) seq = Math.max(seq, parseInt(m[1]!, 10))
        saveReminders()
        return `${existed ? "~" : "+"}${id} ${existed ? "updated" : "created"} → ${new Date(ev.nextAt).toTimeString().slice(0, 5)} [${repeatLabel(ev)}] ${ev.label}`
      }
      parsed.id = `r-${++seq}`
      parsed.label = args.label
      reminders.set(parsed.id, parsed)
      saveReminders()
      return `+${parsed.id} ${new Date(parsed.nextAt).toTimeString().slice(0, 5)} [${repeatLabel(parsed)}] ${parsed.label}`
    },
  }),

  reminder_list: tool({
    description: "Liệt kê tất cả nhắc. Trạng thái: ⏰ idle, 🔔 due, 🔔 overdue.",
    args: {},
    async execute() {
      if (reminders.size === 0) return "(trống)"
      const now = Date.now()
      return [...reminders.values()].map(ev => {
        let st: string
        if (ev.state === "overdue") st = `🔔 quá hạn (trễ ${Math.max(0, Math.round((now - ev.nextAt) / 60000))}m)`
        else if (ev.state === "due") st = `🔔 chờ push remind`
        else st = `⏰ ${fmtTime(ev.nextAt)}`
        return `${ev.id} ${st} [${repeatLabel(ev)}] ${ev.label}`
      }).join("\n")
    },
  }),

  reminder_done: tool({
    description: "Xác nhận done. One-time → xóa; repeat → sang kỳ kế.",
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
      ev.state = "idle"
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
    description: "Bật/tắt log debug mỗi chu kỳ tick/nag [on|off].",
    args: { on: tool.schema.string().optional() },
    async execute(args: any) {
      if (args.on === "on" || args.on === "1" || args.on === "true") verbose = true
      else if (args.on === "off" || args.on === "0" || args.on === "false") verbose = false
      else verbose = !verbose
      return `verbose ${verbose ? "ON" : "OFF"}`
    },
  }),

  reminder_start: tool({
    description: "Khởi chạy clock tick (60s) + nag (3ph) nếu chưa chạy.",
    args: {},
    async execute() {
      const started = ensureRunning()
      if (started) push("!ev reminder ready")
      return clockTimer ? (started ? "reminder ready" : "reminder running") : "reminder stopped"
    },
  }),
}

// ── Plugin lifecycle ────────────────────────────────────────────────────

export const ReminderPlugin = async ({ client }: { client: any }) => {
  _client = client
  _sid = undefined
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
