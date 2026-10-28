# Seed tenant thí điểm phân hệ Bán hàng

`tools/crm/seed-svn.mjs` dựng tenant thí điểm `svn` ở local theo `docs/crm/TEST.md` mục 1.3. Script chỉ gọi API
thật (đăng nhập, cookie và CSRF như web app), không ghi thẳng DB. Chạy lại nhiều lần được: bản ghi đã có (theo mã,
email hoặc tên) được bỏ qua, quyền của vai trò được chỉnh về đúng bảng 1.3.

```bash
node tools/crm/seed-svn.mjs --step=tenant [--tenant=svn]
node tools/crm/seed-svn.mjs --step=legacy [--tenant=svn]
node tools/crm/seed-svn.mjs --step=inventory [--tenant=svn]
node tools/crm/seed-svn.mjs --step=crm [--tenant=svn]
node tools/crm/seed-svn.mjs --step=pricing [--tenant=svn]
node tools/crm/seed-svn.mjs --step=finance [--tenant=svn]
node tools/crm/seed-svn.mjs --step=warranty [--tenant=svn]
```

## Cần có

- Stack local đang chạy: API Platform (3333), inventory-api (3336), workspace-api (3337), crm-api (3344), worker
  (khởi tạo phân hệ cho tenant, chuyển sự kiện giữa phân hệ). Từ bước `pricing` cần thêm procedure-api (3334), từ
  bước `finance` cần finance-api (3341). Xem `infrastructure/docker/compose.local.yml` và `pnpm dev`.
- Biến môi trường. Script tự nạp `.env` ở gốc repo nếu có; biến đặt trong shell được ưu tiên.

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `SVN_SEED_PASSWORD` | Có | Mật khẩu của QTV và 10 tài khoản nghiệp vụ (6 đến 128 ký tự). Không ghi vào repo. |
| `SVN_SEED_SUPERADMIN_PASSWORD` | Có, hoặc `SEED_SUPERADMIN_PASSWORD` trong `.env` | Mật khẩu `superadmin@platform.local`. |
| `INTERNAL_SERVICE_TOKEN` | Có (đã có trong `.env`) | Gọi route nội bộ: organization context, giữ hàng cũ. |
| `SVN_SEED_SUPERADMIN_EMAIL` | Không | Mặc định `superadmin@platform.local`. |
| `SVN_SEED_PLATFORM_API_URL` | Không | Mặc định `http://localhost:3333/api`. |
| `INVENTORY_API_URL`, `WORKSPACE_API_URL`, `CRM_API_URL`, `FINANCE_API_URL`, `PROCEDURE_API_URL` | Không | Lấy từ `.env`; mặc định cổng local. |
| `SVN_SEED_TENANT_DB_HOST`, `SVN_SEED_TENANT_DB_PORT` | Không | DB của tenant mới; mặc định `localhost:55436`. |
| `SVN_SEED_PROVISION_TIMEOUT_MS` | Không | Thời gian chờ worker khởi tạo phân hệ; mặc định 5 phút. |
| `SVN_SEED_OUTPUT_DIR` | Không | Thư mục ghi ảnh chụp tồn của bước `legacy`; mặc định thư mục tạm của hệ điều hành. |
| `SVN_SEED_EVENT_TIMEOUT_MS` | Không | Thời gian chờ Bán hàng nhận kết quả xuất kho (qua worker) ở bước `finance`, `warranty`; mặc định 90 giây. |

## Thứ tự chạy

1. `--step=tenant` (T0-18), trên code hiện tại.
2. `--step=legacy` (T0-19), ngay sau bước 1 và **trước** khi áp migration Kho mới.
3. Cập nhật code, chạy migration mới (worker nâng cấp phân hệ cho tenant).
4. `--step=inventory` (T1-33), sau khi migration Kho mới đã áp.
5. `--step=crm` (T2-24), `--step=pricing` (T3-18), `--step=finance` (T5-14), `--step=warranty` (T6-10), đúng thứ tự
   này: `pricing` cần nhóm khách của `crm`; `finance` và `warranty` cần khách của `crm` và bảng giá của `pricing`.

Tenant `svn2`, `svn3`, `svn-perf` chỉ chạy bước `tenant` với `--tenant=<slug>`.

## Bước `tenant`

- Tạo tenant (tên "SVN Test"), DB riêng tên theo slug (`svn-perf` thành `svn_perf`), QTV `qtv@<tenant>.local`
  (Platform tạo khi khởi tạo tenant, có vai trò quản trị tenant).
