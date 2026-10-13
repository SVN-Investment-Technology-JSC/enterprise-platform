'use client';

import {
  PROJECT_ROLES,
  PROJECT_STATUSES,
  type CreateProjectRequest,
  type Project,
  type ProjectRole,
  type ProjectSummary,
  type ProjectTypeOption,
  type UpdateProjectRequest,
} from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { formatVndWhileTyping, parseVndInput, toVndInput } from '../money';
import { listProjectTypes } from '../workspace-api';
import { PROJECT_STATUS_LABELS, ROLE_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';
import { PeoplePicker } from './people-picker';
import { useDirectory } from './use-directory';

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
  /**
   * `members` là những người được thêm ngay lúc tạo (ngoài người tạo — người
   * tạo tự thành chủ nhiệm). Nơi gọi gán họ qua endpoint thành viên riêng,
   * cùng kiểu "đi đường riêng" như `contractValue`.
   */
  readonly onCreate: (
    input: CreateProjectRequest,
    contractValue?: number | null,
    members?: ReadonlyArray<{ readonly userId: string; readonly role: ProjectRole }>,
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
  projectType: string;
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
  projectType: '',
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
  const directory = useDirectory();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  /** Loại đã dùng trong tenant, gợi ý khi gõ để không sinh "Bảo trì" lẫn "bảo trì ". */
  const [types, setTypes] = useState<readonly ProjectTypeOption[]>([]);
  /** "Thêm người" lúc tạo: bật mục rồi chọn người, mỗi người đặt vai trò riêng. */
  const [addPeople, setAddPeople] = useState(false);
  const [newMembers, setNewMembers] = useState<Array<{ userId: string; role: ProjectRole }>>([]);

  useEffect(() => {
    if (!open) return;
    listProjectTypes()
      .then((result) => setTypes(result.items))
      .catch(() => setTypes([]));
  }, [open]);

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
            projectType: project.projectType ?? '',
            startDate: project.startDate ?? '',
            endDate: project.endDate ?? '',
            contractValue: toVndInput(project.finance?.contractValue),
          }
        : emptyForm(),
    );
    setError(undefined);
    setSubmitting(false);
    setAddPeople(false);
    setNewMembers([]);
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
          projectType: form.projectType.trim() || null,
          // `null` xoá ngày đã đặt; `undefined` sẽ bị hiểu là "không đụng tới".
          startDate: form.startDate || null,
          endDate: form.endDate || null,
        }, contractValue);
      } else {
        const members = addPeople && newMembers.length > 0 ? newMembers : undefined;
        await onCreate({
          code: form.code,
          name: form.name,
          description: form.description || undefined,
          customerRef: form.customerRef || undefined,
          projectType: form.projectType.trim() || undefined,
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
        }, contractValue, members);
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

      <Field label="Loại dự án" hint="Chọn loại đã có hoặc gõ loại mới.">
        <input
          value={form.projectType}
          maxLength={80}
          list="workspace-project-types"
          placeholder="Ví dụ: Dịch vụ thí nghiệm"
          onChange={(event) => set({ projectType: event.target.value })}
        />
        <datalist id="workspace-project-types">
          {types.map((type) => (
            <option key={type.name} value={type.name} />
          ))}
        </datalist>
      </Field>

      <div className={styles.fieldRow}>
        <Field label="Mã khách hàng">
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
            hint="Bỏ trống nếu chưa ký hợp đồng."
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

      {/*
        Thêm người ngay lúc lập dự án: người tạo luôn là chủ nhiệm. Mỗi người
        thêm vào đặt vai trò riêng (có thể khác nhau). Nếu đặt một người làm chủ
        nhiệm thì người tạo tự lùi về Quản lý để dự án vẫn có đúng một chủ nhiệm.
      */}
      {project ? null : (
        <>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={addPeople}
              onChange={(event) => setAddPeople(event.target.checked)}
            />
            Thêm người vào dự án ngay khi tạo
          </label>

          {addPeople ? (
            <>
              <Field label="Người tham gia" hint="Chọn người rồi đặt vai trò cho từng người bên dưới.">
                <PeoplePicker
                  people={directory.people}
                  selected={newMembers.map((member) => member.userId)}
                  onChange={(ids) =>
                    setNewMembers((prev) => {
                      const byId = new Map(prev.map((member) => [member.userId, member]));
                      return ids.map(
                        (userId) =>
                          byId.get(userId) ?? { userId, role: 'member' as ProjectRole },
                      );
                    })
                  }
                  nameOf={directory.nameOf}
                  placeholder="Tìm theo tên, chức danh hoặc đơn vị"
                  degraded={directory.degraded}
                  loaded={directory.loaded}
                />
              </Field>
              {newMembers.length > 0 ? (
                <ul className={styles.memberList}>
                  {newMembers.map((member) => (
                    <li key={member.userId}>
                      <span className={styles.memberName}>{directory.nameOf(member.userId)}</span>
                      <span className={styles.memberRole}>
                        <Choice
                          label={`Vai trò của ${directory.nameOf(member.userId)}`}
                          value={member.role}
                          options={PROJECT_ROLES.map((role) => ({
                            value: role,
                            label: ROLE_LABELS[role],
                          }))}
                          onChange={(value) =>
                            setNewMembers((prev) =>
                              prev.map((entry) =>
                                entry.userId === member.userId
                                  ? { ...entry, role: value as ProjectRole }
                                  : entry,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`Bỏ ${directory.nameOf(member.userId)}`}
                          onClick={() =>
                            setNewMembers((prev) =>
                              prev.filter((entry) => entry.userId !== member.userId),
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
