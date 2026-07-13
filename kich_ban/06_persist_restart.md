# BƯỚC 6 — PERSIST QUA RESTART

Mục tiêu: nhắc sống sót khi tắt/mở lại opencode; nhắc lặp quá hạn tự dời tới
mốc tương lai (không bắn dồn quá khứ).

Lưu ý: dữ liệu lưu tại `~/.local/share/opencode-reminders/reminders.json`
(chung cho mọi session/máy này, không theo từng session).

Trong TUI:
```
reminder_add when "daily 09:00" text "họp sáng"
reminder_add when "every 30m" text "nghỉ mắt"
reminder_list
```
Ghi lại các id và giờ hiển thị.

Dừng. THOÁT opencode (Ctrl+C).

Chờ vài phút (để mốc `every 30m` "quá hạn" trên lý thuyết nếu để lâu, hoặc
cứ mở lại ngay cũng được).

MỞ LẠI TUI:
```
cd ~/reminders-test
opencode
reminder_list
```

Quan sát:
- Vẫn còn "họp sáng" và "nghỉ mắt" (không mất sau restart).
- `every 30m` nếu đã qua mốc trong lúc đóng app → `next` đã tự dời tới mốc kế
  tiếp trong TƯƠNG LAI, không bắn dồn cho quá khứ.
- Bộ nhắc tự chạy lại (không cần bật gì thủ công).

Dọn dẹp cuối:
```
reminder_del <id họp sáng>
reminder_del <id nghỉ mắt>
```

Hoặc xoá sạch file:
```
rm ~/.local/share/opencode-reminders/reminders.json
```