- Bật phân hệ `crm`, `inventory`, `finance`, `procedure-engine`, `workspace`, `hrm`; chờ worker khởi tạo xong.
- Tạo Permission và vai trò theo bảng 1.3, 10 tài khoản `<ký hiệu>@<tenant>.local` (ví dụ `nv1@svn.local`), gán vai trò.
  TN và QL có thêm `procedure.access` (bảng 1.3 chưa ghi) để duyệt báo giá, vượt hạn mức trên Quy trình; thiếu quyền
  này procedure-api trả 403 `MODULE_ROLE_FORBIDDEN` và phiên duyệt kẹt ở Chờ duyệt.
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

## Bước `inventory`

Dữ liệu Kho mới cho Bán hàng, chỉ qua API chứng từ kho (`v1/stock-documents`), lô và serial. Cần bước `legacy` trước
(kho, `QA-KHO-LAP` với `SN001` đến `SN040`, `QA-KHO-MUC`).

- Kho `QA-KHO-HN`, `QA-KHO-CL` (cách ly), `QA-KHO-LOI` (hàng lỗi): tạo nếu chưa có.
- Mặt hàng dịch vụ `QA-KHO-BT` (gói bảo trì), `QA-KHO-PM` (phần mềm), loại `SERVICE`; `QA-KHO-LAP` bảo hành 12 tháng.
- Chứng từ nhập mua (ghi sổ thẳng) vào `QA-KHO-HN`, mỗi chứng từ một `idempotencyKey` cố định
  `qa-seed-inventory:<tenant>:<khoá>`: chạy lại trả chứng từ đã có, chứng từ còn Nháp thì ghi sổ tiếp.
  - `QA-KHO-MUC` lô L01 (30, hạn 31/12 năm nay), L02 (20, hạn 30/11 năm nay), L03 (10, hạn 31/12 năm trước, đã hết
    hạn), L04 (15, hạn 30/6 năm sau), đơn giá 250.000; sau đó đổi L04 sang Cách ly có lý do.
  - 5 serial dự phòng `SN-DP01` đến `SN-DP05` của `QA-KHO-LAP` (Q9), đơn giá 15.000.000.
- Serial `SN039` chuyển Cách ly có lý do (TC-INV-12).
- Cuối bước in hạn dùng, chất lượng từng lô, gợi ý FEFO xuất 10 (mong đợi L02 rồi L01, không có L03, L04) và số serial
  dự phòng, serial Cách ly.
- Chạy vào tháng 12 thì L02 đã quá hạn theo lịch; test FEFO khi đó cần tenant mới seed lại.

## Bước `crm`

Mỗi nhân viên tự tạo dữ liệu của mình (đăng nhập bằng tài khoản đó) để test phạm vi dữ liệu (TC-PERM-02, TC-PERM-04).

- Chạy chuyển khách Workspace sang Bán hàng trước (cùng hàm với `migrate-workspace-customers.mjs`, bằng QTV).
- QTBH tạo 3 nhóm khách: `QA-CRM-DL1` "Đại lý cấp 1", `QA-CRM-VIP` "VIP", `QA-CRM-DA` "Dự án".
- 30 khách `QA-CRM-KH01` đến `KH30`: NV1 có KH01 đến KH10, NV2 có KH11 đến KH20, NV3 có KH21 đến KH30; nhóm xoay
  vòng DL1, VIP, Dự án; MST riêng (KH01 mang `0101234567` cho TC-CUS-05, TC-OPP-03), tỉnh và khu vực Bắc, Trung,
  Nam, thời hạn thanh toán 30 ngày. Mỗi khách một người liên hệ chính, KH01, KH06... thêm kế toán trưởng.
- 10 lead `QA-CRM Lead 01` đến `10` chia NV1, NV2, NV3: Mới, Đang chăm sóc, một Không tiềm năng; lead 10 cùng MST KH01.
- 15 cơ hội `QA-CRM CH01` đến `CH15` ở đủ 7 giai đoạn (NV1 có cả 7). Cơ hội Thắng cần báo giá được khách chấp nhận:
  script lập báo giá dòng `QA-KHO-BT` giá nhập tay, gửi duyệt (TN hoặc QL duyệt trực tiếp nếu cần), gửi khách, khách
  chấp nhận, rồi chuyển Thắng. Bước này chạy trước `pricing` nên cách duyệt báo giá lúc đó là DIRECT.
- Mỗi nhân viên 3 hoạt động: gọi điện quá hạn 3 ngày (mở), gặp khách sau 3 ngày (mở), email 7 ngày trước (đã xong).
- Cuối bước in số khách theo người phụ trách, số khách NV1 thấy (10) và số thẻ kanban theo giai đoạn.

