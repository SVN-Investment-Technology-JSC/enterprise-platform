# Kiến trúc phân hệ Văn thư

Nghiệp vụ của Văn thư (công văn đến, công văn đi, quy trình duyệt, sổ, lưu trữ). Mô tả chức năng và
cấu hình cho người dùng ở `apps/correspondence-api/README.md`; tài liệu này nói code nằm ở đâu và
thêm, sửa thì làm ở chỗ nào.

## Các phần của phân hệ

| Phần | Thư mục | Vai trò |
|---|---|---|
| Hợp đồng | `packages/contracts/correspondence` | Kiểu dữ liệu, nhãn, hàm tính dùng chung cho web và API |
| Nghiệp vụ | `packages/modules/correspondence` (thư mục này) | Toàn bộ luật xử lý |
| API | `apps/correspondence-api` | App NestJS: guard xác thực, phân quyền phân hệ, nạp module nghiệp vụ |
| Giao diện | `packages/features/correspondence`, `apps/correspondence-web` | Màn hình Văn thư |
| Dữ liệu | `migrations/tenant/correspondence` | Schema `correspondence_schema` trong DB của từng tenant |

## Các tầng trong `src/lib`

```
presentation/   Nhận HTTP, đổi lỗi nghiệp vụ thành HTTP. Không có luật nghiệp vụ.
  correspondence-http.ts            Lớp cơ sở: lấy người gọi, đổi lỗi
  letter-queries.controller.ts      Tra cứu, danh sách, chi tiết, báo cáo, sổ
  correspondence-config.controller.ts  Cài đặt, danh mục, quy trình, sổ đăng ký
  letter-flow.controller.ts         Tiếp nhận, soạn, giao, xử lý, duyệt, ban hành
  letter-revocation.controller.ts   Huỷ, thu hồi, xoá; đôn đốc, trao đổi
  letter-attachments.controller.ts  Tệp đính kèm
  routes.spec.ts                    Giữ bảng route: đổi đường dẫn là test báo
application/    Nghiệp vụ
  correspondence.service.ts         Cửa vào chung: chỉ chuyển tiếp sang các nhóm dưới
  letters/                          Mỗi nhóm nghiệp vụ một lớp
    letter-queries.service.ts         Tra cứu, tổng quan, sổ, báo cáo, kho lưu trữ
    letter-intake.service.ts          Tiếp nhận công văn đến, giao xử lý, sửa thông tin
    letter-handling.service.ts        Phản hồi, văn thư kiểm tra, duyệt, trả lại, hoàn tất
    outgoing-letters.service.ts       Công văn đi: soạn, gửi văn thư, ban hành, theo dõi gửi
    letter-revocation.service.ts      Huỷ, thu hồi, xoá
    letter-follow-up.service.ts       Đôn đốc, trao đổi theo bước
    letter-attachments.service.ts     Tệp đính kèm
    correspondence-configuration.service.ts  Cài đặt, danh mục, quy trình, sổ
  core/
    correspondence-core.ts          Lõi dùng chung: khoá công văn trong transaction, chuyển bước,
                                    kích hoạt bước, đóng công văn, chọn quy trình, quyền xem,
                                    tóm tắt, sự kiện thông báo; `detail`
    letter-helpers.ts               Hằng, kiểu, hàm thuần (không đọc ghi gì)
  ports.ts                          Cổng ra ngoài: kho dữ liệu, kho tệp, sơ đồ tổ chức
domain/         Luật thuần, không phụ thuộc gì: quyền theo bước (letter-rules), người duyệt
                (approvers), cấp số (numbering), sơ đồ tổ chức (organization), lỗi nghiệp vụ
infrastructure/ Cài đặt các cổng: Postgres, kho tệp qua Hệ dùng chung (HTTP nội bộ), sơ đồ tổ chức
correspondence.module.ts  Nối các phần lại (composition root)
```

Hướng phụ thuộc chỉ một chiều: `presentation → application → domain`; `infrastructure` cài đặt các cổng
trong `application/ports.ts`. Nhóm nghiệp vụ không gọi nhau; phần dùng chung nằm ở `core/`.

## Quan hệ với phân hệ khác

Văn thư không import code của phân hệ khác, nên sửa Văn thư không ảnh hưởng tới chúng và ngược lại:

- **Tệp**: gọi route nội bộ `/api/shared/v1/internal/filings/*` của Hệ dùng chung (service token). Tệp nằm
  ở kho tài liệu công ty (máy chủ ERP hoặc kho ngoài như NAS, theo cấu hình của tenant).
- **Sơ đồ tổ chức, quyền**: hỏi Platform qua HTTP.
- **Thông báo**: ghi sự kiện vào outbox trong cùng transaction; worker thông báo đọc và gửi.

## Thêm hay sửa một chức năng

1. Hợp đồng mới (kiểu yêu cầu, phản hồi): `packages/contracts/correspondence`.
2. Nghiệp vụ: viết phương thức vào nhóm phù hợp trong `application/letters/`. Bước dùng chung nhiều nhóm
   thì đặt ở `core/correspondence-core.ts`; hàm tính thuần đặt ở `core/letter-helpers.ts` hoặc `domain/`.
3. Thêm một dòng chuyển tiếp vào `application/correspondence.service.ts`.
4. Route: thêm vào controller cùng nhóm, rồi thêm dòng vào bảng trong `presentation/routes.spec.ts`.
5. Bảng, cột mới: tạo migration mới trong `migrations/tenant/correspondence` (không sửa file đã merge).
6. Test: nghiệp vụ trong `application/correspondence.service.spec.ts`; truy vấn trong
   `infrastructure/postgres-correspondence-store.integration.spec.ts`.

## Chạy test

```bash
# từ packages/modules/correspondence; test Postgres cần một DB tạm
docker run -d --rm --name corr-pg -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:18.4-alpine
CORRESPONDENCE_TEST_ADMIN_URL=postgres://postgres:test@127.0.0.1:55432/postgres npx jest
docker stop corr-pg
```
