'use client';
import { useCallback, useEffect, useState } from 'react';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmLeaveSettlementSettings,
  HrmUnusedLeaveDisposition,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';

const options: { value: HrmUnusedLeaveDisposition; label: string }[] = [
  { value: 'CANCEL', label: 'Hủy' },
  {
    value: 'PAYOUT_MARKED',
    label: 'Trả tiền (chỉ đánh dấu số ngày, chưa tính tiền)',
  },
];

/** Cấu hình vận hành: xử lý phép còn dư khi nghỉ việc (mặc định Hủy). */
export function LeaveSettlementPolicyCard() {
  const [saved, setSaved] = useState<HrmUnusedLeaveDisposition>('CANCEL');
  const [value, setValue] = useState<HrmUnusedLeaveDisposition>('CANCEL');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await hrmFetch<{ data: HrmLeaveSettlementSettings }>(
      '/leave-settlement-settings',
    );
    setSaved(r.data.unusedLeaveDisposition);
    setValue(r.data.unusedLeaveDisposition);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const r = await hrmFetch<{ data: HrmLeaveSettlementSettings }>(
        '/leave-settlement-settings',
        {
          method: 'PUT',
          body: JSON.stringify({ unusedLeaveDisposition: value }),
        },
      );
      setSaved(r.data.unusedLeaveDisposition);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được cấu hình');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-800">
        Quyết toán phép khi nghỉ việc
      </h2>
      <p className="text-xs text-slate-600">
        Chọn cách xử lý phép còn dư khi quyết toán nghỉ việc. Phần dùng dư không bị thu hồi và không nối lương; hệ thống chỉ ghi nhận để xử lý sau.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-96 space-y-1 text-xs font-medium text-slate-700">
          <span>Xử lý phép còn dư</span>
          <SearchableSelect
            value={value}
            options={options}
            clearable={false}
            onChange={(v) => setValue((v as HrmUnusedLeaveDisposition) || 'CANCEL')}
          />
        </div>
        <Popconfirm
          title="Lưu cấu hình xử lý phép dư?"
          okText="Lưu"
          cancelText="Quay lại"
          onConfirm={() => void save()}
        >
          <Button
            disabled={busy || value === saved}
            className="h-9 bg-blue-600 text-xs text-white hover:bg-blue-700"
          >
            Lưu cấu hình
          </Button>
        </Popconfirm>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
