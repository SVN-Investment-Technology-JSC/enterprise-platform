# Hướng dẫn test: Phiếu thu/chi từ Quy trình và mã phiếu mới

Tài liệu này dành cho người kiểm thử (QA, kế toán tham gia UAT, lập trình viên). Phạm vi gồm ba tính năng:

1. **Mã phiếu mới.** Mã chính thức có dạng `PC-2610-0045`. Mã nháp có dạng `NHAP_PC_2610_0045`.
2. **Bước Tài chính trong Quy trình.** Khi hồ sơ tới bước này, hệ thống tự tạo phiếu thu hoặc phiếu chi. Kế toán ghi sổ thì bước đóng lại; kế toán trả hồ sơ thì hồ sơ quay về bước trước.
3. **Đảo và huỷ.** Huỷ hiệu lực hồ sơ thì phiếu tự đảo bút toán. Phiếu tạo từ hồ sơ không được đảo trực tiếp.

---

## 1. Chuẩn bị môi trường

### 1.1 Chạy hệ thống

Hạ tầng docker phải đang chạy: gateway `:8080`, platform-db `:55432`, tenant-db `:55436`, RabbitMQ `:5672`, Valkey `:56379`.

1. Chép file `.env` từ checkout chính vào thư mục đang test, nếu thư mục đó chưa có.
2. Áp migration và đăng ký module:
   ```bash
   pnpm db:provision
   ```
   > Lệnh này áp migration cho **mọi tenant** trên DB đang dùng. Nếu DB dùng chung với người khác, hãy báo trước.
3. Chạy các ứng dụng cần thiết:
   ```bash
   node tools/dev.mjs run-many -t dev serve \
     --projects=web,procedure-web,finance-web,workspace-web,api,procedure-api,finance-api,workspace-api,worker \
     --configuration=development --parallel=2 --outputStyle=stream
   ```
4. Nếu worker báo `Cannot find module 'pg'`, chạy riêng worker như sau:
   ```bash
   NODE_PATH=apps/worker/node_modules node .nx/worker-dev/main.js
   ```
5. Kiểm tra gateway `:8080` có route `/modules/finance` và `/api/finance`. Nếu bấm "Mở phiếu" mà ra 404, gateway đang chạy cấu hình nginx cũ. Khi đó, hoặc reload gateway bằng `infrastructure/nginx` hiện tại, hoặc mở thẳng app Tài chính ở `http://localhost:3009/modules/finance/...`.

> Worker **bắt buộc** phải chạy, vì phiếu chỉ được tạo, liên kết và ghi nhận kết quả qua sự kiện. Nếu thẻ phiếu trên hồ sơ đứng mãi ở "Chờ Tài chính tạo phiếu", hãy kiểm tra worker và RabbitMQ trước.

### 1.2 Bật module

Trong trang quản trị tenant, bật **Tài chính**, **Quy trình** và **Không gian làm việc** cho tenant dùng để test.

### 1.3 Tài khoản và quyền

Tạo các tài khoản sau **qua giao diện quản trị**, không ghi thẳng vào DB.

| Vai | Ví dụ | Quyền / chức danh |
|---|---|---|
| Quản trị | `admin@<tenant>` | `tenant.manage` |
| Người lập đề nghị | `thanhvien.test` | `procedure.access`; được khởi tạo quy trình |
| Người duyệt | `quanly.test` | Vai A ở bước duyệt |
| Kế toán 1 | `ketoan1.test` | Chức danh **Kế toán thanh toán (test)**; quyền `finance.read`, `finance.payment.create`, `finance.payment.approve`, `finance.receipt.create`, `finance.receipt.approve`, `finance.account.manage`, `finance.report.read`, `procedure.access` |
| Kế toán 2 | `ketoan2.test` | Như Kế toán 1, **cùng chức danh** |
| Người có quyền duyệt nhưng khác chức danh | tuỳ chọn | Có `finance.payment.approve` nhưng **không** giữ chức danh kế toán |

