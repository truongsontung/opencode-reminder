# Hướng dẫn cài đặt & khởi động lần đầu (tiếng Việt)

Tài liệu này hướng dẫn **từng bước** thiết lập mailbox Gmail và khởi chạy
reminder từ con số 0. Đọc sau khi đã `bun install` xong dependency.

---

## MỤC LỤC

1. [Chuẩn bị Gmail App Password](#1-chuẩn-bị-gmail-app-password)
2. [Tạo & cấu hình config.json](#2-tạo--cấu-hình-configjson)
3. [Khởi động mailbox](#3-khởi-động-mailbox)
4. [Khởi tạo & dùng reminder](#4-khởi-tạo--dùng-reminder)
5. [Kiểm tra trạng thái & xử lý sự cố](#5-kiểm-tra-trạng-thái--xử-lý-sự-cố)

---

## 1. Chuẩn bị Gmail App Password

Plugin dùng IMAP (nhận) + SMTP (gửi) của Gmail, **không dùng được mật khẩu
thường**. Bạn cần một *App Password* (mật khẩu ứng dụng 16 ký tự).

1. Bật **Xác minh 2 bước** cho tài khoản Google:
   https://myaccount.google.com/security → «Bảo mật» → «Xác minh 2 bước».
2. Tạo App Password:
   https://myaccount.google.com/apppasswords
   - Tên ứng dụng: gõ tuỳ ý, ví dụ `opencode-reminders`.
   - Nhấn **Tạo** → Google trả về chuỗi 16 ký tự dạng `abcd efgh ijkl mnop`.
3. **Copy chuỗi đó lại** (bỏ dấu cách khi điền vào config cũng được, plugin
   chấp nhận cả hai).

> ⚠️ App Password chỉ hiển thị **một lần**. Mất thì phải thu hồi và tạo mới.

---

## 2. Tạo & cấu hình config.json

### 2.1. Vị trí file

Mailbox đọc config từ (mặc định trong code, biến `<MAIL_DIR>`):

```
<MAIL_DIR>/config.json
```

> `<MAIL_DIR>` mặc định là `/home/vps2/apps/mail-server` (được hardcode trong
> `src/mailbox.ts`). Nếu bạn đặt ở máy khác, hãy sửa hằng `BASE_DIR` trong
> `src/mailbox.ts` cho khớp, hoặc để nguyên và tạo thư mục tại đúng đường dẫn đó.

Thư mục `<MAIL_DIR>` và file `config.json` sẽ **tự động được tạo** khi bạn gọi
`reminder_mailbox_test` hoặc `reminder_mailbox_start` lần đầu — nhưng để chủ động,
hãy tạo thủ công:

```bash
mkdir -p <MAIL_DIR>
```

### 2.2. Nội dung config.json

Tạo file với nội dung sau (thay `you@gmail.com` và app password của bạn):

```json
{
  "gmail": {
    "email": "you@gmail.com",
    "app_password": "abcdefghijklmnop",
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

### 2.3. Ý nghĩa từng trường

**Khối `gmail`** — thông tin đăng nhập & server:

| Trường          | Giá trị mặc định      | Ghi chú                                         |
| --------------- | --------------------- | ----------------------------------------------- |
| `email`         | (bạn điền)            | Gmail gốc, ví dụ `you@gmail.com`.               |
| `app_password`  | (bạn điền)            | App Password 16 ký tự, **không phải** mật khẩu tài khoản. |
| `imap_host`     | `imap.gmail.com`      | Giữ nguyên.                                     |
| `imap_port`     | `993`                 | IMAP SSL.                                       |
| `smtp_host`     | `smtp.gmail.com`      | Giữ nguyên.                                     |
| `smtp_port`     | `587`                 | SMTP STARTTLS.                                  |

**Khối `checker`** — cách quét thư đến:

| Trường                | Giá trị            | Ghi chú                                                                 |
| --------------------- | ------------------ | ----------------------------------------------------------------------- |
| `interval_seconds`    | `30`               | Chu kỳ quét IMAP (giây). Nhỏ hơn = trễ thấp hơn, tốn tài nguyên hơn.    |
| `max_emails_per_check`| `50`               | Giới hạn số thư xử lý mỗi lần quét.                                      |
| `label`              | `""` (INBOX)       | Nếu để tên nhãn Gmail (vd `Reminders`), plugin chỉ quét nhãn đó thay vì INBOX. |
| `search_mode`        | `"to"`             | `"to"` = tìm theo địa chỉ `you+<code>@gmail.com`; `"label"` = quét cả nhãn; `"both"` = cả hai. |
| `initial_sync`       | `"skip_all"`       | Lần đầu chạy: `"skip_all"` bỏ qua hết thư cũ (chỉ đánh dấu đã đọc); `"last_n"` chỉ xử lý 10 thư mới nhất; `"process_all"` xử lý toàn bộ. |

> 💡 **Mẹo**: Nếu bạn muốn tách thư của từng session khỏi INBOX chính, hãy tạo
> nhãn Gmail (vd `AgentMail`) và đặt `label: "AgentMail"` + `search_mode: "label"`.
> Khi đó mỗi session vẫn có địa chỉ `you+<code>@gmail.com` riêng, nhưng thư phải
> được gắn nhãn đó mới được quét.

---

## 3. Khởi động mailbox

Plugin tự động khởi chạy mail checker khi load, nhưng **chỉ quét mailbox của
session đang active** (`_sid`). Quy trình đúng như sau:

### 3.1. Trong OpenCode (tại session bạn muốn gắn mailbox)

Gọi tool (agent tự chạy, hoặc bạn gõ lệnh tương ứng):

```
reminder_mailbox_start
```

Kết quả trả về chứa địa chỉ email duy nhất của session, ví dụ:

```json
{
  "status": "created",
  "session_id": "ses_abc123",
  "mailbox": "you+8f3a9c21@gmail.com",
  "code": "8f3a9c21",
  "gmail_label": "",
  "instructions": [
    "Mailbox created: you+8f3a9c21@gmail.com",
    "Checking INBOX",
    "Give this email to anyone who wants to send you mail",
    "Emails will be checked every 30 seconds",
    "New emails trigger !ev mail event in this session"
  ]
}
```

→ **Hãy copy địa chỉ `you+8f3a9c21@gmail.com` và đưa cho người muốn gửi mail.**

### 3.2. Kiểm tra kết nối

```
reminder_mailbox_test
```

Trả về:

```json
{ "email": "you@gmail.com", "configured": true }
```

Nếu `configured: false` → `config.json` chưa có `email`/`app_password` → xem lại
[mục 2](#2-tạo--cấu-hình-configjson).

### 3.3. Xem trạng thái

```
reminder_mailbox_status
```

Trả về tổng quan số mailbox, hoặc chi tiết 1 session nếu truyền `session_id`.

### 3.4. Tạm dừng / xoá

```
reminder_mailbox_stop        # tạm dừng nhận thư session hiện tại
reminder_mailbox_delete      # xoá vĩnh viễn mailbox + cache
```

### 3.5. Gửi thư đi

```
reminder_mailbox_send  to="friend@example.com"  subject="Xin chào"  body="Nội dung..."
```

---

## 4. Khởi tạo & dùng reminder

Reminder **tự động chạy** ngay khi bạn add cái đầu tiên (không cần start tay).
Nhưng nếu muốn chắc chắn:

```
reminder_start
```

### 4.1. Thêm nhắc

| Lệnh (when)                  | Ý nghĩa                              |
| ---------------------------- | ------------------------------------ |
| `reminder_add when="in 30m" label="Check build"` | Sau 30 phút.                  |
| `reminder_add when="14:30" label="Stand up"`      | Lúc 14:30 hôm nay/tới.        |
| `reminder_add when="daily 09:00" label="Morning"` | Mỗi ngày 09:00.              |
| `reminder_add when="mon 10:30" label="Weekly"`    | Mỗi thứ 2 10:30.             |
| `reminder_add when="every 15m" label="Ping"`      | Mỗi 15 phút (tối thiểu 1p).  |

Có thể giữ nguyên id để update:

```
reminder_add when="daily 09:00" label="Morning" id="r-7"
```

### 4.2. Khi nhắc đến hạn

Session nhận prompt:

```
!ev remind: reminder r-1 Check build @2026-07-20 ... — gọi reminder_done
```

→ Agent (hoặc bạn) gọi:

```
reminder_done id="r-1"
```

- **One-time** (`in ...` / `HH:MM`): xoá luôn.
- **Repeat** (`daily`/`weekly`/`every`): tự sang kỳ kế tiếp, không xoá.

Nếu **quên không gọi `reminder_done`**, plugin tự động nhắc lại mỗi 3 phút
(`!ev resum: ...`) cho tới khi bạn xác nhận.

### 4.3. Quản lý

```
reminder_list        # liệt kê, kèm trạng thái ⏰/🔔
reminder_del id="r-1"  # xoá hẳn
reminder_verbose on    # bật log debug mỗi chu kỳ (để theo dõi)
```

---

## 5. Kiểm tra trạng thái & xử lý sự cố

### 5.1. File heartbeat (sức khoẻ mailbox)

Plugin ghi `<MAIL_DIR>/mail_heartbeat.json` mỗi chu kỳ:

```json
{ "status": "running", "last_ping": "2026-07-20T...Z", "session_id": "ses_abc123" }
```

- `running` → đang quét tốt.
- `idle` → không có mailbox active nào khớp session hiện tại.
- `error` → lỗi kết nối IMAP/SMTP (thường do App Password sai).

Bạn có thể theo dõi realtime bằng `life_monitor.py` (phần MAIL CHECKER).

### 5.2. File dữ liệu reminder

Mỗi session lưu tại:

```
~/.local/share/opencode-reminders/<sid>.reminder.json
```

Nếu session tắt rồi mở lại, plugin tự load file này và **tiếp tục bơm** các nhắc
còn dang dở — không mất, không tạo lại.

### 5.3. Lỗi thường gặp

| Triệu chứng                              | Nguyên nhân & cách fix                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `configured: false`                      | Thiếu `email`/`app_password` trong `config.json` → điền lại (mục 2).       |
| Mail đến nhưng không inject vào session  | Session tạo mailbox khác `_sid` hiện tại, hoặc `reminder_mailbox_stop` đã chạy. Gọi `reminder_mailbox_status`. |
| Thư cũ bị đẩy lại sau restart            | Đặt `initial_sync: "skip_all"` (mặc định) để bỏ qua thư cũ lần đầu.         |
| `reminder_add` báo "định dạng không hợp lệ" | Sai cú pháp `when`. Xem bảng mục 4.1.                                  |
| Reminder OVERDUE giả ở session đã tắt    | Session tắt → file đứng yên. Chỉ báo động ở session alive (theo thiết kế).  |

---

## Tóm tắt quy trình lần đầu

```bash
# 1. Dependency
bun install

# 2. Tạo config Gmail (mục 2)
mkdir -p <MAIL_DIR>
#    → viết config.json với email + app_password

# 3. Trong OpenCode session:
reminder_mailbox_test        # verify config
reminder_mailbox_start       # tạo mailbox, lấy địa chỉ you+code@gmail.com
reminder_start               # chắc chắn reminder loop chạy
reminder_add when="in 5m" label="Test nhắc"   # thử thêm 1 nhắc

# 4. Theo dõi
python3 ~/life_monitor.py    # xem MAIL CHECKER + REMINDERS BY SESSION
```
