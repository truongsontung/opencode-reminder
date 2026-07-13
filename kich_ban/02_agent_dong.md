# BƯỚC 2 — NHẮC BẮN ĐÚNG AGENT (self)

Mục tiêu: nhắc do agent nào tạo thì bắn về đúng agent đó, không nhảy sai.

Gọi:
```
reminder_add when "in 1m" text "ghi chú agent"
```

Dừng. Chờ ~1 phút.

Quan sát:
- Nhận `⏰ Reminder: ghi chú agent` và lượt xử lý là CHÍNH agent đang chạy kịch bản
  (agent lúc tạo), KHÔNG bị chuyển sang agent khác.

Ý nghĩa:
- Plugin lưu `context.agent` lúc tạo và truyền lại khi bắn → agent xác định, không
  hardcode.
- Ghi chú: nếu người dùng Tab đổi agent giữa chừng, nhắc vẫn bắn bằng agent lúc TẠO
  (hành vi cố ý, không đổi). Việc đổi agent bằng Tab là thao tác của user, agent tự
  chạy kịch bản không kiểm thử phần đó.