> Mật khẩu tài khoản dev: hỏi người quản lý môi trường. Không ghi mật khẩu vào tài liệu hay vào repo.

### 1.4 Dữ liệu Tài chính

Đăng nhập bằng quản trị hoặc Kế toán 1, vào **Tài chính → Tài khoản / Cài đặt** và tạo:
- Tài khoản ngân hàng `VCB-TEST`, số dư đầu kỳ đủ lớn (ví dụ 500.000.000), ngày bắt đầu sử dụng trước hôm nay.
- Lý do chi `TT-NCC` (Thanh toán nhà cung cấp).
- Đối tượng thu chi: mở tab "Đối tượng thu chi" một lần để hệ thống tự nạp nhóm mặc định.

### 1.5 Quy trình mẫu "Đề nghị thanh toán"

Trong **Quy trình → Thiết kế**, tạo quy trình `QT-DNTT-TEST`. Quy trình phải được gán vào một **nhóm**, nếu không sẽ không công bố được.

| Bước | Vai | Thuộc tính |
|---|---|---|
| 1. Lập đề nghị | S: người lập | `so_tien` (money, bắt buộc), `noi_dung` (text) |
| 2. Duyệt | A: người duyệt | |
| 3. Chi tiền | R: chức danh **Kế toán thanh toán (test)** | |

Ở bước 3, mở **Cấu hình bước** và cấu hình như sau:
- Bật **Bước Tài chính**, loại phiếu **Phiếu chi**.
- Để bảng ánh xạ ở chế độ "Tự khớp theo mã chuẩn".
- Ở ô "Bước nhận hồ sơ khi trả về", chọn **Lập đề nghị**.

Sau đó công bố quy trình.

---

## 2. Kịch bản test thủ công

Ghi kết quả vào bảng ở mục 5. Mỗi kịch bản ghi lại mã hồ sơ và mã phiếu.

### TC-01: Kiểm tra lúc công bố quy trình

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1 | Công bố khi bước Tài chính chưa có vai R | Bị chặn: "Bước Tài chính … phải có vai R" |
| 2 | Thêm một bước có hành động **sau** bước Tài chính rồi công bố | Bị chặn: bước Tài chính phải là bước có hành động cuối cùng |
| 3 | Xoá thuộc tính `so_tien` rồi công bố | Bị chặn: thiếu thuộc tính số tiền |
| 4 | Gán thêm vai A cho bước Tài chính | Giao diện cảnh báo chỉ dùng vai R/I; công bố bị chặn |
| 5 | Tắt finance-api rồi công bố | Bị chặn: Tài chính không phản hồi |
| 6 | Cấu hình đúng như mục 1.5 rồi công bố | Công bố thành công, kèm cảnh báo nhắc người giữ vai R phải có quyền `finance.payment.approve` |
| 7 | Sửa một ô bất kỳ trên ma trận RCSI rồi mở lại "Cấu hình bước" | Cấu hình Bước Tài chính **vẫn còn** |

### TC-02: Hồ sơ gắn dự án, ghi sổ thành công

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1 | Người lập tạo hồ sơ, gắn một dự án Workspace, nhập `so_tien` = 12.500.000 | Hồ sơ mở, ở bước Lập đề nghị |
| 2 | Người lập gửi, người duyệt duyệt | Hồ sơ tới bước Chi tiền. Thẻ phiếu hiện "Chờ Tài chính tạo phiếu", vài giây sau đổi thành "NHAP_PC_YYMM_xxxx · Chờ ghi sổ · 12.500.000 đ" |
| 3 | Ở bước Chi tiền, xem các nút | **Không** có nút Duyệt/Hoàn thành, chỉ có trao đổi và "Mở phiếu". Quản trị cũng không vượt qua (override) được bước này |
| 4 | Kế toán 1 bấm "Mở phiếu" | Mở đúng trang phiếu chi bên Tài chính |
| 5 | Xem trang phiếu | Có khối **"Nguồn: hồ sơ …"**. Số tiền, nội dung và hạch toán dự án có **icon khoá**, không sửa được. Có 1 dòng chi tiết, không thêm hay xoá dòng được |
| 6 | Kế toán 1 nhập tài khoản `VCB-TEST`, lý do, ngày hạch toán là hôm nay, rồi bấm **Ghi sổ** | Ghi sổ thành công. Mã đổi thành `PC-YYMM-xxxx`, bên dưới hiện "Mã nháp: NHAP_PC_…". Số dư `VCB-TEST` giảm 12.500.000 |
| 7 | Quay lại hồ sơ | Thẻ hiện "PC-YYMM-xxxx · Đã ghi sổ bởi Kế toán 1 · 12.500.000 đ". Hồ sơ **hoàn tất**. Nhật ký ghi người hoàn thành bước là Kế toán 1 |
| 8 | Trang dự án bên Workspace, tab Tài chính | Phiếu xuất hiện trong danh sách thu chi của dự án |

