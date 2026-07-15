# opencode-reminders

Bộ nhắc việc tự động lịch nhắc định kì: tích hợp plugin opencode, tạo lịch tự động nhắc việc trực tiếp vào inline prompt opencode, duy trình quá trình hoạt động độc lập của agent.

## Install

Add the plugin to your opencode config:

```json
{
  "plugin": ["opencode-reminders"]
}
```

Or point at a local checkout during development:

```json
{
  "plugin": ["/home/vps2/opencode-reminders/src/index.ts"]
}
```

## Tools

| Tool            | Purpose                                             |
| --------------- | --------------------------------------------------- |
| `reminder_add`  | Create a reminder (`when` + `text`).                |
| `reminder_list` | List reminders (`all: true` to include completed).  |
| `reminder_done` | Mark a reminder done so it stops firing.            |
| `reminder_del`  | Delete a reminder permanently.                      |

## Agent usage

When the user says "nhắc tôi…", "đặt báo…", "nhắc sau N phút/giờ/ngày", call
`reminder_add` — **do NOT read this plugin's source to figure it out**.

- `reminder_add when="in 30m" text="nghỉ ngơi"` — remind in 30 minutes
- `reminder_add when="daily 09:00" text="đọc báo"` — every day at 09:00
- `reminder_add when="every 2h" text="uống nước"` — repeat every 2 hours
- `reminder_list` — list this session's reminders
- `reminder_done <id>` / `reminder_del <id>` — stop / delete

On due time the plugin injects `⏰ Reminder: <text>` into the session and auto-stops
(repeating ones advance to the next occurrence). Distinct from the scheduler `cal_*`
tools (personal calendar tied to tasks, re-nags every 5m until `cal_done`/`cal_del`).

## `when` syntax

| Form           | Meaning                          | Repeats |
| -------------- | -------------------------------- | ------- |
| `in 2m`        | 2 minutes from now               | no      |
| `in 1h30m`     | 1 hour 30 minutes from now       | no      |
| `at 14:30`     | next time the clock hits 14:30   | no      |
| `daily 09:00`  | every day at 09:00               | yes     |
| `mon 09:00`    | every Monday at 09:00            | yes     |
| `every 10m`    | every 10 minutes                 | yes     |

Duration units: `s`, `m`, `h`, `d` (combinable, e.g. `2h30m`).

## How firing works

A background timer checks due reminders every 15 seconds. When one fires, it calls
`session.promptAsync` against the **originating session** using the **agent captured at
creation time** (`ToolContext.agent`) — never a hardcoded agent. Repeating reminders are
rescheduled; one-shot reminders are marked done.

Reminders persist to `~/.local/share/opencode-reminders/reminders.json`.

## Develop

```sh
bun install
bun test
bun run typecheck
```
