# Đề xuất: mục đích xuất kho thành danh mục, liên kết đối tượng với phân hệ khác (bản nháp)

Trạng thái: nháp để thảo luận, chưa quyết định. Ngày 24/11/2026. Dựa trên việc đọc code và dữ liệu một tenant dev;
chưa chạy thử từng kịch bản trên giao diện.

## 1. Hiện trạng đã xác nhận

### 1.1 Hai trang `#stock/movements` và `#stock/history` có mục đích khác nhau

| | Xuất/nhập kho (`#stock/movements`) | Lịch sử xuất nhập (`#stock/history`) |
|---|---|---|
| Dữ liệu | Chứng từ kho (`stock_documents`): Nháp, Chờ duyệt, Đã duyệt, Đã ghi sổ, Từ chối, Huỷ | Sổ cái (`inventory_transactions`): bút toán đã ghi sổ |
| Dùng để | Theo dõi và xử lý chứng từ: lập, gửi duyệt, duyệt, ghi sổ, yêu cầu xuất từ đơn bán | Tra cứu biến động tồn đã xảy ra |
| Chứng từ Chờ duyệt | Có | **Không**: chưa ghi sổ thì chưa có bút toán |

Phiếu xuất vừa thử đang Chờ duyệt (không có chứng từ nguồn nên phải qua người duyệt), vì vậy chỉ hiện ở trang
chứng từ. Sau khi duyệt và ghi sổ, nó sẽ hiện ở lịch sử.

### 1.2 Nhãn loại phiếu không khớp lựa chọn của người dùng

Form xuất nhanh (`movement-form.tsx`) cho chọn đối tượng: Phòng ban, Lắp vào Tài sản, Khách hàng, Dự án. Nhưng mọi phiếu
xuất (trừ lắp tài sản) đều tạo chứng từ loại `ISSUE_PROJECT`, hiển thị "Xuất cho dự án", kể cả khi chọn Phòng ban hoặc
Khách hàng. Danh sách loại chứng từ (`STOCK_DOCUMENT_TYPES`) và nhãn (`stock-document.model.ts`) đều cứng trong code.
Hệ thống đã có sẵn `ISSUE_SALES`, `ISSUE_WARRANTY`, `ISSUE_TRANSFER`, `ISSUE_OTHER` nhưng form xuất nhanh không dùng.

### 1.3 Tên dự án, khách hàng, phòng ban thực chất không được lưu thành đối tượng

- Ba lựa chọn này chỉ là ô chữ tự do, không nối với Workspace, CRM, Core.
- Bảng `stock_documents` **không có cột đối tượng nhận**. Đường tạo chứng từ Chờ duyệt (`createAndPost` rẽ nhánh
  Chờ duyệt) không lưu thông tin đối tượng; đối tượng chỉ được ghi vào bút toán lúc ghi sổ, và chỉ khi người ghi sổ truyền
  lại. Hệ quả: với phiếu phải qua duyệt, tên dự án hoặc khách hàng đã nhập có thể **mất** trước khi ghi sổ. Cần xác nhận
  bằng thử nghiệm: duyệt và ghi sổ phiếu Chờ duyệt, xem bút toán có đối tượng hay không.
- Chính sách hiện hành (`stock-document-policy.ts`): xuất dự án chỉ ghi sổ thẳng khi có chứng từ nguồn (đơn mua, dự án,
  tài sản). Form không bao giờ gửi chứng từ nguồn cho dự án, nên phiếu xuất dự án luôn Chờ duyệt.

### 1.4 Dịch vụ lọt vào ô chọn hàng của phiếu xuất nhập nhanh

Dịch vụ không có tồn, server đã từ chối ở bước ghi sổ. Ô chọn hàng của form xuất nhập nhanh và nhập Excel trước đây
vẫn cho chọn, và đã được sửa (loại dịch vụ khỏi ô chọn, báo lỗi dòng Excel). Form "Lập chứng từ kho" đã loại dịch vụ từ
trước.

## 2. Đề xuất

### 2.1 Danh mục "Mục đích xuất kho" do tenant quản lý

Bảng `inventory_schema.issue_purposes` theo quy ước chuẩn đã đề xuất (`code`, `name`, `active`, `sort_order`,
`deleted_at`, `version`), cộng hai cột nghiệp vụ:

| Cột | Ý nghĩa |
|---|---|
| `doc_type` | Loại chứng từ hệ thống mà mục đích này tạo ra (`ISSUE_SALES`, `ISSUE_PROJECT`, `ISSUE_WARRANTY`, `ISSUE_OTHER`...). Quyết định luật duyệt, nên **không để tenant tự đặt**, chỉ chọn trong các loại hệ thống |
| `target_kind` | Đối tượng nhận cần liên kết: `NONE`, `PROJECT`, `CUSTOMER`, `DEPARTMENT`, `ASSET` |

