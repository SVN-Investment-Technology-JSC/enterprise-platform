'use client';
import { useMemo } from 'react';
import type { HrmCareerEvent } from '@enterprise-platform/contracts-hrm';
import { Briefcase, Building2, Calendar, GitBranch } from 'lucide-react';
import { Badge } from './badge';

function formatDate(value?: string | null): string {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (value ?? '----');
}

const isLaneEvent = (e: HrmCareerEvent) => Boolean(e.laneId);

export interface CareerLane {
  readonly id: string;
  /** Mới nhất lên trước. */
  readonly steps: readonly HrmCareerEvent[];
  readonly ended: boolean;
  readonly endDate: string | null;
  /** Chuỗi chức danh theo thứ tự thời gian, ví dụ ["Chuyên viên kế toán", "Kế toán trưởng"]. */
  readonly path: readonly string[];
}

/** Gom kiêm nhiệm / bãi nhiệm theo nhánh (`laneId`); nhánh mới nhất lên trước. */
export function groupCareerLanes(events: readonly HrmCareerEvent[]): CareerLane[] {
  const byLane = new Map<string, HrmCareerEvent[]>();
  for (const e of events.filter(isLaneEvent)) {
    const list = byLane.get(e.laneId as string);
    if (list) list.push(e);
    else byLane.set(e.laneId as string, [e]);
  }
  return [...byLane.entries()]
    .map(([id, list]): CareerLane => {
      const steps = [...list].sort(
        (a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || (a.kind === 'REVOKE' ? -1 : 1),
      );
      const revoke = steps.find((s) => s.kind === 'REVOKE');
      const path: string[] = [];
      for (const s of [...steps].reverse()) {
        if (s.kind !== 'REVOKE' && s.positionName && path[path.length - 1] !== s.positionName) path.push(s.positionName);
      }
      return { id, steps, ended: Boolean(revoke), endDate: revoke?.effectiveDate ?? null, path };
    })
    .sort((a, b) => b.steps[0].effectiveDate.localeCompare(a.steps[0].effectiveDate));
}

function EventCard({ ev, tone }: { ev: HrmCareerEvent; tone: 'main' | 'lane' | 'revoke' }) {
  const isDecision = ev.source === 'DECISION';
  const isEnd = isDecision && ev.kind === 'DISMISS';
  const box =
    tone === 'revoke'
      ? 'bg-rose-50/60 border-rose-200'
      : tone === 'lane'
        ? 'bg-white border-amber-200'
        : 'bg-slate-50 border-slate-200';
  return (
    <div className={`p-4 rounded-xl border transition-colors ${box}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Briefcase
              className={`size-3.5 ${tone === 'revoke' ? 'text-rose-600' : tone === 'lane' ? 'text-amber-600' : 'text-[#021E73]'}`}
            />
            {ev.title}
            {ev.positionName ? `: ${ev.positionName}` : ''}
          </h4>
          <Badge
            variant="outline"
            className={`text-[10px] font-semibold ${
              isDecision ? 'text-blue-800 border-blue-300 bg-blue-50' : 'text-slate-600 border-slate-300'
            }`}
          >
            {isDecision ? 'Quyết định' : 'Hợp đồng'}
          </Badge>
          {isDecision && tone === 'main' && !isEnd && (
            <Badge variant="outline" className="text-[10px] font-semibold text-emerald-800 border-emerald-300 bg-emerald-50">
              Thay thế chức danh chính
            </Badge>
          )}
          {ev.reference && <span className="text-[11px] font-mono text-slate-500">{ev.reference}</span>}
        </div>
        <div className="flex items-center gap-1 text-xs font-semibold text-blue-700">
          <Calendar className="size-3 text-slate-400" />
          <span>
            {formatDate(ev.effectiveDate)}
            {!isDecision ? ` - ${ev.endDate ? formatDate(ev.endDate) : 'Hiện tại'}` : ''}
          </span>
        </div>
      </div>
      {ev.unitName && (
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 font-medium">
          <span className="flex items-center gap-1">
            <Building2 className="size-3 text-slate-400" />
            Đơn vị: <strong>{ev.unitName}</strong>
          </span>
        </div>
      )}
      {ev.note && (
        <div className="mt-2.5 p-2 bg-white rounded-lg border border-slate-200/80 text-[11px] text-slate-600 leading-relaxed">
          {ev.note}
        </div>
      )}
    </div>
  );
}

function LanePanel({ lane, index }: { lane: CareerLane; index: number }) {
  return (
    <section
      aria-label={`Nhánh kiêm nhiệm ${index + 1}`}
      className={`rounded-xl border p-3 ${lane.ended ? 'border-slate-200 bg-slate-50/60' : 'border-amber-200 bg-amber-50/40'}`}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <GitBranch className={`size-3.5 ${lane.ended ? 'text-slate-400' : 'text-amber-600'}`} />
        <span className="text-xs font-bold text-slate-900">{lane.path.join(' → ') || 'Kiêm nhiệm'}</span>
        {lane.ended ? (
          <Badge variant="outline" className="text-[10px] font-semibold text-rose-700 border-rose-300 bg-rose-50">
            Đã bãi nhiệm {formatDate(lane.endDate)}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] font-semibold text-emerald-800 border-emerald-300 bg-emerald-50">
            Đang kiêm nhiệm
          </Badge>
        )}
      </header>
      <ol className={`relative ml-2 space-y-3 border-l-2 border-dashed pl-5 ${lane.ended ? 'border-slate-300' : 'border-amber-300'}`}>
        {lane.steps.map((step, i) => {
          const revoke = step.kind === 'REVOKE';
          return (
            <li key={step.id} className="relative">
              <span
                aria-hidden="true"
                className={`absolute -left-[27px] top-4 size-3 rounded-full border-2 border-white ring-2 ${
                  revoke ? 'bg-rose-500 ring-rose-200' : i === 0 && !lane.ended ? 'bg-amber-500 ring-amber-200' : 'bg-slate-400 ring-slate-200'
                }`}
              />
              <EventCard ev={step} tone={revoke ? 'revoke' : 'lane'} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Lịch sử bổ nhiệm và công tác: trục chính (chức danh chính, hợp đồng) tách khỏi các nhánh kiêm nhiệm. Mỗi nhánh
 * là một chuỗi nối tiếp (kiêm nhiệm → kiêm nhiệm → bãi nhiệm) vẽ trong một khung riêng bên phải.
 */
export function CareerTimeline({ events }: { events: readonly HrmCareerEvent[] }) {
  const trunk = useMemo(() => events.filter((e) => !isLaneEvent(e)), [events]);
  const lanes = useMemo(() => groupCareerLanes(events), [events]);
  return (
    <div className={lanes.length ? 'grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]' : ''}>
      <div>
        {lanes.length > 0 && (
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">Trục chính</p>
        )}
        <div className="relative pl-6 sm:pl-8 border-l-2 border-blue-200 space-y-6 ml-2 sm:ml-4">
          {trunk.length === 0 && <p className="text-xs italic text-slate-500">Chưa có sự kiện ở trục chính.</p>}
          {trunk.map((ev, index) => (
            <div key={`${ev.source}-${ev.id}`} className="relative">
              <span
                className={`absolute -left-[31px] sm:-left-[39px] top-1 size-4 rounded-full border-2 border-white ring-2 ${
                  index === 0 ? 'bg-[#021E73] ring-blue-300' : 'bg-slate-400 ring-slate-200'
                }`}
              />
              <EventCard ev={ev} tone="main" />
            </div>
          ))}
        </div>
      </div>
      {lanes.length > 0 && (
        <div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Nhánh kiêm nhiệm ({lanes.length})
          </p>
          <div className="space-y-4">
            {lanes.map((lane, i) => (
              <LanePanel key={lane.id} lane={lane} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
