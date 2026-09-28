'use client';

import {
  PROJECT_STATUSES,
  type CreateProjectRequest,
  type Project,
  type ProjectSummary,
  type UpdateProjectRequest,
} from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { formatVndWhileTyping, parseVndInput, toVndInput } from '../money';
import { PROJECT_STATUS_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';

export interface ProjectFormProps {
  readonly open: boolean;
  /** Rỗng nghĩa là tạo mới; có nghĩa là sửa dự án đó. */
  readonly project?: ProjectSummary;
  readonly onClose: () => void;
  /**
   * `contractValue` ghi qua endpoint tài chính riêng, không đi chung payload
   * dự án: số tiền có hàng rào quyền riêng ở server. `undefined` nghĩa là
   * không đụng tới, `null` là xoá giá trị đang có.
   */
  readonly onCreate: (
    input: CreateProjectRequest,
    contractValue?: number | null,
  ) => Promise<void>;
  readonly onUpdate: (
    input: UpdateProjectRequest,
    contractValue?: number | null,
  ) => Promise<void>;
  /** Người dùng được xem và sửa tài chính dự án; tắt thì ẩn ô giá trị hợp đồng. */
  readonly financeEnabled?: boolean;
}

interface FormState {
  code: string;
  name: string;
  description: string;
  status: string;
  customerRef: string;
  startDate: string;
  endDate: string;
  /** Chuỗi người dùng gõ, có dấu chấm ngăn nghìn; đọc bằng `parseVndInput`. */
  contractValue: string;
}

/** Hôm nay theo múi giờ máy người dùng, dạng `YYYY-MM-DD` cho ô `type="date"`. */
function today(): string {
  const now = new Date();
  return [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Dự án mới mặc định bắt đầu và kết thúc trong hôm nay.
 *
 * Hai ô trống buộc người tạo phải mở lịch chọn tay hai lần cho một việc mà
 * phần lớn trường hợp chỉ cần sửa lại ngày kết thúc.
 */
const emptyForm = (): FormState => ({
  code: '',
  name: '',
  description: '',
  status: 'planning',
  customerRef: '',
  startDate: today(),
  endDate: today(),
  contractValue: '',
});

export function ProjectForm({
  open,
  project,
  onClose,
  onCreate,
  onUpdate,
  financeEnabled = false,
}: ProjectFormProps) {
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  // Nạp lại mỗi lần mở, nếu không hộp thoại sẽ còn giữ giá trị của lần trước.
  useEffect(() => {
    if (!open) return;
    setForm(
      project
        ? {
            code: project.code,
            name: project.name,
            description: project.description ?? '',
            status: project.status,
            customerRef: project.customerRef ?? '',
            startDate: project.startDate ?? '',
            endDate: project.endDate ?? '',
            contractValue: toVndInput(project.finance?.contractValue),
          }
        : emptyForm(),
    );
    setError(undefined);
    setSubmitting(false);
  }, [open, project]);

  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  const submit = async () => {
    setError(undefined);

    /*
     * Đọc ô giá trị hợp đồng.
     *
     * Chuỗi rỗng nghĩa là "không đặt": lúc tạo thì bỏ qua, lúc sửa thì xoá giá
     * trị cũ. Chuỗi không đọc được phải báo lỗi chứ không âm thầm lưu số sai.
     */
    let contractValue: number | null | undefined;
    if (financeEnabled) {
      const parsed = parseVndInput(form.contractValue);
      if (parsed === undefined) {
        setError('Giá trị hợp đồng: không đọc được số.');
        return;
      }
      if ((parsed ?? 0) < 0) {
        setError('Giá trị hợp đồng không được là số âm.');
        return;
      }
      contractValue = project ? parsed : (parsed ?? undefined);
    }

    setSubmitting(true);
    try {
      if (project) {
        await onUpdate({
          name: form.name,
          description: form.description || undefined,
          status: form.status as Project['status'],
          customerRef: form.customerRef || undefined,
          // `null` xoá ngày đã đặt; `undefined` sẽ bị hiểu là "không đụng tới".
          startDate: form.startDate || null,
          endDate: form.endDate || null,
        }, contractValue);
      } else {
        await onCreate({
          code: form.code,
          name: form.name,
          description: form.description || undefined,
          customerRef: form.customerRef || undefined,
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
        }, contractValue);
      }
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được dự án.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={project ? 'Sửa dự án' : 'Dự án mới'}
      subtitle={
        project ? `Mã dự án ${project.code} không thay đổi được.` : 'Người tạo tự thành chủ nhiệm.'
      }
      submitLabel={project ? 'Lưu thay đổi' : 'Tạo dự án'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {project ? null : (
        <Field label="Mã dự án" hint="Chữ in hoa, số và dấu gạch ngang. Ví dụ: DA-2026-001.">
          <input
            value={form.code}
            required
            maxLength={32}
            onChange={(event) => set({ code: event.target.value.toUpperCase() })}
          />
        </Field>
      )}

      <Field label="Tên dự án">
        <input
          value={form.name}
          required
          maxLength={180}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>

      <Field label="Mô tả">
        <textarea
          rows={3}
          value={form.description}
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>

      <div className={styles.fieldRow}>
        <Field label="Ngày bắt đầu">
          <input
            type="date"
            value={form.startDate}
            onChange={(event) => set({ startDate: event.target.value })}
          />
        </Field>
        <Field label="Ngày kết thúc">
          <input
            type="date"
            value={form.endDate}
            onChange={(event) => set({ endDate: event.target.value })}
          />
        </Field>
      </div>

      <div className={styles.fieldRow}>
        <Field label="Mã khách hàng" hint="Con trỏ sang CRM, chỉ để tra cứu.">
          <input
            value={form.customerRef}
            maxLength={160}
            onChange={(event) => set({ customerRef: event.target.value })}
          />
        </Field>
        {/*
          Giá trị hợp đồng nhập ngay lúc lập dự án: đó là con số mọi báo cáo
          lợi nhuận dựa vào, và bắt người dùng tạo xong rồi mới mở tab Tài
          chính để điền là thừa một bước. Ô chỉ hiện với người được xem tài
          chính — server cũng chỉ nhận lệnh ghi từ chủ nhiệm và quản lý.
        */}
        {financeEnabled ? (
          <Field
            label="Giá trị hợp đồng (VND)"
            hint="Dùng để tính lợi nhuận và tỉ suất ở tab Tài chính. Bỏ trống nếu chưa ký."
          >
            <input
              inputMode="decimal"
              value={form.contractValue}
              placeholder="Ví dụ 2.500.000.000"
              onChange={(event) =>
                set({ contractValue: formatVndWhileTyping(event.target.value) })
              }
            />
          </Field>
        ) : null}
        {project ? (
          <Field label="Trạng thái">
            <Choice
              label="Trạng thái"
              value={form.status}
              options={PROJECT_STATUSES.map((status) => ({
                value: status,
                label: PROJECT_STATUS_LABELS[status],
              }))}
              onChange={(value) => set({ status: value })}
            />
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
