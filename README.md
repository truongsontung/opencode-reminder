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

### Reminder Tools

| Tool              | Purpose                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `reminder_add`    | Tạo nhắc (`when` + `label`).                                               |
| `reminder_list`   | Liệt kê nhắc. Trạng thái: ⏰ idle, 🔔 due, 🔔 overdue.                    |
| `reminder_done`   | Xác nhận done. One-time → xóa; lặp → kỳ kế.                              |
| `reminder_del`    | Xóa nhắc vĩnh viễn.                                                        |
| `reminder_start`  | Khởi chạy clock tick (60s) + nag (3ph).                                     |
| `reminder_verbose`| Bật/tắt log debug (`on`/`off`).                                            |

### Mailbox Tools

| Tool                     | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `reminder_mailbox_start` | Tạo mailbox cho session, trả địa chỉ email.   |
| `reminder_mailbox_stop`  | Tạm dừng nhận email.                           |
| `reminder_mailbox_delete`| Xoá mailbox vĩnh viễn.                        |
| `reminder_mailbox_status`| Xem trạng thái mailbox.                        |
| `reminder_mailbox_send`  | Gửi email từ mailbox.                         |
| `reminder_mailbox_test`  | Test kết nối Gmail SMTP/IMAP.                 |

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

## Mailbox Feature

Mailbox cho phép session nhận email từ bên ngoài. Plugin tự poll Gmail IMAP và inject
`!ev mail:` event vào session khi có email mới.

### Setup

1. Tạo Gmail App Password tại [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)

2. Cấu hình `/home/vps2/apps/mail-server/config.json`:

```json
{
  "gmail": {
    "email": "your-email@gmail.com",
    "app_password": "xxxx xxxx xxxx xxxx",
    "imap_host": "imap.gmail.com",
    "imap_port": 993,
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 587
  },
  "checker": {
    "interval_seconds": 30,
    "max_emails_per_check": 50
  }
}
```

### Tạo Mailbox

```bash
# Tạo mailbox check INBOX
reminder_mailbox_start --session ses_xxx --name "My Mail"

# Tạo mailbox check label cụ thể
reminder_mailbox_start --session ses_xxx --name "GitHub" --gmail_label "GitHub"
```

Kết quả:
```json
{
  "status": "created",
  "session_id": "ses_xxx",
  "mailbox": "your-email+abc123@gmail.com",
  "gmail_label": "GitHub"
}
```

### Mailbox per Session

Mỗi session có thể có label Gmail riêng:

```bash
# Session 1: check label "GitHub"
reminder_mailbox_start --session ses_001 --name "GitHub" --gmail_label "GitHub"

# Session 2: check label "Bounty"
reminder_mailbox_start --session ses_002 --name "Bounty" --gmail_label "Bounty"
```

### Workflow

```
1. Session tạo mailbox → nhận địa chỉ email
2. Mail checker poll IMAP mỗi 30s
3. Email mới đến → inject !ev mail: event vào session
4. Session nhận event, xử lý email
```

### Event Format

```bash
!ev mail:From: sender@example.com
To: your-email+abc123@gmail.com
Subject: New bounty available
Date: Mon, 20 Jul 2026 10:00:00 +0700

[Email body content here...]
```

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
