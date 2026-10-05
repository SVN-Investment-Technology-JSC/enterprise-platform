# KẾ HOẠCH SỬA LỖI NHÓM DÙNG CHUNG (HRM_FIX_04_CHUNG_PLAN.md)

Phạm vi: lỗi không thuộc riêng một nhóm người dùng nhưng ảnh hưởng toàn module HRM - chuẩn giao diện dùng chung (`packages/shared/ui`), kiến trúc backend `module-hrm`, test/lint/CI và hạ tầng. Làm **sau** ba nhóm (Cá nhân, HR, Quản trị viên) nhưng **xen kẽ theo từng PR nhỏ** khi một task nhóm trước cần một thành phần dùng chung (ví dụ `FIX-A-13` cần `FormDialog`).

Khung điều phối, quy ước commit: `HRM_FIX_00_OVERVIEW_PLAN.md`.

Nguyên tắc riêng của nhóm này: **mỗi PR một chủ đề, không trộn refactor với sửa lỗi nghiệp vụ**; chuyển dần theo màn hình (mỗi PR một file lớn), không đổi hàng loạt.

---

## FIX-D-01 - FormDialog, Drawer, Popconfirm, toast và API client dùng chung

Gộp các issue: ISS-UI-005 (High), ISS-UI-016, 017, 019, 020, 021, 026, 029, 030 (Medium).

**Hiện trạng.**

