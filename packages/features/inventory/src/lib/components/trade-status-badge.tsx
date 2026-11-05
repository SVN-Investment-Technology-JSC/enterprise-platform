/** Nhãn trạng thái của mặt hàng: đang dùng (xanh) hay ngừng dùng (đỏ), đủ đậm để phân biệt ngay trong bảng. */
export function TradeStatusBadge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        background: active ? '#dcfce7' : '#ffe4e6',
        color: active ? '#15803d' : '#be123c',
        border: `1px solid ${active ? '#86efac' : '#fda4af'}`,
      }}
    >
      {active ? 'Đang dùng' : 'Ngừng dùng'}
    </span>
  );
}
