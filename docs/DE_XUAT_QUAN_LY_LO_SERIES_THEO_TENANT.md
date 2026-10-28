# Đề xuất: quản lý theo lô / sê-ri linh hoạt theo từng tenant

Trạng thái: **đề xuất, chưa triển khai**. Phạm vi: phân hệ Kho (`inventory`), form xuất – nhập – chuyển kho.

> **Cập nhật 28/10/2026:** sau khi nhánh được đưa lên `origin/dev/release`, phần lô và sê-ri phía server đã có sẵn ở đó
> (migration `0013-serial-quality`, `0014-lots`, `0015-quality-blocked`, `lot.controller.ts`, `serial.controller.ts`, ghi lô và sê-ri qua
> chứng từ kho). Mục 1 "Bối cảnh" bên dưới mô tả hiện trạng **trước** khi hợp nhất nên nay không còn đúng (lô lưu `localStorage`,
> sổ cái chưa có cột lô). Phần còn lại của tài liệu (công tắc theo tenant, kiểu theo dõi của từng vật tư, cột Mã lô / Sê-ri theo
> nhu cầu của phiếu, ẩn hiện theo `capabilities`) vẫn là đề xuất chưa làm và cần được rà lại trên mô hình chứng từ của origin.


## 1. Bối cảnh

Form phiếu kho (`packages/features/inventory/src/lib/components/movement-form.tsx`) hiện có cột "Theo dõi định danh":
mỗi dòng vật tư mở hộp thoại khai lô hoặc sê-ri. Hiện trạng:

- **Vật tư nào theo lô** do một quy tắc cứng trong `getTrackingMode`: nhóm "tiêu hao", hoặc mã chứa `DAU` hoặc `CAP`,
  hoặc đúng mã `VT-001`. Theo sê-ri thì dựa vào cờ `isSerialized`. Tenant không cấu hình được.
- **Lô** khai trong form chỉ lưu ở `localStorage` của trình duyệt (`saveLots`), server không có. Máy khác không thấy.
- **Sê-ri khi nhập** được đăng ký lên server (cần quyền quản lý kho). **Sê-ri khi xuất** bị bắt khai đủ nhưng luồng
  submit không dùng, nên không được ghi hay trừ ở đâu.
- Sổ cái `inventory_transactions` có cột `serial_number` nhưng không có cột lô, nên một dòng sổ cái không biết nó lấy
  từ lô nào. Bảng `lot_tracking` (migration 0011) và `serial_tracking` đã tồn tại.

Vấn đề cần giải quyết:

1. Tenant nhỏ không dùng lô hay sê-ri bị hiển thị cột và hộp thoại thừa.
2. Khi bổ sung quản lý lô/sê-ri, một phiếu xuất một vật tư có thể lấy từ hai lô hoặc hai sê-ri khác nhau, nên mỗi dòng
   phải gắn với đúng một mã lô hoặc sê-ri.

## 2. Nguyên tắc

- **Tắt là mặc định, bật là có chủ đích.** Tenant không bật gì thì form giữ như một phiếu kho thường.
- **Thêm mới, không sửa cũ.** Cột và setting mới có giá trị mặc định; không đụng dữ liệu và phiếu đang có.
- **Server là nơi bắt buộc.** Giao diện ẩn hiện theo `capabilities` do API trả về; quy tắc "vật tư theo lô phải có lô"
  kiểm ở server, không chỉ ở giao diện (luật 2 trong `AGENTS.md`).

## 3. Ba tầng điều khiển

### 3.1 Công tắc cho cả tenant

Lưu trong `inventory_schema.module_settings` (migration 0003; đã có khóa lạc quan theo phiên bản, API
`GET /v1/settings`, `PUT /v1/settings/:key`):

| Khóa | Ý nghĩa | Mặc định |
|---|---|---|
| `tracking.lot.enabled` | Tenant dùng quản lý theo lô | `false` |
| `tracking.serial.enabled` | Tenant dùng quản lý theo sê-ri | `false` |

- Tắt: giao diện ẩn cột mã lô/sê-ri, nút phân bổ và tùy chọn "kiểu theo dõi" trong form vật tư; server từ chối tham số
  lô/sê-ri trong request.
- `GET /v1/capabilities` trả thêm trạng thái hai công tắc, giao diện đọc từ đó.
- Người đổi cấu hình cần `inventory.manage`; ai đổi và đổi lúc nào được ghi theo cơ chế phiên bản sẵn có.

### 3.2 Kiểu theo dõi của từng vật tư

Cột mới trên `inventory_schema.materials`: `tracking_mode` với giá trị `NONE` (mặc định), `LOT`, `SERIAL`.

- Thay quy tắc cứng trong `getTrackingMode`; hàm này thành **một nơi duy nhất** đọc từ vật tư và cấu hình tenant, dùng
  chung cho form, bảng tồn và báo cáo.
- Chỉ chọn được kiểu `LOT` hoặc `SERIAL` khi công tắc tenant tương ứng đang bật.
- Không tự chuyển các vật tư mà quy tắc cũ từng coi là "theo lô" sang `LOT`: làm vậy sẽ ép tenant nhỏ vào quản lý lô.

### 3.3 Hiện cột theo nhu cầu của từng phiếu

