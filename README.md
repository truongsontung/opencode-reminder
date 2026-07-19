# opencode-reminders

Personal reminders for [opencode](https://github.com/anomalyco/opencode). Schedule a
note and it wakes your session when it is due — the reminder is injected as a message
into the exact session that created it.

## Install

Thêm plugin vào opencode config (file `.ts` được load trực tiếp):

```json
{
  "plugin": ["/home/vps2/opencode-reminders/src/index.ts"]
}
```

Hoặc copy vào thư mục plugins và dùng tên:

```sh
cp /home/vps2/opencode-reminders/src/index.ts ~/.config/opencode/plugins/reminder.ts
```

```json
{
  "plugin": ["reminder"]
}
```

## Tools

| Tool              | Purpose                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `reminder_add`    | Tạo nhắc (`when` + `label`).                                               |
| `reminder_list`   | Liệt kê nhắc. Trạng thái: ⏰ upcoming, 🔔 due (chờ done).                 |
| `reminder_done`   | Xác nhận done. One-time → xóa; lặp → kỳ kế.                              |
| `reminder_del`    | Xóa nhắc vĩnh viễn.                                                        |
| `reminder_start`  | Khởi chạy clock tick (60s) + nag (3ph).                                     |
| `reminder_verbose`| Bật/tắt log debug mỗi chu kỳ (`on`/`off`).                                 |

## Cách dùng (agent)

Khi user nói "nhắc tôi…", "đặt báo…", "nhắc sau N phút/giờ/ngày", gọi `reminder_add`.

- `reminder_add when="in 30m" label="nghỉ ngơi"` — nhắc sau 30 phút
- `reminder_add when="daily 09:00" label="đọc báo"` — mỗi ngày 09:00
- `reminder_add when="every 2h" label="uống nước"` — lặp mỗi 2 giờ
- `reminder_add when="mon 09:00" label="họp"` — mỗi thứ 2 09:00
- `reminder_list` — liệt kê nhắc
- `reminder_start` — bật clock
- `reminder_done <id>` / `reminder_del <id>` — dừng / xóa

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

Đơn vị: `m` (phút), `h` (giờ). Chu kỳ lặp tối thiểu 1 phút.

## Cơ chế hai luồng: Tick (remind) + Nag (resum)

Hệ thống chạy song song 2 luồng quét:

### Tick — nhắc lần đầu (60s)

```
60s quét → tìm reminder đến hạn → push !ev remind 1 lần
  ├─ thành công → due=true, dueAt=now → chuyển sang nag
  └─ thất bại  → bỏ qua, tick sau tự retry
```

### Nag — nhắc lại khi quá hạn (3ph)

```
3ph quét → tìm reminder due=true → push !ev resum 1 lần
  ├─ thành công → giữ due=true, nag tiếp sau 3ph
  └─ thất bại  → bỏ qua, nag sau tự retry
```

### Flow hoàn chỉnh

```
[nextAt reached]
  → Tick: due=true, dueAt=nextAt → push "!ev remind: ..."
  → Nag bắt đầu: mỗi 3ph push "!ev resum: ..."
  → Lặp đến khi user gọi reminder_done

[reminder_done]
  → repeat=none (in/at) → xóa reminder
  → repeat=other (every/daily/weekly) → nextAt=nextOccurrence, due=false, dueAt=undefined
```

### Định dạng thông điệp

| Loại    | Format                                                              |
| ------- | ------------------------------------------------------------------- |
| remind  | `!ev remind: reminder <id> <label> @<time> — gọi reminder_done`    |
| resum   | `!ev resum: reminder <id> <label> @<time> (trễ Xm) — gọi reminder_done` |

Giờ hiển thị theo múi giờ thực tế của hệ thống (`Intl.DateTimeFormat`).

## Persist & resume

Mỗi session lưu riêng 1 file:

```
~/.local/share/opencode-reminders/<sessionID>.reminder.json
```

JSON fields: `{id, label, nextAt, repeat, hour, minute, dow?, intervalMs?, due?, dueAt?, lastNagAt?}`

- Clock ghi file mỗi chu kỳ → session tắt rồi mở lại, nhắc tiếp tục (resume).
- Nag timer tự động chạy khi load reminder có due=true.

## Develop

```sh
bun install
bun test
bun run typecheck   # tsc --noEmit
```
