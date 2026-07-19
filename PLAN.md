# Plan: Simplify Reminder Plugin — Fire-Once-Per-Cycle

## Problem

The current `tick()` in `src/index.ts` is overly complex:
- `BATCH_WINDOW_MS` batches "near" reminders into a single push → spam when agent is busy
- `REMIND_INTERVAL_MS` throttle creates confusing retry logic
- `pendingBatch[]` accumulates multiple pushes → multi-line spam
- Failed pushes are retried silently in the same tick, causing state confusion

## New Design

**Single principle: 60s tick → scan all → push each due reminder ONCE → done.**

### State Machine

```
[nextAt reached] → push ONCE
  ├── success → due=true, dueAt=now  (waiting for reminder_done)
  └── fail    → skip (next 60s cycle retries)
  
[due=true, reminder_done called]
  ├── repeat=none  → delete
  └── repeat=other → nextAt=nextOccurrence, due=false

[due=true, next tick] → push ONCE again (nagging until done)
```

### Changes to `src/index.ts`

#### Remove
- `BATCH_WINDOW_MS` constant
- `REMIND_INTERVAL_MS` constant
- `pendingBatch` array
- The `near[]` collection logic in `tick()`
- The batching loop that pushes multiple reminders in one message

#### Rewrite `tick()`
```
async function tick():
  now = Date.now()
  for each reminder:
    if due=true:
      → push text "reminder {id} {label} ... (trên {late}m) — gọi reminder_done"
      → if push ok: keep due=true (already set)
      → if push fail: skip (no retry, no state change)
    else if now >= nextAt:
      → push text "reminder {id} {label} @{time}"
      → if push ok: set due=true, dueAt=now
      → if push fail: skip (next cycle retries naturally)
    else:
      → skip (not yet time)
  saveReminders()
```

Key points:
- Each reminder is pushed individually (no batching)
- Push is fire-once: one push attempt per cycle per reminder
- No `lastRemindAt` throttle — the 60s tick IS the throttle
- Verbose logging stays but simplified

#### Keep unchanged
- `parseWhen()` — parsing logic is correct
- `nextOccurrence()` — scheduling logic is correct
- `reminder_add` tool — no changes needed
- `reminder_list` tool — no changes needed
- `reminder_done` tool — no changes needed
- `reminder_del` tool — no changes needed
- `reminder_verbose` tool — no changes needed
- `reminder_start` tool — no changes needed
- `saveReminders()` / `loadReminders()` — no changes needed
- `Reminder` interface — remove `lastRemindAt` field
- Plugin lifecycle (event, dispose) — no changes needed

### Changes to Tests

Tests that depend on the old behavior need updating:
- `integration.test.ts`: Tests reference `outbox` behavior, retry logic, and `BATCH_WINDOW_MS` — update to reflect fire-once semantics
- `dbg.test.ts`: Event spam test — should still pass (no state wipe)

## Files to Modify

1. **`src/index.ts`** — Main rewrite of `tick()`, remove `pendingBatch`, `BATCH_WINDOW_MS`, `REMIND_INTERVAL_MS`, `lastRemindAt`
2. **`test/integration.test.ts`** — Update tests for new semantics

## Verification

1. Run `bun test` to confirm all tests pass
2. Manual verification: create reminder with `in 2m`, wait, confirm single push
