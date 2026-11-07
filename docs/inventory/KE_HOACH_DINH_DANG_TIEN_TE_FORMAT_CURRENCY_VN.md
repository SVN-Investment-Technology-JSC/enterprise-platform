# Kế hoạch: Chuẩn hóa định dạng tiền và số trong phân hệ Kho (nhập liệu và hiển thị bảng)

Trạng thái: **Đề xuất triển khai**.
Phạm vi áp dụng: **chỉ phân hệ Kho** (`packages/features/inventory/`). Các phân hệ khác (CRM, Finance, HRM) chưa đụng tới; sau này muốn dùng thì chỉ cần import cùng bộ hàm.
Nơi đặt hàm dùng chung: `@enterprise-platform/shared-ui` (cùng chỗ với `date-format.ts`) để một nguồn duy nhất, nhưng trong đợt này chỉ Kho gọi.
Định hướng: tạm gác đa ngôn ngữ, thống nhất theo chuẩn Việt Nam: dấu `.` ngăn hàng nghìn, dấu `,` ngăn phần thập phân. Ví dụ `500.000.000,01`.

Hai việc trọng tâm:
1. **Form nhập liệu**: ô tiền và ô số lượng tự chèn dấu chấm khi gõ, nhận đúng `500.000.000,01`, không mất số lẻ.
2. **Bảng hiển thị**: cột tiền và số lượng canh phải, cùng một định dạng, số lẻ không bị cắt.

---

## 1. Hiện trạng trong Kho (đã đối chiếu với code)

### 1.1. Hiển thị
Dữ liệu DB lưu `NUMERIC`, giao diện tự format riêng lẻ ở nhiều nơi:

| Hàm hiện có | Vị trí | Cách format |
|---|---|---|
| `formatNumber` | `inventory-labels.ts:105` | `Intl.NumberFormat('vi-VN')` |
| `formatNumber` (bản sao) | `transaction-hub.tsx:38`, `stocktake-hub.tsx:54`, `inventory-dashboard.tsx:37` | như trên, mỗi file một bản |
| `formatMaterialPrice` | `inventory-labels.ts:115` | `formatNumber` + `đ` |
| `formatSalePrice` | `trade-items.model.ts:153` | `Intl` + ` đ` |
| `formatCurrency` | `stocktake-hub.tsx:58` | `style: 'currency'` nên ra ký hiệu `₫`, khác nơi khác |
| (nội tuyến) | `excel-import-dialog.tsx:2249, 2397, 2417` | `Intl.NumberFormat('vi-VN')` trực tiếp |
| (nội tuyến) | `inventory-dashboard.cards.tsx:210` | `maximumFractionDigits: 0`, cắt số lẻ |

Có khoảng 144 chỗ gọi các hàm trên rải ở 28 file (nhiều nhất `inventory-reports.tsx`, `movement-form.tsx`, `item-catalog.tsx`).

Lưu ý: mặc định `Intl.NumberFormat('vi-VN')` hiển thị tối đa 3 chữ số thập phân nên `500000000.01` hiện đã ra `500.000.000,01`. Vấn đề của Kho là **không nhất quán** (hai kiểu đơn vị `đ` và `₫`, một số chỗ cắt số lẻ ở dashboard, mỗi file một bản hàm) và **ô nhập liệu** dưới đây.

### 1.2. Ô nhập liệu
| Ô | Vị trí | Kiểu hiện tại | Vấn đề |
|---|---|---|---|
| Giá bán (tạo hàng hóa) | `trade-item-form-dialog.tsx:217` | text + `inputMode="decimal"` | không chèn dấu chấm; người dùng gõ `500000000,01` hay `500000000.01` đều có thể, kiểm tra hợp lệ phụ thuộc cách parse |
| Giá bán (sửa trong drawer) | `trade-item-drawer.tsx:363` | text + `inputMode="decimal"` | như trên |
| Đơn giá vật tư | `material-form.tsx:310` | `type="number"` | trình duyệt hiển thị số thập phân theo locale máy, không có dấu ngăn nghìn, cuộn chuột làm đổi giá trị |
| Đơn giá dòng phiếu | `stock-document-form.tsx:228` | `type="number"` | như trên |
| Số lượng dòng phiếu | `stock-document-form.tsx:211`, `movement-form.tsx:1499/1535`, `stocktake-hub.tsx:1100`, `batch-requisition-modal.tsx:524`, `return-to-stock-dialog.tsx:302` | `type="number"` | như trên |
| Import Excel | `excel-import-dialog.tsx` (cột đơn giá, số lượng) | đọc chuỗi/số từ file | file khách có thể là `500.000.000,01`, `500000000,01` hoặc `500000000.01` |

