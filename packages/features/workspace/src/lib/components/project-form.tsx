'use client';

import {
  PROJECT_STATUSES,
  type CreateProjectRequest,
  type CrmCustomerOption,
  type CustomerSummary,
  type Project,
  type ProjectRole,
  type ProjectSummary,
  type ProjectTypeOption,
  type UpdateProjectRequest,
  type ProjectCodePreview,
} from '@enterprise-platform/contracts-workspace';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatVndWhileTyping, parseVndInput, toVndInput } from '../money';
import { orgUnitOptions } from '../org-units';
import {
  createCustomer,
  linkCrmCustomer,
  listCustomers,
  listProjectTypes,
  loadProjectArchiveSettings,
  previewProjectCode,
  searchCrmCustomers,
} from '../workspace-api';
import { PROJECT_STATUS_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';
import { PeoplePicker } from './people-picker';
import { TagPicker } from './tag-picker';
import { TaskTitleListEditor } from './task-title-list-editor';
import { useDirectory } from './use-directory';
import { roleOptions, useProjectRoles } from './use-project-roles';

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
  name: string;
  /** Phòng ban phụ trách: id đơn vị trên cây tổ chức; rỗng là chưa chọn. */
  orgUnitId: string;
  description: string;
  status: string;
  /** Khách hàng chủ quản (thực thể Workspace); rỗng nghĩa là chưa gắn. */
  customerId: string;
  projectType: string;
  tagIds: string[];
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
  name: '',
  orgUnitId: '',
  description: '',
  status: 'planning',
  customerId: '',
  projectType: '',
  tagIds: [],
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
  const projectRoles = useProjectRoles();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  /** Nhóm dự án trong danh mục (quản trị sửa ở Cài đặt). */
  const [types, setTypes] = useState<readonly ProjectTypeOption[]>([]);
  /** Khách hàng để chọn làm chủ quản của dự án. */
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  /** Mở phần tạo nhanh khách hàng mới ngay trong hộp dự án. */
  const [addCustomer, setAddCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ code: '', name: '' });
  const [customerError, setCustomerError] = useState<string>();
  const [savingCustomer, setSavingCustomer] = useState(false);
  /**
   * Tenant bật Bán hàng (D1): chọn khách từ Bán hàng thay cho danh mục Workspace.
   * Chọn một khách thì Workspace tạo (hoặc gắn) bản sao rồi dự án trỏ tới bản sao.
   */
  const [crmMode, setCrmMode] = useState(false);
  const [crmOptions, setCrmOptions] = useState<readonly CrmCustomerOption[]>([]);
  const [crmSearch, setCrmSearch] = useState('');
  const [linkingCustomer, setLinkingCustomer] = useState(false);
  /** "Thêm người" lúc tạo: bật mục rồi chọn người, mỗi người đặt vai trò riêng. */
  const [addPeople, setAddPeople] = useState(false);
  /** Mã dự kiến theo quy tắc ở Cài đặt (chỉ khi tạo); đổi nhóm dự án thì tính lại. */
  const [codePreview, setCodePreview] = useState<ProjectCodePreview>();
  const [newMembers, setNewMembers] = useState<Array<{ userId: string; role: ProjectRole }>>([]);
  /** Công việc tạo sẵn cùng dự án (chỉ khi tạo): lấy mẫu của tenant nếu bật, người tạo thêm hoặc bớt được. */
  const [initialTasks, setInitialTasks] = useState<string[]>([]);
  /** Đã biết cấu hình của tenant; chưa biết thì để server tự quyết khi gửi. */
  const [templateLoaded, setTemplateLoaded] = useState(false);
  /** Người dùng đã tự sửa danh sách: mẫu tải về chậm không được ghi đè. */
  const tasksTouched = useRef(false);

  useEffect(() => {
    if (!open) return;
    listProjectTypes()
      .then((result) => setTypes(result.items))
      .catch(() => setTypes([]));
    listCustomers()
      .then((items) => setCustomers(items))
      .catch(() => setCustomers([]));
  }, [open]);

  // Mỗi lần mở form tạo: nạp mẫu công việc tạo sẵn của tenant. Tắt thì danh sách rỗng, người tạo vẫn thêm tay được.
  useEffect(() => {
    if (!open || project) return;
    let alive = true;
    tasksTouched.current = false;
    setInitialTasks([]);
    setTemplateLoaded(false);
    loadProjectArchiveSettings()
      .then((settings) => {
        if (!alive) return;
        if (!tasksTouched.current) setInitialTasks(settings.defaultTasksEnabled ? [...settings.defaultTaskTitles] : []);
        setTemplateLoaded(true);
      })
      // Không đọc được cấu hình: coi như không có mẫu để danh sách thấy trên màn và danh sách gửi đi là một.
      .catch(() => alive && setTemplateLoaded(true));
    return () => {
      alive = false;
    };
  }, [open, project]);

  // Hỏi Bán hàng mỗi lần mở và khi gõ tìm (chờ một nhịp để không gọi mỗi phím). Tenant không bật Bán hàng thì
  // server trả `enabled = false`, form giữ danh mục Workspace như cũ.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = setTimeout(
      () =>
        void searchCrmCustomers(crmSearch.trim() || undefined)
          .then((result) => {
            if (!alive) return;
            setCrmMode(result.enabled);
            setCrmOptions(result.items);
          })
          .catch((cause) => {
            if (!alive) return;
            // Bán hàng tạm không trả lời: vẫn ở chế độ Bán hàng, báo lỗi để người dùng thử lại.
            const unavailable = (cause as { code?: string })?.code === 'CRM_UNAVAILABLE';
            setCrmMode(unavailable);
            setCrmOptions([]);
            if (unavailable) setCustomerError((cause as { message?: string })?.message);
          }),
      crmSearch ? 300 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, crmSearch]);

  useEffect(() => {
    if (!open || project) return;
    let alive = true;
    setCodePreview(undefined);
    previewProjectCode(form.projectType || undefined)
      .then((preview) => alive && setCodePreview(preview))
      .catch(() => alive && setCodePreview({ error: 'Không xem trước được mã dự án; mã vẫn được cấp khi lưu.' }));
    return () => {
      alive = false;
    };
  }, [open, project, form.projectType]);

  /** Phòng ban chọn được: các đơn vị trên cây tổ chức, kèm đường dẫn đơn vị cha. */
  const unitOptions = useMemo(() => orgUnitOptions(directory.orgNodes), [directory.orgNodes]);

  // Nạp lại mỗi lần mở, nếu không hộp thoại sẽ còn giữ giá trị của lần trước.
  useEffect(() => {
    if (!open) return;
    setForm(
      project
        ? {
            name: project.name,
            orgUnitId: project.orgUnitId ?? '',
            description: project.description ?? '',
            status: project.status,
            customerId: project.customerId ?? '',
            projectType: project.projectType ?? '',
            tagIds: [...(project.tagIds ?? [])],
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
    setAddCustomer(false);
    setNewCustomer({ code: '', name: '' });
    setCustomerError(undefined);
    setSavingCustomer(false);
    setCrmSearch('');
    setLinkingCustomer(false);
  }, [open, project]);

  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  /** Tạo nhanh một khách hàng rồi chọn luôn làm chủ quản của dự án. */
  const saveNewCustomer = async () => {
    const code = newCustomer.code.trim().toUpperCase();
    const name = newCustomer.name.trim();
    if (!code || !name) {
      setCustomerError('Nhập cả mã và tên khách hàng.');
      return;
    }
    setCustomerError(undefined);
    setSavingCustomer(true);
    try {
      const created = await createCustomer({ code, name });
      // Đưa vào danh sách ngay để SearchableSelect có nhãn hiển thị.
      setCustomers((current) => [
        { ...created, contractCount: 0, projectCount: 0 },
        ...current,
      ]);
      set({ customerId: created.id });
      setAddCustomer(false);
      setNewCustomer({ code: '', name: '' });
    } catch (cause) {
      setCustomerError((cause as { message?: string })?.message ?? 'Không tạo được khách hàng.');
    } finally {
      setSavingCustomer(false);
    }
  };

  /** Khách đang chọn (bản sao Workspace), để giữ nhãn khi nó không nằm trong kết quả tìm ở Bán hàng. */
  const selectedCustomer = customers.find((customer) => customer.id === form.customerId);
  const crmSelectValue = selectedCustomer?.crmCustomerId
    ? `crm:${selectedCustomer.crmCustomerId}`
    : form.customerId;
  const crmSelectOptions = useMemo(() => {
    const options = crmOptions.map((option) => ({
      value: `crm:${option.crmCustomerId}`,
      label: option.taxCode
        ? `${option.code} · ${option.name} · MST ${option.taxCode}`
        : `${option.code} · ${option.name}`,
    }));
    if (selectedCustomer && !options.some((option) => option.value === crmSelectValue)) {
      options.unshift({ value: crmSelectValue, label: `${selectedCustomer.code} · ${selectedCustomer.name}` });
    }
    return options;
  }, [crmOptions, selectedCustomer, crmSelectValue]);

  /** Chọn khách Bán hàng: đã có bản sao thì dùng luôn, chưa có thì nhờ Workspace tạo bản sao. */
  const chooseCrmCustomer = async (value: string) => {
    setCustomerError(undefined);
    if (!value.startsWith('crm:')) {
      set({ customerId: value });
      return;
    }
    const crmCustomerId = value.slice('crm:'.length);
    const known = customers.find((customer) => customer.crmCustomerId === crmCustomerId);
    if (known) {
      set({ customerId: known.id });
      return;
    }
    setLinkingCustomer(true);
    try {
      const copy = await linkCrmCustomer(crmCustomerId);
      setCustomers((current) => [
        { ...copy, contractCount: 0, projectCount: 0 },
        ...current.filter((customer) => customer.id !== copy.id),
      ]);
      set({ customerId: copy.id });
    } catch (cause) {
      setCustomerError((cause as { message?: string })?.message ?? 'Không chọn được khách hàng từ CRM.');
    } finally {
      setLinkingCustomer(false);
    }
  };

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
          // `null` gỡ khách hàng khỏi dự án khi người dùng xoá lựa chọn.
          customerId: form.customerId || null,
          projectType: form.projectType || null,
          orgUnitId: form.orgUnitId || null,
          tagIds: form.tagIds,
          // `null` xoá ngày đã đặt; `undefined` sẽ bị hiểu là "không đụng tới".
          startDate: form.startDate || null,
          endDate: form.endDate || null,
        }, contractValue);
      } else {
        const members = addPeople && newMembers.length > 0 ? newMembers : undefined;
        await onCreate({
          name: form.name,
          orgUnitId: form.orgUnitId || undefined,
          description: form.description || undefined,
          customerId: form.customerId || undefined,
          projectType: form.projectType || undefined,
          tagIds: form.tagIds,
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
          // Biết mẫu của tenant hoặc người dùng đã sửa thì gửi danh sách rõ ràng (rỗng là không tạo); chưa biết thì để
          // server theo cấu hình chung.
          initialTasks:
            templateLoaded || tasksTouched.current
              ? initialTasks.map((title) => title.trim()).filter(Boolean)
              : undefined,
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
      <Field label="Nhóm dự án" hint="Thêm hoặc sửa nhóm ở Cài đặt > Nhóm dự án.">
        <Choice
          label="Nhóm dự án"
          value={form.projectType}
          emptyOption="Chưa phân loại"
          options={[
            ...types.map((type) => ({ value: type.name, label: type.name })),
            // Nhóm đang gắn mà danh mục chưa tải xong vẫn hiện đúng tên.
            ...(form.projectType && !types.some((type) => type.name === form.projectType)
              ? [{ value: form.projectType, label: form.projectType }]
              : []),
          ]}
          onChange={(value) => set({ projectType: value })}
        />
      </Field>

      {project ? null : (
        <Field
          label="Mã dự án"
          hint="Cấp tự động khi lưu theo quy tắc ở Cài đặt > Mã dự án; không sửa được. Số có thể tăng nếu có người tạo dự án cùng dãy ngay trước bạn."
        >
          <input
            value={codePreview?.code ?? (codePreview ? '' : 'Đang tính…')}
            readOnly
            disabled
            aria-label="Mã dự án dự kiến"
          />
          {codePreview?.error ? (
            <p role="alert" className={styles.alert}>
              {codePreview.error}
            </p>
          ) : null}
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

      <Field
        label="Phòng ban phụ trách"
        hint="Đơn vị trên cây tổ chức chịu trách nhiệm dự án; không ảnh hưởng tới thành viên dự án."
      >
        <SearchableSelect
          options={[
            ...unitOptions,
            // Phòng ban đang gắn mà cây tổ chức chưa tải xong (hoặc đã bị xoá) vẫn hiện, không mất lựa chọn.
            ...(form.orgUnitId && !unitOptions.some((option) => option.value === form.orgUnitId)
              ? [{ value: form.orgUnitId, label: directory.loaded ? 'Đơn vị không còn trên cây tổ chức' : 'Đang tải…' }]
              : []),
          ]}
          value={form.orgUnitId}
          placeholder="Chọn phòng ban (gõ tên để lọc)…"
          emptyText={directory.degraded ? 'Không đọc được cây tổ chức lúc này.' : 'Không có đơn vị nào khớp.'}
          clearable
          onChange={(value) => set({ orgUnitId: value })}
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
          <DatePickerInput
            height={38}
            value={form.startDate}
            onChange={(value) => set({ startDate: value })}
          />
        </Field>
        <Field label="Ngày kết thúc">
          <DatePickerInput
            height={38}
            value={form.endDate}
            onChange={(value) => set({ endDate: value })}
          />
        </Field>
      </div>


      <Field label="Nhãn" hint="Gắn nhiều nhãn để lọc dự án trên trang Dự án.">
        <TagPicker selected={form.tagIds} onChange={(tagIds) => set({ tagIds })} />
      </Field>

      {crmMode ? (
        <Field
          label="Khách hàng"
          hint="Khách hàng chủ quản của dự án, lấy từ phân hệ CRM. Bỏ trống nếu chưa gắn."
        >
          <input
            value={crmSearch}
            placeholder="Tìm ở CRM theo mã, tên hoặc mã số thuế…"
            aria-label="Tìm khách hàng ở CRM"
            maxLength={100}
            onChange={(event) => setCrmSearch(event.target.value)}
          />
          <SearchableSelect
            options={crmSelectOptions}
            value={crmSelectValue}
            placeholder="Chọn khách hàng từ CRM…"
            emptyText="Không có khách hàng nào khớp ở CRM."
            disabled={linkingCustomer}
            clearable
            onChange={(value) => void chooseCrmCustomer(value)}
          />
          {customerError ? (
            <p role="alert" className={styles.alert}>
              {customerError}
            </p>
          ) : null}
          <a className={styles.linkButton} href="/modules/crm">
            <Plus size={13} /> Tạo khách hàng ở CRM
          </a>
        </Field>
      ) : (
      <Field label="Khách hàng" hint="Khách hàng chủ quản của dự án. Bỏ trống nếu chưa gắn.">
        <SearchableSelect
          options={customers.map((customer) => ({
            value: customer.id,
            label: `${customer.code} · ${customer.name}`,
          }))}
          value={form.customerId}
          placeholder="Chọn khách hàng (gõ mã hoặc tên để lọc)…"
          emptyText="Chưa có khách hàng nào khớp."
          clearable
          onChange={(value) => set({ customerId: value })}
        />
        {addCustomer ? (
          // Tạo nhanh khách hàng ngay trong hộp dự án, khỏi rời form rồi quay lại.
          <div className={styles.inlineCreate}>
            <div className={styles.fieldRow}>
              <input
                value={newCustomer.code}
                placeholder="Mã khách hàng"
                maxLength={32}
                aria-label="Mã khách hàng mới"
                onChange={(event) =>
                  setNewCustomer((current) => ({ ...current, code: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void saveNewCustomer();
                  }
                }}
              />
              <input
                value={newCustomer.name}
                placeholder="Tên khách hàng"
                maxLength={180}
                aria-label="Tên khách hàng mới"
                onChange={(event) =>
                  setNewCustomer((current) => ({ ...current, name: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void saveNewCustomer();
                  }
                }}
              />
            </div>
            {customerError ? (
              <p role="alert" className={styles.alert}>
                {customerError}
              </p>
            ) : null}
            <div className={styles.rowActions}>
              <button
                type="button"
                className={styles.buttonSmall}
                disabled={savingCustomer}
                onClick={() => void saveNewCustomer()}
              >
                {savingCustomer ? 'Đang lưu…' : 'Lưu khách hàng'}
              </button>
              <button
                type="button"
                className={styles.buttonGhost}
                onClick={() => {
                  setAddCustomer(false);
                  setCustomerError(undefined);
                }}
              >
                <X size={14} /> Huỷ
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => setAddCustomer(true)}
          >
            <Plus size={13} /> Tạo khách hàng mới
          </button>
        )}
      </Field>
      )}

      {/*
        Giá trị hợp đồng nhập ngay lúc lập dự án: đó là con số mọi báo cáo
        lợi nhuận dựa vào, và bắt người dùng tạo xong rồi mới mở tab Tài
        chính để điền là thừa một bước. Ô chỉ hiện với người được xem tài
        chính — server cũng chỉ nhận lệnh ghi từ chủ nhiệm và quản lý.
      */}
      {financeEnabled || project ? (
        <div className={styles.fieldRow}>
          {financeEnabled ? (
            <Field label="Giá trị hợp đồng (VND)" hint="Bỏ trống nếu chưa ký hợp đồng.">
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
      ) : null}

      {project ? null : (
        <Field
          label="Công việc tạo sẵn"
          hint={
            initialTasks.length > 0
              ? `Tạo sẵn ${initialTasks.filter((title) => title.trim()).length} công việc cấp gốc cùng dự án, chưa giao ai. Thêm, bớt hoặc đổi thứ tự cho dự án này; mẫu chung sửa ở Cài đặt > Cấu hình chung.`
              : 'Không bắt buộc: thêm các công việc cấp gốc để tạo sẵn cùng dự án. Mẫu chung sửa ở Cài đặt > Cấu hình chung.'
          }
        >
          <TaskTitleListEditor
            idPrefix="Công việc tạo sẵn"
            titles={initialTasks}
            emptyText="Chưa tạo sẵn công việc nào."
            onChange={(next) => {
              tasksTouched.current = true;
              setInitialTasks(next);
            }}
          />
        </Field>
      )}

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
                          options={roleOptions(projectRoles, true)}
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
