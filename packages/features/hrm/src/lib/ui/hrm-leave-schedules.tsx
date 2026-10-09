'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmLeaveAccrualSchedule,
  HrmLeaveType,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from './button';
import {
  HrmActionDialog,
  type HrmAction,
  type ActionField,
} from './hrm-action-dialog';
import { LeaveScheduleDialog } from './leave-schedule-dialog';
import { formatDateVn } from '../personnel-decision-rules';

const frequencies = [
  { value: 'MONTHLY', label: 'Hàng tháng' },
  { value: 'QUARTERLY', label: 'Hàng quý' },
  { value: 'YEARLY', label: 'Hàng năm' },
];
export function HrmLeaveSchedules({ types }: { types: HrmLeaveType[] }) {
  const { can } = useHrmPermissions();
  const [selected, setSelected] = useState(''),
    [rows, setRows] = useState<HrmLeaveAccrualSchedule[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [action, setAction] = useState<HrmAction | null>(null),
    [editing, setEditing] = useState<{
      row: HrmLeaveAccrualSchedule;
      mode: 'edit' | 'version';
    } | null>(null);
  // Mặc định loại nghỉ đang áp dụng; loại đã ngừng/gộp chỉ xem khi chọn tay.
  const typeId =
    selected ||
    types.find((t) => t.active && !t.mergedIntoId)?.id ||
    types[0]?.id ||
    '';
  const load = useCallback(async () => {
    if (!typeId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setRows(
        (
          await hrmFetch<{ data: HrmLeaveAccrualSchedule[] }>(
            `/leave-types/${typeId}/accrual-schedules`,
          )
        ).data,
      );
    } catch (err) {
      setRows([]);
      setError(
        err instanceof Error ? err.message : 'Không tải được lịch cộng phép',
      );
    } finally {
      setLoading(false);
    }
  }, [typeId]);
  useEffect(() => {
    void load();
  }, [load, types]);
  const open = (
    row: HrmLeaveAccrualSchedule,
    kind: 'edit' | 'version' | 'deactivate' | 'delete',
  ) => {
    if (kind === 'edit' || kind === 'version') {
      setEditing({ row, mode: kind });
      return;
    }
    const fields: ActionField[] =
      kind === 'delete'
        ? []
        : [
            {
              key: 'effectiveTo',
              label: 'Kết thúc hiệu lực đến hết ngày',
              type: 'date',
              value: row.effectiveTo || '',
            },
          ];
    setAction({
      title:
        kind === 'deactivate'
          ? 'Kết thúc lịch cộng phép'
          : 'Xóa lịch chưa sử dụng',
      confirmTitle: 'Xác nhận thay đổi lịch cộng phép?',
      description:
        'Lịch đã phát sinh bút toán được giữ nguyên. Phiên bản mới chỉ áp dụng sau kỳ đã cộng; dữ liệu đã cộng không bị ghi lại.',
      fields: [...fields, { key: 'reason', label: 'Lý do' }],
      submit: async (v) => {
        const body: Record<string, unknown> = {
          expectedUpdatedAt: row.updatedAt,
          reason: v.reason,
        };
        if (kind === 'deactivate') body.effectiveTo = v.effectiveTo;
        await hrmFetch(
          `/leave-types/${typeId}/accrual-schedules/${row.id}${kind === 'deactivate' ? '/deactivate' : ''}`,
          {
            method: kind === 'delete' ? 'DELETE' : 'POST',
            body: JSON.stringify(body),
          },
        );
        await load();
      },
    });
  };
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-bold text-slate-900">Lịch cộng phép và thâm niên</h2>
        <div className="w-64">
          <SearchableSelect
            value={typeId}
            options={types.map((t) => {
              const isInactive = !t.active || Boolean(t.mergedIntoId);
              return {
                value: t.id,
                label: `${t.code} · ${t.name}${isInactive ? ' [Ngừng sử dụng]' : ''}`,
              };
            })}
            onChange={(v) => setSelected(v || '')}
            clearable={false}
          />
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          Tải lại
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Table<HrmLeaveAccrualSchedule>
        size="small"
        rowKey="id"
        dataSource={rows}
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        scroll={{ x: 1400, y: 320 }}
        columns={[
          {
            title: 'Từ ngày',
            dataIndex: 'effectiveFrom',
            width: 110,
            render: (v: string) => formatDateVn(v),
          },
          {
            title: 'Đến hết ngày',
            dataIndex: 'effectiveTo',
            width: 115,
            render: (v) => (v ? formatDateVn(v) : 'Không giới hạn'),
          },
          {
            title: 'Chu kỳ',
            dataIndex: 'accrualFrequency',
            width: 105,
            render: (v) => frequencies.find((f) => f.value === v)?.label || v,
          },
          {
            title: 'Mốc tính',
            dataIndex: 'accrualBasis',
            width: 150,
            render: (v, r) =>
              v === 'CONTRACT_SIGN_DATE'
                ? r.startOffsetMonths
                  ? `Ngày ký HĐ + ${r.startOffsetMonths} tháng`
                  : 'Từ tháng ký HĐ'
                : 'Ngày vào làm',
          },
          {
            title: 'Định mức',
            width: 120,
            render: (_, r) =>
              r.accrualBasis === 'CONTRACT_SIGN_DATE'
                ? `${r.annualDays ?? 0} ngày/năm`
                : `${r.accrualAmount} / kỳ`,
          },
          {
            title: 'Ứng phép',
            width: 100,
            render: (_, r) =>
              r.accrualBasis === 'CONTRACT_SIGN_DATE'
                ? r.advanceAllowed
                  ? 'Cho phép'
                  : 'Không cho'
                : '—',
          },
          {
            title: 'Thâm niên',
            width: 200,
            render: (_, r) =>
              r.accrualBasis === 'CONTRACT_SIGN_DATE'
                ? r.seniorityTiers.length
                  ? r.seniorityTiers
                      .map((t) => `${t.minYears} năm +${t.bonusDays}`)
                      .join(', ')
                  : 'Không áp dụng'
                : r.seniorityBonusYears
                  ? `${r.seniorityBonusDays} ngày / ${r.seniorityBonusYears} năm`
                  : 'Không áp dụng',
          },
          {
            title: 'Phân bổ',
            dataIndex: 'prorationRule',
            width: 150,
            render: (v) =>
              v === 'HALF_MONTH'
                ? 'Tính tháng khi đủ 15 ngày'
                : v === 'BY_JOIN_DATE'
                  ? 'Theo thời gian thực tế'
                  : 'Không phân bổ',
          },
          {
            title: 'Thao tác',
            width: 290,
            fixed: 'right',
            render: (_, r) =>
              can('hrm.leave.manage') ? (
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => open(r, 'edit')}
                  >
                    Sửa
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => open(r, 'version')}
                  >
                    Phiên bản mới
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => open(r, 'deactivate')}
                  >
                    Kết thúc
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive"
                    onClick={() => open(r, 'delete')}
                  >
                    Xóa
                  </Button>
                </div>
              ) : null,
          },
        ]}
      />
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
      {editing && (
        <LeaveScheduleDialog
          mode={editing.mode}
          types={types}
          leaveTypeId={typeId}
          schedule={editing.row}
          onClose={() => setEditing(null)}
          onSaved={() => load()}
        />
      )}
    </section>
  );
}