Dữ liệu mồi: Xuất bán (khách hàng), Xuất cho dự án (dự án), Xuất bảo hành (khách hàng), Xuất nội bộ (phòng ban), Lắp vào
tài sản (tài sản), Xuất khác (không đối tượng). Tenant thêm, đổi tên, tắt được; mục đã dùng chỉ tắt, không xoá.

Chứng từ lưu `purpose_id`; nhãn hiển thị lấy từ danh mục, không còn từ hằng số trong code. Loại chứng từ hệ thống
(`doc_type`) vẫn là enum cố định vì nó mang hành vi (duyệt, hướng nhập hay xuất, giá vốn).

### 2.2 Liên kết đối tượng nhận với phân hệ sở hữu

Theo luật 4 của repo (không ghi hay đọc thẳng schema phân hệ khác), Kho lấy danh sách qua API nội bộ
`/v1/internal/` của từng phân hệ, hoặc nhận sự kiện:

| Đối tượng | Phân hệ sở hữu | Lưu ở chứng từ |
|---|---|---|
| Dự án, công trình | Workspace | `target_type = PROJECT`, `target_id` (id dự án), `target_name` (tên chụp lúc lập) |
| Khách hàng | CRM | `target_type = CUSTOMER`, `target_id`, `target_name` |
| Phòng ban | Core (sơ đồ tổ chức) | `target_type = DEPARTMENT`, `target_id`, `target_name` |
| Tài sản | Kho (cây tài sản) | Giữ luồng lắp đặt hiện có |

Quy tắc: lưu cả id và tên chụp lúc lập để lịch sử vẫn đọc được khi đối tượng bị đổi tên hay xoá; chứng từ lưu đối tượng
ngay trên `stock_documents` nên không mất khi phải qua duyệt. Id không có khoá ngoại (khác schema); kiểm tồn tại ở server
lúc lập chứng từ.

Khi đối tượng là dự án có thật, nó trở thành chứng từ nguồn (`source_type = project`, `source_id`) đúng như chính sách
hiện hành, nên phiếu xuất dự án hợp lệ có thể ghi sổ thẳng theo luật đã định.

### 2.3 Form xuất nhập nhanh

- Ô "Mục đích" đọc từ danh mục (2.1) thay cho bốn lựa chọn cứng; đổi nhãn thành "Mục đích xuất".
- Ô đối tượng đổi theo `target_kind`: danh sách chọn từ phân hệ sở hữu (có tìm kiếm), không còn ô chữ tự do.
- Dịch vụ không xuất hiện trong ô chọn hàng (đã làm).

## 3. Giai đoạn

| Bước | Việc | Ghi chú |
|---|---|---|
| 0 | Sửa nhanh nhãn: ánh xạ đối tượng sang loại chứng từ có sẵn (Phòng ban sang `ISSUE_OTHER`, Khách hàng sang `ISSUE_SALES`, Dự án giữ `ISSUE_PROJECT`) | Đổi luật duyệt: `ISSUE_OTHER` luôn phải duyệt. Cần quyết định nghiệp vụ |
| 1 | Cột đối tượng trên `stock_documents` (migration mới), lưu và đọc ở mọi đường tạo chứng từ, kể cả Chờ duyệt | Sửa gốc mất dữ liệu |
| 2 | Bảng danh mục mục đích, màn quản lý trong Cài đặt Kho, `purpose_id` trên chứng từ | Theo chuẩn danh mục |
| 3 | API nội bộ danh sách dự án (Workspace), khách hàng (CRM), phòng ban (Core); phía Kho gọi qua adapter | Cần phối hợp phụ trách từng phân hệ |
| 4 | Form dùng danh mục và ô chọn đối tượng thật | |

Migration mới của Kho bắt đầu từ `0030`. Đăng ký trong `tenant-migrations.ts`, chạy `node tools/check-migrations.mjs`.

## 4. Quyết định cần chốt

1. Mục đích xuất có quyết định luật duyệt không? Đề xuất: mỗi mục đích gắn một loại chứng từ hệ thống; tenant không tự
   đặt luật duyệt.
2. Bước 0 (sửa nhanh nhãn) làm ngay, hay chờ bước 2? Làm ngay sẽ đổi luật duyệt của phiếu xuất cho phòng ban, khách hàng.
3. Khách hàng và phòng ban có bắt buộc chọn từ danh sách không, hay vẫn cho gõ chữ khi chưa có trong hệ thống?
4. Dự án: có cần phiếu xuất dự án ghi sổ thẳng khi chọn đúng dự án (dự án thành chứng từ nguồn), hay vẫn qua duyệt?

## 5. Ngoài phạm vi

- Đổi luật duyệt hiện có của chứng từ (ISS-BE-006).
- Sửa dữ liệu CRM đã chụp phân loại hay loại mặt hàng của dòng cũ.
- Đồng bộ nhãn loại chứng từ ở form "Lập chứng từ kho" (`#stock/movements`) nếu khác với form xuất nhanh; chưa đối chiếu.
