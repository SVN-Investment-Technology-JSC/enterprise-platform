'use client';

import {
  checkCompliance,
  type BrandPalette,
  type BrandRules,
  type ComplianceIssue,
  type IconDocument,
  type IssueSeverity,
} from '@enterprise-platform/shared-brand-icon';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { countBySeverity, summaryParts } from './compliance-model';

const SEVERITY_STYLE: Record<IssueSeverity, { icon: ReactNode; text: string; label: string }> = {
  error: { icon: <CircleAlert />, text: 'text-red-600', label: 'Lỗi' },
  warning: { icon: <TriangleAlert />, text: 'text-amber-600', label: 'Cảnh báo' },
  info: { icon: <Info />, text: 'text-blue-600', label: 'Gợi ý' },
};

function IssueRow({ issue, onSelectShape }: { issue: ComplianceIssue; onSelectShape?: (id: string) => void }) {
  const style = SEVERITY_STYLE[issue.severity];
  const shapeId = issue.shapeId;
  const body = (
    <>
      <span className={cn('mt-px shrink-0 [&_svg]:size-3.5', style.text)} role="img" aria-label={style.label}>
        {style.icon}
      </span>
      <span className="min-w-0 flex-1 text-xs leading-snug text-slate-700">{issue.message}</span>
    </>
  );
  if (shapeId && onSelectShape) {
    return (
      <button
        type="button"
        title="Bấm để chọn lớp này"
        onClick={() => onSelectShape(shapeId)}
        className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-start gap-2 rounded px-1.5 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
      >
        {body}
      </button>
    );
  }
  return <div className="flex items-start gap-2 py-2">{body}</div>;
}

/** Kết quả kiểm tra quy chuẩn thương hiệu của icon; bấm vào dòng có lớp liên quan để chọn lớp đó. */
export function CompliancePanel({
  doc,
  palette,
  rules,
  onSelectShape,
}: {
  doc: IconDocument;
  palette: BrandPalette;
  rules: BrandRules;
  onSelectShape?: (id: string) => void;
}) {
  const issues = useMemo(() => checkCompliance(doc, palette, rules), [doc, palette, rules]);

  if (issues.length === 0) {
    return (
      <div role="status" className="flex items-center gap-2 py-2 text-xs font-medium text-emerald-700">
        <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
        Đạt quy chuẩn
      </div>
    );
  }

  const parts = summaryParts(countBySeverity(issues));
  return (
    <div>
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 pb-2 text-[11px]">
        {parts.map((part) => (
          <span key={part.severity} className={cn('inline-flex items-center gap-1 font-medium [&_svg]:size-3.5', SEVERITY_STYLE[part.severity].text)}>
            <span aria-hidden="true">{SEVERITY_STYLE[part.severity].icon}</span>
            {part.text}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-slate-100">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.shapeId ?? 'icon'}-${index}`}>
            <IssueRow issue={issue} onSelectShape={onSelectShape} />
          </li>
        ))}
      </ul>
    </div>
  );
}
