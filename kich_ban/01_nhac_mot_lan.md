# BƯỚC 1 — NHẮC MỘT LẦN (in 1m)

Gọi:
```
reminder_add when "in 1m" text "kiểm tra deploy"
```

Gọi để kiểm tra:
```
reminder_list
```

Kết quả mong đợi ngay:
- `reminder_add` trả về: `Added [r_xxxxxx] kiểm tra deploy (once, next in 1m)`
- `reminder_list` hiển thị đúng mục đó, trạng thái `next in ~1m`.

Ghi lại `r_xxxxxx`.

Dừng. Chờ ~1 phút (có thể trễ tối đa +15s do tick).

Quan sát:
- Nhận được MỘT lượt mới với nội dung: `⏰ Reminder: kiểm tra deploy`
- Lượt này do CHÍNH agent đang chạy kịch bản xử lý (đúng agent lúc tạo).

Kiểm tra lại:
```
reminder_list
```
- Mục `kiểm tra deploy` KHÔNG còn (nhắc once đã xong).
- Muốn thấy cả mục đã xong: `reminder_list all: true`.
