# Đề xuất: duyệt chứng từ Kho nhiều cấp theo hạn mức, hai phương án (trực tiếp hoặc qua quy trình) (bản nháp)

Trạng thái: nháp để thảo luận, chưa quyết định. Ngày 24/11/2026. Dựa trên việc đọc code duyệt đơn từ của HRM, máy trạng thái
chứng từ Kho và Procedure Engine; chưa chạy thử. Chưa đọc kỹ luồng duyệt của kiểm kê (xem mục 6).

## 1. Hiện trạng

### 1.1 Kho hôm nay: một cấp, không có người duyệt chỉ định

- Máy trạng thái: Nháp, Chờ duyệt, Đã duyệt, Đã ghi sổ (`stock-document-policy.ts`). Chỉ có **một** bước duyệt.
- Loại chứng từ nào phải duyệt do code quyết định: `RECEIPT_OTHER`, `ISSUE_OTHER`, `ADJUSTMENT` luôn phải duyệt; `RECEIPT_PURCHASE`,
  `ISSUE_PROJECT` chỉ khi không có chứng từ nguồn.
- Ai duyệt: bất kỳ người có quyền duyệt kho, trừ chính người lập (cài đặt `documents.approval.allowSelfApproval`).
  Không có khái niệm "cấp trên của người lập" hay "chức danh duyệt".
- Không có giá trị chứng từ trong luật duyệt: phiếu 1 triệu và phiếu 5 tỷ đi cùng một đường.

### 1.2 HRM: hai chế độ trên mỗi loại đơn

Bảng `hrm_schema.request_procedure_bindings` (theo loại đơn, tuỳ chọn theo mã lý do) có `mode`:

| Chế độ | Cách chạy | Người duyệt |
|---|---|---|
| `DIRECT` | HRM tự duyệt, không qua quy trình (`hrm-approval-policy.ts`) | Quản lý trực tiếp theo "Báo cáo cho" của sơ đồ tổ chức, hoặc người giữ một chức danh chỉ định (`POSITION`), cộng chức danh dự phòng (có thể chỉ mở sau N ngày) |
| `PROCEDURE` | HRM tạo hồ sơ ở Procedure Engine (`POST /v1/internal/instances`, kèm bản chụp định nghĩa quy trình), PE điều phối các bước, bắn sự kiện `procedure.instance.completed`, HRM nhận qua hộp thư rồi chuyển đơn sang Đã duyệt, Từ chối hay Huỷ | Do quy trình quyết định |

Các luật chung: không tự duyệt đơn của mình, người tạo hộ không duyệt đơn mình tạo hộ, đơn đã có quy trình thì chặn duyệt trực
tiếp, người duyệt thấy đơn của cấp dưới. Đơn đã gắn quy trình bị khoá không cho duyệt trực tiếp.

### 1.3 Điều HRM không có mà bạn cần: nhiều cấp theo giá trị

- HRM ở `DIRECT` chỉ có **một** cấp (quản lý trực tiếp). Muốn nhiều cấp phải chuyển sang PROCEDURE.
- Procedure Engine **đã có** điểm rẽ nhánh (gateway) với điều kiện số và tiền (`gt`, `gte`, `lt`, `between`...) trên thuộc tính của hồ sơ
  (`procedure-condition.ts`). Nên phương án "qua quy trình" làm được mức 2 cấp hay 3 cấp ngay trong định nghĩa quy trình, không cần viết
  thêm engine.
- Phương án "trực tiếp" thì Kho phải tự làm phần nhiều cấp, vì HRM không có mẫu.

### 1.4 Ô "Quy trình liên kết mở Work Order" trên form nhập kho (bổ sung ngày 24/11/2026)

Ô này **không phải ô duyệt**. Đọc `movement-form.tsx` và `inventory-screen.tsx` (`openOrderFor`):

- Chọn quy trình là tuỳ chọn, mỗi phiếu một lần. Server Kho không nhận trường này (`procedureDefinitionId` không có trong
  `packages/modules/inventory`).
- Sau khi phiếu **đã ghi sổ**, trình duyệt gọi riêng `openMovementWorkOrder` để mở một Work Order. Lỗi bị nuốt có chủ đích
  (hàng đã vào kho rồi nên không được báo thất bại).
- Nghĩa là nó mở việc theo dõi sau ghi sổ, không chặn ghi sổ và không quyết định ai duyệt.

Yêu cầu mới: cấu hình ở Cài đặt Kho chọn `PROCEDURE` thì mới hiện vùng liên kết quy trình; chọn `DIRECT` thì tạo phiếu có hiệu lực
ngay, không vào Chờ duyệt. Hai điểm xung đột với luật hiện hành, cần quyết định ở mục 8: (a) `*_OTHER` và điều chỉnh đang bị
**ép** phải duyệt (ISS-BE-006), (b) người lập không được tự duyệt. Chế độ `DIRECT` "ghi sổ ngay" chỉ làm được nếu hai luật này được nới
có điều kiện.

