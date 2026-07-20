# opencode-reminders

> **Give your agent a life of its own.**
> An autonomous memory + circadian system for [OpenCode](https://opencode.ai) —
> so your agent doesn't just wait to be told what to do. It remembers, it shows
> up on time, it reads its mail, and it keeps working whether you're watching or not.

## Why this exists

Most AI agents are **amnesiac interns**: brilliant while you watch, useless the
moment you look away. Close the terminal and they forget every commitment.
Reopen it and they start from zero, blank-eyed, waiting for orders.

`opencode-reminders` changes that. It gives the agent something close to a
**lifecycle** — a sense of time, obligation, and continuity:

- ⏰ **It remembers what it promised.** A reminder isn't a note you set — it's a
  commitment the agent made to *itself*, persisted to disk and bound to the exact
  session that owns it.
- 🌅 **It has a routine.** Daily stand-ups, weekly syncs, "ping me every 15
  minutes" — the agent builds a rhythm, like a working professional.
- 🔔 **It wakes itself up.** When a reminder is due, it's pushed *into* the
  session as a prompt — no cron, no OS ties, no human in the loop. Due but you
  didn't ack? It nudges itself every 3 minutes until the job is done.
- 📬 **It reads and answers its mail.** A private Gmail mailbox per session means
  the outside world can reach the agent directly — and it can reply.
- 🔁 **It survives.** Detach the session, lose the SSH connection, reboot the
  machine — reminders are reloaded on restart and resume firing. The agent picks
  up its life where it left off.

In short: this plugin turns a reactive chatbot into a **persistent, scheduled,
self-driven worker** — one that shows up, does the recurring task, and never
drops a commitment just because you stopped staring at the screen.

---

## ✨ Features

- **Session-scoped reminders** — each reminder is bound to the session that
  created it and wakes *that* session (never a neighbour).
- **Fire-and-forget scheduling** — relative, absolute, daily, weekly and
  interval schedules via a tiny natural-language `when` parser.
- **Resilient delivery** — a tick loop (60 s) pushes due reminders; a nag loop
  (3 min) re-pushes overdue ones until acknowledged with `reminder_done`.
- **Persistence** — reminders are saved to `<session>.reminder.json` on every
  state change, so they survive session restarts and resume automatically.
- **Per-session mailbox** — Gmail *plus addressing* (`you+<code>@gmail.com`)
  gives every session a unique address. IMAP polling injects new mail as a
  `!ev mail:` prompt into the active session.
- **Outbound mail** — send email straight from the session mailbox via SMTP.
- **Live monitor friendly** — a heartbeat file and `life_monitor.py` surface
  reminder state, overdue alerts, and mailbox health on an 80-column TUI.

---

## 📦 Installation

```bash
git clone <repo-url> opencode-reminders
cd opencode-reminders
bun install        # or: npm install
```

The plugin entry point is `src/index.ts` (declared in `package.json` → `exports`).

```json
{
  "plugins": {
    "opencode-reminders": {
      "path": "<path-to>/opencode-reminders"
    }
  }
}
```

---

## ⚙️ Configuration

The plugin reads two optional environment variables:

| Variable                   | Default                                  | Description                                  |
| -------------------------- | ---------------------------------------- | -------------------------------------------- |
| `OPENCODE_REMINDERS_DIR`   | `~/.local/share/opencode-reminders`      | Directory for `<sid>.reminder.json` storage. |
| `OPENCODE_REMINDERS_TICK_MS` | `60000`                               | Tick interval in milliseconds (min `>0`).    |

Mailbox settings live in `<MAIL_DIR>/config.json` (default `<MAIL_DIR>` is
`~/.opencode/mail-server`, or set env `OPENCODE_MAIL_DIR`; auto-created with
defaults on first run):

```json
{
  "gmail": {
    "email": "you@gmail.com",
    "app_password": "xxxx xxxx xxxx xxxx",
    "imap_host": "imap.gmail.com",
    "imap_port": 993,
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 587
  },
  "checker": {
    "interval_seconds": 30,
    "max_emails_per_check": 50,
    "label": "",
    "search_mode": "to",
    "initial_sync": "skip_all"
  }
}
```

> `app_password` is a Gmail **App Password**, not your account password.
> The checker only processes the mailbox that belongs to the currently active
> session, so a stale/foreign session is never pushed into.

---

## 🛠️ Tools

All tools are exposed to the agent under the `reminder_*` namespace.

### Reminders

| Tool                  | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| `reminder_add`        | Add/update a reminder. `when`: `HH:MM` · `in <N>m\|h\|s` · `daily HH:MM` · `<dow> HH:MM` · `every <N>m\|h`. Optional `id` to update in place. |
| `reminder_list`       | List all reminders with state (`⏰ idle`, `🔔 due`, `🔔 overdue`).          |
| `reminder_done`       | Acknowledge. One-time → deleted; repeating → advanced to next occurrence.   |
| `reminder_del`        | Delete a reminder permanently.                                              |
| `reminder_start`      | Start the tick + nag loops if not already running.                          |
| `reminder_verbose`    | Toggle per-cycle debug logging (`on`/`off`).                                |

**Examples**

```
reminder_add  label="Stand up"  when="daily 09:00"
reminder_add  label="Check build"  when="in 30m"
reminder_add  label="Weekly sync"  when="mon 10:30"
reminder_add  label="Ping me"  when="every 15m"
reminder_add  label="Fix later"  when="14:30"  id="r-7"
reminder_done id="r-7"
```

When a reminder fires, the session receives:

```
!ev remind: reminder <id> <label> @<time> — gọi reminder_done
```

Repeating reminders that were not acknowledged are re-pushed every 3 minutes
with `!ev resum: ...` until `reminder_done` is called.

### Mailbox

| Tool                       | Description                                                  |
| -------------------------- | ------------------------------------------------------------ |
| `reminder_mailbox_start`   | Create/reactivate a mailbox for the current session. Returns the `you+<code>@gmail.com` address. |
| `reminder_mailbox_stop`    | Pause receiving mail for the current session.                |
| `reminder_mailbox_delete`  | Delete the session mailbox (and its cache) permanently.      |
| `reminder_mailbox_status`  | Show mailbox status / stats.                                 |
| `reminder_mailbox_send`    | Send email from the session mailbox (`to`, `subject`, `body`).|
| `reminder_mailbox_test`    | Verify Gmail SMTP/IMAP credentials are configured.           |

Incoming mail is injected as:

```
!ev mail:From: <from>
To: <to>
Subject: <subject>
Date: <date>

<body>
```

---

## 🧠 Architecture

```
src/
├── index.ts     # Plugin entry: tools, tick/nag loops, lifecycle, persistence
├── when.ts      # Pure "when" expression parser + next-fire calculator
├── store.ts     # Reminder model, due/advance/describe helpers, id generator
└── mailbox.ts   # Gmail mailbox mgmt + IMAP polling + SMTP send + heartbeat
```

### State machine

```
        ┌─────────┐   now ≥ nextAt   ┌──────┐   push ok   ┌──────────┐
        │  idle   │ ───────────────► │ due  │ ───────────► │ overdue  │
        └─────────┘                  └──────┘             └──────────┘
                                          │ push fails            │
                                          └──── retry next tick ──┘
                                                               │
                                            reminder_done      │
                                          ┌────────────────────┘
                                          ▼
                                   one-time → deleted
                                   repeat  → next occurrence (idle)
```

- **tick()** runs every `TICK_MS`, flips `idle → due`, pushes due reminders,
  and persists state. On push failure the reminder stays `due` and is retried
  on the next tick.
- **nag()** runs every 3 minutes and re-pushes anything still `overdue`.
- **Persistence** — `<sid>.reminder.json` is rewritten on every transition, so
  a session restart reloads reminders and (if any remain) restarts the loops.

### `when` grammar

| Input              | Meaning                                  |
| ------------------ | ---------------------------------------- |
| `in 30m` / `in 2h` | Once, `now + duration`.                  |
| `14:30`            | Once, next occurrence of that clock time.|
| `daily 09:00`      | Every day at 09:00.                      |
| `mon 10:30`        | Every Monday at 10:30.                   |
| `every 15m`        | Repeating interval (min 1 minute).       |

Durations support `s`, `m`, `h`, `d` and may be combined (`in 1h30m`).

---

## 🧪 Development

```bash
bun install          # install deps
bun test             # run unit + integration tests
npm run typecheck    # tsc --noEmit
```

The `when` parser and store helpers are **pure** (they take an explicit `now`
in epoch ms), so they are fully deterministic and unit-testable without a real
clock — see `test/when.test.ts` and `test/store.test.ts`.

---

## 🚀 Getting Started (first-run guide)

New to the plugin? Read **[SETUP.md](./SETUP.md)** for a step-by-step
Vietnamese walkthrough: creating `config.json`, generating a Gmail App
Password, starting the mailbox, and initializing your first reminders.

Quick start:

```bash
bun install
mkdir -p <MAIL_DIR>   # write config.json with gmail credentials (default: ~/.opencode/mail-server)
# In OpenCode:
reminder_mailbox_test      # verify config
reminder_mailbox_start     # create mailbox → you+<code>@gmail.com
reminder_add when="in 5m" label="Test"   # first reminder auto-starts the loop
```

---

## 📄 License

MIT