Cột "Mã lô / Sê-ri" chỉ hiện khi **tenant bật** và **phiếu có ít nhất một dòng vật tư theo dõi lô hoặc sê-ri**. Phiếu toàn
hàng thường giữ bảng gọn, kể cả ở tenant đang bật.

## 4. Mô hình dòng phiếu: một dòng một mã lô hoặc sê-ri

Khi bật quản lý lô/sê-ri, một dòng phiếu là một bộ (vật tư, mã lô hoặc sê-ri), không còn danh sách phân bổ ẩn trong
hộp thoại.

- Xuất một vật tư từ hai lô thì phiếu có hai dòng, mỗi dòng một mã lô và một số lượng riêng.
- Cột **Mã lô / Sê-ri** đặt sau tên vật tư; vật tư không theo dõi hiện "—".
- Phiếu xuất: chọn lô từ danh sách lô còn tồn của kho phiếu, gợi ý sẵn theo hạn dùng gần nhất trước (FEFO), người dùng
  sửa được. Lô `BLOCKED`, `EXPIRED`, `QUARANTINE` không chọn được (giữ như code hiện tại).
- Phiếu nhập: dòng mang mã lô mới kèm ngày sản xuất, hạn dùng, nhà cung cấp, số CO/CQ; lô được tạo khi ghi sổ.
- Sê-ri: mỗi sê-ri một dòng với số lượng 1; cần cách chọn nhiều sê-ri một lần rồi tự tách dòng (phiếu 50 cái không
  bắt nhập 50 lần).
- Kiểm tồn mở rộng từ kiểm tồn theo kho (đã có) thành kiểm tồn **theo lô**: tồn khả dụng của đúng lô đó trong kho
  phiếu, báo lỗi dạng "Lô L0425 của vật tư X chỉ còn 3, phiếu cần 5."

## 5. Phía server

1. Migration mới (không sửa migration đã merge): `materials.tracking_mode`, cột `lot_id` trên sổ cái, tồn theo lô.
2. Ghi lô/sê-ri vào sổ cái **cùng transaction** với dòng nhập/xuất, như `appendWithin` đang làm cho tồn kho; cả phiếu
   rollback nếu một lô thiếu tồn.
3. `POST /v1/movements/batch` nhận thêm `lotId` hoặc `serialNumber` cho từng dòng. Vật tư có `tracking_mode` khác
   `NONE` mà thiếu lô/sê-ri thì bị từ chối. Phiếu cũ không mang lô vẫn hợp lệ với vật tư không theo dõi.
4. Bỏ lưu lô trong `localStorage`; lô nằm ở server.
5. Sê-ri khi xuất phải được ghi và trừ thật (hiện chưa).

## 6. Không ảnh hưởng người dùng và cấu hình hiện có

- **Tenant đang dùng thì tự bật.** Migration kiểm `lot_tracking`, `serial_tracking` và vật tư `is_serialized`; có dữ liệu
  thì bật công tắc tương ứng để không ai đột ngột mất chức năng.
- **Lô chỉ nằm trong `localStorage` không phát hiện được** từ server, nên không bật tự động cho các tenant đó. Cần nêu
  trong ghi chú triển khai và hỏi các tenant đang dùng.
- **Tắt công tắc khi còn hàng theo dõi:** chặn tắt nếu còn vật tư `LOT`/`SERIAL` đang có tồn, kèm thông báo
  "Còn N vật tư đang theo dõi theo lô". Nếu không, hàng sẽ mất truy vết.
- Giá trị mặc định ở mọi cột/setting mới giữ hành vi hiện tại cho tenant không bật.

## 7. Thứ tự làm đề xuất (mỗi bước một PR)

1. Công tắc tenant và `tracking_mode` trên vật tư (migration, form danh mục, `capabilities`); thay `getTrackingMode`.
2. Cột lô/sê-ri ở sổ cái và API batch, kèm test rollback cả phiếu khi một lô thiếu tồn.
3. Giao diện: cột Mã lô / Sê-ri, tách dòng, kiểm tồn theo lô.
4. Chuyển dữ liệu lô cũ trong `localStorage` sang server (nếu tenant có dùng).

## 8. Câu hỏi còn mở

- Lô hết hạn hoặc bị khóa: có cho xuất với quyền đặc biệt không? (đề xuất: không, giữ như hiện tại).
- Chọn lô tự động (FEFO) hay thủ công hoàn toàn? (đề xuất: gợi ý FEFO, người dùng sửa được).
- Sê-ri: mỗi cái một dòng, hay một dòng chứa danh sách sê-ri rồi tách khi ghi sổ?
- Tenant bật rồi tắt công tắc khi chưa còn tồn theo dõi: dữ liệu lô cũ giữ ở chế độ chỉ đọc hay ẩn hẳn?

## 9. Liên quan

- `docs/DE_XUAT_FORM_XUAT_NHAP_KHO_DA_DOI_TUONG.md`: đề xuất form phiếu đa đối tượng.
- `docs/THIET_KE_CHUC_NANG_KIEM_KE_KHO.md`: thiết kế kiểm kê kho.
- Quy tắc kiểm tồn theo kho của phiếu xuất/chuyển:
  `packages/features/inventory/src/lib/components/movement-stock-check.ts`.
