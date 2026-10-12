'use client';
import { CheckCircle2 } from 'lucide-react';
import { analyzeTimeline, type TimelineVersion } from '../hrm-payroll-config';
import { formatDateVn } from '../personnel-decision-rules';
import { InfoNote, StatusPill } from './settings-kit';
import { VERSION_STATE_LABEL, VERSION_STATE_TONE, versionState } from './payroll-settings/types';

interface Item extends TimelineVersion {
  policy_type: string;
}

const LABEL: Record<string, string> = { PAYROLL: 'Công thức lương', OT: 'Quy định OT' };
const DOT = { active: 'bg-emerald-500', upcoming: 'bg-amber-500', ended: 'bg-slate-400' } as const;

/** Dòng thời gian phiên bản theo từng loại, gọn: mới nhất ở trên; đánh dấu khoảng trống / chồng lấn. */
export function PayrollVersionTimeline({ versions }: { versions: Item[] }) {
  const groups = (['PAYROLL', 'OT'] as const)
    .map((type) => ({
      type,
      list: versions
        .filter((v) => v.policy_type === type)
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.version_no - a.version_no),
    }))
    .filter((g) => g.list.length > 0);
  if (groups.length === 0) return <p className="text-xs text-slate-500">Chưa có phiên bản nào.</p>;
  return (
    <div className="space-y-4">
      {groups.map(({ type, list }) => {
        const issues = analyzeTimeline(list);
        return (
          <div key={type} className="space-y-2">
            <div className="text-xs font-bold text-slate-700">{LABEL[type]}</div>
            <ol className="relative max-h-72 space-y-2.5 overflow-y-auto border-l-2 border-slate-200 pl-4 ml-1.5">
              {list.map((v) => {
                const from = v.effective_from.slice(0, 10);
                const to = v.effective_to?.slice(0, 10) ?? null;
                const state = versionState(v);
                return (
                  <li key={v.id} className="relative text-xs">
                    <span
                      aria-hidden="true"
                      className={`absolute top-1 -left-[22px] size-2.5 rounded-full ring-2 ring-white ${DOT[state]}`}
                    />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-mono font-semibold text-slate-900">v{v.version_no}</span>
                      <StatusPill tone={VERSION_STATE_TONE[state]}>{VERSION_STATE_LABEL[state]}</StatusPill>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      {formatDateVn(from)} đến {to ? formatDateVn(to) : 'nay'}
                    </div>
                  </li>
                );
              })}
            </ol>
            {issues.map((i) => (
              <InfoNote key={i.message} tone={i.kind === 'GAP' ? 'amber' : 'red'} className="p-2 text-[11px]">
                {i.kind === 'GAP' ? '' : 'Chồng lấn: '}
                {i.message.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1')}
              </InfoNote>
            ))}
            {!issues.length && (
              <p className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                <CheckCircle2 aria-hidden="true" className="size-3.5" />
                Chuỗi phiên bản liền mạch
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
