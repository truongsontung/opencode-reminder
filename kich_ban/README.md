# Kịch bản test — opencode-reminders (agent tự chạy)

Viết cho AGENT tự thực thi: gọi tool trực tiếp, "Dừng. Chờ...", "Quan sát:".
Chạy lần lượt trong một phiên có nạp plugin `opencode-reminders`.

| Bước | File | Nội dung |
| ---- | ---- | -------- |
| 0 | `00_khoi_dong.md` | Xác nhận 4 tool `reminder_*` đã nạp |
| 1 | `01_nhac_mot_lan.md` | Nhắc một lần `in 1m`, bắn vào session |
| 2 | `02_agent_dong.md` | Bắn bằng đúng agent lúc tạo (self), không nhảy sai |
| 3 | `03_when_sai.md` | Cú pháp `when` sai → báo lỗi, không tạo |
| 4 | `04_lap_lai.md` | Nhắc lặp `every 1m` bắn nhiều lần, tự dời mốc |
| 5 | `05_done_del.md` | `reminder_done` dừng nhắc; `reminder_del` xoá hẳn |
| 6 | `06_persist_restart.md` | Persist xuống đĩa; phần restart do user thực hiện |

Ghi nhớ:
- Tick chạy mỗi 15s → nhắc bắn trong ~15s sau mốc đến hạn.
- Khi nhắc bắn, agent nhận một lượt mới `⏰ Reminder: <text>` trong chính session.
- Dữ liệu: `~/.local/share/opencode-reminders/reminders.json`.
- Muốn test nhanh hơn, đặt env trước khi mở phiên: `OPENCODE_REMINDERS_TICK_MS=3000`.
