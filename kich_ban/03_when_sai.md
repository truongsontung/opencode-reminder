# BƯỚC 3 — WHEN KHÔNG HỢP LỆ

Mục tiêu: cú pháp sai phải báo lỗi rõ ràng, KHÔNG tạo nhắc.

Trong TUI, thử lần lượt:
```
reminder_add when "whenever" text "sai cú pháp"
reminder_add when "in 0m" text "số 0"
reminder_add when "at 25:00" text "giờ sai"
reminder_add when "daily 10:99" text "phút sai"
```

Kết quả mong đợi:
- Mỗi lệnh trả về: `Could not understand "..."` kèm phần Examples hướng dẫn.
- Không mục nào được thêm.

Kiểm tra:
```
reminder_list
```
- Không có mục rác nào từ các lệnh trên.

Cú pháp ĐÚNG để tham chiếu:
- `in 2m`, `in 1h30m`, `at 14:30`, `daily 09:00`, `mon 09:00`, `every 10m`
- Đơn vị: s / m / h / d (ghép được, vd `2h30m`).
