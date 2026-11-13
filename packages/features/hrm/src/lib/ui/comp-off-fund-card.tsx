'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CalendarCheck, CalendarClock, Calculator, Clock, Hourglass, Layers, Scale } from 'lucide-react';
import type { HrmOvertimeCompSettings } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../hrm-comp-off-api';
import { buildCompOffFundSummary } from '../comp-off-model';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from './badge';
import { errorText, Notice } from './comp-off/comp-off-kit';

function Item({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-semibold leading-snug text-slate-900">{value}</p>
      </div>
    </div>
  );
}

/**
 * Thẻ quỹ nghỉ bù ở Chính sách phép, cạnh thẻ phép năm: tóm tắt cách tính quỹ từ cấu hình làm thêm đang áp dụng.
 * Chỉ xem; chỉnh ở màn Làm thêm và nghỉ bù. Chỉ hiện cho người có quyền xem chính sách.
 */
export function CompOffFundCard() {
  const { can } = useHrmPermissions();
  const allowed = can('hrm.policy.view') || can('hrm.policy.manage');
  const [settings, setSettings] = useState<HrmOvertimeCompSettings | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!allowed) return;
    compOffApi
      .settings()
      .then(setSettings)
      .catch((e) => setError(errorText(e, 'Không tải được cấu hình quỹ nghỉ bù')));
  }, [allowed]);

  if (!allowed) return null;
  const config = settings?.current?.config ?? null;
  const summary = config ? buildCompOffFundSummary(config) : null;

  return (
    <section aria-label="Quỹ nghỉ bù" className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
            <Calculator className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight text-slate-900">Quỹ nghỉ bù</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Giờ làm thêm vượt trần được quy thành ngày nghỉ bù. Số dư lấy từ sổ quỹ nghỉ bù, không trừ vào quỹ phép năm.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {summary ? (
            <Badge variant={summary.enabled ? 'default' : 'outline'}>{summary.enabled ? 'Đang áp dụng' : 'Đang tắt'}</Badge>
          ) : null}
          <Link href="/settings?view=overtime-comp" className="text-xs font-semibold text-blue-700 underline underline-offset-2">
            Cấu hình chi tiết
          </Link>
        </div>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!settings && !error ? (
        <p role="status" className="py-4 text-center text-xs text-slate-500">
          Đang tải cấu hình quỹ nghỉ bù...
        </p>
      ) : null}
      {settings && !summary ? (
        <Notice tone="warn">Chưa có chính sách làm thêm nên chưa tính được quỹ nghỉ bù. Cấu hình ở mục Lương và OT trước.</Notice>
      ) : null}
      {summary ? (
        <>
          {!summary.enabled ? (
            <Notice tone="info">
              Quy tắc làm thêm và nghỉ bù đang tắt: lý do Nghỉ bù vẫn dùng được nhưng quỹ do doanh nghiệp tự quản lý ngoài hệ thống. Hệ
              thống không tính quỹ, không giữ chỗ, không chặn vượt số dư; người duyệt toàn quyền duyệt hoặc từ chối. Bật ở màn Làm thêm và
              nghỉ bù nếu muốn hệ thống tính quỹ.
            </Notice>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Item icon={<Layers className="size-4" />} label="Cách phân loại làm thêm" value={summary.classify} />
            <Item icon={<Scale className="size-4" />} label="Trần làm thêm trả lương" value={summary.cap} />
            <Item icon={<Calculator className="size-4" />} label="Quy đổi giờ dư thành ngày" value={summary.conversion} />
            <Item icon={<CalendarClock className="size-4" />} label="Thời điểm cộng quỹ" value={summary.accrual} />
            <Item icon={<Hourglass className="size-4" />} label="Hạn dùng" value={summary.expiry} />
            <Item icon={<CalendarCheck className="size-4" />} label="Trần tích lũy" value={summary.accumulation} />
            <Item icon={<Clock className="size-4" />} label="Cách dùng" value={summary.usage} />
          </div>
          <p className="text-xs text-slate-600">{summary.example}</p>
        </>
      ) : null}
    </section>
  );
}
