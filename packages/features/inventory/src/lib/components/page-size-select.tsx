'use client';

import { SearchableSelect } from '@enterprise-platform/shared-ui';

const DEFAULT_SIZES: readonly number[] = [15, 30, 45, 60];

/**
 * Ô chọn số dòng mỗi trang theo chuẩn UI (SearchableSelect, không dùng thẻ select).
 * Luôn có mặt giá trị hiện tại kể cả khi nó không nằm trong danh sách mặc định,
 * để ô không bao giờ hiển thị rỗng.
 */
export function PageSizeSelect({
  value,
  sizes = DEFAULT_SIZES,
  onChange,
}: {
  value: number;
  sizes?: readonly number[];
  onChange: (size: number) => void;
}) {
  const all = sizes.includes(value) ? sizes : [...sizes, value].sort((a, b) => a - b);
  return (
    <SearchableSelect
      style={{ minWidth: 150 }}
      value={String(value)}
      options={all.map((size) => ({ value: String(size), label: `${size} / trang` }))}
      onChange={(next) => {
        const size = Number(next);
        if (Number.isFinite(size) && size > 0) onChange(size);
      }}
    />
  );
}
