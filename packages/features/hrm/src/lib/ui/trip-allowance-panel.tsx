'use client';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plane, Plus, Trash2 } from 'lucide-react';
import type { HrmTripAllowanceRate } from '@enterprise-platform/contracts-hrm';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { formatMoneyVnd } from '../hrm-salary-format';
import { Button } from './button';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';
import { InfoNote, SettingsSection, StatusPill } from './settings-kit';
import { DataList, type DataColumn } from './payroll-settings/data-rows';
import { toast } from './toast';

const TRIP_TYPE_LABEL: Record<HrmTripAllowanceRate['tripType'], string> = {
  DOMESTIC: 'Công tác trong nước',
  OVERSEAS: 'Công tác nước ngoài',
  INTERSITE: 'Công tác giữa các cơ sở',
};
const TRIP_TYPE_OPTIONS = (Object.keys(TRIP_TYPE_LABEL) as HrmTripAllowanceRate['tripType'][]).map((value) => ({
  value,
  label: TRIP_TYPE_LABEL[value],
}));

const vnDate = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Mức công tác phí mỗi ngày theo hình thức công tác, có phiên bản theo ngày hiệu lực. Công tác phí được tính khi tính
 * công (theo ngày công tác thực tế của đơn đã duyệt) và đóng băng theo kỳ chốt; bảng lương chỉ cộng lại. Dự trù phụ
 * phí nhập trong đơn công tác (vé, khách sạn) chỉ là dự trù, không được trả từ đây.
 */
