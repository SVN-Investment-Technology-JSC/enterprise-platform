import { cn } from '../ui/cn';

/** Nhãn trạng thái của mặt hàng: đang dùng (xanh) hay ngừng dùng (đỏ), đủ đậm để phân biệt ngay trong bảng. */
export function TradeStatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        active ? 'border-green-300 bg-green-100 text-green-700' : 'border-rose-300 bg-rose-100 text-rose-700',
      )}
    >
      {active ? 'Đang dùng' : 'Ngừng dùng'}
    </span>
  );
}