---

## 2. Mục tiêu kỹ thuật

1. **Một bộ hàm duy nhất**: hiển thị, đọc (parse), và một component ô nhập.
2. **Số lẻ**: `500000000.01` hiển thị `500.000.000,01`; số nguyên tròn không thừa `,00` (trừ khi bật `fixedDecimals`).
3. **An toàn giá trị rỗng**: `null`, `undefined`, `""`, `NaN`, `Infinity` trả về fallback (`—` cho tiền, `0` cho số lượng).
4. **Giá trị đưa lên server luôn là chuỗi/số chuẩn** `500000000.01` (dấu chấm thập phân, không ngăn nghìn); phần hiển thị chỉ nằm trong giao diện.
5. **Không đổi DB, không đổi API**.

---

## 3. Đặc tả kỹ thuật

### 3.1. File
- `packages/shared/ui/src/lib/currency-format.ts` (hàm thuần)
- `packages/shared/ui/src/lib/vn-number-input.tsx` (+ `.module.css` nếu cần)
- Export tại `packages/shared/ui/src/index.ts`
- Test: `currency-format.spec.ts`, `vn-number-input.spec.tsx` cạnh code.

### 3.2. `formatCurrencyVn` và `formatQuantityVn`

```typescript
export interface FormatCurrencyVnOptions {
  /** Thêm hậu tố đơn vị. Mặc định false (bảng thường để đơn vị ở tiêu đề cột). */
  showUnit?: boolean;
  /** Mặc định 'đ'. Dùng một ký hiệu duy nhất trong Kho; không dùng '₫'. */
  unitSymbol?: 'đ' | 'VND';
  /** Số chữ số thập phân tối đa. Mặc định 2 (khớp NUMERIC(15,2)). */
  maxDecimals?: number;
  /** true: luôn đủ số thập phân (500000000 -> "500.000.000,00"). Mặc định false. */
  fixedDecimals?: boolean;
  /** Trả về khi dữ liệu không hợp lệ. Mặc định '—'. */
  fallback?: string;
}

export function formatCurrencyVn(
  value: number | string | null | undefined,
  options: FormatCurrencyVnOptions = {},
): string {
  const { showUnit = false, unitSymbol = 'đ', maxDecimals = 2, fixedDecimals = false, fallback = '—' } = options;
  // Chuỗi đi qua parseVnNumber, không tự đổi ',' thành '.' ở đây
  const num = typeof value === 'string' ? parseVnNumber(value) : value;
  if (num === null || num === undefined || !Number.isFinite(num)) return fallback;
  const text = new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: fixedDecimals ? maxDecimals : 0,
    maximumFractionDigits: maxDecimals,
  }).format(num);
  return showUnit ? `${text} ${unitSymbol}` : text;
}

/** Số lượng tồn/xuất/nhập có thể lẻ; tối đa 3 chữ số thập phân. */
export function formatQuantityVn(value: number | string | null | undefined, maxDecimals = 3, fallback = '0'): string {
  return formatCurrencyVn(value, { maxDecimals, fallback });
}
```

Quy ước hiển thị: `0` là `0`, còn chưa khai báo là `—` (khác nhau, giữ đúng như `formatMaterialPrice` hiện tại).

### 3.3. `parseVnNumber`
Đọc chuỗi người dùng gõ hoặc từ Excel thành `number | null`:

| Chuỗi vào | Kết quả | Quy tắc |
|---|---|---|
| `500.000.000,01` | 500000000.01 | có cả `.` và `,`: dấu xuất hiện **cuối cùng** là thập phân |
| `500000000,01` | 500000000.01 | chỉ có `,`: thập phân |
| `500000000.01` | 500000000.01 | chỉ có `.` và không đúng mẫu nhóm nghìn: thập phân |
| `1.500` | 1500 | chỉ có `.` và đúng mẫu `\d{1,3}(\.\d{3})+`: ngăn nghìn (người dùng Việt gõ như vậy) |
| `-1.250,5`, `(1.250)` | -1250.5, -1250 | hỗ trợ dấu `-` đầu và ngoặc |
| `500.000 đ`, `500 000 VND` | 500000 | bỏ `đ`, `₫`, `VND`, khoảng trắng |
| `abc`, `1,2,3`, `` | `null` | không hợp lệ |

Khi ô Excel đã là kiểu số (`typeof === 'number'`) thì dùng thẳng, không parse chuỗi (tránh hiểu nhầm `1.5` là một nghìn năm trăm). Chuỗi nhập tay `1.500` được hiểu là 1500; muốn nhập 1,5 phải gõ `1,5`.

