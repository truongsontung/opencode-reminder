# Native design notes

This prototype is intentionally shaped so it can be ported into opencode core with
minimal reshaping. This document maps the prototype onto the conventions used inside
`packages/opencode`.

## Where it would live

- `packages/opencode/src/tool/reminder.ts` — tool definitions.
- `packages/opencode/src/tool/reminder.txt` — tool descriptions (core keeps prose in
  sibling `.txt` files rather than inline strings).
- `packages/opencode/src/reminder/` — the reminder service (store, scheduler, firing).

## Conventions to adopt on port

- **Tools use `Tool.define(id, Effect.gen(...))` with Effect + Schema**, not the plugin
  `tool()` helper and not zod. The prototype's zod args map directly onto `Schema`
  fields; the plain async `execute` bodies map onto `Effect.gen`.
- **Descriptions move to `.txt`** and are imported, matching `todo.ts` / other core
  tools.
- **Persistence uses the core storage/Drizzle layer** (snake_case columns) instead of a
  JSON file. Table sketch:
  - `reminder(id, text, schedule_json, next_at, session_id, agent, created_at,
    last_fired, done)`.
- **Scheduling** is a `Service` with dependency injection, started from the app
  lifecycle, rather than a raw `setInterval` inside the plugin. `dispose` becomes the
  service teardown.
- **Style rules**: no `let`/`else`/`try-catch`/`any`, no alias or star imports, Bun APIs
  for I/O. The prototype already follows these (early returns instead of `else`,
  `.catch(() => {})` instead of `try/catch`, explicit `.ts` imports).

## The one design decision that matters

When a reminder fires it must be injected into the session with the **agent that owns
that session**, captured dynamically. The prototype records `ToolContext.agent` at
creation and passes it back through `session.promptAsync({ body: { agent } })`. This is
deliberately NOT a hardcoded agent name — hardcoding an agent (e.g. always "manager" or
always "build") is a real bug that silently switches a user's session to the wrong
agent. Core port must preserve this dynamic-agent behavior.

## Pure core, thin shell

`when.ts` (parsing/next-fire math) and `store.ts` (due detection, advance, formatting)
are pure and fully unit-tested with an injected `now`. Only `index.ts` touches I/O and
the opencode client. This split is what makes the logic portable and testable in either
environment.
