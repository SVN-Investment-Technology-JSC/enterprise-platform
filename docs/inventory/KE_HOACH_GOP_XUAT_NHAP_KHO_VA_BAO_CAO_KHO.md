# Kế hoạch gộp "Xuất/nhập kho" và báo cáo của Kho

Trạng thái: đang triển khai, xem mục 10. Ngày lập: 2026-11-12. Cập nhật: 2026-11-17.
Phạm vi: module Inventory (`packages/features/inventory`, `packages/modules/inventory`, `packages/contracts/inventory`).

## 1. Mục tiêu

1. Người dùng chỉ thấy một nơi để theo dõi mọi lần xuất/nhập kho, thay cho bốn khu vực hiện nay: Lịch sử xuất nhập, Chứng từ kho, Duyệt chứng từ, Yêu cầu xuất từ đơn bán.
2. Mỗi dòng có trường **Nguồn phát sinh** (thủ công, đơn bán, bảo hành, quy trình, kiểm kê, cây vận hành...).
3. Giữ nguyên logic hiện tại chạy song song, để kiểm thử cũ không bị vỡ.
4. Xác định Kho nên báo cáo những gì, tách khỏi báo cáo doanh số của CRM.

## 2. Hiện trạng đã kiểm tra

### 2.1 Hai khái niệm đang cùng tồn tại

| | Sổ giao dịch (`inventory_transactions`) | Chứng từ (`stock_documents` + `stock_document_lines`) |
|---|---|---|
| Bản chất | Từng dòng biến động, chỉ ghi thêm (trigger chặn sửa, xoá) | Phiếu nhiều dòng, có máy trạng thái |
| Liên kết | Cột `document_id`, cho phép trống | Có `source_type`, `source_id` |
| Dùng để | Tính tồn, lô, serial, giá vốn | Duyệt, truy vết, liên kết CRM |

### 2.2 Đính chính về thao tác nhanh

Các thao tác nhanh (nhập, xuất, điều chuyển, nhập xuất hàng loạt, lắp/tháo thiết bị, trả về kho) **đã tạo và ghi sổ một chứng từ** thông qua `postLegacyDocument` (`inventory.application.ts`). Tầng application không còn chỗ nào gọi trực tiếp `transaction.append`. Dòng sổ không có chứng từ chỉ là dữ liệu từ trước migration 0011. Chưa kiểm tra riêng đường ghi sổ của kiểm kê.

Hệ quả: với dữ liệu mới, "lịch sử xuất nhập" và "chứng từ" đã là cùng một dấu vết. Việc gộp chủ yếu là việc hiển thị, không phải đổi đường ghi.

### 2.3 "Thao tác nhanh không qua duyệt"

Có hai đường tạo chứng từ, khác nhau về số bước và quyền:

| | Thao tác nhanh | Chứng từ đầy đủ |
|---|---|---|
| Ví dụ | Nút "Nhập kho" ở tab Nhà kho | Màn Chứng từ kho; yêu cầu xuất từ CRM |
| Các bước | Nháp, rồi Đã ghi sổ ngay | Nháp, Chờ duyệt, Đã duyệt, Đã ghi sổ |
| Quyền | `inventory.transaction.write` | Lập và ghi sổ cần quyền trên. Duyệt, từ chối cần thêm `inventory.document.approve` |
| Tồn đổi lúc | Ngay khi bấm | Khi ghi sổ, sau khi có người duyệt |

Hệ quả: người có quyền ghi giao dịch tự nhập hoặc tự xuất mà không có người thứ hai xác nhận. **Quyết định: giữ nguyên cả hai đường.**

### 2.4 Phần "quy trình" hiện tại

Giao diện Kho tự đọc `/api/procedure/v1/workspace` để lấy phiếu yêu cầu vật tư (`loadProcedureRequisitions`). Không có tích hợp phía server. Việc nhận biết "đã xuất" dựa vào dò mã trong ghi chú giao dịch và localStorage. Khu vực này hiện đã bị tắt trong giao diện (các biến `_visibleRequisitions`, `_handleOpenIssueFromRequisition` không còn được render). Chưa xác minh lý do bị tắt.

## 3. Các quyết định đã chốt

1. Dữ liệu cũ (dòng sổ không có chứng từ) **giữ nguyên**, không viết migration bù. Xuất/nhập kho không bắt buộc phải có chứng từ. Chứng từ chủ yếu để liên kết với CRM và sau này với Cây vận hành.
2. Giữ nguyên cả thao tác nhanh lẫn chứng từ đầy đủ, chạy song song.
3. Gộp về một danh sách có trường "Nguồn phát sinh".
4. Báo cáo doanh số và hiệu quả sản phẩm thuộc CRM. Kho báo cáo về tồn, luân chuyển, chi phí và vận hành.

