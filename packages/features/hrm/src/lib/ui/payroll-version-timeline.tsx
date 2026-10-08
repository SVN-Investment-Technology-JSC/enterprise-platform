'use client';
import { analyzeTimeline, type TimelineVersion } from '../hrm-payroll-config';
import { formatDateVn } from '../personnel-decision-rules';

interface Item extends TimelineVersion {
  policy_type: string;
}

const LABEL: Record<string, string> = { PAYROLL: 'Công thức lương', OT: 'Quy định OT' };

/** Dòng thời gian phiên bản theo từng loại; đánh dấu khoảng trống / chồng lấn. */
export function PayrollVersionTimeline({ versions }: { versions: Item[] }) {
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <div className="space-y-4">
      {(['PAYROLL', 'OT'] as const).map((type) => {
        const list = versions
          .filter((v) => v.policy_type === type)
          .sort((a, b) => a.effective_from.localeCompare(b.effective_from) || a.version_no - b.version_no);
        if (!list.length) return null;
        const issues = analyzeTimeline(list);
        return (
          <div key={type} className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-700">{LABEL[type]}</div>
            <ol className="relative border-l-2 border-slate-200 ml-2 space-y-2">
              {list.map((v) => {
                const from = v.effective_from.slice(0, 10);
                const to = v.effective_to?.slice(0, 10) ?? null;
                const state = from > today ? 'Chưa hiệu lực' : to && to < today ? 'Hết hiệu lực' : 'Đang áp dụng';
                const color =
                  state === 'Đang áp dụng' ? 'bg-emerald-500' : state === 'Chưa hiệu lực' ? 'bg-amber-500' : 'bg-slate-400';
                return (
                  <li key={v.id} className="ml-4 text-xs">
                    <span className={`absolute -left-[7px] mt-1 size-3 rounded-full ${color}`} aria-hidden />
                    <span className="font-mono font-semibold text-slate-900">v{v.version_no}</span>{' '}
                    <span className="text-slate-700">
                      {formatDateVn(from)} đến {to ? formatDateVn(to) : 'nay'}
                    </span>{' '}
                    <span className="text-slate-500">({state})</span>
                  </li>
                );
              })}
            </ol>
            {issues.map((i) => (
              <p key={i.message} className={`text-[11px] ${i.kind === 'GAP' ? 'text-amber-700' : 'text-rose-700'}`}>
                {/* Thông điệp khoảng trống đã có tiền tố; đổi ngày ISO sang dd/mm/yyyy. */}
                {i.kind === 'GAP' ? '' : 'Chồng lấn: '}
                {i.message.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1')}
              </p>
            ))}
            {!issues.length && <p className="text-[11px] text-emerald-700">Chuỗi phiên bản liền mạch</p>}
          </div>
        );
      })}
    </div>
  );
}
