'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import { AlertCircle, UserCheck, Workflow } from 'lucide-react';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import type {
  ApprovalRoutePreview,
  HrmRequestReason,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import {
  approvalRoutePath,
  approverLine,
  choiceFromCatalogReason,
  descriptionRequired,
  emptyReasonCatalogMessage,
  isApprovalRoutePreview,
  reasonCatalogKindOf,
  type ReasonedRequestKind,
  type RequestReasonChoice,
} from '../request-reason-form';
import { Badge } from './badge';
import { Button } from './button';

export interface ReasonCatalogState {
  choices: RequestReasonChoice[];
  loading: boolean;
  error: string;
  reload: () => void;
}

const NO_CHOICES: RequestReasonChoice[] = [];

/**
 * Danh mục lý do đang dùng của loại đơn (GET /request-reasons theo kind). Đơn nghỉ không dùng hook này
 * vì lý do nghỉ là loại nghỉ do màn hình tự tải; loại đơn không có danh mục trả danh sách rỗng.
 */
export function useRequestReasonCatalog(
  kind: string,
  enabled = true,
): ReasonCatalogState {
  const catalogKind = reasonCatalogKindOf(kind);
  const [state, setState] = useState<{
    choices: RequestReasonChoice[];
    loading: boolean;
    error: string;
  }>({ choices: NO_CHOICES, loading: false, error: '' });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !catalogKind) {
      setState((prev) =>
        prev.choices === NO_CHOICES && !prev.loading && !prev.error
          ? prev
          : { choices: NO_CHOICES, loading: false, error: '' },
      );
      return;
    }
    let active = true;
    setState({ choices: NO_CHOICES, loading: true, error: '' });
    hrmFetch<{ data: HrmRequestReason[] }>(
      `/request-reasons?kind=${catalogKind}&active=true`,
    )
      .then((res) => {
        if (!active) return;
        const rows = Array.isArray(res?.data) ? res.data : [];
        setState({
          choices: rows
            .filter((row) => row.active !== false)
            .map(choiceFromCatalogReason),
          loading: false,
          error: '',
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          choices: NO_CHOICES,
          loading: false,
          error:
            error instanceof Error && error.message
              ? error.message
              : 'Không tải được danh sách lý do.',
        });
      });
    return () => {
      active = false;
    };
  }, [catalogKind, enabled, version]);

  return { ...state, reload: () => setVersion((value) => value + 1) };
}

/**
 * Người duyệt dự kiến của đơn (GET /approval-route). Chỉ gọi khi đã biết nhân viên và `enabled`;
 * lỗi tải hoặc phản hồi sai hình dạng thì trả null (khối ẩn, không chặn gửi đơn).
 */
export function useApprovalRoutePreview(input: {
  kind: string;
  employeeId: string;
  reasonId?: string;
  enabled?: boolean;
}): ApprovalRoutePreview | null {
  const { kind, employeeId, reasonId, enabled = true } = input;
  const [preview, setPreview] = useState<ApprovalRoutePreview | null>(null);

  useEffect(() => {
    setPreview(null);
    if (!enabled || !employeeId) return;
    let active = true;
    hrmFetch<{ data: unknown }>(
      approvalRoutePath({ kind, employeeId, reasonId }),
    )
      .then((res) => {
        if (active && isApprovalRoutePreview(res?.data)) setPreview(res.data);
      })
      .catch(() => {
        if (active) setPreview(null);
      });
    return () => {
      active = false;
    };
  }, [kind, employeeId, reasonId, enabled]);

  return preview;
}

/** Khối "Người duyệt: ..." cho người làm đơn biết trước đơn đi theo cách duyệt nào. */
export function ApproverPreview({
  preview,
}: {
  preview: ApprovalRoutePreview | null;
}) {
  if (!preview) return null;
  const line = approverLine(preview);
  const Icon = preview.mode === 'PROCEDURE' ? Workflow : UserCheck;
  const note =
    line.note ||
    (preview.mode === 'DIRECT' && !preview.directManager
      ? 'Chưa xác định được quản lý trực tiếp của nhân viên.'
      : '');
  return (
    <div
      role="status"
      data-testid="approver-preview"
      className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-blue-600" aria-hidden />
      <div className="space-y-0.5">
        <p className="text-slate-700">
          <span className="text-slate-500">Người duyệt: </span>
          <strong className="font-semibold text-slate-900">{line.method}</strong>
          {line.detail ? ` (${line.detail})` : ''}
        </p>
        {note ? <p className="text-[11px] text-amber-700">{note}</p> : null}
      </div>
    </div>
  );
}

export interface RequestReasonSectionProps {
  kind: ReasonedRequestKind;
  choices: readonly RequestReasonChoice[];
  loading?: boolean;
  /** Lỗi tải danh mục lý do (có thì hiện cảnh báo và nút Thử lại). */
  error?: string;
  onRetry?: () => void;
  reasonId: string;
  onReasonChange: (id: string) => void;
  description: string;
  onDescriptionChange: (text: string) => void;
  /** Nhân viên làm đơn (chính mình hoặc người được làm hộ); chưa biết thì ẩn khối Người duyệt. */
  employeeId?: string;
  disabled?: boolean;
  /**
   * Phần được vẽ: `all` (mặc định) là khối Lý do + Người duyệt + Mô tả; `reason` chỉ ô chọn lý do kèm diễn giải;
   * `description` chỉ ô Mô tả. Dùng khi màn hình đặt hai phần ở hai vị trí khác nhau trong form.
   */
  part?: 'all' | 'reason' | 'description';
  reasonLabel?: string;
  reasonPlaceholder?: string;
  descriptionLabel?: string;
  descriptionPlaceholder?: string;
  /** Ép Mô tả bắt buộc (ngoài trường hợp lý do đã chọn yêu cầu mô tả). */
  descriptionMandatory?: boolean;
}