## 4. Danh sách gộp do server hay giao diện tạo

**Kết luận: server tạo.** Các store tôi đã đọc đều gộp nhiều nguồn ngay trong SQL, không module nào gộp ở trình duyệt.

| Nơi | Cách làm |
|---|---|
| CRM, dòng thời gian khách hàng (`postgres-activity.store.ts`) | Một câu `UNION ALL` hợp nhiều nguồn (hoạt động, báo giá, hợp đồng, đơn, bảo hành, công nợ). Mỗi nhánh tự lọc phạm vi quyền, rồi phân trang keyset trên `(at, id)`, con trỏ mã hoá bằng `encodeCursor`. Thêm loại mục mới là thêm một nhánh. |
| HRM, nhật ký kiểm toán (`hrm-audit-trail.ts`) | Dựng nhãn đối tượng bằng nhiều nhánh `UNION ALL` trong `LEFT JOIN LATERAL`, giải quyết ngay ở SQL. |
| Inventory, báo cáo nhập xuất (`postgres-inventory-report.store.ts`) | `LEFT JOIN` chứng từ vào dòng sổ, phân loại theo "có chứng từ thì theo loại chứng từ, không thì theo loại bút toán". Phân trang `LIMIT/OFFSET` kèm tổng của cả tập đã lọc. |

Lý do giao diện không nên gộp:
- Phân trang và sắp xếp sai khi mỗi nguồn trả một trang riêng.
- Tổng và số đếm không đúng.
- Quyền phạm vi phải lặp lại ở nhiều chỗ.

**Đề xuất kỹ thuật cho Kho:**
- Thêm một endpoint đọc mới, ví dụ `GET /v1/stock-movements`, **chỉ thêm, không đổi endpoint cũ**.
- Câu truy vấn hợp hai nhánh bằng `UNION ALL`: (a) `stock_documents`, mỗi chứng từ một dòng; (b) `inventory_transactions` có `document_id IS NULL`, mỗi bút toán một dòng, gắn nhãn "Bút toán cũ".
- Phân trang `limit/offset` kèm tổng, theo quy ước của Kho (danh sách chứng từ và báo cáo đều dùng offset, và giao diện đã có bộ chia trang `table-pager.tsx`). Keyset chỉ cần nếu sau này danh sách quá lớn.
- Trả về trường `source` đã chuẩn hoá (xem mục 6).

### 4.1 So sánh các phương án

| Phương án | Mô tả | Ưu | Nhược | Đánh giá |
|---|---|---|---|---|
| A. Giao diện tự gộp | Gọi hai API cũ, gộp và sắp xếp trong trình duyệt | Không đổi backend | Sai phân trang (mỗi nguồn một trang), sai tổng và số đếm, lọc quyền lặp ở hai nơi, tải thừa dữ liệu | Loại |
| B. Server `UNION ALL` trong một store | Endpoint mới, một câu SQL hợp hai nhánh | Đúng phân trang, tổng, quyền; cùng mẫu với CRM và HRM; không đổi bảng | Phải viết và kiểm thử câu SQL; cần chú ý chỉ mục | **Chọn** |
| C. Server dùng VIEW | Migration tạo `inventory_schema.v_stock_movements`, endpoint đọc từ view | Dễ tái dùng cho báo cáo; truy vấn gọn | Thêm migration; view phải giữ tương thích ngược về sau | Cân nhắc ở giai đoạn 3, khi báo cáo cần dùng chung |
| D. Bảng gộp được ghi sẵn | Mỗi lần ghi sổ ghi thêm một dòng vào bảng "dòng thời gian" | Đọc nhanh nhất | Ghi đôi, có nguy cơ lệch với nguồn; cần backfill dữ liệu cũ | Loại (mâu thuẫn quyết định giữ nguyên dữ liệu cũ) |

### 4.2 Hợp đồng endpoint đề xuất

`GET /v1/stock-movements` (chỉ đọc, thuộc nhóm đọc của Kho; quyền xem giống danh sách chứng từ hiện tại).

Tham số tuỳ chọn, đều nhận được rỗng:
- `search`: mã chứng từ, mã giao dịch, mã hoặc tên vật tư.
- `kind`: `document`, `legacy` (mặc định cả hai).
- `docType`, `status`, `warehouseCode`, `sourceType`, `from`, `to`.
- `limit` (mặc định theo `DEFAULT_PAGE_SIZE` của Kho, tối đa 200), `offset`.

