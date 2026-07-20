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

Tất cả mailbox tools dùng `_sid` hiện tại (session đang active), không cần truyền session_id.

| Tool                     | Purpose                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `reminder_mailbox_start` | Tạo mailbox cho session hiện tại, trả địa chỉ email (Gmail plus addressing).|
| `reminder_mailbox_stop`  | Tạm dừng nhận email cho session hiện tại.                                   |
| `reminder_mailbox_delete`| Xoá mailbox + cache vĩnh viễn.                                             |
| `reminder_mailbox_status`| Xem trạng thái mailbox session hiện tại.                                    |
| `reminder_mailbox_send`  | Gửi email từ mailbox session hiện tại.                                      |
| `reminder_mailbox_test`  | Test kết nối Gmail SMTP/IMAP.                                              |

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
    "max_emails_per_check": 50,
    "label": "GitHub",
    "search_mode": "label",
    "initial_sync": "skip_all"
  }
}
```

### Tạo Mailbox

```bash
# Tạo mailbox (dùng _sid hiện tại, không cần truyền session_id)
reminder_mailbox_start --name "GitHub" --gmail_label "GitHub"
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

Mỗi session có thể có label Gmail riêng. Session ID tự động lấy từ `_sid` hiện tại:

```bash
# Session A: check label "GitHub" (chạy trong session A)
reminder_mailbox_start --name "GitHub" --gmail_label "GitHub"

# Session B: check label "Bounty" (chạy trong session B)
reminder_mailbox_start --name "Bounty" --gmail_label "Bounty"
```

### Workflow

```
1. Session tạo mailbox → nhận địa chỉ email (Gmail plus addressing)
2. Mail checker poll IMAP mỗi 30s, chỉ xử lý mailbox khớp _sid hiện tại
3. Email mới đến (SAU thời điểm tạo mailbox) → inject !ev mail: event vào session
4. Session nhận event, xử lý email
```

### Initial Sync

Khi tạo mailbox lần đầu, `initial_sync: "skip_all"` sẽ đánh dấu toàn bộ email
hiện có trong label là "đã xử lý" mà không push. Chỉ email MỚI (sau thời điểm
tạo) mới được push. Sau restart, SINCE filter (dựa trên `last_check`) chỉ lấy
email mới — không bao giờ push lại email cũ.

Post-filter kiểm tra header `Date` của mail so với `last_check` timestamp để
đảm bảo chính xác đến giờ (IMAP SINCE chỉ lọc theo ngày).

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
