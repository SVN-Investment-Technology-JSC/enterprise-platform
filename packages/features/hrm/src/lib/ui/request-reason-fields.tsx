'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import type {
  HrmRequestReason,
  HrmRequestReasonKind,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import {
  choiceFromCatalogReason,
  descriptionRequired,
  emptyReasonCatalogMessage,
  reasonCatalogKindOf,
  type ReasonedRequestKind,
  type RequestReasonChoice,
} from '../request-reason-form';
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
  /** Loại đơn tuỳ chỉnh: mã loại đơn chính là `kind` của danh mục lý do. */
  customTypeCode?: string,
): ReasonCatalogState {
  const catalogKind = (customTypeCode as HrmRequestReasonKind | undefined) ?? reasonCatalogKindOf(kind);
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
  /** Ép Mô tả bắt buộc (ngoài trường hợp lý do đã chọn yêu cầu mô tả); nhãn và gợi ý tuỳ chỉnh theo loại đơn. */
  descriptionMandatory?: boolean;
  descriptionLabel?: string;
  descriptionPlaceholder?: string;
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
  descriptionMandatory = false,
  descriptionLabel = 'Mô tả (nhập thêm chi tiết nếu cần)',
  descriptionPlaceholder,
}: RequestReasonSectionProps) {
  const labelId = useId();
  const descriptionId = useId();
  const selected = choices.find((choice) => choice.id === reasonId);
  const reasonNeedsDescription = descriptionRequired(selected);
  const required = descriptionMandatory || reasonNeedsDescription;
  const empty = !loading && !error && choices.length === 0;
  // Đơn nghỉ và đơn làm thêm giờ không hiện thẻ có lương / không lương, nhãn trừ quỹ hay diễn giải của lý do; làm thêm giờ
  // chỉ còn hệ số tăng ca.
  const showDescription = kind !== 'ot';
  const showRate = kind === 'ot' && selected?.rateMultiplier != null;

  const options = useMemo<SearchableSelectOption[]>(
    () =>
      choices.map((choice) => ({
        value: choice.id,
        label: choice.name,
        description: choice.description ?? undefined,
      })),
    [choices],
  );

  return (
    <div className="space-y-3" data-testid="request-reason-section">
      <div className="space-y-1.5">
        <div role="group" aria-labelledby={labelId} className="space-y-1">
          <span
            id={labelId}
            className="block text-xs font-semibold text-slate-800"
          >
            Lý do <span className="font-bold text-red-500">*</span>
          </span>
          <SearchableSelect
            options={options}
            value={selected ? selected.id : ''}
            renderOption={(option) => {
              return (
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{option.label}</span>
                  </span>
                  {showDescription && option.description ? (
                    <span className="whitespace-normal text-[12px] font-normal leading-snug text-slate-500">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              );
            }}
            onChange={(value) => onReasonChange(value)}
            placeholder={
              loading
                ? 'Đang tải danh sách lý do...'
                : empty
                  ? 'Chưa có lý do để chọn'
                  : 'Chọn lý do...'
            }
            disabled={disabled || loading || choices.length === 0}
            clearable={false}
          />
        </div>

        {error ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-[12px] text-red-700"
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
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-900"
          >
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-700" />
            <span>{emptyReasonCatalogMessage(kind)}</span>
          </div>
        ) : null}

        {selected ? (
          <div className="space-y-1" data-testid="reason-guide">
            {showDescription && selected.description ? (
              <p className="text-[12px] leading-relaxed text-slate-500">
                {selected.description}
              </p>
            ) : null}
            {showRate ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {showRate ? (
                  <span data-testid="reason-rate" className="text-[12px] font-medium text-slate-600">
                    Hệ số tăng ca x{String(selected.rateMultiplier).replace('.', ',')}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>


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
          <p className="text-[12px] text-amber-700">
            Lý do đã chọn yêu cầu nhập mô tả.
          </p>
        ) : null}
      </div>
    </div>
  );
}