Trả về `{ rows, total, limit, offset, pendingCount }`:
- `rows[]` gồm `kind`, `id`, `code`, `type` (loại chứng từ hoặc loại bút toán), `status`, `warehouseCode`, `occurredAt`, `sourceType` (đã chuẩn hoá), `sourceId`, `lineCount`, `quantityTotal`, `createdBy`.
- `pendingCount` là số chứng từ đang chờ duyệt (theo bộ lọc kho nếu có) để hiện trên nhãn tab, không phụ thuộc trang hiện tại.
- Dòng `kind = legacy` không có thao tác; mở chi tiết dùng endpoint sẵn có `GET /v1/transactions`, dòng `document` dùng `GET /v1/stock-documents/:id`. Endpoint mới không thay thế hai endpoint đó.

### 4.3 Cách dựng truy vấn

Một câu SQL, hai nhánh, sắp xếp chung theo `(occurredAt DESC, id DESC)`:

```sql
SELECT * FROM (
  -- Nhánh 1: mỗi chứng từ một dòng
  SELECT 'document' AS kind, d.id, d.code, d.doc_type AS type, d.status,
         w.code AS warehouse_code,
         COALESCE(d.posted_at, d.created_at) AS occurred_at,
         d.source_type, d.source_id,
         (SELECT count(*) FROM inventory_schema.stock_document_lines l WHERE l.document_id = d.id) AS line_count,
         d.created_by
    FROM inventory_schema.stock_documents d
    JOIN inventory_schema.warehouses w ON w.id = d.warehouse_id
  UNION ALL
  -- Nhánh 2: bút toán cũ chưa có chứng từ
  SELECT 'legacy', t.id, t.transaction_code, t.type, 'POSTED',
         w.code, t.created_at, t.reference_type, t.reference_id, 1, t.created_by
    FROM inventory_schema.inventory_transactions t
    JOIN inventory_schema.warehouses w ON w.id = t.warehouse_id
   WHERE t.document_id IS NULL
) m
WHERE ... /* bộ lọc áp ở lớp ngoài, giá trị truyền bằng tham số, không nối chuỗi */
ORDER BY occurred_at DESC, id DESC
LIMIT $n OFFSET $m;
```

Lưu ý khi viết thật:
- Đây là bản phác để thấy hình dạng, chưa chạy thử. Cần đối chiếu cột thật khi làm (ví dụ nhãn "Đã ghi sổ" cho bút toán cũ lấy từ `workflow_status`, không cứng).
- Nhánh 2 nên lọc sớm trong nhánh (ngày, kho) để không quét cả sổ. Kiểm tra chỉ mục bằng `EXPLAIN` trên dữ liệu lớn; nếu cần thì thêm chỉ mục bằng migration mới, không sửa migration cũ.
- Tổng `total` đếm trên cùng điều kiện lọc, chạy song song với trang dữ liệu như báo cáo hiện tại.
- Quy tắc suy ra `sourceType` cho nhánh 2 nằm một chỗ (hàm chuẩn hoá), dùng chung với nhánh 1 và với giao diện.

### 4.4 Lộ trình xử lý cho phần này

1. Thêm cổng đọc mới ở tầng application và store (`PostgresStockDocumentStore` hoặc store báo cáo), kèm spec tích hợp mẫu như `stock-document.integration.spec.ts` và `inventory-reports.integration.spec.ts`: có chứng từ, có bút toán cũ, kết hợp, phân trang qua ranh giới hai nguồn, tổng đúng sau lọc.
2. Thêm hợp đồng kiểu trong `packages/contracts/inventory` (chỉ thêm).
3. Giao diện gọi một endpoint, không tự gộp. Khi endpoint lỗi, hiển thị lỗi và nút thử lại; **không** quay về gọi hai API cũ (tránh hai hành vi khác nhau).
4. Giữ nguyên các màn cũ và API cũ trong giai đoạn 1; chỉ ẩn khỏi thanh bên. Nhờ vậy nếu endpoint mới có lỗi, quay lại màn cũ bằng cách bỏ ẩn mà không phải sửa dữ liệu.
5. Khi cần dùng chung cho báo cáo (giai đoạn 3), tách phần truy vấn thành VIEW (phương án C) bằng migration mới.

## 5. Kế hoạch theo giai đoạn

Nguyên tắc chung:
- Chỉ thêm, không đổi hình dạng endpoint hiện có. Tham số mới ở dạng tuỳ chọn.
- Không sửa các spec đang có, chỉ thêm spec mới.
- Mỗi giai đoạn một nhánh từ `origin/dev/release`, một PR riêng.
- Trước khi mở PR chạy đủ: `pnpm nx affected -t lint typecheck test --base=origin/dev/release`, `pnpm nx sync:check`, `node tools/check-migrations.mjs`, `node tools/check-ui-rules.mjs`, `node tools/sync-agent-skills.mjs --check`.