export function TripAllowancePanel() {
  const [rates, setRates] = useState<HrmTripAllowanceRate[] | null>(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await hrmFetch<{ data: HrmTripAllowanceRate[] }>('/trip-allowance-rates');
      setRates(result.data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được mức công tác phí.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(tripType?: HrmTripAllowanceRate['tripType']) {
    setAction({
      title: 'Thêm mức công tác phí',
      description:
        'Mức mới có hiệu lực từ ngày chọn; phiên bản đang hiệu lực của cùng hình thức được kết thúc vào ngày trước đó. Tháng đã chốt công giữ nguyên số đã tính.',
      columns: 1,
      fields: [
        { key: 'tripType', label: 'Hình thức công tác', options: TRIP_TYPE_OPTIONS, value: tripType ?? 'DOMESTIC', required: true },
        { key: 'dailyAmount', label: 'Mức mỗi ngày công tác (đồng)', type: 'number', min: 0, step: '1000', required: true },
        { key: 'effectiveFrom', label: 'Hiệu lực từ ngày', type: 'date', value: todayIso(), required: true },
        { key: 'note', label: 'Ghi chú', optional: true },
      ],
      submit: async (values) => {
        await hrmFetch('/trip-allowance-rates', {
          method: 'POST',
          body: JSON.stringify({
            tripType: values.tripType,
            dailyAmount: Number(values.dailyAmount),
            effectiveFrom: values.effectiveFrom,
            note: values.note?.trim() || undefined,
          }),
        });
        toast.success('Đã thêm mức công tác phí');
        await load();
      },
    });
  }

  async function cancel(rate: HrmTripAllowanceRate) {
    setBusy(true);
    try {
      await hrmFetch(`/trip-allowance-rates/${rate.id}`, { method: 'DELETE' });
      toast.success('Đã huỷ mức công tác phí');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không huỷ được mức công tác phí.');
    } finally {
      setBusy(false);
    }
  }

  if (!rates && !error)
    return (
      <div role="status" className="flex items-center gap-2 p-6 text-sm text-slate-500">
        <Loader2 className="size-4 animate-spin" />
        <span>Đang tải mức công tác phí...</span>
      </div>
    );

  const active = (rates ?? []).filter((r) => r.status === 'ACTIVE');
  const statusLabel = (r: HrmTripAllowanceRate) => (r.status === 'CANCELLED' ? 'Đã huỷ' : r.effectiveTo ? 'Đã thay thế' : 'Hiện hành');
  const statusTone = (r: HrmTripAllowanceRate) => (r.status === 'CANCELLED' ? 'red' : r.effectiveTo ? 'slate' : 'green');

  return (
    <SettingsSection
      icon={Plane}
      tone="green"
      title="Công tác phí"
      description="Mức tiền mỗi ngày công tác theo hình thức, có phiên bản theo ngày hiệu lực."
      actions={
        <Button permission="hrm.payroll.configure" onClick={() => openCreate()} disabled={busy} className="h-9 gap-1.5 px-3 text-xs font-semibold">
          <Plus className="size-4" />
          <span>Thêm mức</span>
        </Button>
      }
      bodyClassName="space-y-3"
    >
      <InfoNote tone="blue">
        Tính theo ngày công tác thực tế của đơn đã duyệt, chốt cùng bảng công và cộng vào lương qua thành phần
        TRIP_ALLOWANCE_AMOUNT trong công thức. Dự trù phụ phí trong đơn công tác không phải khoản trả.
      </InfoNote>
      {error && (
        <InfoNote tone="red" role="alert">
          {error}
        </InfoNote>
      )}
      <div className="grid grid-cols-1 gap-3">
        {(Object.keys(TRIP_TYPE_LABEL) as HrmTripAllowanceRate['tripType'][]).map((type) => {
          const list = (rates ?? []).filter((r) => r.tripType === type);
          const current = active.find((r) => r.tripType === type && !r.effectiveTo);
          const firstActive = list.find((x) => x.status === 'ACTIVE');
          const columns: DataColumn<HrmTripAllowanceRate>[] = [
            {
              key: 'amount',
              header: 'Mức mỗi ngày',
              width: '150px',
              cardOrder: -1,
              cell: (r) => (
                <span className={`font-mono text-sm font-semibold ${r.status === 'CANCELLED' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                  {formatMoneyVnd(r.dailyAmount)}
                </span>
              ),
            },
            {
              key: 'range',
              header: 'Hiệu lực',
              width: '170px',
              cardLabel: true,
              cardOrder: 1,
              cell: (r) => (
                <span className={r.status === 'CANCELLED' ? 'text-slate-400' : 'text-slate-700'}>
                  {vnDate(r.effectiveFrom)} - {r.effectiveTo ? vnDate(r.effectiveTo) : 'nay'}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Trạng thái',
              width: '110px',
              cell: (r) => <StatusPill tone={statusTone(r)}>{statusLabel(r)}</StatusPill>,
            },
            {
              key: 'note',
              header: 'Ghi chú',
              width: 'minmax(0,1fr)',
              cardFull: true,
              cardOrder: 2,
              cell: (r) => <span className="break-words text-slate-600">{r.note ?? ''}</span>,
            },
            {
              key: 'cancel',
              header: '',
              width: '84px',
              cardEnd: true,
              align: 'right',
              cell: (r) =>
                r.status === 'ACTIVE' && r.id === firstActive?.id ? (
                  <Popconfirm
                    title={`Huỷ mức ${formatMoneyVnd(r.dailyAmount)} từ ${vnDate(r.effectiveFrom)}?`}
                    description="Phiên bản liền trước (nếu có) được mở lại như cũ. Tháng đã chốt công giữ nguyên số đã tính."
                    okText="Huỷ mức"
                    cancelText="Quay lại"
                    okType="danger"
                    onConfirm={() => cancel(r)}
                  >
                    <Button
                      permission="hrm.payroll.configure"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={`Huỷ mức ${TRIP_TYPE_LABEL[type]} từ ${vnDate(r.effectiveFrom)}`}
                      className="gap-1 border-rose-200 text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="size-3" />
                      Huỷ
                    </Button>
                  </Popconfirm>
                ) : null,
            },
          ];
          return (
            <section
              key={type}
              aria-label={TRIP_TYPE_LABEL[type]}
              className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50/40 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900">{TRIP_TYPE_LABEL[type]}</h3>
                  {current ? (
                    <p className="text-xs text-slate-600">
                      Hiện hành: <span className="font-mono font-semibold text-slate-900">{formatMoneyVnd(current.dailyAmount)}</span> / ngày
                    </p>
                  ) : null}
                </div>
                {!current && <StatusPill tone="amber">Chưa có mức hiện hành</StatusPill>}
              </div>
              <DataList
                label={`Mức ${TRIP_TYPE_LABEL[type]}`}
                rows={list}
                rowKey={(r) => r.id}
                columns={columns}
                pageSize={6}
                empty={
                  <p className="text-xs text-slate-500">
                    Chưa cấu hình. Đơn công tác hình thức này sẽ báo lỗi khi tính lương cho tới khi có mức.
                  </p>
                }
              />
            </section>
          );
        })}
      </div>
      {action && <HrmActionDialog action={action} onClose={() => setAction(null)} />}
    </SettingsSection>
  );
}
