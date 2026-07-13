# BƯỚC 2 — AGENT ĐỘNG (không hardcode)

Mục tiêu: chứng minh nhắc bắn vào ĐÚNG agent đã tạo nó, không cố định.

Trong TUI, chuyển sang agent khác trước khi đặt nhắc.
Ví dụ đổi sang `plan` (Tab/menu chọn agent, hoặc chạy `opencode` với agent plan).

Với agent = `plan`, yêu cầu:
```
reminder_add when "in 1m" text "ghi chú từ plan"
```

Dừng. Chờ ~1 phút.

Quan sát khi đến hạn:
- Tin `⏰ Reminder: ghi chú từ plan` được xử lý bởi agent `plan`
  (đúng agent lúc tạo), KHÔNG phải `build` hay agent mặc định nào.

Ý nghĩa:
- Đây là điểm mấu chốt: plugin lưu `context.agent` lúc tạo và truyền lại khi bắn.
- Trái ngược với lỗi cũ ở agent-teamwork (hardcode "manager") làm session bị
  nhảy sai agent.
