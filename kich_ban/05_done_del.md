# BƯỚC 5 — DONE & DEL

Mục tiêu: `reminder_done` dừng nhắc; `reminder_del` xoá hẳn.

## Phần A — done

Tạo hai nhắc lặp:
```
reminder_add when "every 1m" text "A"
reminder_add when "every 1m" text "B"
reminder_list
```
Ghi lại id của A (`r_aaa`) và B (`r_bbb`).

Đánh dấu A xong:
```
reminder_done r_aaa
```

Kết quả mong đợi:
- Trả về `Marked r_aaa as done.`
- `reminder_list` (mặc định) chỉ còn B.
- `reminder_list` với `all: true` vẫn thấy A ở trạng thái `done`.
- Chờ ~1 phút: chỉ còn B bắn `⏰ Reminder: B`, A KHÔNG bắn nữa.

## Phần B — del

Xoá hẳn B:
```
reminder_del r_bbb
```

Kết quả mong đợi:
- Trả về `Deleted r_bbb.`
- `reminder_list` với `all: true` KHÔNG còn B (khác với done: del biến mất hoàn toàn).

## Lỗi id sai

```
reminder_done r_khongco
reminder_del r_khongco
```
- Cả hai trả về `No reminder with id r_khongco.`
