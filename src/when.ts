/**
 * Parser for human "when" expressions used by opencode-reminders.
 *
 * Supported forms (case-insensitive):
 *   in <dur>            -> once, now + dur          e.g. "in 2m", "in 1h30m", "in 45s"
 *   at HH:MM            -> once, next occurrence of that clock time
 *   daily HH:MM         -> repeats every day at HH:MM
 *   <dow> HH:MM         -> repeats weekly on that weekday   e.g. "mon 09:00"
 *   every <dur>         -> repeats every <dur>       e.g. "every 10m"
 *
 * All functions are pure and take an explicit `now` (epoch ms) so they are
 * deterministic and unit-testable without a real clock.
 */

export type Schedule =
  | { readonly kind: "once"; readonly at: number }
  | { readonly kind: "every"; readonly intervalMs: number }
  | { readonly kind: "daily"; readonly hour: number; readonly minute: number }
  | { readonly kind: "dow"; readonly dow: number; readonly hour: number; readonly minute: number }

const DOW: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

const DUR_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

/** Parse a compact duration like "1h30m", "45s", "2d" into milliseconds. */
export function parseDuration(input: string): number | undefined {
  const text = input.trim().toLowerCase()
  if (text.length === 0) return undefined
  const matches = text.matchAll(/(\d+)\s*([smhd])/g)
  let total = 0
  let count = 0
  for (const match of matches) {
    const value = Number(match[1])
    const unit = DUR_UNIT_MS[match[2] as string]
    if (unit === undefined) return undefined
    total += value * unit
    count += 1
  }
  if (count === 0) return undefined
  return total
}

function parseClock(input: string): { hour: number; minute: number } | undefined {
  const match = input.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (match === null) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return undefined
  return { hour, minute }
}

function atClockOnDay(now: number, dayOffset: number, hour: number, minute: number): number {
  const d = new Date(now)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

function nextClock(now: number, hour: number, minute: number): number {
  const today = atClockOnDay(now, 0, hour, minute)
  if (today > now) return today
  return atClockOnDay(now, 1, hour, minute)
}

/**
 * Parse a "when" expression into a Schedule, or undefined when invalid.
 * `now` (epoch ms) resolves relative forms ("in", "at") into absolute times.
 */
export function parseWhen(input: string, now: number): Schedule | undefined {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ")
  if (text.length === 0) return undefined

  const [head, ...rest] = text.split(" ")
  const tail = rest.join(" ")

  if (head === "in") {
    const ms = parseDuration(tail)
    if (ms === undefined || ms <= 0) return undefined
    return { kind: "once", at: now + ms }
  }

  if (head === "every") {
    const ms = parseDuration(tail)
    if (ms === undefined || ms <= 0) return undefined
    return { kind: "every", intervalMs: ms }
  }

  if (head === "at") {
    const clock = parseClock(tail)
    if (clock === undefined) return undefined
    return { kind: "once", at: nextClock(now, clock.hour, clock.minute) }
  }

  if (head === "daily") {
    const clock = parseClock(tail)
    if (clock === undefined) return undefined
    return { kind: "daily", hour: clock.hour, minute: clock.minute }
  }

  if (Object.hasOwn(DOW, head as string)) {
    const clock = parseClock(tail)
    if (clock === undefined) return undefined
    return { kind: "dow", dow: DOW[head as string] as number, hour: clock.hour, minute: clock.minute }
  }

  return undefined
}

/**
 * Compute the next fire time (epoch ms) strictly after `now` for a schedule.
 * `last` is the previous fire time, used to space out "every" schedules.
 */
export function nextFire(schedule: Schedule, now: number, last?: number): number {
  if (schedule.kind === "once") {
    return schedule.at
  }

  if (schedule.kind === "every") {
    const base = last ?? now
    let next = base + schedule.intervalMs
    while (next <= now) next += schedule.intervalMs
    return next
  }

  if (schedule.kind === "daily") {
    return nextClock(now, schedule.hour, schedule.minute)
  }

  const currentDow = new Date(now).getDay()
  const delta = (schedule.dow - currentDow + 7) % 7
  const candidate = atClockOnDay(now, delta, schedule.hour, schedule.minute)
  if (candidate > now) return candidate
  return atClockOnDay(now, delta + 7, schedule.hour, schedule.minute)
}