### TC-03: Hồ sơ không gắn dự án

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1 | Tạo hồ sơ **không** gắn dự án, gửi và duyệt tới bước Chi tiền | Phiếu nháp được tạo |
| 2 | Mở phiếu | Hạch toán để trống và **không khoá**. Kế toán tự chọn dự án hoặc công việc, hoặc để trống |
| 3 | Ghi sổ | Thành công |

### TC-04: Hai kế toán cùng chức danh và nhận xử lý thay

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1 | Kế toán 1 mở phiếu nháp, nhập một trường rồi lưu | Phiếu ghi nhận "Đang xử lý: Kế toán 1" |
| 2 | Kế toán 2 mở cùng phiếu | Thấy "Đang xử lý: Kế toán 1 (từ hh:mm)". Lưu, Ghi sổ và Trả hồ sơ đều bị chặn; chỉ có nút **Nhận xử lý thay** |
| 3 | Kế toán 2 bấm Nhận xử lý thay (Popconfirm) | Kế toán 2 trở thành người đang xử lý. Nhật ký phiếu ghi lại việc nhận thay |
| 4 | Kế toán 1 và Kế toán 2 cùng bấm Ghi sổ (hai trình duyệt) | Chỉ một người thành công. Người còn lại nhận thông báo phiếu đã được ghi sổ. Chỉ có **một** bút toán |
| 5 | Người có `finance.payment.approve` nhưng khác chức danh mở phiếu | Phiếu ở chế độ chỉ đọc, không có nút Ghi sổ hay Trả hồ sơ. Gọi API trực tiếp thì nhận lỗi không có quyền |
| 6 | Tắt procedure-api rồi kế toán bấm Ghi sổ | Bị từ chối: "Không xác minh được quyền ở bước quy trình…" |

### TC-05: Kế toán trả hồ sơ, người lập sửa số tiền

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1 | Kế toán bấm **Trả hồ sơ**, để trống lý do | Không gửi được; lý do là bắt buộc |
| 2 | Nhập lý do và xác nhận | Hồ sơ quay về bước Lập đề nghị, nhật ký có lý do và tên kế toán. Thẻ phiếu hiện "Kế toán đã trả hồ sơ" kèm lý do |
| 3 | Mở phiếu lúc này | Phiếu chỉ đọc. Ghi sổ bị chặn |
| 4 | Người lập sửa `so_tien` thành 3.500.000, gửi lại; người duyệt duyệt | Hồ sơ quay lại bước Chi tiền. Thẻ hiện "NHAP_PC_… · Chờ Tài chính cập nhật phiếu", rồi "Chờ ghi sổ · 3.500.000 đ" |
| 5 | Mở phiếu | **Vẫn là phiếu cũ** (cùng mã nháp), số tiền đã thành 3.500.000. Các trường kế toán đã nhập trước đó vẫn còn |
| 6 | Ghi sổ | Thành công. Hồ sơ hoàn tất |