### Giai đoạn 1 – Gộp giao diện, giữ song song logic cũ

- Thêm tab con **"Xuất/nhập kho"** vào trang Kho hàng, cạnh Hàng hóa, Nhà kho, Lịch sử kiểm đếm.
- Danh sách gộp lấy từ endpoint mới ở mục 4. Cột và bộ lọc **Nguồn phát sinh**; bộ lọc loại, trạng thái, kho, khoảng ngày. Dùng `SearchableSelect`, không dùng `<select>`, không dùng emoji.
- "Chờ duyệt" trở thành bộ lọc trạng thái kèm số đếm. Nút duyệt chỉ hiện với người có `inventory.document.approve`.
- Dòng "Bút toán cũ" hiển thị chỉ đọc, không có nút thao tác.
- Ẩn ba mục khỏi thanh bên: Chứng từ kho, Duyệt chứng từ, Yêu cầu xuất từ đơn bán. Giữ chuyển hướng hash cũ qua `LEGACY_TAB` để link đã chia sẻ không vỡ.
- Giữ nguyên code của `StockDocumentList`, `StockDocumentApproval`, `IssueRequestPanel`, `TransactionHub`. Tab mới dùng lại hoặc bọc chúng. Chưa xoá gì.
- Nguồn "Quy trình" dùng bộ tải hiện có, chưa đụng module Quy trình.
- Kiểm thử: spec cũ giữ nguyên. Thêm spec cho (a) truy vấn gộp, (b) bộ chuyển đổi hàng, (c) chuyển hướng hash, (d) ẩn hiện nút theo quyền.

Tiêu chí xong: người dùng lập, duyệt, ghi sổ, huỷ chứng từ ngay trong tab mới; số liệu và quyền khớp với các màn cũ.

### Giai đoạn 2 – Chuẩn hoá "Nguồn phát sinh"

- Lập bảng mã nguồn và nhãn tiếng Việt, mở rộng `sourceTypeLabel` (`stock-document.model.ts`). Hiện chỉ có 5 mã CRM.
- Gắn đúng `sourceType` khi lắp/tháo thiết bị, trả về kho, kiểm kê, để xuất/nhập từ Cây vận hành sau này có chỗ đứng. Cần kiểm tra các luồng này hiện đặt `sourceType` bằng gì.
- Không cần migration vì `source_type` là chuỗi tự do. Mã chưa có nhãn thì hiển thị nguyên mã.

### Giai đoạn 3 – Báo cáo của Kho

Tổ chức hai cấp (nhóm rồi báo cáo), thay cho 5 tab phẳng hiện nay (Tồn theo kho, lô, serial, Nhập xuất, Lịch sử duyệt).

| Nhóm | Báo cáo đề xuất | Dữ liệu |
|---|---|---|
| Tồn và giá trị | Nhập – Xuất – Tồn theo kỳ; thẻ kho một vật tư; giá trị tồn theo kho và phân loại | Có (sổ cái, `avgCost`) |
| Luân chuyển | Vòng quay tồn kho; hàng chậm luân chuyển; hàng xuất nhiều nhất theo số lượng | Suy ra từ sổ cái |
| Cảnh báo | Dưới tồn tối thiểu kèm gợi ý bổ sung; lô sắp hết hạn; lô, serial bị chặn chất lượng | Có |
| Kiểm kê | Chênh lệch theo đợt, kho, vật tư; tỷ lệ chính xác; điều chỉnh bất thường | Có |
| Chứng từ | Chứng từ treo (nháp, chờ duyệt quá hạn); thời gian duyệt trung bình; lý do từ chối | Có (lịch sử duyệt) |
| Yêu cầu xuất | Tiến độ đáp ứng; thời gian từ yêu cầu đến xuất kho; thiếu hàng theo vật tư | Có (`issueLineProgress`) |
| Đối tác nhập | Nhập theo nhà cung cấp: số lần, giá trị | Có (`counterparty`, migration 0020) |
| Tài sản | Tình trạng; cấp phát theo nhân viên; phụ tùng BOM so với tồn | Có |

Thứ tự làm đề xuất: Nhập–Xuất–Tồn theo kỳ, Giá trị tồn, Cảnh báo, Chênh lệch kiểm kê, Chứng từ treo. Phần còn lại làm theo nhu cầu.

Ranh giới với CRM: CRM trả lời "bán được gì, thu bao nhiêu"; Kho trả lời "còn gì, chạy nhanh hay chậm, tốn bao nhiêu, vận hành có trơn tru không".

### Giai đoạn 4 – Dọn dẹp (chỉ khi các bước trên đã ổn định)

