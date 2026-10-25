/**
 * Ảnh bìa mặc định của thẻ hồ sơ: SVG nhúng sẵn (không thêm tệp ảnh, không gọi mạng), nền xanh nhạt với hai mảng cong.
 * Khi có chức năng đổi ảnh bìa, thẻ hồ sơ nhận `coverUrl` của người dùng và chỉ dùng ảnh này khi chưa có.
 */
const DEFAULT_COVER_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 140" preserveAspectRatio="xMidYMid slice">',
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
  '<stop offset="0" stop-color="#dbe9ff"/><stop offset="1" stop-color="#c3d6ff"/>',
  '</linearGradient></defs>',
  '<rect width="600" height="140" fill="url(#g)"/>',
  '<circle cx="430" cy="-10" r="120" fill="#a9ccff" fill-opacity="0.55"/>',
  '<path d="M0 140 C 120 60 260 130 400 80 S 540 40 600 70 V140 Z" fill="#b8c7ff" fill-opacity="0.5"/>',
  '</svg>',
].join('');

export const DEFAULT_PROFILE_COVER = `data:image/svg+xml;utf8,${encodeURIComponent(DEFAULT_COVER_SVG)}`;
