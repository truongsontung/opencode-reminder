# BƯỚC 0 — KHỞI ĐỘNG & NẠP PLUGIN

Mục tiêu: mở TUI có nạp `opencode-reminders`, xác nhận 4 tool đã đăng ký.

Đã tạo sẵn thư mục test riêng (tách khỏi agent-teamwork):
`~/reminders-test/opencode.json` trỏ tới plugin.

Mở TUI:
```
cd ~/reminders-test
opencode
```

Trong TUI, hỏi model:
```
Liệt kê các tool có tên bắt đầu bằng reminder_
```

Kết quả mong đợi:
- Model thấy: `reminder_add`, `reminder_list`, `reminder_done`, `reminder_del`.

Nếu KHÔNG thấy:
- Kiểm tra đường dẫn plugin trong `~/reminders-test/opencode.json`.
- Thoát và mở lại TUI (plugin nạp lúc khởi động).

Ghi chú:
- Bộ đếm nội bộ (tick) chạy mỗi 15s, nên nhắc "đến hạn" sẽ bắn trong vòng ~15s
  sau mốc giờ.
- Dữ liệu lưu tại `~/.local/share/opencode-reminders/reminders.json`.

Dừng. Không làm gì thêm.