### 3.4. Component `VnNumberInput` (ô nhập khi gõ)
- Là `<input type="text" inputMode="decimal">` (không dùng `type="number"`), canh phải, `font-variant-numeric: tabular-nums`.
- Khi gõ: chỉ giữ chữ số và tối đa một dấu `,`; tự chèn `.` ngăn nghìn ở phần nguyên; cắt phần thập phân theo `maxDecimals` (tiền 2, số lượng 3); cho phép `-` nếu `allowNegative`.
- Giữ vị trí con trỏ: đếm số chữ số bên trái con trỏ trước khi format, đặt lại sau khi format (tránh nhảy con trỏ về cuối).
- Gõ `.` được hiểu là dấu thập phân khi phần nguyên chưa có nhóm nghìn hợp lệ (`500.` → `500,`); dán chuỗi đi qua `parseVnNumber`.
- Giá trị ra ngoài: `onChange(raw: string)` với `raw` chuẩn hóa dạng `500000000.01` (hoặc `''`), nên code hiện tại dùng `Number(price)` và kiểm tra `priceInvalid` tiếp tục chạy mà không phải đổi.
- Hiển thị `aria-invalid`, hỗ trợ `id`, `placeholder`, `disabled`, `onBlur`; blur thì định dạng lại (bỏ dấu `,` thừa ở cuối).
- Không đổi giá trị khi cuộn chuột (đây là lý do bỏ `type="number"`).

Thiết kế props: `value: string`, `onChange(raw: string)`, `maxDecimals?: number` (mặc định 2), `allowNegative?: boolean` (mặc định false), `unit?: string` (hiện nhãn đơn vị cố định bên phải ô, ví dụ `đ`).

---

## 4. Áp dụng trong Kho

### 4.1. Gom hàm hiển thị, không sửa 144 chỗ gọi
Giữ tên hàm hiện có, cho chúng gọi hàm mới:
- `inventory-labels.ts`: `formatNumber` → `formatQuantityVn`; `formatMaterialPrice` → `formatCurrencyVn(..., { showUnit: true })` giữ `currencyLabel`.
- `trade-items.model.ts`: `formatSalePrice` → `formatCurrencyVn(price, { showUnit: true })`.
- Xóa bản sao `formatNumber` ở `transaction-hub.tsx`, `stocktake-hub.tsx`, `inventory-dashboard.tsx`; import từ `inventory-labels.ts`.
- `stocktake-hub.tsx:58` `formatCurrency`: bỏ `style: 'currency'`, dùng `formatCurrencyVn` để thống nhất `đ`.
- `excel-import-dialog.tsx:2249/2397/2417`: thay `Intl` nội tuyến bằng `formatQuantityVn`/`formatCurrencyVn`.
- `inventory-dashboard.cards.tsx:210`: **hỏi lại chủ ý** làm tròn nguyên cho thẻ tổng quan. Nếu là cố ý thì dùng `formatCurrencyVn(value, { maxDecimals: 0 })` và ghi chú; không đổi ngầm.

### 4.2. Quy chuẩn hiển thị ở bảng (Table)
- Cột tiền và số lượng: **canh phải**, `tabular-nums`, để các chữ số thẳng hàng.
- Bảng nhiều dòng: đơn vị đặt ở **tiêu đề cột** (`Đơn giá (đ)`), ô chỉ có số (`formatCurrencyVn` không `showUnit`). Giá trị đơn lẻ (drawer, chi tiết, thẻ) dùng `showUnit: true`.
- Không có dữ liệu: `—` cho tiền; `0` cho số lượng.
- Cột tổng (Thành tiền = số lượng x đơn giá): tính bằng số rồi mới format, không cộng chuỗi đã format.

Các bảng cần rà (mỗi bảng chuẩn hóa canh phải và hàm format): `item-catalog.tsx`, `stock-table.tsx`, `ledger-table.tsx`, `warehouse-stock-tab.tsx`, `stock-document-list.tsx`, `stock-document-detail.tsx`, `movement-detail-drawer.tsx`, `transaction-hub.tsx`, `stocktake-hub.tsx`, `inventory-reports.tsx`, `trade-items-page.tsx`.

### 4.3. Form nhập liệu (đổi sang `VnNumberInput`)
Đợt 1 (ô tiền, ưu tiên cao vì dễ nhập sai số 0):
| Ô | Vị trí |
|---|---|
| Giá bán | `trade-item-form-dialog.tsx:217`, `trade-item-drawer.tsx:363` |
| Đơn giá vật tư | `material-form.tsx:310` |
| Đơn giá dòng phiếu | `stock-document-form.tsx:228`, đơn giá trong `movement-form.tsx` |

