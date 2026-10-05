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
    [action, setAction] = useState<HrmAction | null>(null);
  const typeId = selected || types[0]?.id || '';
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
    const tomorrowMonth = new Date();
    tomorrowMonth.setDate(1);
    tomorrowMonth.setMonth(tomorrowMonth.getMonth() + 1);
    const fields: ActionField[] =
      kind === 'delete'
        ? []
        : kind === 'deactivate'
          ? [
              {
                key: 'effectiveTo',
                label: 'Kết thúc hiệu lực đến hết ngày',
                type: 'date',
                value: row.effectiveTo || '',
              },
            ]
          : [
              {
                key: 'accrualFrequency',
                label: 'Chu kỳ cộng',
                options: frequencies,
                value: row.accrualFrequency,
              },
              {
                key: 'accrualAmount',
                label: 'Định mức mỗi chu kỳ',
                type: 'number',
                min: 0,
                max: 366,
                step: '0.01',
                value: row.accrualAmount,
              },
              {
                key: 'prorationRule',
                label: 'Phân bổ theo thời gian thực tế',
                options: [
                  {
                    value: 'BY_JOIN_DATE',
                    label: 'Theo ngày vào và thời gian hiệu lực',
                  },
                  { value: 'NONE', label: 'Không phân bổ' },
                ],
                value: row.prorationRule || 'NONE',
              },
              {
                key: 'seniorityBonusYears',
                label: 'Mỗi bao nhiêu năm thâm niên (0: tắt)',
                type: 'number',
                min: 0,
                max: 100,
                value: row.seniorityBonusYears,
              },
              {
                key: 'seniorityBonusDays',
                label: 'Số ngày phép thâm niên',
                type: 'number',
                min: 0,
                max: 100,
                step: '0.5',
                value: row.seniorityBonusDays,
              },
              {
                key: 'effectiveFrom',
                label: 'Ngày bắt đầu hiệu lực',
                type: 'date',
                value:
                  kind === 'version'
                    ? tomorrowMonth.toLocaleDateString('en-CA')
                    : row.effectiveFrom,
              },
              {
                key: 'effectiveTo',
                label: 'Ngày kết thúc (để trống nếu không giới hạn)',
                type: 'date',
                optional: true,
                value: kind === 'version' ? '' : row.effectiveTo || '',
              },
            ];
    setAction({
      title: {
        edit: 'Sửa lịch chưa cộng phép',
        version: 'Tạo phiên bản lịch cộng phép',
        deactivate: 'Kết thúc lịch cộng phép',
        delete: 'Xóa lịch chưa sử dụng',
      }[kind],
      confirmTitle: ['delete', 'deactivate'].includes(kind)
        ? 'Xác nhận thay đổi lịch cộng phép?'
        : undefined,
      description:
        'Lịch đã phát sinh bút toán được giữ nguyên. Phiên bản mới chỉ áp dụng sau kỳ đã cộng; dữ liệu đã cộng không bị ghi lại.',
      fields: [...fields, { key: 'reason', label: 'Lý do' }],
      submit: async (v) => {
        const body: Record<string, unknown> = {
          expectedUpdatedAt: row.updatedAt,
          reason: v.reason,
        };
        if (kind === 'deactivate') body.effectiveTo = v.effectiveTo;
        if (['edit', 'version'].includes(kind))
          Object.assign(body, {
            accrualFrequency: v.accrualFrequency,
            accrualAmount: Number(v.accrualAmount),
            prorationRule: v.prorationRule,
            seniorityBonusYears: Number(v.seniorityBonusYears),
            seniorityBonusDays: Number(v.seniorityBonusDays),
            effectiveFrom: v.effectiveFrom,
            effectiveTo: v.effectiveTo || null,
          });
        await hrmFetch(
          `/leave-types/${typeId}/accrual-schedules/${row.id}${['version', 'deactivate'].includes(kind) ? '/' + kind : ''}`,
          {
            method:
              kind === 'delete' ? 'DELETE' : kind === 'edit' ? 'PATCH' : 'POST',
            body: JSON.stringify(body),
          },
        );
        await load();
      },
    });
  };
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">Lịch cộng phép và thâm niên</h2>
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
        scroll={{ x: 1080, y: 320 }}
        columns={[
          { title: 'Từ ngày', dataIndex: 'effectiveFrom', width: 110 },
          {
            title: 'Đến hết ngày',
            dataIndex: 'effectiveTo',
            width: 115,
            render: (v) => v || 'Không giới hạn',
          },
          {
            title: 'Chu kỳ',
            dataIndex: 'accrualFrequency',
            width: 105,
            render: (v) => frequencies.find((f) => f.value === v)?.label || v,
          },
          { title: 'Định mức', dataIndex: 'accrualAmount', width: 90 },
          {
            title: 'Thâm niên',
            width: 150,
            render: (_, r) =>
              r.seniorityBonusYears
                ? `${r.seniorityBonusDays} ngày / ${r.seniorityBonusYears} năm`
                : 'Không áp dụng',
          },
          {
            title: 'Phân bổ',
            dataIndex: 'prorationRule',
            render: (v) =>
              v === 'BY_JOIN_DATE' ? 'Theo thời gian thực tế' : 'Không phân bổ',
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
    </section>
  );
}
