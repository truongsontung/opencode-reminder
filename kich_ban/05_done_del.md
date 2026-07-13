# BƯỚC 5 — DONE & DEL

Mục tiêu: `reminder_done` dừng nhắc; `reminder_del` xoá hẳn.

## Phần A — done

Gọi:
```
reminder_add when "every 1m" text "A"
reminder_add when "every 1m" text "B"
reminder_list
```
Ghi lại id của A (`r_aaa`) và B (`r_bbb`).

Gọi:
```
reminder_done r_aaa
```

Kết quả mong đợi:
- Trả về `Marked r_aaa as done.`
- `reminder_list` chỉ còn B.
- `reminder_list all: true` vẫn thấy A ở trạng thái `done`.

Dừng. Chờ ~1 phút:
- Chỉ nhận `⏰ Reminder: B`, KHÔNG còn nhận A.

## Phần B — del

Gọi:
```
reminder_del r_bbb
```

Kết quả mong đợi:
- Trả về `Deleted r_bbb.`
- `reminder_list all: true` KHÔNG còn B (khác done: del biến mất hoàn toàn).

## Lỗi id sai

Gọi:
```
reminder_done r_khongco
reminder_del r_khongco
```
- Cả hai trả về `No reminder with id r_khongco.`

Dừng.
