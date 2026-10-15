'use client';

import type {
  HrmScheduleConflict,
  HrmScheduleRulePreview,
  HrmScheduleRulePreviewItem,
  HrmSchedulePlanSummary,
  HrmSchedulePreview,
  HrmWorkDayType,
  HrmScheduleRequestConflict,
} from '@enterprise-platform/contracts-hrm';
import {
  DAY_TYPE_LABELS,
  RULE_ACTION_LABELS,
  RULE_SCOPE_LABELS,
  SOURCE_LABELS,
  formatVnDate,
  ruleRangeText,
} from '../../hrm-work-schedule-model';
import { Notice } from './common';

function dayText(dayType: HrmWorkDayType, shiftCode: string | null) {
  return dayType === 'SHIFT' ? (shiftCode ?? 'Ca') : DAY_TYPE_LABELS[dayType];
}

export function ConflictTable({
  conflicts,
  total,
}: {
  conflicts: readonly HrmScheduleConflict[];
  total: number;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="conflict-table">
      <div className="text-xs font-semibold text-slate-700">
        Xung đột lịch ({total} ngày)
      </div>
      <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="text-left text-[12px] font-bold text-slate-600">
              {['Nhân viên', 'Ngày', 'Lịch hiện có', 'Lịch mới'].map((h) => (
                <th key={h} scope="col" className="sticky top-0 border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c) => (
              <tr key={`${c.employeeId}-${c.date}`}>
                <td className="border-b border-slate-100 px-2.5 py-1">
                  <span className="font-mono text-[12px] text-blue-700">{c.employeeCode}</span> {c.employeeName}
                </td>
                <td className="border-b border-slate-100 px-2.5 py-1 whitespace-nowrap">{formatVnDate(c.date)}</td>
                <td className="border-b border-slate-100 px-2.5 py-1">
                  {dayText(c.existing.dayType, c.existing.shiftCode)}
                  <span className="ml-1 text-slate-400">({SOURCE_LABELS[c.existing.source]})</span>
                </td>
                <td className="border-b border-slate-100 px-2.5 py-1">
                  {dayText(c.incoming.dayType, c.incoming.shiftCode)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > conflicts.length ? (
        <span className="text-[12px] text-slate-500">
          Chỉ hiển thị {conflicts.length} dòng đầu trong tổng {total} xung đột.
        </span>
      ) : null}
    </div>
  );
}

const REQUEST_KIND_LABEL = { LEAVE: 'Đơn nghỉ', TRIP: 'Đơn công tác' } as const;

/** Ngày đổi ca/OFF/lễ trùng đơn nghỉ hoặc công tác: đơn đã duyệt chặn áp dụng, đơn đang chờ chỉ cảnh báo. */
export function RequestConflictTable({
  conflicts,
  total,
}: {
  conflicts: readonly HrmScheduleRequestConflict[];
  total: number;
}) {
  if (!conflicts.length) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="request-conflicts">
      <div className="max-h-44 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="text-left text-[12px] font-bold text-slate-600">
              {['Nhân viên', 'Ngày', 'Đơn', 'Trạng thái'].map((h) => (
                <th key={h} scope="col" className="sticky top-0 border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c) => (
              <tr key={`${c.requestId}-${c.date}`}>
                <td className="border-b border-slate-100 px-2.5 py-1">
                  <span className="font-mono text-[12px] text-blue-700">{c.employeeCode}</span> {c.employeeName}
                </td>
                <td className="border-b border-slate-100 px-2.5 py-1 whitespace-nowrap">{formatVnDate(c.date)}</td>
                <td className="border-b border-slate-100 px-2.5 py-1">{REQUEST_KIND_LABEL[c.kind]}</td>
                <td
                  className={`border-b border-slate-100 px-2.5 py-1 font-semibold ${c.status === 'APPROVED' ? 'text-red-700' : 'text-amber-700'}`}
                >
                  {c.status === 'APPROVED' ? 'Đã duyệt' : 'Đang chờ duyệt'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > conflicts.length ? (
        <span className="text-[12px] text-slate-500">
          Chỉ hiển thị {conflicts.length} dòng đầu trong tổng {total} ngày.
        </span>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className={`text-lg font-bold ${tone ?? 'text-slate-900'}`}>{value}</div>
      <div className="text-[12px] text-slate-500">{label}</div>
    </div>
  );
}

export function SummaryStats({
  summary,
  employeeCount,
}: {
  summary: HrmSchedulePlanSummary;
  employeeCount: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 @xl:grid-cols-6" aria-label="Tóm tắt xem trước">
      <Stat label="Nhân viên" value={employeeCount} />
      <Stat label="Ngày sẽ tạo mới" value={summary.insert} tone="text-emerald-700" />
      <Stat label="Ngày sẽ ghi đè" value={summary.replace} tone={summary.replace ? 'text-amber-700' : undefined} />
      <Stat label="Ngày giữ nguyên (trùng)" value={summary.same} />
      <Stat label="Ngày bỏ qua" value={summary.skipped} />
      <Stat label="Ngày xung đột" value={summary.conflicts} tone={summary.conflicts ? 'text-red-700' : undefined} />
    </div>
  );
}

export function PreviewPanel({ preview }: { preview: HrmSchedulePreview }) {
  return (
    <div className="flex flex-col gap-3">
      <SummaryStats summary={preview.summary} employeeCount={preview.employeeCount} />
      <div className="text-xs text-slate-600">
        Tổng số ngày thuộc khoảng áp dụng: <strong>{preview.dayCount}</strong> ngày công của{' '}
        <strong>{preview.employeeCount}</strong> nhân viên.
      </div>
      {preview.lockedPeriods.length ? (
        <Notice tone="error" title="Có kỳ công đã khoá trong khoảng ngày này">
          {preview.lockedPeriods.join(', ')}. Không thể ghi lịch cho tới khi kỳ công được mở lại.
        </Notice>
      ) : null}
      {preview.conflicts.length ? (
        <ConflictTable conflicts={preview.conflicts} total={preview.conflictTotal} />
      ) : null}
      {(preview.requestConflictTotal ?? 0) > 0 ? (
        <>
          <Notice
            tone={(preview.blockingRequestConflictTotal ?? 0) > 0 ? 'error' : 'warn'}
            title="Có ngày trùng đơn nghỉ hoặc công tác"
          >
            {(preview.blockingRequestConflictTotal ?? 0) > 0
              ? `${preview.blockingRequestConflictTotal} ngày có đơn đã duyệt nên không thể đổi ca hoặc chuyển thành ngày nghỉ. Huỷ (đảo) đơn đó hoặc bỏ các ngày này khỏi phạm vi.`
              : 'Các đơn này đang chờ duyệt; người duyệt cần biết lịch ca đã đổi.'}
          </Notice>
          <RequestConflictTable
            conflicts={preview.requestConflicts ?? []}
            total={preview.requestConflictTotal ?? 0}
          />
        </>
      ) : null}
      {preview.employees.length ? (
        <details className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-700">
            Nhân viên bị ảnh hưởng (mẫu {preview.employees.length})
          </summary>
          <ul className="mt-2 grid max-h-32 grid-cols-1 gap-x-4 gap-y-0.5 overflow-auto @lg:grid-cols-2">
            {preview.employees.map((e) => (
              <li key={e.employeeId} className="truncate">
                <span className="font-mono text-[12px] text-blue-700">{e.code}</span> {e.name}
                <span className="text-slate-400"> - {e.days} ngày</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Các lịch định kỳ đang có sẽ bị kết thúc sớm hoặc hủy, nhóm theo phạm vi. */
export function RuleChangesList({ rules }: { rules: readonly HrmScheduleRulePreviewItem[] }) {
  const affected = rules.filter((r) => r.changes.length > 0);
  if (!affected.length) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="rule-changes">
      <div className="text-xs font-semibold text-slate-700">Lịch định kỳ đang có bị ảnh hưởng</div>
      <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="text-left text-[12px] font-bold text-slate-600">
              {['Phạm vi', 'Hiệu lực hiện tại', 'Mẫu lịch', 'Xử lý'].map((h) => (
                <th key={h} scope="col" className="sticky top-0 border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {affected.flatMap((item) =>
              item.changes.map((change) => (
                <tr key={`${item.scopeType}-${item.scopeLabel}-${change.id}`}>
                  <td className="border-b border-slate-100 px-2.5 py-1">
                    <span className="text-slate-500">{RULE_SCOPE_LABELS[item.scopeType]}: </span>
                    <span className="font-semibold">{item.scopeLabel}</span>
                  </td>
                  <td className="border-b border-slate-100 px-2.5 py-1 whitespace-nowrap">
                    {ruleRangeText(change.from, change.to)}
                  </td>
                  <td className="border-b border-slate-100 px-2.5 py-1">{change.templateName ?? 'Tự cấu hình'}</td>
                  <td className="border-b border-slate-100 px-2.5 py-1">
                    {RULE_ACTION_LABELS[change.action]}
                    {change.action === 'TRUNCATE' && change.newTo ? (
                      <span className="ml-1 text-slate-500">(đến {formatVnDate(change.newTo)})</span>
                    ) : null}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RulePreviewPanel({ preview }: { preview: HrmScheduleRulePreview }) {
  return (
    <div className="flex flex-col gap-3" data-testid="rule-preview">
      <div className="grid grid-cols-2 gap-2 @md:grid-cols-3 @3xl:grid-cols-6" aria-label="Tóm tắt xem trước lịch định kỳ">
        <Stat label="Lịch định kỳ sẽ tạo" value={preview.ruleCount} tone="text-emerald-700" />
        <Stat label="Nhân viên đang được áp dụng" value={preview.employeeCount} />
        <Stat
          label="Lịch định kỳ cũ bị kết thúc hoặc hủy"
          value={preview.changedRules}
          tone={preview.changedRules ? 'text-amber-700' : undefined}
        />
        <Stat
          label="Ngày phân từng ngày bị thay"
          value={preview.replacedDays ?? 0}
          tone={preview.replacedDays ? 'text-amber-700' : undefined}
        />
        <Stat label="Phạm vi bỏ qua" value={preview.skippedTargets} />
        <Stat
          label="Phạm vi đã có lịch định kỳ"
          value={preview.conflictTotal}
          tone={preview.conflictTotal ? 'text-red-700' : undefined}
        />
      </div>
      <p className="text-xs text-slate-600">
        Lịch được lưu một lần và tự chạy đến khi kết thúc. Ngoại lệ và ngày lễ luôn được giữ. Ở chế độ ghi đè, lịch mới
        thay các ngày đã phân ca từng ngày từ ngày bắt đầu; các chế độ khác giữ lịch từng ngày ưu tiên hơn lịch định kỳ.
      </p>
      {preview.lockedPeriods.length ? (
        <Notice tone="error" title="Có kỳ công đã khoá trong khoảng áp dụng">
          {preview.lockedPeriods.join(', ')}. Không thể ghi lịch cho tới khi kỳ công được mở lại.
        </Notice>
      ) : null}
      <RuleChangesList rules={preview.rules} />
    </div>
  );
}