## Bước `pricing`

- QTBH: bảng giá chuẩn `QA-CRM-BG-CHUAN` (`QA-KHO-CAP` 1.000.000, `QA-KHO-LAP` 20.000.000, `QA-KHO-MUC` 400.000,
  `QA-KHO-BT` 5.000.000, `QA-KHO-PM` 12.000.000, VAT 10%) và bảng giá Đại lý cấp 1 `QA-CRM-BG-DL1` gán nhóm
  `QA-CRM-DL1` (CAP 950.000, LAP 19.000.000, MUC 380.000), hiệu lực từ 1/1 năm nay.
- Chính sách `QA-CRM-CS-BAC` bậc số lượng 1-9 giảm 2%, 10-49 giảm 5%, từ 50 giảm 8%; chương trình `QA-CRM-CS-T12`
  giảm 3% từ 1/12 đến 31/12 năm nay, cộng dồn; trần tổng 10%. Ngưỡng duyệt NV 5%, TN 15%, QL không giới hạn, biên
  lợi nhuận tối thiểu 10%.
- QTV tạo và công bố ở Quy trình hai định nghĩa nhóm "Kinh doanh": `QA-CRM-DUYET-BG` "Duyệt báo giá" (bước 1 mọi
  nhân viên gửi, bước 2 chức danh `SVN-KD-TN` duyệt) và `QA-CRM-DUYET-HM` "Duyệt vượt hạn mức công nợ" (bước 2 chức
  danh `SVN-KD-QL`). QTBH gắn `approval_bindings` QUOTE và ORDER_CREDIT vào hai quy trình này. Không tạo, công bố được
  quy trình thì gắn DIRECT và in lý do.
- Cuối bước in thử tính giá 9, 10, 50 `QA-KHO-CAP` (2%, 5%, 8%; 9 cái thành tiền 8.820.000), 50 cái ngày 15/12 (chạm
  trần 10%), giá nhóm Đại lý và cách duyệt hiện tại.

## Bước `finance`

- QTV: tài khoản `QA-TC-TM` (quỹ tiền mặt) và `QA-TC-VCB` (ngân hàng Vietcombank), cài đặt Tài chính không cho tự duyệt.
- Hạn mức và dư nợ: KH01 hạn mức 200 triệu, nợ 50 triệu quá hạn 30 ngày (dưới hạn mức); KH02 hạn mức 100 triệu, nợ 95
  triệu quá hạn 61 ngày (sát hạn mức); KH03 hạn mức 50 triệu, nợ 80 triệu quá hạn 91 ngày (vượt hạn mức).
- Khoản quá hạn tạo bằng hợp đồng mua bán (dòng dịch vụ `QA-KHO-BT`) có ngày ký trong quá khứ và một đợt thanh toán
  "khi ký" 100%, hạn 0 ngày: xác nhận hợp đồng ghi nợ đúng ngày ký. Không dùng đơn giao hàng vì Bán hàng ghi nợ theo
  ngày Kho ghi sổ chứng từ xuất (luôn là hôm nay), xem mục giới hạn dưới đây.
- Thêm một đơn của NV1 cho KH01 (2 `QA-KHO-CAP`) giao hôm nay: thủ kho TK ghi sổ chứng từ xuất, Bán hàng ghi nợ chưa
  đến hạn.
- Cuối bước in dư nợ, hạn mức, khoản quá hạn theo nhóm tuổi nợ của 3 khách (đọc bằng KT).

## Bước `warranty`

- Đầu bước QTV cấu hình kho bảo hành của tenant thử nghiệm: kho cách ly `QA-KHO-CL`, kho lỗi `QA-KHO-LOI`, kho nhập lại
  hàng Đạt `QA-KHO-HN` (kho của bước `inventory`). Từ crm migration 0013 không còn kho mặc định; chưa cấu hình thì nhận
  hàng, chuyển kho bảo hành bị chặn (409).
- NV1 lập đơn `QA-KHO-LAP` 1 cái, đợt giao và ngày chứng từ xuất đặt ở mốc quá khứ, TK chọn serial và ghi sổ: `SN031`
  (KH08, 3 tháng trước), `SN032` (KH09, 11 tháng), `SN033` (KH10, 13 tháng), `SN034` theo hợp đồng nguyên tắc bảo hành
  24 tháng (KH08) và `SN035` theo hợp đồng 6 tháng (KH09), cùng 8 tháng trước. Hợp đồng do QTV tạo, người phụ trách NV1.
- Cuối bước KTV tra cứu từng serial, in ngày giao, nguồn và hạn bảo hành, cảnh báo serial có ngày giao khác mốc.

