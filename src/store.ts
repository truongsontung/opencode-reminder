import { nextFire, type Schedule } from "./when.ts"

export type Reminder = {
  readonly id: string
  readonly text: string
  readonly schedule: Schedule
  readonly nextAt: number
  /** Session to wake when this reminder fires. */
  readonly sessionID: string
  /** Agent that owns the target session, captured so we inject into the RIGHT agent. */
  readonly agent: string
  readonly createdAt: number
  readonly lastFired?: number
  readonly done: boolean
}

/** Reminders that are due to fire at `now` (not done, nextAt reached). */
export function dueReminders(list: readonly Reminder[], now: number): Reminder[] {
  return list.filter((r) => !r.done && r.nextAt <= now)
}

/**
 * Advance a reminder after it fires.
 * A "once" reminder becomes done; a repeating one gets its next fire time.
 */
export function advance(reminder: Reminder, now: number): Reminder {
  if (reminder.schedule.kind === "once") {
    return { ...reminder, lastFired: now, done: true }
  }
  return {
    ...reminder,
    lastFired: now,
    nextAt: nextFire(reminder.schedule, now, reminder.nextAt),
  }
}

/** Human summary of a reminder for list output. */
export function describe(reminder: Reminder, now: number): string {
  const status = reminder.done ? "done" : `next ${formatEta(reminder.nextAt - now)}`
  return `[${reminder.id}] ${reminder.text} (${reminder.schedule.kind}, ${status})`
}

function formatEta(ms: number): string {
  if (ms <= 0) return "now"
  const totalSeconds = Math.round(ms / 1000)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (parts.length === 0) parts.push(`${seconds}s`)
  return `in ${parts.join(" ")}`
}

/** Short random id, e.g. "r_k3f9a2". */
export function makeId(): string {
  return `r_${Math.random().toString(36).slice(2, 8)}`
}