Đợt 2 (ô số lượng, `maxDecimals` 3, cần cho hàng lẻ như kg, mét):
`stock-document-form.tsx:211`, `movement-form.tsx:1499/1535`, `stocktake-hub.tsx:1100` (số lượng kiểm kê thực tế), `batch-requisition-modal.tsx:524`, `return-to-stock-dialog.tsx:302`, `stocktake-lot-serial-drawer.tsx:305/371`.

Lưu ý khi đổi: các ô `type="number"` có thuộc tính `min`, `max`, `step` (ví dụ `movement-form.tsx:1752` tối đa bằng tồn lô); phần kiểm tra giới hạn phải chuyển vào code (kẹp giá trị sau khi parse) khi bỏ `type="number"`. Ô lưới (`gridCellInput`) cần kiểm tra con trỏ/focus khi nằm trong bảng.

### 4.4. Import Excel
`excel-import-dialog.tsx` và `trade-item-import-dialog.tsx`: cột đơn giá và số lượng đọc qua `parseVnNumber` nếu là chuỗi, dùng thẳng nếu là số. Dòng không parse được báo lỗi theo dòng (tiếng Việt, nêu giá trị gốc), không âm thầm đổi về 0. Bảng xem trước hiển thị bằng `formatCurrencyVn`/`formatQuantityVn`.

---

## 5. Kiểm thử

`currency-format.spec.ts` bao phủ tối thiểu:
- Format: `500000000.01`, `500000000`, `0`, `0.5`, `1234.5678` (cắt 2 chữ số), số âm, chuỗi `"500.000.000,01"`, `null`, `undefined`, `""`, `NaN`, `Infinity`, `fixedDecimals`, `showUnit`.
- Parse: toàn bộ bảng ở mục 3.3, thêm `1.500` (nghìn), `1.5` (thập phân), `500.000.000,01`, ngoặc, đơn vị, chuỗi rác.
- Khứ hồi: `parseVnNumber(formatCurrencyVn(x)) === x` với tập giá trị mẫu.

`vn-number-input.spec.tsx`: gõ `500000000,01` hiển thị `500.000.000,01` và `onChange` nhận `500000000.01`; xóa giữa chuỗi không nhảy con trỏ; dán `500.000.000,01`; không nhận chữ; cắt đúng số thập phân.

Cập nhật test hiện có nếu chúng khẳng định chuỗi cũ (`₫`, v.v.).

---

## 6. Lộ trình

| Bước | Nội dung | File |
|:---:|---|---|
| B1 | Viết `currency-format.ts` (+ test) | `packages/shared/ui/src/lib/currency-format.ts`, `.spec.ts`, `index.ts` |
| B2 | Viết `VnNumberInput` (+ test) | `packages/shared/ui/src/lib/vn-number-input.tsx` |
| B3 | Gom hàm hiển thị trong Kho (mục 4.1) | `inventory-labels.ts`, `trade-items.model.ts`, các hub |
| B4 | Chuẩn hóa bảng (mục 4.2) | danh sách bảng ở 4.2 |
| B5 | Đổi ô tiền sang `VnNumberInput` (đợt 1) | mục 4.3 |
| B6 | Đổi ô số lượng (đợt 2) | mục 4.3 |
| B7 | Import Excel (mục 4.4) | hai dialog import |
| B8 | Chạy kiểm: `pnpm nx run shared-ui:test`, `pnpm nx run feature-inventory:typecheck`, `lint`, `test`; sau đó `pnpm nx affected -t lint typecheck test --base=origin/dev/release` | |

Mỗi bước tách thành một commit nhỏ để dễ xem và hoàn lại; B1-B2 có thể mở PR riêng trước.

---

## 7. Kết quả mong đợi
1. Trong Kho: `500000000.01` hiển thị `500.000.000,01` (kèm ` đ` khi có `showUnit`); `500000000` hiển thị `500.000.000`; chưa khai báo hiển thị `—`.
2. Gõ vào ô tiền: thấy ngay `500.000.000,01`, không còn nhầm số 0, nhận cả khi dán từ Excel.
3. Một ký hiệu `đ` thống nhất, không còn `₫` hay các bản sao `formatNumber`.
4. Không đổi cấu trúc DB, không đổi hợp đồng API; giá trị gửi lên server vẫn là số chuẩn.

## 8. Việc ngoài phạm vi (ghi lại, không làm trong kế hoạch này)
- Áp dụng cho CRM, Finance, HRM (CRM có `maximumFractionDigits: 0` ở `sales.model.ts` và `dashboard.model.ts`, nên xem lại khi tới lượt).
- Đa ngôn ngữ, đa tiền tệ.
