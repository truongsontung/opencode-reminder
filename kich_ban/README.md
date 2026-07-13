# Kịch bản test TUI — opencode-reminders

Chạy lần lượt trong TUI. Mỗi bước có "Kết quả mong đợi".

| Bước | File | Nội dung |
| ---- | ---- | -------- |
| 0 | `00_khoi_dong.md` | Mở TUI, xác nhận 4 tool `reminder_*` đã nạp |
| 1 | `01_nhac_mot_lan.md` | Nhắc một lần `in 1m`, bắn vào session đúng agent |
| 2 | `02_agent_dong.md` | Bắn vào ĐÚNG agent lúc tạo (không hardcode) |
| 3 | `03_when_sai.md` | Cú pháp `when` sai → báo lỗi, không tạo |
| 4 | `04_lap_lai.md` | Nhắc lặp `every 1m` bắn nhiều lần, tự dời mốc |
| 5 | `05_done_del.md` | `reminder_done` dừng nhắc; `reminder_del` xoá hẳn |
| 6 | `06_persist_restart.md` | Sống sót qua restart; overdue tự dời tương lai |

Chuẩn bị nhanh (đã tạo sẵn):
```
cd ~/reminders-test   # opencode.json ở đây đã trỏ tới plugin
opencode
```

Ghi nhớ:
- Tick chạy mỗi 15s → nhắc bắn trong ~15s sau mốc đến hạn.
- Dữ liệu: `~/.local/share/opencode-reminders/reminders.json`.
- Muốn test nhanh hơn, đặt env trước khi mở TUI:
  `export OPENCODE_REMINDERS_TICK_MS=3000`