- `MinimalPopupForm` trong `shared-ui/minimal-popup-form.tsx` thực chất là form liên hệ 3 trường hard-code (họ tên, email, điện thoại; regex điện thoại sai `[3|5|7|8|9]`); khi truyền `children` chỉ trả về children trần (không `<form>`, footer, khóa double-submit, xử lý lỗi), không có focus trap, dùng `id` cố định, Esc nghe ở `window`.
- HRM có 0 chỗ dùng; tự dựng Dialog ở 18 nơi qua `hrm/ui/hrm-action-dialog.tsx`, cộng `create-employee-dialog.tsx`, các dialog trong `shifts-screen.tsx`, `employees-screen.tsx`, `requests-screen.tsx`, `attendance-screen.tsx`, `time-settings-screen.tsx`.
- Drawer HRM đo 576px (chuẩn 580-720px); modal tự dựng thiếu focus trap (Tab rò ra sidebar); label không `htmlFor`, tab tự dựng thiếu `role="tab"`; thẻ chọn ngạch lương là `div onClick`.
- HRM có toast riêng (`hrm/ui/toast.tsx`) song song với `sonner`; 14/18 màn không báo thành công.
- `fetch` thô chép `csrfToken()` nhiều bản (ví dụ `employees-screen.tsx:56`, `profile-screen.tsx:64`, `requests-screen.tsx`), không refresh khi 401, bỏ qua `message` của server.
- Popconfirm tự viết hoặc dùng antd trực tiếp, sai màu nút OK.
- `SearchableSelect` (76 chỗ dùng trong HRM) thiếu `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, không nhận `id`/`aria-label`; không portal nên bị cắt trong Dialog/Sheet.

**Việc cần làm (chia 5 PR).**

1. **FormDialog** (`packages/shared/ui/src/lib/form-dialog.tsx`): props `open`, `onClose`, `title`, `subtitle`, `size` (`md|lg`), `onSubmit(values, e)` bất đồng bộ, `busy`, `submitLabel`, `error`; có `<form>`, footer cố định, khóa double-submit, focus trường lỗi đầu tiên, ESC chỉ đóng khi không `busy`, focus trap và trả focus, `id` sinh bằng `useId`. Xuất lại `MinimalPopupForm` làm alias; ví dụ form liên hệ chuyển thành `ContactPopupForm`. Test RTL.
2. **Drawer** (`shared-ui`): `<Drawer open onOpenChange width={600} title code status tabs footer busy closeOnBackdrop />`, chiều rộng kẹp 580-720px, header cố định, body tự cuộn, ESC + focus trap + backdrop; thay `hrm/ui/sheet.tsx`. Hai drawer HRM đang 576px chuyển sang đây.
3. **Popconfirm và toast:** chỉ dùng `Popconfirm` của shared-ui (`okType="primary"` cho Duyệt, `danger` cho Từ chối/Hủy/Xóa; truyền promise trực tiếp vào `onConfirm`); thêm helper `notify` trong module-shell; quy ước: thành công → `toast.success`, lỗi form → inline, lỗi trang → `ErrorState`; xóa `hrm/ui/toast.tsx`, `hrm/ui/dialog.tsx`, `hrm/ui/button.tsx` sau khi thay hết.
4. **API client** (`createApiClient({ baseUrl, onSessionExpired })` trên `authFetch`): trả `ApiError { status, message, fieldErrors }`, refresh khi 401, phát sự kiện khi 403; HRM dùng `hrmFetch` thay mọi `fetch` thô; xóa mọi bản `csrfToken()`; export `getCsrfToken`.
5. **SearchableSelect ARIA:** thêm `role="combobox"`, `aria-*`, `id`, `portal` có flip, `useMemo` chuỗi đã chuẩn hóa, listener chỉ gắn khi mở; `required` dùng input ẩn `sr-only`. Phối hợp `FIX-A-11`. Chỉnh a11y còn lại (label `htmlFor`, `role="tab"`, `div onClick` thành `button`) ở các màn khi chạm tới.

**Chuyển đổi dần.** Thứ tự màn hình: requests → approvals → employees → shifts → time-settings → payroll → còn lại. Mỗi PR chuyển một màn, kèm ảnh chụp trước/sau ở 1920x1080 và 1440x900.

**Nghiệm thu.** `rg "from '../ui/dialog'|hrm/ui/toast"` trong `packages/features/hrm` không còn kết quả; Tab trong dialog không rò ra sidebar; Drawer HRM rộng trong khoảng 580-720px. **Cỡ:** L. **Phụ thuộc:** FIX-A-11 (SearchableSelect).

## FIX-D-02 - Token màu, định dạng ngày/số, nhãn tiếng Việt, bố cục master-detail

Gộp các issue: ISS-UI-024, 025, 052, 053, 055, 056, 057, 060 (đã thuộc FIX-C), 058/059 (đã thuộc FIX-B-04).

**Hiện trạng.**

- Không có token màu chung: màu `#021E73` xuất hiện **102 lần** trong `packages/features/hrm/src` (báo cáo ghi 79) ở `shifts-screen`, `requests-screen`, `profile-screen`, `employees-screen`; HRM có hai màu primary.
- Ngày hiển thị lẫn ISO `2026-01-01`, `8/10/2026`, `15:44 2/10/26`; số thập phân `-0.5` và `-0,5`; `toLocaleString()` không truyền locale (`employees-screen.tsx:1075-1076,1771,1779`, `dependents-screen.tsx:198`, `time-settings-screen.tsx:418`, `approvals-screen.tsx:205-208`, `requests-screen.tsx:372,813-818`).
- Nhãn tiếng Anh và enum thô: `ACTIVE/INACTIVE`, `OFFICIAL`, "Export", "Mode A/B", "Permission", "Dashboard" (`shifts-screen.tsx:1523`, `employees-screen.tsx:1651,1786`).
- `key={index}` cho danh sách thêm/xóa được (`attendance-screen.tsx:560`, `employees-screen.tsx:2006,2117,2219`, `payroll-settings-screen.tsx:635`, `hrm-correction-sessions.tsx:35`).
- `as any`/`(e: any)` khi map giá trị `SearchableSelect` (`employees-screen.tsx:1000,1235,2155,2496`, `requests-screen.tsx:530,2704,2785,2943`).
- Master-detail lệch tỉ lệ chuẩn 40-46/54-60, không cuộn độc lập, chiều cao số cứng; `/permissions` có hai thanh cuộn lồng nhau.
- Enter trong `HrmActionDialog` có `confirmTitle` báo lỗi khó hiểu (`hrm-action-dialog.tsx:69-76,153-170`).

**Việc cần làm.**