### TC-06: Huỷ hiệu lực hồ sơ đã ghi sổ

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1 | Trên phiếu đã ghi sổ của TC-02, tìm nút đảo phiếu (kể cả với quản trị) | **Không có** nút đảo. Gọi API đảo thì bị chặn: "huỷ hiệu lực hồ sơ để đảo phiếu" |
| 2 | Vào **Tài chính → Cài đặt**, khoá sổ đến hôm nay | Lưu thành công |
| 3 | Quản trị mở hồ sơ, chọn **Huỷ hiệu lực** | Hộp thoại báo phiếu đã ghi sổ sẽ bị đảo bút toán. Xác nhận thì **bị chặn**, lý do có câu "Sổ đã khoá đến ngày …". Hồ sơ vẫn hoàn tất |
| 4 | Mở khoá sổ rồi huỷ hiệu lực lại | Huỷ thành công. Phiếu chuyển **Đã huỷ**, có 1 bút toán đảo ngày hôm nay, số dư được hoàn lại. Khối Nguồn hiện "Đã đóng" |
| 5 | Tạo hồ sơ mới, huỷ hồ sơ khi phiếu còn nháp | Phiếu nháp chuyển **Đã huỷ**, không có bút toán |

### TC-07: Mã phiếu (phiếu lập trực tiếp)

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1 | Tạo phiếu chi mới | Ô mã xem trước `NHAP_PC_YYMM_xxxx` |
| 2 | Lưu nháp, đổi ngày hạch toán sang tháng khác rồi lưu lại | Mã nháp **giữ nguyên** |
| 3 | Gửi duyệt rồi duyệt (duyệt trực tiếp) | Mã đổi thành `PC-YYMM-xxxx`, trong đó YYMM theo **ngày hạch toán** |
| 4 | Lập lệnh chuyển tiền và duyệt | Tiền tố là `CT-` |
| 5 | Tạo hai phiếu chi sang tháng mới rồi duyệt | Số thứ tự quay về `0001` |
| 6 | Tìm theo mã nháp và theo mã chính thức | Cả hai đều tìm được phiếu |
| 7 | Mở phiếu cũ (định dạng `PC_45_10_2026`) | Vẫn giữ mã cũ |

### TC-08: Bộ lọc danh sách phiếu

| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1 | Kế toán 1 chọn **"Chờ tôi ghi sổ"** | Chỉ có phiếu nháp từ hồ sơ mà Kế toán 1 phụ trách (khớp theo chức danh) |
| 2 | Chọn **"Chờ ghi sổ (tất cả)"** | Mọi phiếu từ quy trình đang chờ ghi sổ |
| 3 | Chọn **"Từ quy trình"** | Chỉ có phiếu tạo từ hồ sơ, **không** có phiếu lập trực tiếp |
| 4 | Xem cột mã | Mã nháp hiện màu nhạt. Phiếu từ hồ sơ có dòng "Từ hồ sơ …" |

### TC-09: Quy chuẩn giao diện (theo `AGENTS.md`)

- [ ] Không có emoji trên các màn đã sửa (Tài chính, cấu hình bước, thẻ phiếu).
- [ ] Mọi ô chọn đều là `SearchableSelect` (gõ để lọc, gõ không dấu được, điều hướng bằng phím).
- [ ] Trả hồ sơ và Nhận xử lý thay dùng Popconfirm; cấu hình bước dùng Dialog.
- [ ] Bố cục ổn ở 1920×1080, 1600×900 và 1440×900.

---

## 3. Test tự động (backend)

```bash
# Toàn bộ project liên quan
FINANCE_TEST_ADMIN_URL=postgres://tenant:tenant@localhost:55436/postgres \
pnpm nx run-many -t typecheck lint test \
  -p contracts-finance module-finance feature-finance finance-api \
     contracts-procedure-engine module-procedure-engine feature-procedure-engine procedure-api \
     worker platform-entitlement
```

