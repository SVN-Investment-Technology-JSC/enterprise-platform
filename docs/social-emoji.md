# Chèn biểu tượng cảm xúc (Mạng nội bộ)

Nút mặt cười có ở ô soạn bài (thanh công cụ của `RichEditor`) và ô bình luận (gồm cả ô sửa bình luận).

## Cách hoạt động

- Hộp chọn dùng thư viện `frimousse` (ghim đúng phiên bản `0.4.0`, MIT): danh sách ảo hoá, không kèm giao diện.
  Mã `EmojiPickerPanel` nằm trong chunk riêng (khoảng 31 KB), chỉ tải khi mở hộp lần đầu.
- Emoji hiển thị bằng font emoji của hệ điều hành, bài và bình luận lưu và hiển thị như chữ thường:
  không thêm yêu cầu mạng, không cần bộ phân tích chữ thành ảnh. Hình dạng emoji khác nhau giữa Windows, macOS, Android.
- Dữ liệu tiếng Việt (tìm kiếm, tên danh mục) là `emojibase-data/vi`, tự host tại
  `/modules/social/emoji-data/vi/{data,messages}.json`. `apps/social-web/next.config.js` sao chép hai tệp này từ
  `node_modules` vào `public/emoji-data/` mỗi lần dựng cấu hình; thư mục đích nằm trong `.gitignore`. Cache một ngày.
- "Dùng gần đây" (tối đa 18) và tông màu da được nhớ trong `localStorage` (`social.emoji.recent`, `social.emoji.skin-tone`).
- Esc chỉ đóng hộp emoji, không đóng hộp thoại soạn bên dưới.

## Chèn vào đâu

- `RichEditor`: ghi nhớ vùng chọn trước khi mở hộp, chèn bằng `execCommand('insertText')` nên giữ lịch sử hoàn tác.
- Ô bình luận: chèn tại con trỏ (thay đoạn đang chọn), không đụng phần nhắc tên (`@[id]` chỉ được mã hoá lúc gửi).

## Phía server

Giới hạn độ dài đếm theo đơn vị UTF-16: một emoji tính 2, emoji ghép (gia đình, cờ) có thể tính tới 8.
Các hàm cắt chữ (`truncatePlainText`, nhãn báo cáo, từ khoá tìm kiếm) dùng `sliceSafe` để không cắt đôi cặp thay thế.

## Nâng phiên bản dữ liệu

Cập nhật `emojibase-data` và `frimousse` bằng `pnpm --filter <project> add <gói>@<phiên bản> --save-exact`.
Chữ trên giao diện không được chứa emoji ký tự (CI chặn); trong test dùng ký tự thoát `\u{...}`.