function PaidTag({ paid }: { paid: boolean }) {
  return (
    <Badge
      variant="outline"
      className={
        paid
          ? 'border-emerald-200 bg-emerald-50 text-[10px] font-semibold text-emerald-700'
          : 'border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-800'
      }
    >
      {paid ? 'Có lương' : 'Không lương'}
    </Badge>
  );
}

/**
 * Hai phần tách biệt của đơn: "Lý do" (chọn từ danh mục, bắt buộc, kèm diễn giải và thẻ có lương / không lương)
 * và "Mô tả" (văn bản tự do, chỉ bắt buộc khi lý do đã chọn cần mô tả), cùng khối Người duyệt dưới ô lý do.
 */
export function RequestReasonSection({
  kind,
  choices,
  loading = false,
  error = '',
  onRetry,
  reasonId,
  onReasonChange,
  description,
  onDescriptionChange,
  employeeId = '',
  disabled = false,
  part = 'all',
  reasonLabel = 'Lý do',
  reasonPlaceholder = 'Chọn lý do...',
  descriptionLabel = 'Mô tả (nhập thêm chi tiết nếu cần)',
  descriptionPlaceholder,
  descriptionMandatory = false,
}: RequestReasonSectionProps) {
  const labelId = useId();
  const descriptionId = useId();
  const selected = choices.find((choice) => choice.id === reasonId);
  const reasonNeedsDescription = descriptionRequired(selected);
  const required = descriptionMandatory || reasonNeedsDescription;
  const empty = !loading && !error && choices.length === 0;
  const showPaid = kind === 'leave' || kind === 'ot';

  const options = useMemo<SearchableSelectOption[]>(
    () =>
      choices.map((choice) => ({
        value: choice.id,
        label: choice.name,
        description: choice.description ?? undefined,
      })),
    [choices],
  );

  const preview = useApprovalRoutePreview({
    kind,
    employeeId,
    reasonId,
    enabled: Boolean(employeeId && selected && part === 'all'),
  });

  const showReason = part !== 'description';
  const showDescription = part !== 'reason';

  return (
    <div className="space-y-3" data-testid="request-reason-section">
      {showReason ? (
      <div className="space-y-1.5">
        <div role="group" aria-labelledby={labelId} className="space-y-1">
          <span
            id={labelId}
            className="block text-xs font-semibold text-slate-800"
          >
            {reasonLabel} <span className="font-bold text-red-500">*</span>
          </span>
          <SearchableSelect
            options={options}
            value={selected ? selected.id : ''}
            onChange={(value) => onReasonChange(value)}
            placeholder={
              loading
                ? 'Đang tải danh sách lý do...'
                : empty
                  ? 'Chưa có lý do để chọn'
                  : reasonPlaceholder
            }
            disabled={disabled || loading || choices.length === 0}
            clearable={false}
          />
        </div>

        {error ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-[11px] text-red-700"
          >
            <span>{`Không tải được danh sách lý do: ${error}`}</span>
            {onRetry ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                onClick={onRetry}
              >
                Thử lại
              </Button>
            ) : null}
          </div>
        ) : null}

        {empty ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900"
          >
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-700" />
            <span>{emptyReasonCatalogMessage(kind)}</span>
          </div>
        ) : null}

        {selected ? (
          <div className="space-y-1" data-testid="reason-guide">
            {selected.description ? (
              <p className="text-[11px] leading-relaxed text-slate-500">
                {selected.description}
              </p>
            ) : null}
            {showPaid || selected.deductBalance ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {showPaid ? <PaidTag paid={selected.paid} /> : null}
                {kind === 'leave' && selected.deductBalance ? (
                  <span className="text-[11px] font-medium text-slate-600">
                    Trừ quỹ phép năm
                  </span>
                ) : null}
                {kind === 'ot' && !selected.paid ? (
                  <span className="text-[11px] text-slate-500">
                    Làm thêm giờ không lương, không tính tiền OT.
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      ) : null}

      {part === 'all' ? <ApproverPreview preview={preview} /> : null}

      {showDescription ? (
      <div className="space-y-1">
        <label
          htmlFor={descriptionId}
          className="block text-xs font-semibold text-slate-800"
        >
          {descriptionLabel}
          {required ? (
            <span className="ml-1 font-bold text-red-500">*</span>
          ) : null}
        </label>
        <textarea
          id={descriptionId}
          rows={3}
          maxLength={2000}
          required={required}
          aria-required={required}
          disabled={disabled}
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder={
            required
              ? (descriptionPlaceholder ?? 'Lý do này yêu cầu nhập mô tả chi tiết...')
              : (descriptionPlaceholder ?? 'Nhập thêm chi tiết nếu cần (không bắt buộc)...')
          }
          className="w-full rounded-md border border-slate-200 p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
        />
        {reasonNeedsDescription ? (
          <p className="text-[11px] text-amber-700">
            Lý do đã chọn yêu cầu nhập mô tả.
          </p>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}
