/**
 * Ô ngày của Excel đọc ra là số serial (số ngày kể từ 30/12/1899), không phải chuỗi. Đổi thẳng sang `YYYY-MM-DD`;
 * nếu để chuỗi "46371" đi qua `new Date(...)` thì ra năm 46370 mà không báo lỗi gì.
 * Trả `undefined` khi giá trị không phải số serial hợp lý (khoảng năm 1954 đến 2119), để nhánh đọc chuỗi xử lý tiếp.
 */
export function excelSerialToIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value <= 20_000 || value >= 80_000) return undefined;
  return new Date(Math.round((value - 25_569) * 86_400_000)).toISOString().slice(0, 10);
}
