# Seed tenant thí điểm phân hệ Bán hàng

`tools/crm/seed-svn.mjs` dựng tenant thí điểm `svn` ở local theo `docs/crm/TEST.md` mục 1.3. Script chỉ gọi API
thật (đăng nhập, cookie và CSRF như web app), không ghi thẳng DB. Chạy lại nhiều lần được: bản ghi đã có (theo mã,
email hoặc tên) được bỏ qua, quyền của vai trò được chỉnh về đúng bảng 1.3.

```bash
node tools/crm/seed-svn.mjs --step=tenant [--tenant=svn]
node tools/crm/seed-svn.mjs --step=legacy [--tenant=svn]
```

## Cần có

- Stack local đang chạy: API Platform (3333), inventory-api (3336), workspace-api (3337), crm-api (3344), worker
  (khởi tạo phân hệ cho tenant). Xem `infrastructure/docker/compose.local.yml` và `pnpm dev`.
- Biến môi trường. Script tự nạp `.env` ở gốc repo nếu có; biến đặt trong shell được ưu tiên.

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `SVN_SEED_PASSWORD` | Có | Mật khẩu của QTV và 10 tài khoản nghiệp vụ (6 đến 128 ký tự). Không ghi vào repo. |
| `SVN_SEED_SUPERADMIN_PASSWORD` | Có, hoặc `SEED_SUPERADMIN_PASSWORD` trong `.env` | Mật khẩu `superadmin@platform.local`. |
| `INTERNAL_SERVICE_TOKEN` | Có (đã có trong `.env`) | Gọi route nội bộ: organization context, giữ hàng cũ. |
| `SVN_SEED_SUPERADMIN_EMAIL` | Không | Mặc định `superadmin@platform.local`. |
| `SVN_SEED_PLATFORM_API_URL` | Không | Mặc định `http://localhost:3333/api`. |
| `INVENTORY_API_URL`, `WORKSPACE_API_URL`, `CRM_API_URL` | Không | Lấy từ `.env`; mặc định cổng local. |
| `SVN_SEED_TENANT_DB_HOST`, `SVN_SEED_TENANT_DB_PORT` | Không | DB của tenant mới; mặc định `localhost:55436`. |
| `SVN_SEED_PROVISION_TIMEOUT_MS` | Không | Thời gian chờ worker khởi tạo phân hệ; mặc định 5 phút. |
| `SVN_SEED_OUTPUT_DIR` | Không | Thư mục ghi ảnh chụp tồn của bước `legacy`; mặc định thư mục tạm của hệ điều hành. |

## Thứ tự chạy

1. `--step=tenant` (T0-18), trên code hiện tại.
2. `--step=legacy` (T0-19), ngay sau bước 1 và **trước** khi áp migration Kho mới.
3. Cập nhật code, chạy migration mới (worker nâng cấp phân hệ cho tenant).
4. Các bước của giai đoạn sau, sẽ thêm vào cùng script: `inventory` (T1-33), `crm` (T2-24), `pricing` (T3-18),
   `finance` (T5-14), `warranty` (T6-10).

Tenant `svn2`, `svn3`, `svn-perf` chỉ chạy bước `tenant` với `--tenant=<slug>`.

## Bước `tenant`

- Tạo tenant (tên "SVN Test"), DB riêng tên theo slug (`svn-perf` thành `svn_perf`), QTV `qtv@<tenant>.local`
  (Platform tạo khi khởi tạo tenant, có vai trò quản trị tenant).
- Bật phân hệ `crm`, `inventory`, `finance`, `procedure-engine`, `workspace`, `hrm`; chờ worker khởi tạo xong.
- Tạo Permission và vai trò theo bảng 1.3, 10 tài khoản `<ký hiệu>@<tenant>.local` (ví dụ `nv1@svn.local`), gán vai trò.
- Cơ cấu tổ chức: đơn vị Kinh doanh, Kho, Kế toán, Kỹ thuật; chức danh và quan hệ "Báo cáo cho":
  NV1, NV2 báo cáo TN; NV3 và TN báo cáo QL (trưởng Kinh doanh); TK báo cáo QLK (trưởng Kho); KT ở Kế toán; KTV ở Kỹ thuật.
- Kiểm tra cuối bước: NV1 gọi `GET /api/crm/v1/status` có `canWriteOpportunity = true`, `canReadAll = false`;
  organization context nội bộ cho thấy cấp dưới của TN là NV1, NV2.