### Giới hạn: không lùi được ngày giao qua API

Bán hàng lấy ngày giao (mốc bảo hành, ngày ghi nợ, dòng doanh thu) từ `postedAt` của sự kiện `inventory.stock.issued`;
Kho đặt giá trị này bằng `now()` lúc ghi sổ (`postgres-stock-document.store.ts`, `UPDATE ... posted_at = now()`), không
theo `documentDate`. Vì vậy đơn seed luôn giao "hôm nay": `SN031` đến `SN035` hiện có hạn tính từ ngày chạy seed (đúng
nguồn hạn MATERIAL 12 tháng, CONTRACT 24 và 6 tháng, nhưng chưa có serial sắp hết hạn hay đã hết hạn). Chứng từ xuất
vẫn mang ngày chứng từ quá khứ. Muốn test hạn theo mốc thời gian, chạy `backdate-deliveries.mjs` (mục dưới) sau bước
`warranty`.

## Lùi ngày giao serial bảo hành (T6-13)

```bash
node tools/crm/backdate-deliveries.mjs --tenant=svn [--dry-run]
```

- Ghi thẳng SQL vào DB tenant nên **từ chối** host khác `localhost`, `127.0.0.1`. URL lấy từ
  `TENANT_DATABASE_URL_TEMPLATE` trong `.env` (`{databaseName}` là slug, `-` thành `_`).
- Đặt `crm_schema.delivery_plans.issued_at` của đợt giao chứa serial (đơn seed ghi chú `seed-svn:warranty:<serial>`)
  về 9 giờ sáng giờ Việt Nam của mốc: `SN031` 3 tháng trước, `SN032` 11 tháng, `SN033` 13 tháng, `SN034`, `SN035` 8
  tháng. Đây là cột duy nhất tra cứu bảo hành đọc làm ngày giao (`postgres-warranty.store.ts`, rồi
  `domain/warranty-period.ts`). Ngày xuất ở Kho (`inventory_schema.serial_movements.occurred_at`) chỉ được đọc khi
  `issued_at` rỗng nên không sửa; bảng đó và chứng từ đã ghi sổ còn bị trigger append-only chặn UPDATE. Vì vậy lịch
  sử serial ở Kho, sổ công nợ và `sales_facts` của các đơn này vẫn mang ngày chạy seed.
- Mốc tính theo hôm nay: chạy lại cùng ngày không đổi gì; chạy ngày khác thì dời theo để vẫn đúng "N tháng trước".
- Kết quả mong đợi (KTV tra `GET /api/crm/v1/warranty/lookup?serial=`): `SN031` còn khoảng 9 tháng (MATERIAL 12),
  `SN032` còn khoảng 1 tháng, `SN033` hết hạn, `SN034` còn khoảng 16 tháng (CONTRACT 24), `SN035` hết hạn (CONTRACT 6),
  khớp TC-WAR-01, 02, 03, 05.

## UAT tự động (TC-UAT-01 đến 09)

```bash
node tools/crm/uat-e2e.mjs --tenant=svn [--roles-only]
```

- Chạy 21 bước TC-UAT-01 (`docs/crm/TEST.md` mục 3.9) qua API thật, đăng nhập đúng tài khoản từng bước (NV1, TN,
  QTBH, TK, KT, QTV, KTV, QL); duyệt báo giá bằng TN trên Procedure Engine
  (`POST /api/procedure/v1/instances/:id/actions`, `approve`). Chờ hiệu ứng qua worker bằng hỏi lại (60 giây,
  `UAT_EVENT_TIMEOUT_MS`). In bảng ĐẠT/LỖI theo bước; có LỖI thì mã thoát 1. `--roles-only` chỉ chạy kiểm vai trò.
- Mỗi lượt dùng tiền tố `QA-UAT-<thời điểm>`: lead và khách mới, 21 serial mới `QAU<thời điểm>-01..21` QTV nhập mua
  vào `QA-KHO-HN` (bước 0) để không dùng serial seed mà test case khác cần. Chạy lại được; mỗi lượt để lại một khách,
  hợp đồng, đơn đã hoàn tất, yêu cầu bảo hành đã đóng.
- Thao tác thêm so với bảng 3.9, đúng như người dùng phải làm trên màn hình: QTBH chọn kho giữ hàng cho hợp đồng (hợp
  đồng chuyển từ báo giá chưa có kho); NV1 bỏ đợt giao mặc định rồi lập 2 đợt, gửi yêu cầu xuất kho trước khi TK xử lý;
  QTV chọn lý do thu (tạo `QA-TC-THU-BH` "Thu tiền bán hàng" nếu chưa có), nhóm đối tượng "Khách hàng", tài khoản
  `QA-TC-VCB` rồi ghi sổ phiếu thu; KTV gửi lệnh nhận hàng, TK ghi sổ chứng từ nhập trả.
