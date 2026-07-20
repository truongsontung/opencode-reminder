/**
 * Mailbox management + IMAP mail checker for reminder plugin.
 * Uses Gmail plus addressing: user+<code>@gmail.com
 * Each session gets a unique mailbox code.
 */

import { ImapFlow } from "imapflow"
import nodemailer from "nodemailer"
import { randomBytes } from "crypto"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"

// ── Config ──────────────────────────────────────────────────────────────

const BASE_DIR = "/home/vps2/apps/mail-server"
const CONFIG_FILE = join(BASE_DIR, "config.json")
const SESSIONS_FILE = join(BASE_DIR, "sessions.json")
const CACHE_DIR = join(BASE_DIR, "mail_cache")
const STATE_DIR = process.env.OPENCODE_REMINDERS_DIR || `${process.env.HOME}/.local/share/opencode-reminders`

export interface MailboxConfig {
  gmail: {
    email: string
    app_password: string
    imap_host: string
    imap_port: number
    smtp_host: string
    smtp_port: number
  }
  checker: {
    interval_seconds: number
    max_emails_per_check: number
    label?: string
    search_mode?: "to" | "label" | "both"
    initial_sync?: "skip_all" | "last_n" | "process_all"
  }
}

export interface MailboxSession {
  code: string
  address: string
  label: string
  gmail_label: string  // ← Thêm: label Gmail riêng cho session này
  active: boolean
  created_at: string
  stopped_at: string | null
  last_check: string | null
  emails_received: number
  last_email_at: string | null
}

// ── Helpers ─────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: MailboxConfig = {
  gmail: { email: "", app_password: "", imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 587 },
  checker: { interval_seconds: 30, max_emails_per_check: 50 },
}

function loadConfig(): MailboxConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"))
  } catch {
    // Auto-create config file with defaults
    try {
      mkdirSync(BASE_DIR, { recursive: true })
      writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2))
      console.log(`[mailbox] Created default config: ${CONFIG_FILE}`)
    } catch (e) {
      console.error(`[mailbox] Failed to create config: ${e}`)
    }
    return DEFAULT_CONFIG
  }
}

function loadSessions(): Record<string, MailboxSession> {
  try {
    return JSON.parse(readFileSync(SESSIONS_FILE, "utf8"))
  } catch {
    // Auto-create sessions file
    try {
      mkdirSync(BASE_DIR, { recursive: true })
      writeFileSync(SESSIONS_FILE, "{}")
    } catch {}
    return {}
  }
}

function saveSessions(data: Record<string, MailboxSession>) {
  mkdirSync(BASE_DIR, { recursive: true })
  writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2))
}

function loadCache(sessionId: string): { processed_ids: string[] } {
  try {
    return JSON.parse(readFileSync(join(CACHE_DIR, `${sessionId}.json`), "utf8"))
  } catch {
    return { processed_ids: [] }
  }
}

function saveCache(sessionId: string, cache: { processed_ids: string[] }) {
  mkdirSync(CACHE_DIR, { recursive: true })
  // Keep only last 500 IDs
  if (cache.processed_ids.length > 500) {
    cache.processed_ids = cache.processed_ids.slice(-500)
  }
  writeFileSync(join(CACHE_DIR, `${sessionId}.json`), JSON.stringify(cache))
}

function generateCode(): string {
  return randomBytes(4).toString("hex")
}

function getMailboxAddress(config: MailboxConfig, code: string): string {
  const user = config.gmail.email.split("@")[0]
  return `${user}+${code}@gmail.com`
}

// ── Mailbox Tools ───────────────────────────────────────────────────────

export function mailboxStart(args: { session_id: string; name?: string; gmail_label?: string }): string {
  const config = loadConfig()
  const sessions = loadSessions()
  const sessionId = args.session_id

  if (sessions[sessionId]?.active) {
    const s = sessions[sessionId]
    return JSON.stringify({ status: "exists", session_id: sessionId, mailbox: s.address, code: s.code, gmail_label: s.gmail_label })
  }

  if (sessions[sessionId] && !sessions[sessionId].active) {
    sessions[sessionId].active = true
    sessions[sessionId].stopped_at = null
    if (args.gmail_label) sessions[sessionId].gmail_label = args.gmail_label
    saveSessions(sessions)
    return JSON.stringify({ status: "reactivated", session_id: sessionId, mailbox: sessions[sessionId].address, code: sessions[sessionId].code, gmail_label: sessions[sessionId].gmail_label })
  }

  const code = generateCode()
  const address = getMailboxAddress(config, code)
  const now = new Date().toISOString()

  // Determine Gmail label for this session
  // Priority: 1. args.gmail_label, 2. config.checker.label, 3. "" (INBOX)
  const gmailLabel = args.gmail_label || config.checker?.label || ""

  sessions[sessionId] = {
    code,
    address,
    label: args.name || `session-${sessionId.slice(0, 8)}`,
    gmail_label: gmailLabel,
    active: true,
    created_at: now,
    stopped_at: null,
    last_check: null,
    emails_received: 0,
    last_email_at: null,
  }
  saveSessions(sessions)

  return JSON.stringify({
    status: "created",
    session_id: sessionId,
    mailbox: address,
    code,
    gmail_label: gmailLabel,
    instructions: [
      `Mailbox created: ${address}`,
      gmailLabel ? `Checking label: ${gmailLabel}` : "Checking INBOX",
      "Give this email to anyone who wants to send you mail",
      "Emails will be checked every 30 seconds",
      "New emails trigger !ev mail event in this session",
    ],
  })
}

