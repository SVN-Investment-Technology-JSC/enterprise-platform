/**
 * Tên nhân viên của đơn, kèm dấu sao đỏ khi đơn do người khác tạo hộ để phân biệt ngay trên danh sách
 * (ví dụ "Đoàn Nguyễn Sơn Hải*"). Rê chuột vào dấu sao để xem ai tạo hộ và lý do.
 */
export function OnBehalfName(props: {
  readonly name: string;
  readonly onBehalf: boolean;
  readonly byName?: unknown;
  readonly reason?: unknown;
}) {
  const { name, onBehalf } = props;
  if (!onBehalf) return <>{name}</>;
  const hint = `Đơn tạo hộ bởi ${String(props.byName || 'một người dùng')}. Lý do: ${String(props.reason || '—')}`;
  return (
    <>
      {name}
      <span className="ml-0.5 font-bold text-red-600" title={hint} aria-label="Đơn tạo hộ" data-testid="on-behalf-mark">
        *
      </span>
    </>
  );
}
