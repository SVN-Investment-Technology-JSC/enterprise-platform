# correspondence-api

API của phân hệ **Văn thư** (`/api/correspondence`, cổng 3345; giao diện `correspondence-web` ở
`/modules/correspondence`, cổng 3013): tiếp nhận công văn đến, trình lãnh đạo chỉ đạo, giao phòng ban
xử lý, duyệt văn bản phản hồi, cấp số và phát hành công văn đi, lưu trữ hồ sơ.

- Bảng: `correspondence_schema` trong DB tenant (`migrations/tenant/correspondence`).
- Luồng duyệt nằm trong phân hệ, không đi qua Quy trình.
- Tệp (bản quét công văn đến, dự thảo phản hồi, bản phát hành) **không lưu ở đây**: Văn thư gọi route nội bộ
  `/api/shared/v1/internal/filings/*` của Hệ dùng chung (service token), tệp nằm trong kho tài liệu ở thư mục
  `Văn thư / <năm> / Công văn đến / <số đến - trích yếu>`. Tenant dùng Văn thư cần bật cả Hệ dùng chung.
  Thư mục gốc "Văn thư" do hệ thống tạo, không xoá hay chuyển được; quản trị kho chia sẻ nó cho ai cần xem
  hồ sơ ngay trong kho.

## Cấu hình động

Mọi thứ do tenant cấu hình ở trang **Cấu hình** (quyền `correspondence.config`); migration ghi sẵn dữ liệu mặc định.

- **Danh mục**: loại văn bản (hạn xử lý mặc định, quy trình mặc định), độ khẩn (tô đỏ), độ mật (chỉ người liên quan
  thấy). Bảng `catalog_items`; công văn giữ mã, mục đã dùng chỉ ngừng dùng được.
- **Quy trình duyệt**: các bước theo thứ tự, đúng một bước chỉ đạo (giao phòng ban), trước đó là các bước xem xét,
  sau đó là các bước duyệt văn bản phản hồi. Người thực hiện mỗi bước theo sơ đồ tổ chức: người được chỉ định, người
  giữ chức danh, trưởng đơn vị, trưởng các phòng được giao, người đã chỉ đạo, hoặc người trình chọn trong một nhóm
  (người có quyền chỉ đạo, chức danh, phòng ban). Bảng `workflows`; công văn chép các bước lúc trình (`letter_steps`)
  nên sửa quy trình không đổi công văn đang chạy.
- **Sổ và đánh số**: ký hiệu số đến, số đi, tiền tố số hồ sơ, hạn xử lý mặc định.
- **Sơ đồ tổ chức**: đọc từ organization context của Tenant Core (phòng ban, chức danh, thành viên, trưởng đơn vị).

## Quyền

| Quyền | Được làm |
| --- | --- |
| `correspondence.read` | xem công văn mình tiếp nhận, được giao bước, thuộc phòng ban được giao |
| `correspondence.letter.read-all` | xem mọi công văn không mật |
| `correspondence.letter.confidential` | xem công văn mật |
| `correspondence.letter.register` | tiếp nhận, vào sổ, phân loại, trình duyệt, huỷ |
| `correspondence.letter.direct` | nằm trong nhóm "lãnh đạo" để người trình chọn chỉ đạo (cấp đích danh) |
| `correspondence.letter.publish` | cấp số đi, phát hành |
| `correspondence.letter.archive` | lưu trữ hồ sơ |
| `correspondence.config` | cấu hình danh mục, quy trình, sổ |
| `correspondence.manage` | mọi quyền trên, trừ quyền chỉ đạo |

Người thuộc phòng ban được giao gửi được văn bản phản hồi cho phòng. Quản trị tenant làm thay được mọi bước.

## Luồng

`received` → `registered` → các bước của quy trình (`reviewing` khi xem xét hay duyệt, `directing` ở bước chỉ đạo,
`processing` khi phòng ban xử lý) → `publishing` → `closing` → `archived`. Người ở bước xem xét hay chỉ đạo trả lại
được văn thư; bước chỉ đạo cho "lưu để biết" được; bước duyệt sau chỉ đạo yêu cầu phòng ban sửa được (các bước duyệt
chạy lại khi đủ phản hồi). Mỗi thao tác chạy trong một transaction đã khoá dòng công văn; sự kiện ghi vào outbox cùng
transaction và thành thông báo qua notification-worker; nhắc hạn theo người đang giữ bước.

Biến môi trường: database, platform access (như mọi API), `TENANT_CORE_ORGANIZATION_CONTEXT_URL`,
`SHARED_API_URL` (mặc định `http://localhost:3342/api/shared`).

Kiểm thử với PostgreSQL thật: `CORRESPONDENCE_TEST_ADMIN_URL=postgresql://…@localhost/postgres pnpm nx test module-correspondence`.

```bash
pnpm dev:correspondence
```