- Bỏ component cũ không còn dùng.
- Bỏ phần code đọc yêu cầu vật tư từ quy trình đã bị tắt, nếu không dùng lại.
- Cần bạn chốt riêng vì sửa nhiều file.

## 6. Bảng "Nguồn phát sinh" đề xuất

| Mã | Nhãn | Ghi chú |
|---|---|---|
| (trống) | Thủ công | Mặc định |
| `crm_order`, `crm_sales_order` | Đơn bán | Đã có |
| `crm_delivery` | Đợt giao hàng | Đã có |
| `crm_warranty` | Bảo hành | Đã có |
| `crm_return` | Trả hàng | Đã có |
| `procedure` | Quy trình | Mới |
| `stocktake` | Kiểm kê | Mới |
| `asset_tree` | Cây vận hành | Mới, chỗ đứng cho xuất/nhập từ Cây vận hành |

## 7. Rủi ro

- **Hai loại hàng trong một danh sách:** chứng từ có mã và thao tác, dòng cũ thì không. Phải phân biệt rõ để người dùng không bấm nhầm.
- **Quyền:** tab gộp phải ẩn nút duyệt với người không có `inventory.document.approve`; lọc dữ liệu theo quyền xem như màn cũ.
- **Phân trang và tổng:** chỉ đúng khi gộp ở server (mục 4).
- **Dữ liệu cũ có `document_id` trống nhưng lại có `reference_type`:** cần chắc chắn quy tắc suy ra nguồn không làm sai nhãn.
- **Hiệu năng:** `UNION ALL` trên sổ lớn cần kiểm tra chỉ mục (`document_date`, `created_at`, `status`) khi thực thi.

## 8. Câu hỏi còn mở

1. Có làm giai đoạn 1 rồi dừng để xem trước khi sang giai đoạn 2 không?
2. Phần Quy trình về lâu dài: thay vì Kho đọc quy trình, quy trình gọi API nội bộ của Kho để tạo yêu cầu (như CRM). Việc này nằm ngoài module Inventory, cần xác nhận phạm vi.
3. 11 loại chứng từ hiện trộn "loại" với "nguồn" (ví dụ `ISSUE_SALES`, `ISSUE_PROJECT`). Giữ nguyên để khỏi sửa ràng buộc `CHECK` trong migration cũ, hay chuẩn hoá bằng migration mới ở giai đoạn sau?
4. Báo cáo doanh số, hiệu quả sản phẩm (hàng chủ chốt theo tháng, quý, nửa năm; hàng kém bán; chuyển đổi báo giá thành đơn) đặt ở CRM. Cần một kế hoạch riêng.

## 9. Đối chiếu với các kế hoạch cũ trong `docs/`

Ngày đối chiếu: 2026-11-12. Phạm vi: các tài liệu kế hoạch, đề xuất, thiết kế liên quan Kho (không gồm kế hoạch HRM, thông báo, mạng xã hội, Workspace và các tài liệu hướng dẫn sử dụng, test, runbook). Đối chiếu bằng đọc code, chưa chạy test. Điểm đánh dấu "(đã xác minh)" đã được kiểm lại trực tiếp trong code; các điểm còn lại là kết quả đọc của agent, chưa kiểm lại từng dòng.

Tài liệu đã xem:
- `inventory/KE_HOACH_HANG_HOA_DICH_VU_TAI_SAN.md`, `inventory/KE_HOACH_DINH_DANG_TIEN_TE_FORMAT_CURRENCY_VN.md`
- `IN_Kế hoạch phát triển.md`, `KE_HOACH_NHAP_KHO_EXCEL_DYNAMIC_MAPPING.md`
- `DE_XUAT_DRAWER_THU_KHO.md`, `DE_XUAT_FORM_XUAT_NHAP_KHO_DA_DOI_TUONG.md`, `DE_XUAT_QUAN_LY_LO_SERIES_THEO_TENANT.md`, `THIET_KE_CHUC_NANG_KIEM_KE_KHO.md`
- `plan_core_drawler/01` đến `05` và `README.md`, `architecture/de-xuat-in-place-approval-drawer.md`, `ui/PHAN_TICH_UX_MODAL_VA_FORM_NHAP_LIEU.md`

### 9.1 Điểm bị bỏ sót nghiêm trọng (ảnh hưởng thứ tự làm)

