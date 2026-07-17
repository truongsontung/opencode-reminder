# opencode-reminders

Personal reminders for [opencode](https://github.com/anomalyco/opencode). Schedule a
note and it wakes your session when it is due — the reminder is injected as a message
into the exact session that created it.

Plugin này được viết lại dựa trên cấu trúc `agent-teamwork-scheduler` (bỏ phần worker,
chỉ giữ lịch nhắc), nên cơ chế hoạt động và format nhắc y hệt scheduler.

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

| Tool              | Purpose                                                      |
| ----------------- | ------------------------------------------------------------ |
| `reminder_add`    | Tạo nhắc (`when` + `label`).                                |
| `reminder_list`   | Liệt kê nhắc (trạng thái: upcoming / chờ xác nhận).         |
| `reminder_done`   | Xác nhận xong (one-time → xóa; lặp → dời kỳ kế).            |
| `reminder_del`    | Xóa nhắc vĩnh viễn.                                         |
| `reminder_start`  | Khởi chạy clock nhắc nếu chưa chạy.                         |
| `reminder_verbose`| Bật/tắt log debug mỗi phút (`on`/`off`).                   |

## Cách dùng (agent)

Khi user nói "nhắc tôi…", "đặt báo…", "nhắc sau N phút/giờ/ngày", gọi `reminder_add`
— **không đọc source plugin để đoán**.

- `reminder_add when="in 30m" label="nghỉ ngơi"` — nhắc sau 30 phút
- `reminder_add when="daily 09:00" label="đọc báo"` — mỗi ngày 09:00
- `reminder_add when="every 2h" label="uống nước"` — lặp mỗi 2 giờ
- `reminder_add when="mon 09:00" label="họp"` — mỗi thứ 2 09:00
- `reminder_list` — liệt kê nhắc của session
- `reminder_start` — bật clock (tự chạy khi có nhắc / mở session)
- `reminder_done <id>` / `reminder_del <id>` — dừng / xóa

## `when` syntax

| Form          | Ý nghĩa                              | Lặp  |
| ------------- | ------------------------------------ | ---- |
| `in 2m`       | 2 phút nữa                           | không|
| `in 1h`       | 1 giờ nữa                            | không|
| `14:30`       | lần tới 14:30                        | không|
| `daily 09:00` | mỗi ngày 09:00                       | có  |
| `mon 09:00`   | mỗi thứ 2 09:00                      | có  |
| `every 90m`   | mỗi 90 phút                          | có  |
| `every 2h`    | mỗi 2 giờ                            | có  |

Đơn vị: `m` (phút), `h` (giờ). Chu kỳ lặp tối thiểu 1 phút.

## Cách nhắc bắn

Clock quét mỗi **60 giây**. Khi tới giờ, nhắc được bơm vào session dưới dạng:

```
!ev remind 1: reminder <id> <label> @HH:MM GMT+7
```

- Nhắc chưa `done` → tiếp tục bắn mỗi **5 phút** (`REMIND_INTERVAL_MS`) cho tới khi gọi
  `reminder_done` / `reminder_del`. Không tự xóa/dời → buộc đóng vòng để không bỏ lỡ.
- Khi trễ: `reminder <id> <label> @HH:MM GMT+7 (trễ Xm) — gọi reminder_done xác nhận`
- Sắp đến (trong 1 phút): thêm `(~Ns)` vào cuối.
- Nhiều nhắc cùng lúc được gộp: `!ev remind N: reminder A | reminder B | ...`

Format và cơ chế hoàn toàn y hệt `agent-teamwork-scheduler` (chỉ đổi `cal` → `reminder`).

## Persist & resume

Mỗi session lưu riêng 1 file:

```
~/.local/share/opencode-reminders/<sessionID>.reminder.json
```

- JSON thuần: `{id, label, nextAt, repeat, hour, minute, dow?, intervalMs?, lastRemindAt?, due?, dueAt?}`
- Clock ghi file mỗi phút → nếu session tắt rồi mở lại, nhắc tiếp tục (resume), không mất.
- `life_monitor.py` đọc theo tên file (`<sessionID>.reminder.json`) để hiện nhắc đúng session.

## Develop

```sh
bun install
bun run typecheck   # tsc --noEmit
```
