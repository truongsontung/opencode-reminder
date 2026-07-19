# opencode-reminders

Personal reminders for [opencode](https://github.com/anomalyco/opencode). Schedule a
note and it wakes your session when it is due — the reminder is injected as a message
into the exact session that created it.

## Install

```json
{
  "plugin": ["/home/vps2/opencode-reminders/src/index.ts"]
}
```

## Tools

| Tool              | Purpose                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `reminder_add`    | Tạo nhắc (`when` + `label`).                                               |
| `reminder_list`   | Liệt kê nhắc. Trạng thái: ⏰ idle, 🔔 due, 🔔 overdue.                    |
| `reminder_done`   | Xác nhận done. One-time → xóa; lặp → kỳ kế.                              |
| `reminder_del`    | Xóa nhắc vĩnh viễn.                                                        |
| `reminder_start`  | Khởi chạy clock tick (60s) + nag (3ph).                                     |
| `reminder_verbose`| Bật/tắt log debug (`on`/`off`).                                            |

## `when` syntax

| Form          | Ý nghĩa                         | Lặp  |
| ------------- | ------------------------------- | ---- |
| `in 2m`       | 2 phút nữa                      | không|
| `in 1h`       | 1 giờ nữa                       | không|
| `14:30`       | lần tới 14:30                   | không|
| `daily 09:00` | mỗi ngày 09:00                  | có   |
| `mon 09:00`   | mỗi thứ 2 09:00                 | có   |
| `every 90m`   | mỗi 90 phút                     | có   |
| `every 2h`    | mỗi 2 giờ                       | có   |

## State machine: idle → due → overdue

```
idle  ──[scheduler: now >= nextAt]──> due
due   ──[tick: push remind OK]──> overdue
due   ──[tick: push remind FAIL]──> due (tick sau retry)
overdue ──[nag: push resum]──> overdue (giữ đến khi done)
any   ──[reminder_done]──> idle (repeat) hoặc xóa (none)
```

### Components

| Component | Nhiệm vụ | Dùng gì |
|-----------|----------|---------|
| **scheduler** | Chuyển idle → due khi đến hạn | Chỉ đọc `nextAt` |
| **tick** (60s) | Push remind khi state = due | Chỉ đọc `state` |
| **nag** (3ph) | Push resum khi state = overdue | Chỉ đọc `state` |

`nextAt` chỉ là data trong JSON — **không dùng để quyết định push**.

### Định dạng thông điệp

| Loại    | Format                                                          |
| ------- | --------------------------------------------------------------- |
| remind  | `!ev remind: reminder <id> <label> @<time> — gọi reminder_done`|
| resum   | `!ev resum: reminder <id> <label> @<time> (trễ Xm) — gọi reminder_done`|

## Persist

```
~/.local/share/opencode-reminders/<sessionID>.reminder.json
```

Override: `OPENCODE_REMINDERS_DIR=/path/to/dir`

Fields: `{id, label, nextAt, repeat, hour, minute, dow?, intervalMs?, state}`

## Develop

```sh
bun install
bun test
```
