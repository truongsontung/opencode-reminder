# BƯỚC 6 — PERSIST QUA RESTART

Mục tiêu: nhắc lưu xuống đĩa, sống sót khi restart; nhắc lặp quá hạn tự dời tới
mốc tương lai (không bắn dồn quá khứ).

Dữ liệu lưu tại: `~/.local/share/opencode-reminders/reminders.json`

Gọi:
```
reminder_add when "daily 09:00" text "họp sáng"
reminder_add when "every 30m" text "nghỉ mắt"
reminder_list
```
Ghi lại các id và giờ hiển thị.

Kiểm tra persist (agent tự đọc file):
- Đọc `~/.local/share/opencode-reminders/reminders.json`
- Xác nhận có 2 mục "họp sáng" và "nghỉ mắt" với `nextAt`, `agent`, `sessionID` đầy đủ.

Phần restart cần USER thực hiện (agent không tự restart được):
- User thoát opencode (Ctrl+C) rồi mở lại đúng phiên.

Sau khi mở lại, gọi:
```
reminder_list
```

Quan sát:
- Vẫn còn "họp sáng" và "nghỉ mắt" (không mất).
- `every 30m` nếu đã qua mốc trong lúc đóng app → `next` tự dời tới mốc kế tiếp
  trong TƯƠNG LAI, không bắn dồn cho quá khứ.
- Bộ nhắc tự chạy lại (không cần bật gì thủ công).

Dọn dẹp cuối:
```
reminder_del <id họp sáng>
reminder_del <id nghỉ mắt>
```
