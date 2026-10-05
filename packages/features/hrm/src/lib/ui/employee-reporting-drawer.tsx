'use client';
import { Table, type TableColumnsType } from 'antd';
import type { HrmReportingLine } from '@enterprise-platform/contracts-hrm';
import { useReportingLines } from '../hrm-personnel-decisions-api';
import { formatDateVn } from '../personnel-decision-rules';
import { Badge } from './badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './sheet';

const sourceLabels: Record<HrmReportingLine['source'], string> = {
  DECISION: 'Quyết định',
  MANUAL: 'Nhập tay',
  IMPORT: 'Nhập khẩu',
  CORE_SYNC: 'Đồng bộ Core',
};

/** Hiển thị "Quản lý trực tiếp" hiện tại của nhân viên. */
export function CurrentManagerLine({
  employeeId,
}: {
  employeeId: string | null | undefined;
}) {
  const { data, loading, error } = useReportingLines(employeeId);
  const current = data?.current;
  return (
    <span className="font-semibold text-slate-900">
      {loading
        ? 'Đang tải...'
        : error
          ? 'Không tải được'
          : current
            ? `${current.managerName ?? current.managerEmployeeId}${current.managerCode ? ` (${current.managerCode})` : ''}`
            : 'Chưa có'}
    </span>
  );
}

export function EmployeeReportingDrawer({
  employeeId,
  employeeName,
  open,
  onOpenChange,
}: {
  employeeId: string | null | undefined;
  employeeName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, loading, error } = useReportingLines(open ? employeeId : null);
  const columns: TableColumnsType<HrmReportingLine> = [
    {
      title: 'Quản lý',
      render: (_, r) => (
        <div>
          <span className="block font-semibold">{r.managerName ?? r.managerEmployeeId}</span>
          <span className="font-mono text-[11px] text-slate-500">{r.managerCode ?? ''}</span>
        </div>
      ),
    },
    {
      title: 'Loại',
      dataIndex: 'relationType',
      width: 90,
      render: (v: string) => (v === 'DIRECT' ? 'Trực tiếp' : 'Gián tiếp'),
    },
    {
      title: 'Hiệu lực',
      width: 190,
      render: (_, r) => `${formatDateVn(r.effectiveFrom)} → ${r.effectiveTo ? formatDateVn(r.effectiveTo) : 'Hiện tại'}`,
    },
    {
      title: 'Nguồn',
      width: 140,
      render: (_, r) => (
        <div>
          <Badge className="border border-slate-200 bg-slate-50 text-[10px] text-slate-700">
            {sourceLabels[r.source]}
          </Badge>
          {r.decisionNo && (
            <span className="mt-0.5 block font-mono text-[11px] text-blue-700">{r.decisionNo}</span>
          )}
        </div>
      ),
    },
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-[680px] p-0">
        <SheetHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 p-5">
          <SheetTitle className="text-base font-bold">Lịch sử báo cáo</SheetTitle>
          <SheetDescription className="text-xs">
            {employeeName ?? 'Nhân viên'} - các quan hệ quản lý trực tiếp theo thời gian
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 text-xs">
          {error && (
            <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 font-semibold text-red-700">
              {error}
            </p>
          )}
          <Table<HrmReportingLine>
            size="small"
            rowKey="id"
            loading={loading}
            pagination={false}
            columns={columns}
            dataSource={[...(data?.history ?? [])]}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