| # | Phát hiện | Ảnh hưởng đến kế hoạch gộp |
|---|---|---|
| 1 | **Kiểm kê chưa có backend (đã xác minh).** Không có controller `/stocktakes`; trong module Inventory chỉ có một chỗ nhắc `stocktake` (đếm tham chiếu khi xoá vật tư). Giao diện lưu phiên và dòng kiểm kê trong `localStorage` (`inventory-api.ts`: `initMockStocktakes`, `loadStocktakes` thử gọi `/stocktakes` rồi rơi về dữ liệu giả). Hai quyền `inventory.stocktake.create` và `.approve` đã khai báo nhưng chưa có guard nào dùng. | Báo cáo "Chênh lệch kiểm kê", nguồn `stocktake` và nhóm báo cáo Kiểm kê (giai đoạn 2, 3) **không dựng được** nếu chưa có server. Cần thêm giai đoạn riêng "Backend kiểm kê" trước giai đoạn 3 (xem 9.3). |
| 2 | **Ghi sổ cân kho chạy ở trình duyệt.** `approveAndPostStocktake` gọi nhập hoặc xuất từng dòng từ giao diện, bỏ qua lỗi bằng `console.warn`, không atomic, không có `referenceType = 'STOCKTAKE'`. | Các dòng này sẽ hiện thành "Thủ công"; nguồn "Kiểm kê" ở mục 6 sẽ rỗng. Đồng thời là rủi ro dữ liệu độc lập với kế hoạch gộp. |
| 3 | **Hash cũ chưa được chuyển hướng (đã xác minh).** `LEGACY_TAB` (`inventory-screen.tsx`) chỉ gộp các tab về tồn kho; chưa có `documents`, `approvals`, `issue-requests`, `vouchers`. Thông báo và drawer duyệt dùng `detailUrl` kiểu `/modules/inventory#vouchers/<id>`. | Khi ẩn ba mục khỏi thanh bên, các link này vỡ nếu không thêm ánh xạ (kể cả hash có id chứng từ để mở thẳng chi tiết). Đưa vào tiêu chí xong của giai đoạn 1. |
| 4 | **Hợp đồng duyệt chung (`plan_core_drawler/01`, `04`, `05`) bị bỏ qua.** Adapter Kho cho `STOCK_EXPORT_REQUEST` và `STOCKTAKE_DISCREPANCY` chưa làm. Tài liệu 04 cấm duyệt hàng loạt cho phiếu xuất kho và chênh lệch kiểm kê. | Tab "Xuất/nhập kho" chỉ là màn xem chi tiết, không tự dựng thêm cách duyệt thứ hai ngoài hợp đồng, và không đưa chọn-nhiều-duyệt-hàng-loạt vào tab. |
| 5 | **Mã nguồn `asset` đã tồn tại (đã xác minh).** `inventory.application.ts` ghi `sourceType: 'asset'` ở hai chỗ (lắp, tháo thiết bị), nhưng bảng mục 6 dùng `asset_tree`. | Phải chốt một mã. Đề xuất giữ `asset` (đã có dữ liệu thật) và đổi bảng mục 6. |

### 9.2 Điểm cần bổ sung vào kế hoạch

