# BƯỚC 1 — NHẮC MỘT LẦN (in 1m)

Mục tiêu: tạo nhắc một lần, đến hạn tự nhảy vào session ĐÚNG agent hiện tại.

Trong TUI (agent mặc định là `build`), yêu cầu:
```
Đặt nhắc: reminder_add với when "in 1m" và text "kiểm tra deploy"
```

Sau đó:
```
reminder_list
```

Kết quả mong đợi ngay:
- `reminder_add` trả về: `Added [r_xxxxxx] kiểm tra deploy (once, next in 1m)`
- `reminder_list` hiển thị đúng mục đó, trạng thái `next in ~1m`.

Ghi lại `r_xxxxxx`.

Dừng. Chờ ~1 phút (tối đa +15s do tick).

Quan sát khi đến hạn:
- Xuất hiện MỘT tin nhắn mới trong session: `⏰ Reminder: kiểm tra deploy`
- Tin nhắn do CHÍNH agent của session này xử lý (ở đây là `build`),
  KHÔNG bị đổi sang agent khác.

Kiểm tra lại:
```
reminder_list
```
- Mục `kiểm tra deploy` KHÔNG còn trong danh sách (nhắc once đã xong).
- Muốn xem cả mục đã xong: `reminder_list` với `all: true`.
