# Feature request draft (Issue-First)

opencode follows an **Issue-First** process: open a Feature Request issue and wait for
core-team approval BEFORE opening a PR. This file is the draft to paste into that issue.
Do not open a PR until a maintainer approves the issue.

---

**Title**: Feature: personal reminders that wake a session when due

**Problem**

There is no built-in way to ask opencode to remind you about something later. Users
resort to external timers or leave notes that opencode never surfaces. During long tasks
it is useful to say "remind me in 30m to check the deploy" and have that reminder appear
back in the same conversation.

**Proposal**

Add a small reminders feature with four tools:

- `reminder_add(when, text)`
- `reminder_list(all?)`
- `reminder_done(id)`
- `reminder_del(id)`

`when` accepts human forms: `in 2m`, `in 1h30m`, `at 14:30`, `daily 09:00`, `mon 09:00`,
`every 10m`.

When a reminder is due, it is injected into the originating session as a message, handled
by the **agent that owns that session** (captured at creation, not hardcoded). Repeating
reminders reschedule; one-shot reminders complete.

**Prototype**

A working plugin prototype exists (parser + store are pure and unit-tested, 20 tests):
`opencode-reminders`. It validates the `when` syntax, the persistence model, and the
dynamic-agent injection path via `session.promptAsync`.

**Proposed native shape** (see `docs/NATIVE_DESIGN.md`)

- `src/tool/reminder.ts` + `reminder.txt`, using `Tool.define` + Effect + Schema.
- `src/reminder/` service (store + scheduler) with DI; started from app lifecycle.
- Drizzle-backed persistence (snake_case), replacing the prototype's JSON file.

**Open questions for maintainers**

1. Should reminders be per-project or global?
2. Is `session.promptAsync` injection the desired delivery, or a toast / notification?
3. Preferred timezone handling for clock-based schedules?

**Out of scope**

Cron expressions, natural-language dates ("next Tuesday"), and notification integrations
— can follow later if the core is accepted.