## 2. Đề xuất chung cho cả hai phương án

### 2.1 Giá trị chứng từ và bậc hạn mức

- **Giá trị chứng từ** = tổng thành tiền các dòng (số lượng nhân giá vốn hoặc đơn giá). Kiểm kê: **giá trị tuyệt đối của chênh lệch**
  (thừa và thiếu cộng dồn theo trị tuyệt đối), vì thiếu hay thừa đều là rủi ro.
- **Bảng hạn mức** tenant tự cấu hình, theo *nhóm nghiệp vụ*:

| Nhóm nghiệp vụ | Gồm |
|---|---|
| Nhập kho | `RECEIPT_*` |
| Xuất kho | `ISSUE_*` |
| Chuyển kho | `ISSUE_TRANSFER` |
| Điều chỉnh | `ADJUSTMENT` |
| Kiểm kê | Đợt kiểm kê |

Mỗi nhóm có các **bậc**: từ giá trị, đến giá trị, số cấp duyệt. Ví dụ xuất kho: dưới 50 triệu duyệt 2 cấp, từ 50 triệu trở lên duyệt
3 cấp. Số bậc không cố định ở hai; bậc cuối không có cận trên.

- Luật hệ thống không đổi: loại chứng từ nào **phải** duyệt vẫn do code quyết định (mục 1.1). Hạn mức chỉ quyết định **bao nhiêu cấp và
  ai duyệt** khi chứng từ đã phải duyệt. Bậc "0 cấp" (miễn duyệt) chỉ cho phép với loại hệ thống vốn không bắt duyệt, không bao giờ cho
  `*_OTHER` và điều chỉnh.
- **Chụp lại lúc gửi duyệt:** số cấp, danh sách cấp, giá trị lúc gửi được ghi vào chứng từ. Đổi hạn mức sau đó không làm đổi
  đường duyệt của chứng từ đang chờ. Sửa chứng từ làm đổi bậc thì phải gửi duyệt lại từ cấp 1.
- Một người không duyệt hai cấp của cùng một chứng từ (mặc định), và không tự duyệt chứng từ mình lập, theo cài đặt hiện có.

### 2.2 Cấu hình chọn phương án

Mỗi nhóm nghiệp vụ chọn một chế độ, như `request_procedure_bindings` của HRM:

- `DIRECT`: duyệt ngay trong Kho (mục 3).
- `PROCEDURE`: Kho gửi sang Procedure Engine (mục 4), chọn một định nghĩa quy trình đã công bố.

Có thể chọn riêng từng nhóm (ví dụ xuất kho qua quy trình, nhập kho duyệt trực tiếp). Mặc định khi chưa cấu hình: `DIRECT` một cấp
như hiện nay, để không đổi hành vi của tenant chưa cài đặt.

## 3. Phương án A: duyệt trực tiếp trong Kho (`DIRECT`)

### 3.1 Dữ liệu

| Bảng | Nội dung |
|---|---|
| `approval_policies` | Một dòng mỗi nhóm nghiệp vụ: `mode`, `procedure_definition_id` (nếu PROCEDURE), `active` |
| `approval_tiers` | Bậc hạn mức: `policy_id`, `min_value`, `max_value` (null = không giới hạn), `levels` |
| `approval_tier_levels` | Từng cấp của bậc: `tier_id`, `level_no`, nguồn người duyệt, `position_id` (khi chỉ định chức danh), `fallback_position_id` |
| `stock_document_approvals` | Mỗi dòng một cấp của một chứng từ đã gửi duyệt: `document_id`, `level_no`, `status` (chờ, đã duyệt, từ chối), `approver_id`, `decided_at`, `note`, bản chụp nguồn duyệt |

Cột mới trên `stock_documents`: `approval_value` (giá trị chụp), `approval_required_levels`, `approval_current_level`.

### 3.2 Nguồn người duyệt của một cấp

Lấy lại hai nguồn của HRM, không phát minh thêm:

1. **Quản lý trực tiếp, đi lên theo "Báo cáo cho"**: cấp 1 là quản lý trực tiếp của người lập, cấp 2 là cấp trên của người đó, và cứ thế.
   Cần danh sách người và chuỗi báo cáo từ Core; theo luật 4 phải lấy qua API nội bộ `/v1/internal/` hoặc sự kiện, không đọc schema Core
   như HRM đang làm (HRM đọc `core_schema` trực tiếp, đây là ngoại lệ nội bộ của cặp Core-HRM, Kho không được bắt chước).