## Bước `legacy`

Dữ liệu theo API Kho và Workspace hiện tại, để test migration (TC-MIG-*) và chuyển khách Workspace:

- Kho `QA-KHO-HN`, `QA-KHO-CL`, `QA-KHO-LOI`; mặt hàng `QA-KHO-LAP` (serial), `QA-KHO-MUC`, `QA-KHO-CAP`.
- `QA-KHO-CAP` nhập 3 lần 10 x 700.000, 10 x 800.000, 10 x 900.000 (bình quân 800.000); `QA-KHO-LAP` nhập 40 và
  khai serial `SN001` đến `SN040` ở `QA-KHO-HN`; `QA-KHO-MUC` nhập 50.
- Một giữ hàng cũ 5 `QA-KHO-CAP` qua `POST /v1/internal/reservations`, không có trường nguồn.
- Cặp serial trùng: API khai serial chặn trùng khi gọi tuần tự, nên script chỉ thử gửi đồng thời nhiều request khai
  `SN040`. Không thành thì chỉ báo, không ghi SQL.
- Workspace: khách `QA-CRM-WS01` đến `QA-CRM-WS05`, 3 dự án gắn WS01 đến WS03, hợp đồng `QA-CRM-HD01`, `QA-CRM-HD02`.
- Cuối bước in tổng tồn theo kho, mặt hàng (`quantity`, `quantity_reserved`), số serial theo trạng thái và ghi ảnh
  chụp JSON `<thư mục tạm>/crm-seed/<tenant>-legacy-snapshot.json` để đối soát sau migration (không ghi vào repo).

## Chuyển khách hàng Workspace sang Bán hàng (T2-15)

Quyết định D1: Bán hàng là nguồn gốc khách hàng, Workspace giữ bản sao (`workspace_schema.customers.crm_customer_id`).
Khi tenant đã bật `crm`, chạy một lần để đưa khách Workspace có sẵn sang Bán hàng:

```bash
node tools/crm/migrate-workspace-customers.mjs --tenant=svn --dry-run   # chỉ báo sẽ làm gì
node tools/crm/migrate-workspace-customers.mjs --tenant=svn             # chạy thật
```

- Đăng nhập bằng quản trị tenant (`qtv@<tenant>.local`, mật khẩu `SVN_SEED_PASSWORD`). Tenant khác: đặt
  `CRM_MIGRATE_ADMIN_EMAIL`, `CRM_MIGRATE_ADMIN_PASSWORD`. URL dịch vụ như bảng biến ở trên (`WORKSPACE_API_URL`,
  `CRM_API_URL`, `SVN_SEED_PLATFORM_API_URL`).
- Chỉ gọi API, không ghi chéo schema. Với mỗi khách Workspace chưa gắn: tìm khách Bán hàng cùng mã (mã viết hoa), chưa
  có thì tạo ở Bán hàng giữ nguyên mã; trùng mã thì dùng khách đã có. Sau đó gọi
  `POST /api/workspace/v1/crm-customers/:id/link` với `customerId` của khách Workspace để ghi `crm_customer_id`. Sự
  kiện `crm.customer.created` cũng tự gắn theo mã; hai đường gặp nhau vẫn chỉ ra một bản sao.
- Mã Workspace không hợp lệ ở Bán hàng (có dấu, khoảng trắng, ký tự lạ, dài quá 50) bị bỏ qua và báo "cần xử lý tay".
  Thêm `--generate-codes` để Bán hàng cấp mã mới cho các khách này (mã cũ ghi vào ghi chú khách Bán hàng; mã của bản
  sao Workspace đổi theo mã mới).
- Dự án và hợp đồng Workspace vẫn trỏ đúng khách: script gắn chính dòng khách cũ, không tạo dòng mới.
- Chạy lại được: khách đã gắn được bỏ qua. Cuối lượt in số khách Workspace, đã gắn từ trước, khớp khách có sẵn, tạo
  mới, vừa gắn, mã không hợp lệ, lỗi. Có lỗi hoặc còn khách mã không hợp lệ thì mã thoát là 1.
- Sau khi bật Bán hàng, màn khách hàng Workspace chỉ đọc và API tạo, sửa, xoá khách Workspace trả 409
  `CUSTOMER_MANAGED_BY_CRM`; vì vậy chạy lại bước `legacy` cho tenant đã bật `crm` sẽ không tạo thêm được khách
  Workspace.
