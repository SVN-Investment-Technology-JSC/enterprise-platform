'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Layers,
  Paperclip,
  Workflow,
  X,
} from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../../hrm-api';
import { procedureInstanceHref } from '../../hrm-approval-kinds';
import {
  isTerminalProcedureStatus,
  procedureFieldsOf,
  type ProcedureActionKind,
  type ProcedureProgressData,
} from '../../procedure-progress-view';
import { Badge } from '../badge';
import { Button } from '../button';
import { ProcedureActionBar } from '../procedure-action-bar';
import { ProcedureProgressPanel } from '../procedure-progress-panel';
import {
  detailFields,
  flowSteps,
  initialsOf,
  isUnpaidOt,
  kindChip,
  rowKindLabel,
  states,
  statusTone,
  type Row,
} from './approvals-model';
import { RequestThread } from './request-thread';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[132px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-slate-900">{children}</dd>
    </div>
  );
}

const STEP_STYLE: Record<'done' | 'current' | 'todo' | 'rejected', string> = {
  done: 'bg-emerald-500 text-white',
  current: 'bg-orange-500 text-white',
  todo: 'bg-slate-200 text-slate-500',
  rejected: 'bg-rose-500 text-white',
};
const STEP_TEXT: Record<'done' | 'current' | 'todo' | 'rejected', string> = {
  done: 'text-slate-500',
  current: 'font-semibold text-orange-600',
  todo: 'text-slate-400',
  rejected: 'font-semibold text-rose-600',
};

/** Quy trình phê duyệt dạng các chấm nối nhau: người gửi, từng bước duyệt. */
export function FlowStepper({ row, progress }: { row: Row; progress: ProcedureProgressData | null }) {
  const steps = flowSteps(row, progress);
  return (
    <ol aria-label="Quy trình phê duyệt" className="flex items-start" data-testid="flow-stepper">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex min-w-0 flex-1 flex-col items-center text-center" data-state={s.state}>
          {i > 0 ? <span aria-hidden="true" className={`absolute right-1/2 top-3.5 h-0.5 w-full ${steps[i - 1].state === 'done' ? 'bg-emerald-300' : 'bg-slate-200'}`} /> : null}
          <span className={`relative z-10 flex size-7 items-center justify-center rounded-full text-[13px] font-bold ${STEP_STYLE[s.state]}`}>
            {s.state === 'done' ? <Check className="size-4" /> : s.state === 'rejected' ? <X className="size-4" /> : i + 1}
          </span>
          <span className="mt-1.5 max-w-full truncate px-1 text-[13px] font-semibold text-slate-800">{s.label}</span>
          <span className={`max-w-full truncate px-1 text-[12px] ${STEP_TEXT[s.state]}`}>{s.sub}</span>
        </li>
      ))}
    </ol>
  );
}

export interface ApprovalDetailPanelProps {
  row: Row | null;
  progress: ProcedureProgressData | null;
  progressLoading: boolean;
  onRefreshProgress: (silent: boolean) => void;
  busy: boolean;
  error: string;
  /** Duyệt trực tiếp đơn này (người dùng có quyền, đơn không đi qua quy trình). */
  canDecide: boolean;
  /** Thao tác qua Procedure Engine. */
  canProcedure: boolean;
  /** Hủy hiệu lực đơn đã duyệt. */
  canReverse: boolean;
  onApprove: (note: string) => Promise<void>;
  onReject: (note: string) => Promise<void>;
  onProcedureAction: (action: ProcedureActionKind, comment: string) => Promise<void>;
  onReverse: () => void;
  onError: (message: string) => void;
  /** Tăng lên sau mỗi quyết định để luồng trao đổi tải lại ý kiến vừa ghi. */
  threadRefresh: number;
}

