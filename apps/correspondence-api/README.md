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

## Quyền

| Quyền | Được làm |
| --- | --- |
| `correspondence.read` | xem công văn mình tiếp nhận, được trình, thuộc phòng ban được giao |
| `correspondence.letter.register` | văn thư: tiếp nhận, phân loại, trình, phát hành, lưu trữ; thấy mọi công văn |
| `correspondence.letter.direct` | lãnh đạo: được chọn để trình, chỉ đạo, giao phòng ban, duyệt (cấp đích danh) |
| `correspondence.manage` | quản trị văn thư: như văn thư, cộng cấu hình sổ (ký hiệu số đến, số đi, số hồ sơ) |

Người thuộc phòng ban được giao (theo sơ đồ tổ chức, kể cả đơn vị cha của chức danh) gửi được văn bản phản hồi
cho phòng. Quản trị tenant làm được việc của văn thư và làm thay lãnh đạo khi cần.

## Luồng

`received` → `registered` → `directing` → `processing` → `reviewing` → `publishing` → `closing` → `archived`.
Lãnh đạo có thể trả lại văn thư, cho "lưu để biết" (chuyển thẳng sang chờ lưu trữ) hoặc yêu cầu phòng ban sửa
dự thảo. Đủ phản hồi của mọi phòng ban thì tự trình lại lãnh đạo. Mỗi bước chạy trong một transaction đã khoá
dòng công văn; sự kiện ghi vào outbox cùng transaction và thành thông báo qua notification-worker.

Biến môi trường: database, platform access (như mọi API), `TENANT_CORE_ORGANIZATION_CONTEXT_URL`,
`SHARED_API_URL` (mặc định `http://localhost:3342/api/shared`).

```bash
pnpm dev:correspondence
```
