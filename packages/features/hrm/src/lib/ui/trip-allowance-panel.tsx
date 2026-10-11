'use client';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { HrmTripAllowanceRate } from '@enterprise-platform/contracts-hrm';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { formatMoneyVnd } from '../hrm-salary-format';
import { Badge } from './badge';
import { Button } from './button';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';
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
  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs md:flex-row md:items-center">
        <div>
          <h2 className="text-base font-bold text-slate-900">Công tác phí</h2>
          <p className="max-w-[90ch] text-xs text-slate-500">
            Mức tiền mỗi ngày công tác theo hình thức. Tính theo ngày công tác thực tế của đơn đã duyệt (đơn có giờ thì theo
            phần ca đã công tác), chốt cùng bảng công và cộng vào lương qua thành phần TRIP_ALLOWANCE_AMOUNT trong công thức.
            Dự trù phụ phí trong đơn công tác không phải khoản trả.
          </p>
        </div>
        <Button permission="hrm.payroll.configure" onClick={() => openCreate()} disabled={busy}>
          <Plus className="size-3.5" />
          <span>Thêm mức</span>
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
      {(Object.keys(TRIP_TYPE_LABEL) as HrmTripAllowanceRate['tripType'][]).map((type) => {
        const list = (rates ?? []).filter((r) => r.tripType === type);
        return (
          <section
            key={type}
            aria-label={TRIP_TYPE_LABEL[type]}
            className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">{TRIP_TYPE_LABEL[type]}</h3>
              {!active.some((r) => r.tripType === type && !r.effectiveTo) && (
                <Badge className="border-amber-200 bg-amber-50 text-amber-800">Chưa có mức hiện hành</Badge>
              )}
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-slate-500">
                Chưa cấu hình. Đơn công tác hình thức này sẽ báo lỗi khi tính lương cho tới khi có mức.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] font-bold text-slate-600">
                    <th className="py-1">Mức mỗi ngày</th>
                    <th className="py-1">Hiệu lực</th>
                    <th className="py-1">Trạng thái</th>
                    <th className="py-1">Ghi chú</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((r, index) => (
                    <tr key={r.id} className={r.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}>
                      <td className="py-1 font-mono font-semibold">{formatMoneyVnd(r.dailyAmount)}</td>
                      <td className="py-1">
                        {vnDate(r.effectiveFrom)} - {r.effectiveTo ? vnDate(r.effectiveTo) : 'nay'}
                      </td>
                      <td className="py-1">{r.status === 'CANCELLED' ? 'Đã huỷ' : r.effectiveTo ? 'Đã thay thế' : 'Hiện hành'}</td>
                      <td className="py-1">{r.note ?? ''}</td>
                      <td className="py-1 text-right">
                        {r.status === 'ACTIVE' && index === list.findIndex((x) => x.status === 'ACTIVE') && (
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
                            >
                              <Trash2 className="size-3" />
                              Huỷ
                            </Button>
                          </Popconfirm>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
      {action && <HrmActionDialog action={action} onClose={() => setAction(null)} />}
    </div>
  );
}