- Bước 3 (nhắc lịch): nhắc chỉ phát trước hạn theo cấu hình (mặc định 30 phút) nên script tạo thêm một hoạt động hạn
  sau 10 phút và đọc `notification_schema.notifications` ở DB tenant local (chỉ đọc, chỉ localhost) vì API đọc thông
  báo nằm ở realtime-api, không có trong stack dev. Cần notification-worker chạy.
- Bước 20: dòng thời gian kiểm 8 trong 9 loại của TC-CUS-10; kịch bản không có đổi trả nên không kiểm loại đó.
- TC-UAT-02 đến 09: kiểm nhanh phạm vi và quyền qua API (NV1 không thấy khách của NV3, TN thấy khách cấp dưới,
  TK bị 403 ở báo giá, KT xem tuổi nợ, KTV không lập đơn, QL xem đủ 4 báo cáo...). Phần còn lại của các kịch bản này là
  thao tác trên giao diện, vẫn làm tay.

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

## Dữ liệu lớn và đo hiệu năng (T7-10)

`tools/crm/seed-perf.mjs` dựng dữ liệu hiệu năng theo `docs/crm/TEST.md` mục 1.3 ("svn-perf") và
`tools/crm/measure-perf.mjs` đo theo mục 1.4 (TC-PERF-01 đến TC-PERF-04).

```bash
# DB mới, dùng xong bỏ, trên PostgreSQL local (ví dụ container test): tạo DB crm_perf_<số> rồi chạy migration crm.
node tools/crm/seed-perf.mjs --url=postgres://postgres:<mật khẩu>@localhost:<cổng>/postgres --create-db --out=/tmp/crm-perf.json
# Hoặc DB tenant svn-perf local đã có crm_schema (đã chạy migration 0011), chưa có dữ liệu hiệu năng:
node tools/crm/seed-perf.mjs --url=postgres://<user>:<mật khẩu>@localhost:55436/svn_perf

pnpm nx build module-crm
node tools/crm/measure-perf.mjs --url=postgres://.../crm_perf_<số> --seed=/tmp/crm-perf.json [--explain] [--only=TC-PERF-04]
```

- Cả hai script **từ chối** URL không phải `localhost` hoặc `127.0.0.1`. Seed ghi thẳng SQL vào `crm_schema` (không qua
  API) nên chỉ dùng cho DB thử; không chạy trên DB có dữ liệu thật.
- Seed (khoảng 30 giây): 30 nhân viên trong 5 nhóm (mỗi nhóm 6 người, người đầu là trưởng nhóm; id ngẫu nhiên ghi vào
  file `--out`, mặc định `<thư mục tạm>/crm-perf/<db>.json`), 5 nhóm khách, 50.000 khách (mã `PF000001`...),
  50.000 cơ hội, 30.000 báo giá, 10.000 hợp đồng, 50.000 đơn bán có một đợt giao (khoảng 20% còn chờ giao, trễ hạn),
  600.000 dòng `sales_facts` trải 12 tháng, 2.000 mặt hàng, 20 nhóm hàng, sổ công nợ một khoản nợ mỗi đơn đã giao
  (một nửa đã thu). `--scale=N` nhân số khách và đơn. DB đã có khách `PF000001` thì dừng, không seed chồng.
- Đo: gọi thẳng các store Postgres đã build của `module-crm` (đúng câu SQL API chạy), không qua HTTP, guard,
  access-decision. Ba phạm vi: toàn bộ (`crm.read.all`), nhóm (6 người), của tôi (1 người). Danh sách: trang 1, trang
  100 (đi lần lượt bằng con trỏ), tìm theo tên, lọc nhóm khách, kanban, đơn giao trễ. Báo cáo: doanh thu 12 tháng theo
  từng chiều, chuyển đổi 12 tháng, cảnh báo, công nợ. Mỗi phép đo 5 lần làm nóng, 50 lần đo, in p95 và Đạt/LỖI theo
  ngưỡng (danh sách 1 giây, báo cáo 5 giây); có phép đo vượt ngưỡng thì mã thoát 1. `--explain` in
  `EXPLAIN (ANALYZE, BUFFERS)` của câu chậm nhất.
- Xoá DB thử sau khi đo: `DROP DATABASE "crm_perf_<số>" WITH (FORCE)`.