1. Định nghĩa token `--ep-*` (map sang biến shadcn `--primary`, `--border`...) trong shared-ui, dùng chung cho SCSS và Tailwind; thay `#021E73` theo từng PR một file lớn, bắt đầu bằng shared-ui.
2. Thêm `formatDateVi`, `formatDateTimeVi` (dd/MM/yyyy) và `Intl.NumberFormat('vi-VN')` vào shared-ui; date picker cố định dd/mm/yyyy; thay `toLocaleString()` không locale.
3. Bảng nhãn tiếng Việt chung (Đang dùng/Tạm dừng, Chính thức, Xuất file, Quyền, Bảng điều khiển).
4. Sinh `id` bằng `crypto.randomUUID()` khi thêm dòng thay cho `key={index}`.
5. `SearchableSelect` generic theo union value hoặc type guard để bỏ `as any`.
6. `MasterDetailSplit` trong shared-ui: `grid minmax(0,0.44fr) minmax(0,0.56fr)`, mỗi cột cao `calc(100dvh - header)` và `overflow-y-auto`, scrollbar hover-reveal; áp cho employees, requests, shifts, profile, payroll; sửa rail cố định 16rem.
7. `HrmActionDialog`: cho Enter mở Popconfirm thay vì báo lỗi, hoặc chặn Enter-submit.

**Nghiệm thu.** `rg "#021E73"` chỉ còn trong file định nghĩa token; ngày/số hiển thị thống nhất; ở 1440x900 không còn cột ngoài khung. **Cỡ:** M. **Phụ thuộc:** FIX-D-01 (một phần).

## FIX-D-03 - Kiến trúc backend: tầng application, zod, bộ lọc lỗi, phân trang

Gộp các issue: ISS-BE-019, 021, 050, 051, 052, 053 (Medium).

**Hiện trạng.**

- HRM không có tầng application: controller tự dựng SQL, transaction, audit và luật nghiệp vụ (`hrm-employee.controller.ts` ~1460 dòng, `hrm-leave.controller.ts` ~1116, `hrm-salary.controller.ts` ~1046; cả 18 controller); worker phải import thẳng hàm infrastructure.
- Không có `ValidationPipe`/`class-validator`/`zod` (`apps/hrm-api/src/main.ts:13-20`); kiểu sai rơi xuống PostgreSQL thành 500.
- Ba kiểu body lỗi khác nhau, không có exception filter; lỗi `pg` thành 500 mặc định.
- Không có quy ước phân trang chung (`hrm-employee.controller.ts:65-80,113-116`).
- HRM đọc/ghi thẳng schema của Core, Procedure, Workspace (`hrm-employee.controller.ts:127,197,209,217,259,412,617,764`, `hrm-procedure-links.ts:79,210,229-243`).
- ESLint không chặn module nghiệp vụ import platform (`eslint.config.mjs:44-51,96-120`); chỉ 3/16 scope có `depConstraints`.

**Việc cần làm (chia theo thứ tự rủi ro).**

1. **Filter lỗi:** `ProblemDetailsFilter` dùng chung (`code`, `message`, `details`, `requestId`) đăng ký ở mọi `main.ts`; ánh xạ lỗi `pg` (`23505` → 409, `23503` → 404/409, `23514`/`22P02` → 400) - đây là gốc của nhiều lỗi 500 trong báo cáo (hợp đồng, loại nghỉ trùng mã, kỳ công trùng mã, xóa người thân). Lint cấm `new XxxException('chuỗi')`.
2. **Validation:** schema zod trong `packages/contracts/hrm` + `ZodValidationPipe` dùng chung; áp cho các route ghi trước (đơn từ, hợp đồng, lương); strip khóa lạ; gom `requireText/requireUuid/requireDate` vào đó.
3. **Phân trang:** `PageQuery`/`PageMeta` trong contracts + helper parse chung; áp cho danh sách nhân viên, đơn, kỳ công, kỳ lương (liên quan `FIX-B-04`).
4. **Tầng application:** tách `application/*-service.ts` nhận `(actor, input)`; SQL chuyển vào `infrastructure/*-repository.ts` sau port. Bắt đầu từ **leave, payroll, request** (cùng lúc với `FIX-B-01` và `FIX-B-08`); không refactor controller chưa liên quan.
5. **Ranh giới module:** ghi employee qua API/event của Core; đọc định nghĩa quy trình qua `/v1/internal/*` của Procedure Engine; lấy nhãn dự án qua `InternalLookupService` của Workspace; thêm `architecture-boundary.spec.ts` cho HRM; bổ sung `depConstraints` cho `scope:hrm`.