1. **Chỗ đặt kiểm kê:** `THIET_KE_CHUC_NANG_KIEM_KE_KHO.md` đặt "Kiểm kê kho" trong "Giao dịch & Nhập xuất"; code hiện để tab "Lịch sử kiểm đếm" trong Kho hàng. Đề xuất **giữ Kiểm kê là tab riêng** (vòng đời riêng: Nháp, Đang kiểm đếm, Chờ duyệt, Đã ghi sổ, không lẫn với máy trạng thái chứng từ). Tab gộp chỉ hiện bút toán cân kho đã ghi sổ, kèm liên kết sang đợt.
2. **Hai quyền duyệt:** ngoài `inventory.document.approve` còn `inventory.stocktake.approve`. Nút duyệt trong tab gộp phải kiểm đúng quyền theo loại dòng. Chưa xác minh Kho có chống người lập tự duyệt hay không; cần kiểm tra và ghi rõ.
3. **Chuyển kho (TRANSFER):** một chứng từ có hai kho (nguồn, đích). Danh sách gộp cần cách hiển thị cho cả hai kho, và bộ lọc kho phải khớp cả hai phía.
4. **Lô và serial:** danh sách gộp ở mức chứng từ, không hard-code cột lô. Phải đảm bảo tab mới mở được chi tiết chứng từ có lô FEFO và serial (`IssueRequestPanel`, `StockDocumentApproval` đang xử lý). Công tắc lô/serial theo tenant (`DE_XUAT_QUAN_LY_LO_SERIES_THEO_TENANT`) chưa làm; không xung đột nếu không hard-code.
5. **Form lập phiếu:** nếu tab mới có nút "Lập phiếu" thì chỉ dùng một đường (đề xuất: `MovementForm` đa dòng hiện có). `POST movements/batch` chỉ có nhập và xuất, thiếu điều chuyển và điều chỉnh.
6. **Chuyển kho hai bước (hàng đi đường)** trong đề xuất drawer chưa làm; chừa chỗ trong bảng trạng thái nhưng chưa làm bây giờ.
7. **Loại trừ dịch vụ và tài sản khỏi báo cáo tồn:** kế hoạch Hàng hoá yêu cầu truy vấn tồn lọc `kind IN ('STOCK','SERVICE')` và dịch vụ không có tồn. Báo cáo giá trị tồn, vòng quay, dưới tồn tối thiểu phải theo quy ước này. Đường sửa vật tư chưa ép `minStock`, `maxStock` về 0 cho dịch vụ, nên dữ liệu rác có thể lọt vào báo cáo "Dưới tồn tối thiểu".
8. **Định dạng tiền:** màn mới (giá trị tồn, giá vốn) dùng `formatCurrencyVn` và `VnNumberInput`. Còn khoảng 13 ô `type="number"` chưa chuyển (một phần có thể không phải tiền, chưa xác minh từng ô).
9. **Nguồn "Quy trình":** chỉ có bộ tải client đã tắt và `localStorage` ghi nhận "đã xuất", trái nguyên tắc "Quy trình sở hữu việc duyệt" của `plan_core_drawler/05`. Đề xuất **tạm ẩn nguồn này** ở giai đoạn 1 cho đến khi chốt hướng API nội bộ (câu hỏi mở 2).
10. **"Duyệt nhanh" khác "thao tác nhanh":** `plan_core_drawler/04` dùng "duyệt nhanh" cho duyệt inline ngoài Dashboard; kế hoạch này dùng "thao tác nhanh" cho nhập/xuất tự ghi sổ. Đổi trong tài liệu và giao diện thành **"ghi sổ trực tiếp"** để khỏi nhầm.
11. **Audit trail:** `plan_core_drawler/04` đòi `channel`, `revision`, snapshot bằng chứng cho thao tác duyệt; Kho hiện chỉ có `approved_by`, `rejected_by`. Ghi sổ trực tiếp không có người duyệt thứ hai, nên người lập và người ghi sổ phải hiện rõ trên danh sách. Thêm cột sau này bằng migration mới.
12. **Entitlement:** `plan_core_drawler/04` yêu cầu chế độ chỉ đọc khi module hết hạn. Endpoint mới và các nút duyệt phải theo `ModuleAccess`. Chưa xác minh hiện trạng.

### 9.3 Điều chỉnh thứ tự giai đoạn

- Giai đoạn 1: thêm tiêu chí "ánh xạ hash cũ (`documents`, `approvals`, `issue-requests`, `vouchers/<id>`)" và ẩn nguồn "Quy trình".
- Giai đoạn 2: đổi `asset_tree` thành `asset`; chưa gắn nguồn `stocktake` cho đến khi có backend.
- **Giai đoạn 2b (mới): Backend kiểm kê.** Controller và store cho phiên, dòng kiểm kê; ghi sổ cân kho trong một transaction tạo chứng từ `ADJUSTMENT` với `source_type = 'stocktake'`; chuyển giao diện từ `localStorage` sang API; dùng đúng hai quyền `stocktake.create` và `stocktake.approve`. Việc lớn, cần kế hoạch riêng dựa trên `THIET_KE_CHUC_NANG_KIEM_KE_KHO.md`.
- Giai đoạn 3: các báo cáo Kiểm kê chỉ làm sau giai đoạn 2b.

### 9.4 Tình trạng các kế hoạch cũ (tóm tắt)

| Tài liệu | Đã làm | Chưa làm hoặc làm dở |
|---|---|---|
| Hàng hoá, dịch vụ, tài sản | Chặn đổi `kind` khi đã có tồn; phân loại bán hàng (`trade_category`) | Ép `minStock`, `maxStock`, serial cho dịch vụ ở đường sửa; chặn `CONSUMABLE`; bảng mở rộng dịch vụ; `tracking_mode`; `is_sellable`, `vat_rate` |
| Định dạng tiền tệ | Hàm dùng chung, `VnNumberInput`, 7 màn đã chuyển, Excel | Khoảng 13 ô `type="number"`; rà canh phải ở các bảng (chưa xác minh) |
| Phân tích phiếu kho (IN) | Sổ kho chỉ ghi thêm; kiểm kê có màn riêng | Khu "Quản lý phiếu kho" đi hướng khác (nhóm "Chứng từ"); gắn work order chưa xác minh |
| Nhập kho Excel | Wizard, tích hợp form nhập, vật tư mới | Mẫu ánh xạ lưu ở `localStorage`, không theo tenant |
| Drawer thủ kho | Tồn so với giữ chỗ; lô, hạn sử dụng | Vị trí Dãy/Kệ/Tầng, aging, hàng đi đường, pick-list, footer 4 nút; tab Kiểm kê trong drawer là mã mồ côi (`MaterialStocktakePanel` không được import) |
| Form xuất nhập đa đối tượng | Nhiều dòng, kiểm tồn khả dụng, tổng, gán thiết bị | Đính kèm file: chưa xác minh phía server |
| Lô, serial theo tenant | Server lô và serial (0013, 0014, 0015) | Công tắc tenant, `tracking_mode`, `getTrackingMode` từ cấu hình |
| Kiểm kê kho | UI danh sách, tạo đợt, lưới đếm; 3 bảng (0010) | **12 API chưa có**; dữ liệu trong `localStorage`; ghi sổ không atomic |
| `plan_core_drawler` (duyệt chung) | Phiếu kho có máy trạng thái và quyền duyệt; drawer UI | Adapter Kho, Dashboard gọi task Kho, duyệt nhanh, audit `channel`, `revision` |
| Phân tích UX modal | Phần lớn modal nhập liệu không đóng khi bấm nền | Form phức tạp chuyển sang drawer |

