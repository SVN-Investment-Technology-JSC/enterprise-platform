'use client';
import { DatePickerInput } from './date-picker-input';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmLeaveSettlement as HrmLeaveSettlementRow,
  HrmLeaveSettlementItem,
  HrmLeaveSettlementResult,
  HrmUnusedLeaveDisposition,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Badge } from './badge';
import { Button } from './button';

const dispositionLabel: Record<HrmUnusedLeaveDisposition, string> = {
  CANCEL: 'Hủy phần phép dư',
  PAYOUT_MARKED: 'Trả tiền (chỉ đánh dấu số ngày, chưa tính tiền)',
};

const num = (v: number) => (Math.round(v * 100) / 100).toLocaleString('vi-VN');

/**
 * Quyết toán phép khi nghỉ việc: xem trước (chỉ đọc), quyết toán, và danh sách quyết toán.
 * Phần dùng dư chỉ ghi nhận "Dùng dư chưa xử lý"; không thu hồi, không trừ lương.
 */
export function HrmLeaveSettlement({
  employees,
}: {
  employees: { value: string; label: string }[];
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState('');
  const [result, setResult] = useState<HrmLeaveSettlementResult | null>(null);
  const [rows, setRows] = useState<HrmLeaveSettlementRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadRows = useCallback(async () => {
    const r = await hrmFetch<{ data: HrmLeaveSettlementRow[] }>(
      '/leave-settlements',
    );
    setRows(r.data);
  }, []);
  useEffect(() => {
    void loadRows().catch((e) => setError(e.message));
  }, [loadRows]);

  async function run(kind: 'preview' | 'commit') {
    if (!employeeId || !date) {
      setError('Cần chọn nhân viên và ngày nghỉ việc');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const r = await hrmFetch<{ data: HrmLeaveSettlementResult }>(
        `/leave-settlements/${kind}`,
        {
          method: 'POST',
          body: JSON.stringify({ employeeId, terminationDate: date }),
        },
      );
      setResult(r.data);
      if (kind === 'commit') {
        setMessage('Đã quyết toán phép. Chạy lại cùng ngày nghỉ không ghi trùng.');
        await loadRows();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-xs p-5 space-y-4">
      <div className="pb-2 border-b border-slate-100">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Quyết toán phép nghỉ việc
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Tính lại phép thực được hưởng đến ngày nghỉ. Phép dư xử lý theo cấu hình vận hành; phần dùng dư chỉ được ghi nhận để xử lý sau (không thu hồi, không trừ lương).
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72 space-y-1 text-xs font-medium text-slate-700">
          <span>Nhân viên</span>
          <SearchableSelect
            value={employeeId}
            options={employees}
            onChange={(v) => {
              setEmployeeId(v || '');
              setResult(null);
            }}
            placeholder="Chọn nhân viên"
          />
        </div>
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Ngày nghỉ việc</span>
          <DatePickerInput
  value={date}
  className="w-44"
  onChange={(v: string) => {
              setDate(v);
              setResult(null);
            }}
/>
        </label>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run('preview')}
          className="h-9 text-xs"
        >
          Xem trước
        </Button>
        <Popconfirm
          title="Quyết toán phép cho nhân viên này?"
          description="Ghi sổ cái và không thể chạy lại với ngày nghỉ khác trong cùng năm."
          okText="Quyết toán"
          cancelText="Quay lại"
          onConfirm={() => void run('commit')}
        >
          <Button
            disabled={busy || !result || !result.preview}
            className="h-9 bg-blue-600 text-xs text-white hover:bg-blue-700"
          >
            Quyết toán
          </Button>
        </Popconfirm>
      </div>
      {error && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-medium text-emerald-700">
          {message}
        </p>
      )}
      {result && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">
            {result.preview ? 'Xem trước' : 'Kết quả quyết toán'} đến ngày{' '}
            {result.terminationDate}. Xử lý phép dư:{' '}
            <strong>{dispositionLabel[result.disposition]}</strong>.
          </p>
          {result.warnings.map((w: string) => (
            <p key={w} role="alert" className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              {w}
            </p>
          ))}
          <Table<HrmLeaveSettlementItem>
            size="small"
            rowKey="leaveTypeId"
            pagination={false}
            dataSource={[...result.items]}
            columns={[
              {
                title: 'Loại nghỉ',
                render: (_, r) => `${r.leaveTypeCode} · ${r.leaveTypeName}`,
              },
              { title: 'Được hưởng', dataIndex: 'entitledDays', render: num },
              { title: 'Đã dùng', dataIndex: 'usedDays', render: num },
              { title: 'Đang chờ duyệt', dataIndex: 'pendingDays', render: num },
              { title: 'Còn dư', dataIndex: 'unusedDays', render: num },
              { title: 'Dùng dư', dataIndex: 'overusedDays', render: num },
              {
                title: 'Trạng thái',
                render: (_, r) =>
                  r.status === 'OVERUSE_OPEN' ? (
                    <Badge className="border-amber-200 bg-amber-50 text-xs text-amber-700">
                      Dùng dư chưa xử lý
                    </Badge>
                  ) : r.alreadySettled ? (
                    <Badge className="border-slate-200 bg-slate-100 text-xs text-slate-600">
                      Đã quyết toán
                    </Badge>
                  ) : (
                    <Badge className="border-emerald-200 bg-emerald-50 text-xs text-emerald-700">
                      Sẵn sàng
                    </Badge>
                  ),
              },
            ]}
          />
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-slate-700">
          Danh sách quyết toán ({rows.length})
        </h3>
        <Table<HrmLeaveSettlementRow>
          size="small"
          rowKey="id"
          dataSource={rows}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 1000 }}
          columns={[
            {
              title: 'Nhân viên',
              render: (_, r) =>
                `${r.employeeCode ?? ''} ${r.employeeName ?? r.employeeId}`.trim(),
            },
            { title: 'Loại nghỉ', dataIndex: 'leaveTypeName' },
            { title: 'Ngày nghỉ việc', dataIndex: 'terminationDate' },
            { title: 'Được hưởng', dataIndex: 'entitledDays', render: num },
            { title: 'Đã dùng', dataIndex: 'usedDays', render: num },
            { title: 'Còn dư', dataIndex: 'unusedDays', render: num },
            { title: 'Dùng dư', dataIndex: 'overusedDays', render: num },
            {
              title: 'Xử lý phép dư',
              dataIndex: 'disposition',
              render: (v: keyof typeof dispositionLabel) =>
                v === 'PAYOUT_MARKED' ? 'Trả tiền (đánh dấu)' : 'Hủy',
            },
            {
              title: 'Trạng thái',
              dataIndex: 'status',
              render: (v) =>
                v === 'OVERUSE_OPEN' ? (
                  <Badge className="border-amber-200 bg-amber-50 text-xs text-amber-700">
                    Dùng dư chưa xử lý
                  </Badge>
                ) : (
                  <Badge className="border-emerald-200 bg-emerald-50 text-xs text-emerald-700">
                    Đã quyết toán
                  </Badge>
                ),
            },
          ]}
        />
      </div>
    </section>
  );
}