export function mailboxStop(args: { session_id: string }): string {
  const sessions = loadSessions()
  const sessionId = args.session_id

  if (!sessions[sessionId]) {
    return JSON.stringify({ status: "error", message: `No mailbox for session ${sessionId}` })
  }

  sessions[sessionId].active = false
  sessions[sessionId].stopped_at = new Date().toISOString()
  saveSessions(sessions)

  return JSON.stringify({ status: "stopped", session_id: sessionId, mailbox: sessions[sessionId].address })
}

export function mailboxDelete(args: { session_id: string }): string {
  const sessions = loadSessions()
  const sessionId = args.session_id

  if (!sessions[sessionId]) {
    return JSON.stringify({ status: "error", message: `No mailbox for session ${sessionId}` })
  }

  const mailbox = sessions[sessionId].address
  delete sessions[sessionId]
  saveSessions(sessions)

  return JSON.stringify({ status: "deleted", session_id: sessionId, mailbox })
}

export function mailboxStatus(args: { session_id?: string }): string {
  const sessions = loadSessions()

  if (args.session_id) {
    const s = sessions[args.session_id]
    if (!s) return JSON.stringify({ status: "error", message: `No mailbox for session ${args.session_id}` })
    return JSON.stringify({ session_id: args.session_id, ...s })
  }

  const active = Object.values(sessions).filter(s => s.active).length
  return JSON.stringify({
    total: Object.keys(sessions).length,
    active,
    inactive: Object.keys(sessions).length - active,
    mailboxes: Object.entries(sessions).map(([sid, s]) => ({
      session_id: sid, address: s.address, active: s.active, emails_received: s.emails_received,
    })),
  })
}

export async function mailboxSend(args: { session_id: string; to: string; subject: string; body: string }): Promise<string> {
  const config = loadConfig()
  const sessions = loadSessions()
  const sessionId = args.session_id

  if (!sessions[sessionId]) {
    return JSON.stringify({ status: "error", message: `No mailbox for session ${sessionId}` })
  }

  const session = sessions[sessionId]
  const transporter = nodemailer.createTransport({
    host: config.gmail.smtp_host,
    port: config.gmail.smtp_port,
    secure: false,
    auth: { user: config.gmail.email, pass: config.gmail.app_password },
  })

  try {
    await transporter.sendMail({
      from: `"${session.label}" <${config.gmail.email}>`,
      to: args.to,
      subject: args.subject,
      text: args.body,
    })
    return JSON.stringify({ status: "sent", from: session.address, to: args.to, subject: args.subject })
  } catch (e: any) {
    return JSON.stringify({ status: "error", message: e.message })
  }
}

export function mailboxTestConnection(): string {
  const config = loadConfig()
  return JSON.stringify({ email: config.gmail.email, configured: !!config.gmail.email && !!config.gmail.app_password })
}

// ── IMAP Mail Checker ───────────────────────────────────────────────────

let mailCheckerTimer: any = null