Lưu ý: số migration trong `plan_core_drawler/03` đã lạc hậu (nêu `0011` cho lô và `0012` cho người giữ tài sản; thực tế là `0018` và `0019`, còn `0011` là chứng từ kho). Không dùng làm tham chiếu.

## 10. Tiến độ triển khai (2026-11-17)

Nhánh làm việc: `feat/inventory-stocktake-backend`, tách từ `origin/dev/release`. Chưa commit, chưa push.

| Giai đoạn | Tình trạng | Ghi chú |
|---|---|---|
| 2b. Kiểm kê phía server | Xong | Migration `0024-stocktake-server.sql`; API `v1/stocktakes`; ghi sổ tạo chứng từ `ADJUSTMENT` nguồn `stocktake`; giao diện bỏ `localStorage`. |
| 1. Tab gộp "Xuất/nhập kho" | Xong | Endpoint `GET /v1/stock-movements`; tab con mới trong Kho hàng; ẩn ba mục thanh bên; chuyển hướng hash cũ. |
| 2. Chuẩn hoá nguồn phát sinh | Xong phần nhãn và lọc | Xem các điểm lệch so với kế hoạch bên dưới. |
| 3. Báo cáo của Kho | Chưa làm | |
| 4. Dọn dẹp | Chưa làm | Cần chốt riêng. |

Điểm lệch so với kế hoạch ban đầu:

1. **Không lấy `fix/inventory-audit-remediation` làm gốc.** Nhánh đó xoá phần lọc theo phân loại bán hàng đã merge (`tradeCategories`, lọc `tradeCategory` ở danh mục nội bộ) và SQL kiểm kê dùng cột không có trong migration (`materials.material_kind`, `materials.standard_cost`); bước duyệt cộng trừ thẳng `material_inventory`, không qua chứng từ, không xử lý lô và serial. Phần đáng giữ của nhánh đó chưa chuyển sang: neo đầu đường dẫn trong guard, endpoint `requisitions/fulfilled`, đổi `<select>` sang `SearchableSelect` ở 7 màn, đọc Excel bằng worker, trang bảo trì nginx.
2. **Mã nguồn thiết bị giữ `asset`**, không dùng `asset_tree`: `listInstalled` và `installedTracking` cộng số đang lắp theo `reference_type = 'asset'`.
3. **Thanh lý về kho (`returnItemToStock`) vẫn là nguồn Thủ công.** Gắn `asset` cho luồng này sẽ làm lệch số đang lắp vì cùng lý do trên.
4. **Tab gộp có ba góc nhìn**: Tất cả (danh sách gộp mới), Chờ duyệt và Yêu cầu xuất từ đơn bán. Hai góc nhìn sau dùng lại nguyên màn cũ, nên quyền và nghiệp vụ không đổi.
5. **Tab con "Lịch sử xuất nhập" vẫn giữ** cạnh tab mới: đó là sổ theo từng dòng bút toán và là nơi đặt form ghi sổ trực tiếp.
6. **Nguồn "Quy trình" không ẩn khỏi bộ lọc**: bút toán do quy trình ghi (`referenceType = PROCEDURE`) vẫn hiện đúng nhãn. Phần tải phiếu yêu cầu từ module Quy trình ở trình duyệt vẫn tắt như trước.
7. Nhãn nguồn trống đổi từ "Không có nguồn" thành "Thủ công".

Kiểm thử đã chạy trên Postgres local: module Kho 32 bộ, 359 test đạt; web Kho 112 test đạt; guard 6 test đạt; `check-migrations`, `check-ui-rules`, `sync-agent-skills --check` đạt. Chưa chạy `nx affected` và `nx sync:check` vì Nx lỗi trong worktree.