| Bộ test | Nội dung |
|---|---|
| `packages/modules/finance/src/lib/finance.integration.spec.ts` | Mã phiếu, ghi sổ, khoá sổ |
| `packages/modules/finance/src/lib/finance-sources.integration.spec.ts` | Phiếu có nguồn: nhận yêu cầu, ghi sổ, trả hồ sơ, khoá xử lý, đảo, huỷ, reversal-check |
| `packages/modules/procedure-engine/src/lib/application/procedure-finance-step.application.spec.ts` | Kiểm tra lúc công bố, `can-act`, nhận kết quả từ Tài chính |
| `packages/modules/procedure-engine/src/lib/application/procedure-reversal.application.spec.ts` | Chặn huỷ hiệu lực khi Tài chính từ chối hoặc không phản hồi |
| `apps/worker/src/finance-procedure.e2e.spec.ts` | Xuyên module, 5 kịch bản: có dự án, không dự án, trả hồ sơ, hai kế toán, huỷ hiệu lực |

Test integration tạo database tạm `finance_test_*` trên tenant-db rồi xoá khi xong. Nếu một lần chạy bị ngắt giữa chừng, database tạm có thể còn sót lại. Xoá thủ công khi cần.

---

## 4. Lỗi đã biết (ngoài phạm vi tính năng)

| Lỗi | Ảnh hưởng | Cách xử lý tạm |
|---|---|---|
| Gateway `:8080` chạy cấu hình nginx cũ | "Mở phiếu" qua :8080 ra 404 | Reload gateway, hoặc mở thẳng `:3009` |
| Worker dev thiếu module `pg` | Worker không chạy | `NODE_PATH=apps/worker/node_modules` |
| Màn RCSI còn `<select>` HTML thường (lọc Nhóm) | Không đúng quy chuẩn | Sẽ sửa riêng |
| Hộp thoại tạo node tổ chức có emoji | Không đúng quy chuẩn | Sẽ sửa riêng |
| Avatar viết tắt sai với tên có dấu ngoặc | Hiển thị | Sẽ sửa riêng |
| Logo sidebar Tài chính vỡ khi mở thẳng `:3009` | Hiển thị | Mở qua gateway |

**Hành vi đã chốt nên không coi là lỗi:**
- Phiếu tạo từ hồ sơ không đảo trực tiếp được; muốn huỷ thì phải huỷ hiệu lực hồ sơ.
- Đảo phiếu theo hồ sơ mà lỗi thì **không tự thử lại**. Phiếu chỉ báo lỗi, kế toán xử lý nguyên nhân rồi bấm "Đảo lại".
- Bước Tài chính chỉ được có vai R và I, và phải là bước có hành động cuối cùng.

**Hành vi đang chờ xác nhận:**
- Khoá "đang xử lý" chặn người khác thao tác cho tới khi họ bấm Nhận xử lý thay.
- Hồ sơ có số tiền trống hoặc không hợp lệ vẫn tạo phiếu 0đ; phiếu này không ghi sổ được, kế toán phải trả hồ sơ.

---

## 5. Bảng ghi kết quả

| Mã | Kịch bản | Người test | Ngày | Mã hồ sơ / phiếu | Kết quả (Đạt / Lỗi) | Ghi chú |
|---|---|---|---|---|---|---|
| TC-01 | Kiểm tra lúc công bố | | | | | |
| TC-02 | Hồ sơ gắn dự án, ghi sổ | | | | | |
| TC-03 | Hồ sơ không gắn dự án | | | | | |
| TC-04 | Hai kế toán, nhận xử lý thay | | | | | |
| TC-05 | Trả hồ sơ, sửa số tiền | | | | | |
| TC-06 | Huỷ hiệu lực, khoá sổ | | | | | |
| TC-07 | Mã phiếu | | | | | |
| TC-08 | Bộ lọc | | | | | |
| TC-09 | Quy chuẩn giao diện | | | | | |

Khi gặp lỗi, ghi lại: tài khoản, mã hồ sơ / mã phiếu, các bước tái hiện, ảnh chụp màn hình, và log của worker / finance-api / procedure-api tại thời điểm lỗi.