/** Chi tiết đơn bên phải danh sách: thông tin, quy trình phê duyệt, trao đổi, ý kiến và nút Từ chối, Phê duyệt. */
export function ApprovalDetailPanel(props: ApprovalDetailPanelProps) {
  const { row, progress } = props;
  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [row?.key]);

  if (!row)
    return (
      <aside aria-label="Chi tiết đơn" className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200/70 bg-white p-6 text-center text-sm text-slate-500">
        <FileText className="size-8 text-slate-300" />
        Chọn một đơn trong danh sách để xem chi tiết, trao đổi và xử lý.
      </aside>
    );

  const f = procedureFieldsOf(row);
  const code = `#${row.id.slice(-8).toUpperCase()}`;
  const extra = Object.entries(detailFields).filter(([k]) => row[k] !== undefined && row[k] !== null);
  const terminal = isTerminalProcedureStatus(progress?.status);
  const instanceId = f.instanceId ?? row.link?.instance_id;
  const procedureHref = procedureInstanceHref(instanceId);

  return (
    <aside aria-label="Chi tiết đơn" className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200/70 bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-[16px] font-bold text-slate-900">Chi tiết đơn</h2>
        {row.link || f.instanceId ? (
          <a
            href={procedureHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#2563eb] hover:underline"
          >
            <Workflow className="size-3.5" />
            Xem quy trình
          </a>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${kindChip(row.source.kind)}`}>
            <FileText className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-bold text-slate-900" data-testid="detail-title">
              {rowKindLabel(row)}
            </p>
            <p className="font-mono text-[12px] text-slate-500">Mã đơn: {code}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${statusTone(row.status)}`}>{states[row.status] ?? row.status}</span>
        </div>

        {row.reversalReason ? (
          <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
            <b>Đã hủy hiệu lực.</b> Lý do: {row.reversalReason}
          </p>
        ) : null}

        <section aria-label="Thông tin nhân viên">
          <h3 className="mb-2 text-[14px] font-bold text-slate-900">Thông tin nhân viên</h3>
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[14px] font-bold text-slate-600">{initialsOf(row.employeeName)}</span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-slate-900">{row.employeeName}</p>
              <p className="truncate text-[13px] text-slate-500">
                {[row.employeeCode, row.department].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
        </section>

        <dl className="divide-y divide-slate-100 border-y border-slate-100">
          <Field label="Loại đơn">{rowKindLabel(row)}</Field>
          <Field label="Thời gian">{row.period || '—'}</Field>
          <Field label="Lý do">
            <span data-testid="approval-detail-reason">
              {row.reasonLabel}
              {isUnpaidOt(row) ? (
                <Badge variant="outline" className="ml-1.5 border-amber-200 bg-amber-50 text-[12px] font-semibold text-amber-800">
                  Không lương
                </Badge>
              ) : null}
            </span>
          </Field>
          <Field label="Mô tả">
            <span data-testid="approval-detail-description" className="whitespace-pre-wrap">
              {row.descriptionText}
            </span>
          </Field>
          {extra.map(([key, label]) => {
            const val = row[key];
            return (
              <Field key={key} label={label}>
                {typeof val === 'boolean' ? (
                  val ? 'Có' : 'Không'
                ) : typeof val === 'number' && key.toLowerCase().includes('amount') ? (
                  <span className="font-mono text-emerald-700">{val.toLocaleString('vi-VN')} đ</span>
                ) : typeof val === 'number' && key.toLowerCase().includes('minutes') ? (
                  <span className="font-mono">{val} phút</span>
                ) : typeof val === 'object' ? (
                  <pre className="overflow-x-auto rounded border border-slate-200 bg-slate-50 p-2 text-left font-mono text-[12px]">{JSON.stringify(val, null, 2)}</pre>
                ) : (
                  String(val)
                )}
              </Field>
            );
          })}
          {row.attachmentFileId ? (
            <Field label="Tệp đính kèm">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-[#2563eb] hover:underline"
                onClick={async () => {
                  try {
                    const file = await hrmFetch<{ data: { url: string } }>(`/attachments/${row.attachmentFileId}/download`);
                    window.open(file.data.url, '_blank', 'noopener,noreferrer');
                  } catch (e) {
                    props.onError(e instanceof Error ? e.message : 'Không tải được chứng từ');
                  }
                }}
              >
                <Paperclip className="size-3.5" />
                Xem chứng từ
                <ExternalLink className="size-3" />
              </button>
            </Field>
          ) : null}
        </dl>

        {row.changes && Object.keys(row.changes).length > 0 ? (
          <section aria-label="Nội dung đề xuất cập nhật hồ sơ" className="rounded-xl border border-slate-200 p-3">
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-slate-900">
              <Layers className="size-3.5 text-[#2563eb]" />
              Nội dung đề xuất cập nhật hồ sơ
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(row.changes).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 p-2">
                  <span className="block text-[12px] text-slate-500">{k}</span>
                  <span className="block break-all text-[13px] font-semibold text-slate-900">{String(v ?? '—')}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <h3 className="mb-3 text-[14px] font-bold text-slate-900">Quy trình phê duyệt</h3>
          <FlowStepper row={row} progress={progress} />
          {row.link ? (
            <details className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-semibold text-slate-700">
                Chi tiết tiến độ quy trình {row.link.instance_code ? `(${row.link.instance_code})` : ''}
              </summary>
              <div className="mt-2">
                <ProcedureProgressPanel
                  progress={progress}
                  loading={props.progressLoading}
                  hasInstance={Boolean(f.instanceId ?? row.link.instance_id)}
                  onRefresh={() => props.onRefreshProgress(false)}
                  syncStatus={row.link.status}
                  lastError={row.link.last_error}
                  fallbackStepName={f.currentStepName}
                  fallbackAssigneeName={f.currentAssigneeName}
                />
              </div>
            </details>
          ) : (
            <p className="mt-2 text-[12px] text-slate-500">Duyệt trực tiếp, không qua Procedure Engine.</p>
          )}
        </section>

        <RequestThread kind={row.source.kind} requestId={row.id} refreshKey={props.threadRefresh} />
      </div>

      <div className="shrink-0 space-y-2 border-t border-slate-100 px-4 py-3">
        {props.error ? (
          <p role="alert" className="text-xs font-semibold text-red-700">
            {props.error}
          </p>
        ) : null}
        {props.canProcedure && progress?.canAct !== false && !terminal ? (
          <ProcedureActionBar busy={props.busy} onAction={props.onProcedureAction} />
        ) : props.canDecide ? (
          <>
            <textarea
              aria-label="Ý kiến xử lý"
              rows={2}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ý kiến xử lý (tuỳ chọn)"
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-[#d9ab00] focus:ring-2 focus:ring-[#d9ab00]/30"
            />
            <div className="grid grid-cols-2 gap-2">
              <Popconfirm
                title="Từ chối đơn này?"
                description="Đơn sẽ chuyển sang trạng thái từ chối và người tạo đơn được thông báo."
                okText="Từ chối"
                cancelText="Quay lại"
                okType="danger"
                onConfirm={() => props.onReject(note.trim())}
              >
                <Button
                  variant="outline"
                  disabled={props.busy}
                  className="h-10 w-full gap-1.5 border-rose-300 text-[14px] font-semibold text-rose-600 hover:bg-rose-50"
                >
                  <X className="size-4" />
                  Từ chối
                </Button>
              </Popconfirm>
              <Popconfirm
                title="Phê duyệt đơn này?"
                description="Hành động này sẽ áp dụng các thay đổi vào hồ sơ công, phép, lương tương ứng."
                okText="Phê duyệt"
                cancelText="Quay lại"
                okType="primary"
                onConfirm={() => props.onApprove(note.trim())}
              >
                <Button disabled={props.busy} className="h-10 w-full gap-1.5 border-0 bg-emerald-600 text-[14px] font-semibold text-white hover:bg-emerald-700">
                  <CheckCircle2 className="size-4" />
                  Phê duyệt
                </Button>
              </Popconfirm>
            </div>
          </>
        ) : props.canReverse ? (
          <Button variant="outline" disabled={props.busy} onClick={props.onReverse} className="h-9 w-full border-amber-200 text-xs font-medium text-amber-700 hover:bg-amber-50">
            Hủy hiệu lực đơn
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
