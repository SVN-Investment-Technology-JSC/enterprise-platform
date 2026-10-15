'use client';
import { useReportingLines } from '../hrm-personnel-decisions-api';

/**
 * Hiển thị "Quản lý trực tiếp" hiện tại của nhân viên: lấy theo "Báo cáo cho" của chức danh trong sơ đồ tổ chức Core,
 * không có thì Tổng giám đốc. Quản lý chỉ đổi được ở Cấu trúc tổ chức, không đổi ở HRM.
 */
export function CurrentManagerLine({
  employeeId,
}: {
  employeeId: string | null | undefined;
}) {
  const { data, loading, error } = useReportingLines(employeeId);
  const manager = data?.manager;
  if (loading || error || !manager)
    return (
      <span className="font-semibold text-slate-900">
        {loading ? 'Đang tải...' : error ? 'Không tải được' : 'Chưa có'}
      </span>
    );
  return (
    <span className="min-w-0">
      <span className="block font-semibold text-slate-900">
        {manager.name}
        {manager.code ? ` (${manager.code})` : ''}
      </span>
      {manager.title ? (
        <span className="block text-[12px] font-normal text-slate-500">{manager.title}</span>
      ) : null}
      {manager.source === 'CHIEF_FALLBACK' ? (
        <span className="block text-[12px] font-normal text-slate-500">Duyệt mặc định (chưa khai báo quản lý)</span>
      ) : null}
    </span>
  );
}