**Nghiệm thu.** Không còn lỗi `pg` lọt thành 500 trong các luồng đã liệt kê; body lỗi thống nhất; controller của leave/payroll/request mỏng (không còn SQL trực tiếp). **Cỡ:** L. **Phụ thuộc:** làm xen kẽ với FIX-B-01, FIX-B-08.

## FIX-D-04 - Test, lint và CI cho HRM

Gộp các issue: ISS-BE-057, 058, ISS-OPS-030, 038, 039, 041, 042, 045, 046, 047, 075 (Medium).

**Hiện trạng.**

- `contracts-hrm` chỉ có type, không export mảng enum runtime; `module-hrm` có 191 `as any` (42 trong mã chạy thật, 10 controller); 223 `no-explicit-any` trong repo; 45 `no-non-null-assertion` (24 trong mã nguồn).
- 11/18 spec HRM là integration và `describe.skip` khi thiếu `HRM_TEST_ADMIN_URL`: **117 test bị skip** trên CI (chạy có env thì 119/119 qua); số dư phép, tính lương, tính công, chuyển trạng thái đơn không được test trên CI. Target test của `module-hrm` không khai báo input env nên Nx có thể replay kết quả "skipped".
- 6 project không có ESLint config (`apps/hrm-api`, `packages/contracts/hrm`, `packages/features/hrm`, ...); `feature-inventory`/`feature-workspace` không có `tsconfig`; `hrm-web` có `dependsOn: ["typecheck"]` trỏ tới target không tồn tại.
- `hrm-api` test là `nx:noop`; `passWithNoTests` toàn cục làm nhiều project 0 spec luôn xanh; không có e2e cho HRM.
- Worker platform đóng gói nguyên `module-hrm`, `module-hrm` phụ thuộc contract Procedure (ngược README).

**Việc cần làm.**

1. Export `XXX_VALUES as const` trong contracts + helper `parseEnum(value, ALLOWED, field)`; thay dần `as any` bằng interface row và `pool.query<Row>()` trong các controller đang chạm.
2. Tách phần tính toán thuần (số dư phép, công thức lương, tính công) ra `domain/` để unit test chạy không cần DB.
3. CI: job integration có `postgres:17`, đặt `HRM_TEST_ADMIN_URL`, `RBAC_TEST_ADMIN_URL`; thêm `inputs: [..., { env: 'HRM_TEST_ADMIN_URL' }]` cho target test của `module-hrm` và log cảnh báo rõ khi suite bị skip; job smoke chạy `docker compose -f compose.full.yml up --wait`, curl các endpoint qua gateway.
4. Thêm `eslint.config.mjs` cho các project thiếu (theo mẫu `packages/features/maintenance/eslint.config.mjs`), sửa lỗi phát sinh theo đợt; bật `typecheck` cho `hrm-web`.
5. `hrm-api-e2e` (jest qua gateway) cho luồng: đăng nhập → tạo nhân viên → gửi đơn → duyệt → lương; một smoke Playwright cho `hrm-web`. Bỏ `passWithNoTests` mặc định, chỉ bật cho contract thuần type.
6. Ghi lại ngoại lệ tường minh hoặc chuyển job HRM sang consumer của `hrm-api` để worker không gói module HRM.

**Nghiệm thu.** CI chạy integration (không còn 117 test skip), lint chạy cho mọi project HRM, có e2e cho HRM. **Cỡ:** M-L. **Phụ thuộc:** không.

## FIX-D-05 - Gateway, nâng `next`, README, script seed

Gộp các issue: ISS-OPS-007 (High), ISS-OPS-018, 021, 022, 026, 027, 054, 069, 072, 081 (Medium/Low).

**Việc cần làm.**