2. **Chức danh chỉ định**: người đang giữ chức danh được chọn (ví dụ Thủ kho trưởng, Kế toán trưởng, Giám đốc). Có chức danh dự phòng.

Thực tế với Kho, chức danh chỉ định (kho trưởng, kế toán, giám đốc) hợp hơn quản lý trực tiếp của người lập phiếu. Đề xuất mặc định
là chức danh chỉ định, quản lý trực tiếp là lựa chọn thêm.

### 3.3 Chạy duyệt

- Gửi duyệt: tính giá trị, chọn bậc, chụp các cấp, đặt `PENDING`, `current_level = 1`.
- Duyệt một cấp: kiểm quyền (đúng người của cấp, không tự duyệt, không duyệt hai cấp); nếu còn cấp sau thì tăng `current_level` và vẫn
  `PENDING`; cấp cuối duyệt xong thì chuyển `APPROVED`. **Máy trạng thái hiện có giữ nguyên** (không thêm trạng thái mới), chỉ thêm tiến độ
  cấp bên trong `PENDING`.
- Từ chối ở bất kỳ cấp nào: `REJECTED` như hiện nay, ghi lý do và cấp từ chối.
- Danh sách "Chờ tôi duyệt" lọc theo cấp hiện tại và người duyệt của cấp đó.
- Mọi bước ghi nhật ký và audit trong cùng giao dịch.

## 4. Phương án B: duyệt qua quy trình (`PROCEDURE`)

### 4.1 Cách làm (theo mẫu HRM)

1. Khi gửi duyệt, Kho tạo bản ghi liên kết (kiểu `procedure_links` của HRM, ví dụ `stock_document_procedure_links`) rồi gọi
   `POST /v1/internal/instances` của Procedure Engine với `sourceType = 'inventory_document'`, `sourceId = id chứng từ`, khoá chống trùng,
   và các thuộc tính: **tổng giá trị**, loại chứng từ, kho, người lập, đối tượng nhận.
2. Định nghĩa quy trình có **một điểm rẽ nhánh** theo thuộc tính "tổng giá trị" (kiểu tiền):
   nhánh `< 50 triệu` có 2 bước duyệt, nhánh `>= 50 triệu` có 3 bước duyệt. Người duyệt từng bước (chức danh, quản lý trực tiếp, người
   cụ thể) khai ngay trong quy trình, đúng cách PE đang làm.
3. PE bắn `procedure.instance.completed` (`completed`, `rejected`, `cancelled`). Kho nghe qua hộp thư (như `procedure_result_inbox` của
   HRM), chuyển chứng từ sang `APPROVED`, `REJECTED` hay `CANCELLED`, ghi người duyệt cuối.
4. Chứng từ đã gắn quy trình thì **khoá duyệt trực tiếp** (409), như `PROCEDURE_IN_PROGRESS` của HRM.
5. Hiển thị tiến độ (bước hiện tại, người đang giữ) trên chứng từ, như `current_step_name` của HRM.

### 4.2 Việc phải làm thêm ở Procedure Engine

- Công nhận nguồn `inventory_document` (hiện chỉ có `manual`, `hrm_request` và các nguồn khác; cần xem danh sách nguồn hợp lệ).
- Mẫu quy trình mồi "Duyệt chứng từ kho" kèm thuộc tính tổng giá trị và nhánh hạn mức.
- Phối hợp với người phụ trách Procedure Engine, vì chạm phân hệ khác.

Lưu ý nhầm lẫn: Kho **đã có** một hướng liên thông ngược (Quy trình duyệt yêu cầu cấp vật tư rồi gọi Kho ghi sổ,
`procedure_requisition`, `inventory-issue-events.ts`). Đó là Quy trình gọi Kho. Phương án B là chiều ngược lại, Kho gọi Quy trình, không
thay thế hay đụng tới luồng cũ.

### 4.3 Điểm khác phương án A

| | A: trực tiếp | B: quy trình |
|---|---|---|
| Số cấp theo giá trị | Kho tự làm bảng bậc | Gateway có sẵn trong PE |
| Rẽ nhánh phức tạp (theo kho, theo loại hàng) | Phải code thêm | PE hỗ trợ |
| Trả lại sửa, uỷ quyền, bình luận | Không có | Có sẵn |
| Phụ thuộc | Chỉ Kho (và API nội bộ Core nếu dùng quản lý trực tiếp) | Cần PE chạy, cần quy trình đã công bố |
| Khi PE không phản hồi | Không ảnh hưởng | Chứng từ kẹt chờ khởi tạo, cần màn đối soát như HRM |
| Công sức | Vừa (3 bảng và logic cấp) | Vừa (cầu nối, hộp thư, mẫu quy trình), phần hạn mức gần như miễn phí |

