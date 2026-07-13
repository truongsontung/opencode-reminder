# BƯỚC 4 — NHẮC LẶP LẠI (every 1m)

Mục tiêu: nhắc lặp bắn nhiều lần và tự dời sang mốc kế tiếp.

Trong TUI:
```
reminder_add when "every 1m" text "uống nước"
reminder_list
```

Kết quả mong đợi:
- `Added [r_xxxxxx] uống nước (every, next in ~1m)`
- `reminder_list` cho thấy trạng thái `next in ~1m`.

Ghi lại `r_xxxxxx`.

Dừng. Quan sát trong ~2–3 phút:
- Tin `⏰ Reminder: uống nước` xuất hiện LẶP LẠI, xấp xỉ mỗi phút.
- Sau mỗi lần bắn, mục vẫn còn trong `reminder_list` (không biến mất như once),
  và `next in ~1m` được tính lại về tương lai.

Dọn dẹp để khỏi nhắc dai ở bước sau:
```
reminder_done r_xxxxxx
```