| Việc | Chi tiết | Nguồn |
| :--- | :--- | :--- |
| Nâng `next` | Lockfile đang `next@16.3.1` (3 advisory RCE) và `sharp@0.35.3`; nâng `next` và `eslint-config-next` lên 16.3.8 trở lên ở root, 6 app web và `packages/features/hrm/package.json`; xác nhận `sharp >= 0.35.4` (hoặc `pnpm.overrides`); build lại 6 image web, smoke 12 endpoint | ISS-OPS-007 |
| Trang bảo trì | `/api/hrm/`, `/modules/hrm*` thêm `proxy_intercept_errors on` + `error_page 502 503 504`, JSON 503 cho API, `hrm-maintenance.html` cho web; `hrm-api` đổi `depends_on` từ `service_started` sang `service_healthy` | ISS-OPS-026 |
| Nginx local | `infrastructure/nginx/nginx.conf` thiếu `/api/hrm` và `proxy_buffer_size/proxy_buffers` (lỗi 502 khi login còn ở local); tách phần `server {}` chung ra file include, CI so khớp danh sách `location` giữa hai file | ISS-OPS-027 |
| Rewrites cứng | `rewrites()` của `apps/hrm-web/next.config.js` ghi cứng `localhost:333x` lúc build; bỏ rewrites khi `output: 'standalone'`, thêm `location ^~ /api/ { return 404; }` sau các location cụ thể | ISS-OPS-018 |
| Dockerfile | Bỏ dòng COPY hard-code `@swc+helpers@0.5.23` trong Dockerfile web; bổ sung `.dockerignore` (`docs`, `HRM`, `docs_test`, `.agents`, `.github`, `**/.env*`, `**/*.tsbuildinfo`) để không mất cache cả 15 image | ISS-OPS-021, 022 |
| Tài liệu | README Docker cập nhật: sơ đồ 19 service, bảng URL/health, bảng port 3000-3008 và 3333-3339, mục xử lý sự cố MinIO, danh sách 5 module; thêm mục "Chạy e2e/integration" (`HRM_TEST_ADMIN_URL`, `BASE_URL`, quyền `CREATE DATABASE`) | ISS-OPS-054, 081 |
| Script mồ côi | `package.json:40` `seed:hrm` trỏ `scripts/seed-hrm-demo.mjs` không tồn tại: xóa hoặc khôi phục file; gỡ dependency thừa (`api` → `shared-ui`, `hrm-web` → `contracts-hrm`/`shared-ui`) và bật `@nx/dependency-checks` | ISS-OPS-069, 072 |

**Nghiệm thu.** `pnpm audit --prod` không còn advisory của `next`/`sharp`; 502/503 trên `/modules/hrm` hiển thị trang bảo trì; README khớp thực tế. **Cỡ:** S-M.

---

## Thứ tự và xen kẽ

| Thời điểm | Làm gì |
| :--- | :--- |
| Trong Nhóm 1 | `FIX-D-01` bước 5 (ARIA SearchableSelect) và bước 4 (API client) khi cần cho `FIX-A-11`, `FIX-A-12`; `FIX-D-03` bước 1 (filter lỗi) sớm vì giải quyết nhiều lỗi 500 |
| Trong Nhóm 2 | `FIX-D-03` bước 3-4 cùng `FIX-B-01`, `FIX-B-04`, `FIX-B-08`; `FIX-D-01` bước 1-2 (FormDialog, Drawer) khi chuyển màn duyệt |
| Trong Nhóm 3 | `FIX-D-05` (nâng `next`, gateway) cùng `FIX-C-07` vì cùng cấu hình hạ tầng |
| Sau cùng | `FIX-D-02` (token, định dạng), `FIX-D-04` (CI, lint) chuyển dần theo từng PR |

## Kiểm thử nghiệm thu nhóm

- Chạy lại file test HRM: không phát sinh Bỏ qua mới do đổi nhãn (nếu có đổi nhãn thì cập nhật test case cùng PR).
- Chụp ảnh các màn đã chuyển ở 1920x1080 và 1440x900, đính kèm PR.
- `pnpm nx run-many -t lint test -p shared-ui feature-hrm module-hrm contracts-hrm hrm-api hrm-web` xanh; `typecheck` cho các project bị chạm.