## 5. Phạm vi áp dụng

Áp dụng cho mọi chứng từ phải duyệt, cho cả hai phương án: nhập kho, xuất kho, chuyển kho, điều chỉnh, kiểm kê, và chứng từ đảo
(đảo hiện dùng quyền duyệt riêng, cần quyết định có theo hạn mức hay giữ như cũ).

Các đường ghi sổ **miễn duyệt** hiện có (`stocktake`, `asset_uninstall`, `asset_return`, `opening_balance`, `reversal`,
`procedure_requisition`) giữ nguyên miễn trừ: chúng đã có bước kiểm riêng, hạn mức không áp lên chúng.

## 6. Điều chưa rõ, cần đọc thêm trước khi làm

- **Kiểm kê:** đợt kiểm kê có trạng thái và người duyệt riêng (`postgres-stocktake.store.ts`) mà tôi chưa đọc kỹ. Cần xem nó duyệt ở
  mức đợt hay mức dòng chênh lệch rồi mới quyết định gắn hạn mức vào đâu.
- **Giá trị chứng từ** ở nhập không có chứng từ nguồn và ở xuất: dùng giá vốn hay đơn giá nhập tay? Xuất hiện chỉ có giá vốn bình quân khi ghi
  sổ, chưa chắc có lúc gửi duyệt.
- **Đối tượng nhận** trên chứng từ chờ duyệt đang bị mất (xem `DE_XUAT_MUC_DICH_XUAT_VA_LIEN_KET_DOI_TUONG.md`); nên làm trước vì người duyệt
  cần thấy đối tượng.

## 7. Giai đoạn

| Bước | Việc |
|---|---|
| 1 | Lưu đối tượng nhận và giá trị chứng từ lúc gửi duyệt (nền cho cả hai phương án) |
| 2 | Bảng hạn mức và màn cấu hình trong Cài đặt Kho (chọn chế độ, bậc, số cấp) |
| 3 | Phương án A: bảng duyệt theo cấp, nguồn người duyệt, danh sách "Chờ tôi duyệt", test từng cấp, tự duyệt, trùng người |
| 4 | Phương án B: cầu nối PE, hộp thư kết quả, màn đối soát, mẫu quy trình mồi (cần phối hợp phụ trách PE) |
| 5 | Kiểm kê và chứng từ đảo theo mục 5 và 6 |

Migration mới của Kho bắt đầu từ `0030`, đăng ký trong `tenant-migrations.ts`, chạy `node tools/check-migrations.mjs`. Quyền mới (nếu có,
ví dụ `inventory.approval.configure`) chỉ thêm vào `TENANT_PERMISSION_ACTIONS`.

## 8. Quyết định cần chốt

1. Hạn mức tính theo giá trị nào: giá vốn, đơn giá nhập tay, hay cho tenant chọn?
2. Nguồn người duyệt mặc định: chức danh chỉ định (đề xuất) hay quản lý trực tiếp theo sơ đồ tổ chức?
3. Làm cả hai phương án cùng lúc, hay A trước (độc lập, nhanh) rồi B sau?
4. Số bậc hạn mức có cần tối đa bao nhiêu (đề xuất tối đa 5 bậc, 5 cấp)?
5. Chứng từ đảo và kiểm kê có theo hạn mức không?
6. Có cho tenant bật tự duyệt riêng theo bậc (ví dụ bậc nhỏ nhất được tự duyệt) hay giữ cài đặt toàn cục hiện có?
7. **Đã chốt hướng (24/11/2026): không có chế độ ghi sổ khi chưa duyệt**, để không phá ISS-BE-006. Chế độ `DIRECT` đổi tên thành
   "Duyệt tại Kho": phiếu vẫn đi `PENDING` rồi `APPROVED` rồi `POSTED`, `assertPostable` giữ nguyên, không thêm đường miễn nào vào
   `POSTING_ORIGINS`. Muốn "tạo là có hiệu lực" thì dùng nút "Tạo và duyệt" cho người có quyền duyệt, chạy cả ba bước trong một
   giao dịch và ghi người duyệt vào `stock_document_approvals`. Nút này chỉ hiện khi tenant đã bật `allowSelfApproval` (cài đặt có sẵn,
   Q5) và bậc hạn mức của phiếu chỉ cần một cấp. Bậc nhiều cấp không dùng được nút này.
8. Ô "liên kết quy trình mở Work Order" giữ nguyên ý nghĩa mở việc sau ghi sổ, hay đổi thành ô chọn quy trình **duyệt** (phương án B)?
   Hai việc này nên tách thành hai ô, vì một phiếu có thể vừa cần duyệt vừa cần mở Work Order.