export function startMailChecker(pushFn: (msg: string, sid?: string) => Promise<boolean>) {
  if (mailCheckerTimer) return

  const config = loadConfig()
  if (!config.gmail.email || !config.gmail.app_password) {
    return // Not configured
  }

  async function checkAllMailboxes() {
    const sessions = loadSessions()
    const activeSessions = Object.entries(sessions).filter(([, s]) => s.active)

    if (activeSessions.length === 0) return

    let client: ImapFlow | null = null
    try {
      client = new ImapFlow({
        host: config.gmail.imap_host,
        port: config.gmail.imap_port,
        secure: true,
        auth: { user: config.gmail.email, pass: config.gmail.app_password },
        logger: false,
      })
      await client.connect()

      // Group sessions by gmail_label for efficiency
      const sessionsByLabel = new Map<string, [string, MailboxSession][]>()
      for (const [sessionId, session] of activeSessions) {
        const label = session.gmail_label || ""  // Empty = INBOX
        if (!sessionsByLabel.has(label)) {
          sessionsByLabel.set(label, [])
        }
        sessionsByLabel.get(label)!.push([sessionId, session])
      }

      // Check each label group
      for (const [label, labelSessions] of sessionsByLabel) {
        try {
          // Open the label/folder
          if (label) {
            await client.mailboxOpen(label)
          } else {
            await client.mailboxOpen("INBOX")
          }

          // Check all sessions in this label
          for (const [sessionId, session] of labelSessions) {
            const cache = loadCache(sessionId)
            const processed = new Set(cache.processed_ids)
            const mailboxPattern = `${config.gmail.email.split("@")[0]}+${session.code}@gmail.com`

            // Build search query
            // If session has gmail_label, search all emails in that label
            // If no gmail_label, search by TO address
            let searchQuery: any = {}
            if (!label) {
              // No label = search by TO address in INBOX
              searchQuery = { to: mailboxPattern }
            }
            // If label is set, search all emails in that label (no TO filter)

            const searchResult = await client.search(searchQuery, { uid: true })
            if (!searchResult || searchResult.length === 0) continue

            let newCount = 0
            const maxCheck = config.checker.max_emails_per_check

            // Handle initial sync: if cache is empty, apply initial_sync behavior
            const isFirstRun = processed.size === 0
            const initialSync = config.checker?.initial_sync || "skip_all"

            if (isFirstRun && initialSync === "skip_all") {
              // First run: mark ALL existing emails as processed without injecting events
              console.log(`[mail-checker] First run for ${sessionId}: skipping ${searchResult.length} existing emails`)
              for (const uid of searchResult) {
                processed.add(String(uid))
              }
              // Save cache immediately
              cache.processed_ids = [...processed]
              saveCache(sessionId, cache)
              continue
            }

            for (const uid of searchResult.slice(-maxCheck)) {
              if (processed.has(String(uid))) continue

              // First run with "last_n" mode: only process last N emails
              if (isFirstRun && initialSync === "last_n") {
                const allUids = searchResult.map(Number)
                const lastN = allUids.slice(-10) // Last 10 emails
                if (!lastN.includes(Number(uid))) {
                  processed.add(String(uid)) // Skip older emails
                  continue
                }
              }

              const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true })
              if (!msg || !msg.source) continue

              // Parse email
              const emailContent = msg.source.toString()
              const fromMatch = emailContent.match(/^From:\s*(.+)/im)
              const toMatch = emailContent.match(/^To:\s*(.+)/im)
              const subjectMatch = emailContent.match(/^Subject:\s*(.+)/im)
              const dateMatch = emailContent.match(/^Date:\s*(.+)/im)

              const from = fromMatch?.[1] || "unknown"
              const to = toMatch?.[1] || ""
              const subject = subjectMatch?.[1] || "(no subject)"
              const date = dateMatch?.[1] || ""

              // Extract body (simplified)
              const bodyMatch = emailContent.match(/\r?\n\r?\n([\s\S]*)$/)
              let body = bodyMatch?.[1] || "(no body)"
              if (body.length > 1500) body = body.slice(0, 1500) + "\n...(truncated)"

              // Format event
              const eventLabel = `!ev mail:From: ${from}\nTo: ${to}\nSubject: ${subject}\nDate: ${date}\n\n${body}`

              // Push into session's inline prompt directly
              // NOTE: Do NOT write to reminder file - it causes duplicate push by tick cycle
              await pushFn(eventLabel, sessionId)

              processed.add(String(uid))
              newCount++
            }

            // Save cache
            cache.processed_ids = [...processed]
            saveCache(sessionId, cache)

            // Update session stats
            if (sessions[sessionId]) {
              sessions[sessionId].last_check = new Date().toISOString()
              sessions[sessionId].emails_received += newCount
              if (newCount > 0) sessions[sessionId].last_email_at = new Date().toISOString()
            }
          }
        } catch (e) {
          console.error(`[mail-checker] Error checking label "${label}":`, e)
        }
      }

      saveSessions(sessions)
    } catch (e) {
      console.error("[mail-checker] Error:", e)
    } finally {
      if (client) await client.logout().catch(() => {})
    }
  }

  // Start checker loop
  const interval = config.checker.interval_seconds * 1000
  mailCheckerTimer = setInterval(checkAllMailboxes, interval)
  console.log(`[mail-checker] Started, checking every ${config.checker.interval_seconds}s`)
}

export function stopMailChecker() {
  if (mailCheckerTimer) {
    clearInterval(mailCheckerTimer)
    mailCheckerTimer = null
  }
}

function injectMailEvent(sessionId: string, eventLabel: string) {
  const reminderFile = join(STATE_DIR, `${sessionId}.reminder.json`)
  let reminders: any[] = []

  try {
    reminders = JSON.parse(readFileSync(reminderFile, "utf8"))
  } catch {
    reminders = []
  }

  // Check for duplicate (same label in last 5 minutes)
  const now = Date.now()
  const recentDuplicate = reminders.find(r =>
    r.label === eventLabel && now - (r.startAt || 0) < 300_000
  )
  if (recentDuplicate) return

  // Add new event
  const event = {
    id: `mail-${randomBytes(6).toString("hex")}`,
    label: eventLabel,
    nextAt: now,
    startAt: now,
    repeat: null,
    intervalMs: 0,
    hour: 0,
    minute: 0,
    state: "idle",
  }

  reminders.push(event)

  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(reminderFile, JSON.stringify(reminders, null, 2))
  console.log(`[mail-checker] Injected event into ${sessionId}: ${event.id}`)
}
