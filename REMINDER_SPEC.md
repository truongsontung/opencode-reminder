MỤC ĐÍCH HOẠT ĐỘNG CỦA REMINDER

1. Bơm nhắc đúng session đã tạo nó
   - Khi đến hạn, nhắc phải xuất hiện đúng trong session đã đặt reminder,
     không nhầm sang session khác.

2. Vẫn bơm dù session đang ẩn / không dùng đến
   - Session có thể không mở foreground, nhưng nhắc vẫn phải được đẩy vào
     để agent tiếp tục chạy nhiệm vụ user giao. Không bỏ qua vì session ẩn.

3. Chỉ dừng khi user thực sự thoát
   - Nhắc hoạt động liên tục suốt đời session. Chỉ ngừng khi user Ctrl-C
     exit. Không tự dừng vì "session không active".

4. Mở lại session thì tiếp tục
   - Sau khi thoát rồi mở lại, các nhắc còn dang dở phải được nạp và tiếp
     bơm, không mất, không phải tạo lại.

5. Thử lại nếu đẩy thất bại
   - Nếu lúc đẩy bị lỗi (mạng / client mất), giữ lại và thử lại ở CHU KỲ
     QUÉT TIẾP THEO (vòng lặp kiểm tra có nhắc cần bơm), không bỏ sót nhắc.
