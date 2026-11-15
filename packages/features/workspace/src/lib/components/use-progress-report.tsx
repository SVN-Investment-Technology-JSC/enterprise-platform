'use client';

import {
  PROGRESS_REPORT_DESCRIPTION_MAX_LENGTH,
  type ProgressReportCompleteStatus,
  type WorkItem,
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

/**
 * Cập nhật tiến độ công việc qua cùng một luồng ở mọi màn (bám 1Office):
 *  · chọn dưới 100% thì lưu ngay thành một báo cáo;
 *  · chọn 100% thì mở hộp "Báo cáo tiến độ công việc" (ngày, %, mô tả) vì việc sẽ chuyển trạng thái;
 *  · "Về tiến độ tự động" (`null`) bỏ số nhập tay, không tạo báo cáo.
 * Server là nơi đổi trạng thái theo con số; hook chỉ gọi API rồi báo `onReported` để màn nạp lại dữ liệu.
 */
export function useProgressReport(onReported: () => void | Promise<void>): {
  readonly setProgress: (item: WorkItem, percent: number | null) => Promise<void>;
  readonly dialog: ReactNode;
} {
  const [pending, setPending] = useState<{ item: WorkItem; percent: number }>();
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
    async (item: WorkItem, body: { percent: number; description?: string; reportedOn?: string }) => {
      const result = await api.reportWorkItemProgress(item.id, body);
      const moved = result.status !== item.status ? ` Trạng thái: ${WORK_ITEM_STATUS_LABELS[result.status]}.` : '';
      toast.success(`Đã báo cáo tiến độ ${item.code}: ${body.percent}%.${moved}`);
      await onReported();
    },
    [onReported],
  );

  const setProgress = useCallback(
    async (item: WorkItem, percent: number | null) => {
      try {
        if (percent === null) {
          await api.updateWorkItem(item.id, { manualProgressPercent: null });
          toast.success(`Đã đưa tiến độ ${item.code} về tự động.`);
          await onReported();
        } else if (percent === 100) {
          setPending({ item, percent });
        } else {
          await submit(item, { percent });
        }
      } catch (cause) {
        toast.error(messageOf(cause, 'Không lưu được tiến độ.'));
      }
    },
    [onReported, submit],
  );

  const dialog = pending ? (
    <ReportDialog
      item={pending.item}
      initialPercent={pending.percent}
      settings={settings}
      onClose={() => setPending(undefined)}
      onSubmit={async (body) => {
        await submit(pending.item, body);
        setPending(undefined);
      }}
    />
  ) : null;

  return { setProgress, dialog };
}

function ReportDialog({
  item,
  initialPercent,
  settings,
  onClose,
  onSubmit,
}: {
  item: WorkItem;
  initialPercent: number;
  settings: ReportSettings;
  onClose: () => void;
  onSubmit: (body: { percent: number; description?: string; reportedOn?: string }) => Promise<void>;
}) {
  const [percent, setPercent] = useState(String(initialPercent));
  const [description, setDescription] = useState('');
  const [reportedOn, setReportedOn] = useState(today());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const value = Number(percent);
  const completing = value === 100;

  const save = async () => {
    setError(undefined);
    if (!percent.trim() || !Number.isInteger(value) || value < 0 || value > 100) {
      setError('Tiến độ phải là số nguyên từ 0 đến 100.');
      return;
    }
    if (value === 100 && settings.requireDescription && !description.trim()) {
      setError('Hãy ghi mô tả khi báo hoàn thành công việc.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ percent: value, description: description.trim() || undefined, reportedOn });
    } catch (cause) {
      setError(messageOf(cause, 'Không lưu được báo cáo tiến độ.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      title="Báo cáo tiến độ công việc"
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
