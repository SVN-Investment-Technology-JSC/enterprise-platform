'use client';

import {
  PROGRESS_REPORT_DESCRIPTION_MAX_LENGTH,
  type ProgressReportCompleteStatus,
  type ReportWorkItemProgressRequest,
  type StandaloneTaskDetail,
  type WorkItem,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import { toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import * as api from '../workspace-api';
import { WORK_ITEM_STATUS_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Dialog, Field } from './dialog';

/** Hôm nay theo múi giờ máy người dùng, dạng `YYYY-MM-DD`. */
function today(): string {
  const now = new Date();
  return [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

interface ReportSettings {
  readonly completeStatus: ProgressReportCompleteStatus;
  readonly requireDescription: boolean;
}

const DEFAULT_SETTINGS: ReportSettings = { completeStatus: 'done', requireDescription: false };

/** Lời của server (hoặc lời mặc định) để hiện trong toast và hộp lỗi. */
const messageOf = (cause: unknown, fallback: string) =>
  (cause as { message?: string })?.message || fallback;

/** Làm tròn phần trăm khối lượng như server (`quantityPercent`), để xem trước đúng con số sẽ lưu. */
const quantityPercentOf = (done: number, target: number | undefined) =>
  !target || target <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((done / target) * 100)));

/** Phần của công việc mà hộp báo cáo và toast cần; việc trong dự án lẫn Công việc khác đều có đủ. */
export interface ProgressTarget {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly status: WorkItemStatus;
  readonly progressPercent: number;
  readonly quantityDone?: number;
  readonly quantityTarget?: number;
  readonly quantityUnit?: string;
}

/** Cách gọi API cho từng loại công việc; hook dùng chung một luồng cho cả hai. */
export interface ProgressAdapter<TResult> {
  report(id: string, body: ReportWorkItemProgressRequest): Promise<TResult>;
  /** Bỏ số nhập tay, về tiến độ tự tính. */
  clear(id: string): Promise<TResult>;
  statusOf(result: TResult): WorkItemStatus;
  percentOf(result: TResult): number;
}

/** Công việc trong dự án. */
export const WORK_ITEM_PROGRESS_ADAPTER: ProgressAdapter<WorkItem> = {
  report: (id, body) => api.reportWorkItemProgress(id, body),
  clear: (id) => api.updateWorkItem(id, { manualProgressPercent: null }),
  statusOf: (result) => result.status,
  percentOf: (result) => result.progressPercent,
};

/** Công việc khác (việc ngoài dự án). */
export const STANDALONE_PROGRESS_ADAPTER: ProgressAdapter<StandaloneTaskDetail> = {
  report: (id, body) => api.reportStandaloneTaskProgress(id, body),
  clear: (id) => api.updateStandaloneTask(id, { manualProgressPercent: null }),
  statusOf: (result) => result.task.status,
  percentOf: (result) => result.task.progressPercent,
};

interface Pending {
  readonly item: ProgressTarget;
  /** `percent`: báo phần trăm (việc theo % tự cập nhật, báo 100%); `quantity`: báo khối lượng đã làm. */
  readonly mode: 'percent' | 'quantity';
  readonly percent: number;
}

/**
 * Cập nhật tiến độ công việc qua cùng một luồng ở mọi màn (bám 1Office):
 *  · chọn dưới 100% thì lưu ngay thành một báo cáo;
 *  · chọn 100% thì mở hộp "Báo cáo tiến độ công việc" (ngày, %, mô tả) vì việc sẽ chuyển trạng thái;
 *  · "Về tiến độ tự động" (`null`) bỏ số nhập tay, không tạo báo cáo;
 *  · việc tính theo khối lượng: `reportQuantity` mở hộp báo khối lượng đã làm, server tính %.
 * Server là nơi đổi trạng thái theo con số; hook chỉ gọi API rồi báo `onReported` để màn nạp lại dữ liệu.
 */
export function useProgressReport<TResult = WorkItem>(
  onReported: (result: TResult) => void | Promise<void>,
  adapter: ProgressAdapter<TResult> = WORK_ITEM_PROGRESS_ADAPTER as unknown as ProgressAdapter<TResult>,
): {
  readonly setProgress: (item: ProgressTarget, percent: number | null) => Promise<void>;
  readonly reportQuantity: (item: ProgressTarget) => void;
  readonly dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending>();
  const [settings, setSettings] = useState<ReportSettings>(DEFAULT_SETTINGS);

  // Mỗi lần mở hộp: đọc lại cài đặt, vì quản trị có thể vừa đổi (bắt buộc mô tả, trạng thái sau khi báo xong).
  useEffect(() => {
    if (!pending) return;
    let alive = true;
    api
      .loadProjectArchiveSettings()
      .then((loaded) => {
        if (!alive) return;
        setSettings({
          completeStatus: loaded.progressReportCompleteStatus ?? 'done',
          requireDescription: Boolean(loaded.progressReportRequireDescription),
        });
      })
      .catch(() => alive && setSettings(DEFAULT_SETTINGS));
    return () => {
      alive = false;
    };
  }, [pending]);

  const submit = useCallback(
    async (item: ProgressTarget, body: ReportWorkItemProgressRequest) => {
      const result = await adapter.report(item.id, body);
      const status = adapter.statusOf(result);
      const moved = status !== item.status ? ` Trạng thái: ${WORK_ITEM_STATUS_LABELS[status]}.` : '';
      toast.success(`Đã báo cáo tiến độ ${item.code}: ${adapter.percentOf(result)}%.${moved}`);
      await onReported(result);
    },
    [onReported, adapter],
  );

  const setProgress = useCallback(
    async (item: ProgressTarget, percent: number | null) => {
      try {
        if (percent === null) {
          const result = await adapter.clear(item.id);
          toast.success(`Đã đưa tiến độ ${item.code} về tự động.`);
          await onReported(result);
        } else if (percent === 100) {
          setPending({ item, mode: 'percent', percent });
        } else {
          await submit(item, { percent });
        }
      } catch (cause) {
        toast.error(messageOf(cause, 'Không lưu được tiến độ.'));
      }
    },
    [adapter, submit],
  );

  const reportQuantity = useCallback(
    (item: ProgressTarget) => setPending({ item, mode: 'quantity', percent: item.progressPercent }),
    [],
  );

  const dialog = pending ? (
    <ReportDialog
      item={pending.item}
      mode={pending.mode}
      initialPercent={pending.percent}
      settings={settings}
      onClose={() => setPending(undefined)}
      onSubmit={async (body) => {
        await submit(pending.item, body);
        setPending(undefined);
      }}
    />
  ) : null;

  return { setProgress, reportQuantity, dialog };
}

function ReportDialog({
  item,
  mode,
  initialPercent,
  settings,
  onClose,
  onSubmit,
}: {
  item: ProgressTarget;
  mode: 'percent' | 'quantity';
  initialPercent: number;
  settings: ReportSettings;
  onClose: () => void;
  onSubmit: (body: ReportWorkItemProgressRequest) => Promise<void>;
}) {
  const quantity = mode === 'quantity';
  const [percent, setPercent] = useState(String(initialPercent));
  const [done, setDone] = useState(String(item.quantityDone ?? 0));
  const [description, setDescription] = useState('');
  const [reportedOn, setReportedOn] = useState(today());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const doneValue = Number(done);
  const value = quantity ? quantityPercentOf(doneValue, item.quantityTarget) : Number(percent);
  const completing = value === 100;

  const save = async () => {
    setError(undefined);
    if (quantity) {
      if (!done.trim() || !Number.isFinite(doneValue) || doneValue < 0) {
        setError('Khối lượng đã hoàn thành phải là số không âm.');
        return;
      }
    } else if (!percent.trim() || !Number.isInteger(value) || value < 0 || value > 100) {
      setError('Tiến độ phải là số nguyên từ 0 đến 100.');
      return;
    }
    if (completing && settings.requireDescription && !description.trim()) {
      setError('Hãy ghi mô tả khi báo hoàn thành công việc.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        ...(quantity ? { quantityDone: doneValue } : { percent: value }),
        description: description.trim() || undefined,
        reportedOn,
      });
    } catch (cause) {
      setError(messageOf(cause, 'Không lưu được báo cáo tiến độ.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      title={quantity ? 'Báo khối lượng hoàn thành' : 'Báo cáo tiến độ công việc'}
      subtitle={`${item.code} · ${item.title}`}
      submitLabel="Báo cáo"
      submitting={submitting}
      error={error}
      centered
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <div className={styles.fieldRow}>
        <Field label="Ngày báo cáo">
          <DatePickerInput height={38} value={reportedOn} max={today()} onChange={(next) => setReportedOn(next || today())} />
        </Field>
        {quantity ? (
          <Field
            label={`Đã hoàn thành (${item.quantityUnit ?? ''})`}
            hint={`Cần hoàn thành ${item.quantityTarget ?? 0} ${item.quantityUnit ?? ''}. Tiến độ: ${value}%.`}
          >
            <input type="number" min={0} step="any" value={done} onChange={(event) => setDone(event.target.value)} />
          </Field>
        ) : (
          <Field label="Tiến độ (%)">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
            />
          </Field>
        )}
      </div>
      <Field
        label={settings.requireDescription && completing ? 'Mô tả (bắt buộc)' : 'Mô tả'}
        hint={
          completing
            ? `Báo 100% thì công việc chuyển sang "${WORK_ITEM_STATUS_LABELS[settings.completeStatus]}".`
            : undefined
        }
      >
        <textarea
          rows={4}
          maxLength={PROGRESS_REPORT_DESCRIPTION_MAX_LENGTH}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}
