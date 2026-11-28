'use client';

import {
  abbreviate,
  conditionSet,
  APPROVE_MODE_LABELS,
  APPROVER_RULE_LABELS,
  CATALOG_KINDS,
  CATALOG_KIND_LABELS,
  FLOW_END_NAMES,
  FLOW_START_NAMES,
  LETTER_DIRECTIONS,
  MAX_WORKFLOW_STEPS,
  NUMBER_TOKENS,
  numberFormatError,
  formatLetterNumber,
  PROCESS_MODE_LABELS,
  RETURN_TARGETS,
  STEP_TYPES,
  STEP_TYPE_LABELS,
  returnTargetLabel,
  type ApproverRule,
  type ApproverRuleType,
  type CatalogItem,
  type CatalogKind,
  type CorrespondenceConfig,
  type CorrespondenceDirectory,
  type LetterCondition,
  type LetterDirection,
  type Register,
  type ReturnTarget,
  type StepCondition,
  type StepType,
  type Workflow,
  type WorkflowStep,
} from '@enterprise-platform/contracts-correspondence';
import { Popconfirm, SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { ArrowDown, ArrowRight, ArrowUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { deleteCatalogItem, deleteRegister, deleteWorkflow, errorMessage, saveCatalogItem, saveRegister, saveWorkflow } from '../correspondence-api';
import { flowLabels } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { CheckGroup, Field, FormDialog, SelectField } from './form-dialog';
import { SettingsView } from './settings-view';

type ConfigTab = 'register' | 'catalog' | 'workflows' | 'organization';

const TABS: readonly { readonly id: ConfigTab; readonly label: string }[] = [
  { id: 'workflows', label: 'Quy trình duyệt' },
  { id: 'catalog', label: 'Danh mục' },
  { id: 'register', label: 'Sổ và đánh số' },
  { id: 'organization', label: 'Sơ đồ tổ chức' },
];

/**
 * Cấu hình văn thư: quy trình duyệt của công văn đến và công văn đi (các bước, ai duyệt theo
 * sơ đồ tổ chức, không đạt thì trả về đâu), danh mục (loại văn bản gắn quy trình và phòng ban
 * gợi ý, độ khẩn, độ mật), sổ và đánh số, xem sơ đồ tổ chức đang dùng.
 */
export function ConfigView({
  config,
  directory,
  onChanged,
}: {
  readonly config: CorrespondenceConfig;
  readonly directory?: CorrespondenceDirectory;
  readonly onChanged: () => void;
}) {
  const [tab, setTab] = useState<ConfigTab>('workflows');
  return (
    <div className={styles.page}>
      <div className={styles.tabs} role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? `${styles.chip} ${styles.chipOn}` : styles.chip}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'register' ? (
        <>
          <SettingsView settings={config.settings} directory={directory} onSaved={() => onChanged()} />
          <RegisterManager config={config} onChanged={onChanged} />
        </>
      ) : tab === 'catalog' ? (
        <CatalogManager config={config} directory={directory} onChanged={onChanged} />
      ) : tab === 'workflows' ? (
        <WorkflowManager config={config} directory={directory} onChanged={onChanged} />
      ) : (
        <OrganizationView directory={directory} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- điều kiện */

const CONDITION_FIELDS: readonly { readonly field: keyof LetterCondition; readonly kind: CatalogKind; readonly label: string }[] = [
  { field: 'kinds', kind: 'letter_type', label: 'Loại văn bản' },
  { field: 'urgency', kind: 'urgency', label: 'Độ khẩn' },
  { field: 'confidentiality', kind: 'confidentiality', label: 'Độ mật' },
];

/** "Độ khẩn: Hoả tốc; Độ mật: Mật, Tối mật". */
function conditionText(condition: LetterCondition | undefined, catalog: readonly CatalogItem[]): string {
  return CONDITION_FIELDS.filter(({ field }) => (condition?.[field]?.length ?? 0) > 0)
    .map(({ field, kind, label }) => {
      const names = (condition?.[field] ?? []).map((code) => catalog.find((item) => item.kind === kind && item.code === code)?.name ?? code);
      return `${label}: ${names.join(', ')}`;
    })
    .join('; ');
}

/** Điều kiện theo phân loại công văn: mỗi mục chọn nhiều giá trị, các mục cùng lúc là "và". */
function ConditionFields({
  value,
  catalog,
  prefix,
  onChange,
}: {
  readonly value: LetterCondition | undefined;
  readonly catalog: readonly CatalogItem[];
  readonly prefix: string;
  readonly onChange: (next: LetterCondition) => void;
}) {
  return (
    <div className={styles.formRow3}>
      {CONDITION_FIELDS.map(({ field, kind, label }) => (
        <MultiPick
          key={field}
          label={`${prefix}: ${label.toLowerCase()}`}
          required={false}
          options={catalog.filter((item) => item.kind === kind && item.isActive).map((item) => ({ value: item.code, label: item.name }))}
          values={value?.[field] ?? []}
          onChange={(values) => onChange({ ...value, [field]: values.length > 0 ? values : undefined })}
        />
      ))}
    </div>
  );
}

/** Bước luôn chạy, chỉ chạy khi, hay bỏ qua khi công văn khớp điều kiện. */
function StepConditionFields({
  condition,
  catalog,
  onChange,
}: {
  readonly condition: StepCondition | undefined;
  readonly catalog: readonly CatalogItem[];
  readonly onChange: (next: StepCondition | undefined) => void;
}) {
  const mode = condition ? (condition.skip ? 'skip' : 'only') : 'always';
  return (
    <>
      <SelectField label="Bước này chạy">
        <SearchableSelect
          options={[
            { value: 'always', label: 'Luôn chạy' },
            { value: 'only', label: 'Chỉ khi công văn khớp điều kiện' },
            { value: 'skip', label: 'Bỏ qua khi công văn khớp điều kiện' },
          ]}
          value={mode}
          searchInDropdown
          hideDropdownSearch
          onChange={(value) => {
            if (!value || value === 'always') onChange(undefined);
            else onChange({ ...(condition ?? {}), skip: value === 'skip' ? true : undefined });
          }}
        />
      </SelectField>
      {condition ? (
        <ConditionFields
          value={condition}
          catalog={catalog}
          prefix={condition.skip ? 'Bỏ qua khi' : 'Chỉ khi'}
          onChange={(next) => onChange({ ...next, skip: condition.skip })}
        />
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- sổ đăng ký */

/** Mẫu số: ô nhập, nút chèn từng phần, ví dụ số sẽ cấp. */
function NumberFormatField({
  label,
  value,
  optional = false,
  sample,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly optional?: boolean;
  readonly sample?: { readonly type?: string; readonly org?: string };
  readonly onChange: (value: string) => void;
}) {
  const error = value.trim() || !optional ? numberFormatError(value) : undefined;
  const example = value.trim() && !error
    ? formatLetterNumber(value, { seq: 5, year: new Date().getFullYear(), type: sample?.type || 'QĐ', org: sample?.org || 'SVN', unit: 'KD' })
    : undefined;
  return (
    <Field label={label} required={!optional}>
      <input value={value} maxLength={80} placeholder={optional ? 'Theo mẫu của sổ' : '{so}/{loai}-{coquan}'} onChange={(event) => onChange(event.target.value)} />
      <div className={styles.tokenList}>
        {NUMBER_TOKENS.map((item) => (
          <button key={item.token} type="button" className={styles.chip} title={item.label} onClick={() => onChange(`${value}${item.token}`)}>
            {item.token}
          </button>
        ))}
      </div>
      <span className={error ? styles.notice : styles.hint}>{error ?? (example ? `Ví dụ: ${example}` : 'Bấm để chèn từng phần; trống là theo mẫu của sổ.')}</span>
    </Field>
  );
}

/**
 * Sổ đăng ký văn bản đến / đi: mỗi sổ cấp số riêng theo năm, theo mẫu số của sổ. Văn bản có độ mật vào
 * sổ mật; sổ ghi loại văn bản thì chỉ nhận loại đó; không sổ nào hợp thì vào sổ mặc định.
 */
function RegisterManager({ config, onChanged }: { readonly config: CorrespondenceConfig; readonly onChanged: () => void }) {
  const [editing, setEditing] = useState<{ direction: LetterDirection; register?: Register }>();
  const typeName = new Map(config.catalog.filter((item) => item.kind === 'letter_type').map((item) => [item.code, item.name]));
  const remove = async (register: Register) => {
    try {
      await deleteRegister(register.id);
      toast.success(`Đã xoá ${register.name}.`);
      onChanged();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không xoá được.'));
    }
  };
  return (
    <>
      {LETTER_DIRECTIONS.map((direction) => (
        <section key={direction} className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Sổ đăng ký {direction === 'incoming' ? 'công văn đến' : 'công văn đi'}</h2>
            <button type="button" className={styles.buttonSmall} onClick={() => setEditing({ direction })}>
              <Plus size={13} /> Thêm sổ
            </button>
          </div>
          <div className={styles.list}>
            {config.registers
              .filter((register) => register.direction === direction)
              .map((register) => (
                <div key={register.id} className={styles.listRow}>
                  <div className={styles.listMain}>
                    <b>{register.name}</b>{' '}
                    {register.isDefault ? <span className={`${styles.tag} ${styles['tone-info']}`}>Mặc định</span> : null}{' '}
                    {register.confidential ? <span className={`${styles.tag} ${styles['tone-warning']}`}>Sổ mật</span> : null}{' '}
                    {!register.isActive ? <span className={`${styles.tag} ${styles['tone-muted']}`}>Ngừng dùng</span> : null}
                    <p>
                      Mẫu số {register.numberFormat}, ví dụ{' '}
                      {formatLetterNumber(register.numberFormat, {
                        seq: register.issuedThisYear + 1,
                        year: new Date().getFullYear(),
                        type: 'QĐ',
                        org: config.settings.orgCode || undefined,
                        unit: 'KD',
                      })}
                      {' · '}Đã cấp năm nay: {register.issuedThisYear}
                      {register.letterTypes.length > 0 ? ` · Loại văn bản: ${register.letterTypes.map((code) => typeName.get(code) ?? code).join(', ')}` : ''}
                    </p>
                  </div>
                  <div className={styles.listActions}>
                    <button type="button" className={styles.buttonSmall} onClick={() => setEditing({ direction, register })}>
                      <Pencil size={13} /> Sửa
                    </button>
                    {!register.isDefault && !register.inUse ? (
                      <Popconfirm
                        title={`Xoá "${register.name}"?`}
                        description="Chỉ xoá được sổ chưa có công văn nào."
                        okText="Xoá"
                        okType="danger"
                        placement="left"
                        onConfirm={() => remove(register)}
                      >
                        <button type="button" className={styles.buttonSmall} aria-label={`Xoá ${register.name}`}>
                          <Trash2 size={13} />
                        </button>
                      </Popconfirm>
                    ) : null}
                  </div>
                </div>
              ))}
          </div>
        </section>
      ))}
      {editing ? (
        <RegisterDialog
          direction={editing.direction}
          register={editing.register}
          config={config}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function RegisterDialog({
  direction,
  register,
  config,
  onClose,
  onSaved,
}: {
  readonly direction: LetterDirection;
  readonly register?: Register;
  readonly config: CorrespondenceConfig;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const initial = useMemo(
    () => ({
      name: register?.name ?? '',
      numberFormat: register?.numberFormat ?? (direction === 'incoming' ? '{so}/CVĐ' : '{so}/{loai}-{coquan}'),
      confidential: register?.confidential ?? false,
      letterTypes: register?.letterTypes ?? ([] as readonly string[]),
      isDefault: register?.isDefault ?? false,
      isActive: register?.isActive ?? true,
    }),
    [register, direction],
  );
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await saveRegister(register?.id, { direction, ...form, sortOrder: register?.sortOrder });
      toast.success('Đã lưu sổ đăng ký.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog
      open
      title={`${register ? 'Sửa' : 'Thêm'} sổ đăng ký ${direction === 'incoming' ? 'công văn đến' : 'công văn đi'}`}
      subtitle={register?.inUse ? 'Sổ đã có công văn: đổi mẫu số chỉ áp dụng cho số cấp sau khi lưu.' : undefined}
      submitLabel="Lưu"
      submitting={busy}
      submitDisabled={!dirty || !form.name.trim() || Boolean(numberFormatError(form.numberFormat))}
      dirty={dirty}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tên sổ" required>
        <input value={form.name} maxLength={160} placeholder="Ví dụ: Sổ văn bản mật đến" onChange={(event) => set('name', event.target.value)} />
      </Field>
      <NumberFormatField label="Mẫu số" value={form.numberFormat} sample={{ org: config.settings.orgCode }} onChange={(value) => set('numberFormat', value)} />
      <MultiPick
        label="Chỉ nhận các loại văn bản (trống là mọi loại)"
        required={false}
        options={config.catalog.filter((item) => item.kind === 'letter_type' && item.isActive).map((item) => ({ value: item.code, label: item.name }))}
        values={form.letterTypes}
        onChange={(values) => set('letterTypes', values)}
      />
      <CheckGroup label="Tuỳ chọn">
        <label className={styles.checkRow}>
          <input type="checkbox" checked={form.confidential} disabled={form.isDefault} onChange={(event) => set('confidential', event.target.checked)} />
          Sổ văn bản mật: văn bản có độ mật vào sổ này, cấp số riêng
        </label>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={form.isDefault} disabled={form.confidential || Boolean(register?.isDefault)} onChange={(event) => set('isDefault', event.target.checked)} />
          Sổ mặc định của {direction === 'incoming' ? 'công văn đến' : 'công văn đi'} (văn bản không hợp sổ nào khác)
        </label>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={form.isActive} disabled={form.isDefault} onChange={(event) => set('isActive', event.target.checked)} />
          Đang dùng
        </label>
      </CheckGroup>
    </FormDialog>
  );
}

/* ---------------------------------------------------------------- danh mục */

function CatalogManager({
  config,
  directory,
  onChanged,
}: {
  readonly config: CorrespondenceConfig;
  readonly directory?: CorrespondenceDirectory;
  readonly onChanged: () => void;
}) {
  const [editing, setEditing] = useState<{ kind: CatalogKind; item?: CatalogItem }>();
  const remove = async (item: CatalogItem) => {
    try {
      await deleteCatalogItem(item.id);
      toast.success(`Đã xoá ${item.name}.`);
      onChanged();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không xoá được.'));
    }
  };
  return (
    <>
      {CATALOG_KINDS.map((kind) => {
        const items = config.catalog
          .filter((item) => item.kind === kind)
          .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'vi'));
        return (
          <section key={kind} className={styles.card}>
            <div className={styles.cardHead}>
              <h2>{CATALOG_KIND_LABELS[kind]}</h2>
              <button type="button" className={styles.buttonSmall} onClick={() => setEditing({ kind })}>
                <Plus size={13} /> Thêm
              </button>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table} style={{ minWidth: 560 }}>
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Tên</th>
                    <th>{kind === 'letter_type' ? 'Hạn · Quy trình đến · Quy trình đi' : kind === 'urgency' ? 'Tô đỏ' : 'Chỉ người liên quan'}</th>
                    <th>Trạng thái</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} style={{ cursor: 'default' }}>
                      <td className={styles.code}>{item.code}</td>
                      <td>{item.name}</td>
                      <td>
                        {kind === 'letter_type'
                          ? `${item.defaultDueDays !== undefined ? `${item.defaultDueDays} ngày` : 'Theo sổ'} · ${
                              config.workflows.find((workflow) => workflow.id === item.workflowId)?.name ?? 'Mặc định'
                            } · ${config.workflows.find((workflow) => workflow.id === item.outgoingWorkflowId)?.name ?? 'Mặc định'}`
                          : kind === 'urgency'
                            ? item.highlight ? 'Có' : 'Không'
                            : item.restricted ? 'Có' : 'Không'}
                      </td>
                      <td>
                        <span className={`${styles.tag} ${styles[item.isActive ? 'tone-success' : 'tone-muted']}`}>
                          {item.isActive ? 'Đang dùng' : 'Ngừng dùng'}
                        </span>
                      </td>
                      <td>
                        <div className={styles.listActions}>
                          <button type="button" className={styles.buttonSmall} onClick={() => setEditing({ kind, item })}>
                            <Pencil size={13} /> Sửa
                          </button>
                          {!item.inUse ? (
                            <Popconfirm
                              title={`Xoá "${item.name}"?`}
                              description="Mục chưa có công văn nào dùng nên xoá được hẳn."
                              okText="Xoá"
                              okType="danger"
                              placement="left"
                              onConfirm={() => remove(item)}
                            >
                              <button type="button" className={styles.buttonSmall} aria-label={`Xoá ${item.name}`}>
                                <Trash2 size={13} />
                              </button>
                            </Popconfirm>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 ? <div className={styles.empty}>Chưa có mục nào.</div> : null}
            </div>
          </section>
        );
      })}
      {editing ? (
        <CatalogDialog
          kind={editing.kind}
          item={editing.item}
          workflows={config.workflows}
          directory={directory}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function CatalogDialog({
  kind,
  item,
  workflows,
  directory,
  onClose,
  onSaved,
}: {
  readonly kind: CatalogKind;
  readonly item?: CatalogItem;
  readonly workflows: readonly Workflow[];
  readonly directory?: CorrespondenceDirectory;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const initial = useMemo(
    () => ({
      code: item?.code ?? '',
      name: item?.name ?? '',
      sortOrder: String(item?.sortOrder ?? 0),
      isActive: item?.isActive ?? true,
      defaultDueDays: item?.defaultDueDays === undefined ? '' : String(item.defaultDueDays),
      workflowId: item?.workflowId ?? '',
      outgoingWorkflowId: item?.outgoingWorkflowId ?? '',
      defaultUnitIds: item?.defaultUnitIds ?? ([] as readonly string[]),
      highlight: item?.highlight ?? false,
      restricted: item?.restricted ?? false,
      abbreviation: item?.abbreviation ?? '',
      numberFormat: item?.numberFormat ?? '',
    }),
    [item],
  );
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const workflowOptions = (direction: LetterDirection) =>
    workflows
      .filter((workflow) => workflow.isActive && workflow.direction === direction)
      .map((workflow) => ({ value: workflow.id, label: workflow.name, description: workflow.steps.map((step) => step.name).join(' → ') || 'Không cần duyệt' }));

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await saveCatalogItem(item?.id, {
        kind,
        code: form.code,
        name: form.name,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
        defaultDueDays: form.defaultDueDays === '' ? null : Number(form.defaultDueDays),
        workflowId: form.workflowId || null,
        outgoingWorkflowId: form.outgoingWorkflowId || null,
        defaultUnitIds: form.defaultUnitIds,
        highlight: form.highlight,
        restricted: form.restricted,
        abbreviation: form.abbreviation.trim() || null,
        numberFormat: form.numberFormat.trim() || null,
      });
      toast.success('Đã lưu danh mục.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open
      title={`${item ? 'Sửa' : 'Thêm'} ${CATALOG_KIND_LABELS[kind].toLowerCase()}`}
      subtitle={item?.inUse ? 'Mục đã có công văn dùng: không đổi được mã, chỉ đổi tên hoặc ngừng dùng.' : undefined}
      submitLabel="Lưu"
      submitting={busy}
      submitDisabled={!dirty || !form.code.trim() || !form.name.trim()}
      dirty={dirty}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.formRow}>
        <Field label="Mã" required>
          <input
            value={form.code}
            maxLength={40}
            disabled={Boolean(item?.inUse)}
            placeholder="vd: hop-dong"
            onChange={(event) => set('code', event.target.value.toLowerCase())}
          />
        </Field>
        <Field label="Tên" required>
          <input value={form.name} maxLength={120} onChange={(event) => set('name', event.target.value)} />
        </Field>
      </div>
      {kind === 'letter_type' ? (
        <>
          <Field label="Hạn xử lý mặc định (ngày)">
            <input
              type="number"
              min={0}
              max={365}
              value={form.defaultDueDays}
              placeholder="Theo cấu hình sổ"
              onChange={(event) => set('defaultDueDays', event.target.value)}
            />
          </Field>
          <div className={styles.formRow}>
            <Field label="Ký hiệu viết tắt">
              <input
                value={form.abbreviation}
                maxLength={20}
                placeholder={abbreviate(form.name) || 'QĐ'}
                onChange={(event) => set('abbreviation', event.target.value)}
              />
              <span className={styles.hint}>Phần {'{loai}'} trong số văn bản; trống là chữ cái đầu của tên.</span>
            </Field>
            <NumberFormatField
              label="Mẫu số riêng khi ban hành"
              value={form.numberFormat}
              optional
              sample={{ type: form.abbreviation || abbreviate(form.name) }}
              onChange={(value) => set('numberFormat', value)}
            />
          </div>
          <div className={styles.formRow}>
            <SelectField label="Quy trình duyệt công văn đến">
              <SearchableSelect
                options={workflowOptions('incoming')}
                value={form.workflowId}
                placeholder="Quy trình mặc định của công văn đến"
                clearable
                onChange={(value) => set('workflowId', value)}
              />
            </SelectField>
            <SelectField label="Quy trình duyệt công văn đi">
              <SearchableSelect
                options={workflowOptions('outgoing')}
                value={form.outgoingWorkflowId}
                placeholder="Quy trình mặc định của công văn đi"
                clearable
                onChange={(value) => set('outgoingWorkflowId', value)}
              />
            </SelectField>
          </div>
          <MultiPick
            label="Phòng ban gợi ý khi văn thư giao xử lý"
            required={false}
            options={(directory?.units ?? []).map((unit) => ({ value: unit.id, label: unit.name, description: unit.path || undefined }))}
            values={form.defaultUnitIds}
            onChange={(values) => set('defaultUnitIds', values)}
          />
        </>
      ) : null}
      <div className={styles.formRow}>
        <Field label="Thứ tự">
          <input type="number" value={form.sortOrder} onChange={(event) => set('sortOrder', event.target.value)} />
        </Field>
        <CheckGroup label="Trạng thái">
          <label className={styles.checkRow}>
            <input type="checkbox" checked={form.isActive} onChange={(event) => set('isActive', event.target.checked)} /> Đang dùng
          </label>
          {kind === 'urgency' ? (
            <label className={styles.checkRow}>
              <input type="checkbox" checked={form.highlight} onChange={(event) => set('highlight', event.target.checked)} /> Tô đỏ trong
              danh sách
            </label>
          ) : null}
          {kind === 'confidentiality' ? (
            <label className={styles.checkRow}>
              <input type="checkbox" checked={form.restricted} onChange={(event) => set('restricted', event.target.checked)} /> Chỉ người
              liên quan và người có quyền xem công văn mật thấy
            </label>
          ) : null}
        </CheckGroup>
      </div>
    </FormDialog>
  );
}

/* ---------------------------------------------------------------- quy trình */

function WorkflowManager({
  config,
  directory,
  onChanged,
}: {
  readonly config: CorrespondenceConfig;
  readonly directory?: CorrespondenceDirectory;
  readonly onChanged: () => void;
}) {
  const [editing, setEditing] = useState<{ direction: LetterDirection; workflow?: Workflow }>();
  const remove = async (workflow: Workflow) => {
    try {
      await deleteWorkflow(workflow.id);
      toast.success(`Đã xoá ${workflow.name}.`);
      onChanged();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không xoá được.'));
    }
  };
  return (
    <>
      {LETTER_DIRECTIONS.map((direction) => {
        const items = config.workflows.filter((workflow) => workflow.direction === direction);
        return (
          <section key={direction} className={styles.card}>
            <div className={styles.cardHead}>
              <h2>Quy trình {direction === 'incoming' ? 'công văn đến' : 'công văn đi'}</h2>
              <button type="button" className={styles.buttonSmall} onClick={() => setEditing({ direction })}>
                <Plus size={13} /> Thêm quy trình
              </button>
            </div>
            <p className={styles.sectionNote}>Sửa quy trình không đổi công văn đã chuyển bước.</p>
            <div className={styles.list}>
              {items.length === 0 ? <p className={styles.muted}>Chưa có quy trình nào.</p> : null}
              {items.map((workflow) => (
                <div key={workflow.id} className={styles.listRow}>
                  <div className={styles.listMain}>
                    <b>{workflow.name}</b>{' '}
                    {workflow.isDefault ? <span className={`${styles.tag} ${styles['tone-info']}`}>Mặc định</span> : null}{' '}
                    {!workflow.isActive ? <span className={`${styles.tag} ${styles['tone-muted']}`}>Ngừng dùng</span> : null}
                    <div className={styles.stepChips}>
                      {flowLabels(workflow, direction).map((label, index, all) => (
                        <span key={`${index}-${label}`} className={index === 0 || index === all.length - 1 ? styles.stepChipFixed : styles.stepChip}>
                          {label}
                        </span>
                      ))}
                    </div>
                    {conditionSet(workflow.conditions) ? <p>Áp dụng khi: {conditionText(workflow.conditions, config.catalog)}</p> : null}
                    {workflow.description ? <p>{workflow.description}</p> : null}
                  </div>
                  <div className={styles.listActions}>
                    <button type="button" className={styles.buttonSmall} onClick={() => setEditing({ direction, workflow })}>
                      <Pencil size={13} /> Sửa
                    </button>
                    {!workflow.isDefault ? (
                      <Popconfirm
                        title={`Xoá "${workflow.name}"?`}
                        description="Chỉ xoá được quy trình chưa có công văn hay loại văn bản nào dùng."
                        okText="Xoá"
                        okType="danger"
                        placement="left"
                        onConfirm={() => remove(workflow)}
                      >
                        <button type="button" className={styles.buttonSmall} aria-label={`Xoá ${workflow.name}`}>
                          <Trash2 size={13} />
                        </button>
                      </Popconfirm>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {editing ? (
        <WorkflowDialog
          direction={editing.direction}
          workflow={editing.workflow}
          directory={directory}
          catalog={config.catalog}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

const RULE_TYPES: readonly ApproverRuleType[] = ['choose', 'users', 'positions', 'unit_heads', 'handling_unit_heads'];
/** Ô cuối không có ai "chọn trong nhóm" lúc chuyển tới. */
const END_RULE_TYPES: readonly ApproverRuleType[] = ['users', 'positions', 'unit_heads', 'handling_unit_heads'];

function blankStep(type: StepType, index: number): WorkflowStep {
  const key = `step-${Date.now().toString(36)}-${index}`;
  if (type !== 'approve') return { key, name: STEP_TYPE_LABELS[type], type };
  return { key, name: index === 0 ? 'Trưởng phòng duyệt' : 'Lãnh đạo duyệt', type, approver: { type: 'choose', pool: 'leaders' } };
}

/** Quy trình mới: theo đúng luồng quen thuộc của từng hướng, sửa thêm tuỳ ý. */
function starterSteps(direction: LetterDirection): WorkflowStep[] {
  return direction === 'incoming'
    ? [
        blankStep('process', 0),
        { ...blankStep('approve', 1), name: 'Trưởng phòng kiểm tra', approver: { type: 'handling_unit_heads' } },
        blankStep('approve', 2),
      ]
    : [
        blankStep('check', 0),
        { ...blankStep('approve', 1), name: 'Trưởng phòng soạn thảo duyệt', approver: { type: 'handling_unit_heads' } },
        blankStep('approve', 2),
      ];
}

function ruleFor(type: ApproverRuleType, current: ApproverRule): ApproverRule {
  if (type === current.type) return current;
  switch (type) {
    case 'choose':
      return { type, pool: 'leaders' };
    case 'users':
      return { type, userIds: [] };
    case 'positions':
      return { type, positionIds: [] };
    case 'unit_heads':
      return { type, unitIds: [] };
    default:
      return { type: 'handling_unit_heads' };
  }
}

function WorkflowDialog({
  direction,
  workflow,
  directory,
  catalog = [],
  onClose,
  onSaved,
}: {
  readonly direction: LetterDirection;
  readonly workflow?: Workflow;
  readonly directory?: CorrespondenceDirectory;
  /** Danh mục, để đặt điều kiện theo loại văn bản, độ khẩn, độ mật. */
  readonly catalog?: readonly CatalogItem[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const initial = useMemo(
    () => ({
      name: workflow?.name ?? '',
      description: workflow?.description ?? '',
      isActive: workflow?.isActive ?? true,
      isDefault: workflow?.isDefault ?? false,
      startName: workflow?.startName ?? '',
      endName: workflow?.endName ?? '',
      autoStart: workflow?.autoStart ?? false,
      endActor: workflow?.endActor ?? null,
      autoEnd: workflow?.autoEnd ?? false,
      archive: workflow?.archive ?? true,
      conditions: workflow?.conditions ?? ({} as LetterCondition),
      steps: workflow?.steps ?? starterSteps(direction),
    }),
    [workflow, direction],
  );
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const setStep = (index: number, patch: Partial<WorkflowStep>) =>
    setForm((current) => ({ ...current, steps: current.steps.map((step, at) => (at === index ? { ...step, ...patch } : step)) }));
  const move = (index: number, delta: number) =>
    setForm((current) => {
      const steps = [...current.steps];
      const target = index + delta;
      if (target < 0 || target >= steps.length) return current;
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps };
    });

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await saveWorkflow(workflow?.id, {
        name: form.name,
        description: form.description || undefined,
        direction,
        isActive: form.isActive,
        isDefault: form.isDefault,
        startName: form.startName.trim() || undefined,
        endName: form.endName.trim() || undefined,
        autoStart: form.autoStart,
        endActor: form.autoEnd ? null : form.endActor,
        autoEnd: form.autoEnd,
        archive: form.archive,
        steps: form.steps,
        conditions: conditionSet(form.conditions) ? form.conditions : null,
      });
      toast.success('Đã lưu quy trình.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được quy trình.'));
    } finally {
      setBusy(false);
    }
  };

  const unitOptions = (directory?.units ?? []).map((unit) => ({ value: unit.id, label: unit.name, description: unit.path || undefined }));
  const positionOptions = (directory?.positions ?? []).map((position) => ({
    value: position.id,
    label: position.name,
    description: [position.unitName, position.holderNames.join(', ') || 'đang trống'].filter(Boolean).join(' · '),
  }));
  const peopleOptions = (directory?.people ?? []).map((person) => ({ value: person.userId, label: person.name }));
  const addStep = (type: StepType) =>
    setForm((current) => ({ ...current, steps: [...current.steps, blankStep(type, current.steps.length)] }));
  const changeType = (index: number, type: StepType) =>
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step, at) => {
        if (at !== index || (step.type ?? 'approve') === type) return step;
        const fresh = blankStep(type, at);
        // Tên đang là tên mặc định của loại cũ thì đổi theo loại mới; tên tự đặt thì giữ.
        const defaultName = (Object.values(STEP_TYPE_LABELS) as string[]).includes(step.name) || !step.name;
        return { ...fresh, key: step.key, name: defaultName ? fresh.name : step.name, dueDays: step.dueDays };
      }),
    }));
  const preview = flowLabels({ startName: form.startName, endName: form.endName, steps: form.steps }, direction);
  // Ô có bước phòng ban xử lý liền sau (ô đầu là -1): người làm ô đó chọn phòng ban. Tick là tự chèn bước đó, bỏ tick là bỏ.
  const assignsNext = (index: number) => form.steps[index + 1]?.type === 'process';
  const setAssignsNext = (index: number, on: boolean) =>
    setForm((current) => {
      const steps = [...current.steps];
      const next = steps[index + 1];
      if (on && next?.type !== 'process' && steps.length < MAX_WORKFLOW_STEPS) steps.splice(index + 1, 0, blankStep('process', index + 1));
      else if (!on && next?.type === 'process') steps.splice(index + 1, 1);
      else return current;
      return { ...current, steps };
    });
  const assignNextRow = (index: number) => (
    <label className={styles.checkRow}>
      <input
        type="checkbox"
        checked={assignsNext(index)}
        disabled={!assignsNext(index) && form.steps.length >= MAX_WORKFLOW_STEPS}
        onChange={(event) => setAssignsNext(index, event.target.checked)}
      />
      Giao phòng ban xử lý ({index < 0 ? 'văn thư' : 'người làm bước này'} chọn phòng ban)
    </label>
  );

  return (
    <FormDialog
      open
      wide
      title={`${workflow ? 'Sửa' : 'Thêm'} quy trình ${direction === 'incoming' ? 'công văn đến' : 'công văn đi'}`}
      submitLabel="Lưu quy trình"
      submitting={busy}
      submitDisabled={!dirty || !form.name.trim()}
      dirty={dirty}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.formRow}>
        <Field label="Tên quy trình" required>
          <input value={form.name} maxLength={160} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </Field>
        <CheckGroup label="Trạng thái">
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
            />{' '}
            Đang dùng
          </label>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))}
            />{' '}
            Mặc định cho {direction === 'incoming' ? 'công văn đến' : 'công văn đi'} (khi loại văn bản chưa gắn quy trình)
          </label>
        </CheckGroup>
      </div>
      <Field label="Mô tả">
        <textarea
          value={form.description}
          maxLength={2000}
          rows={2}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
        />
      </Field>
      <fieldset className={styles.fieldset}>
        <legend>Áp dụng khi (trống là theo loại văn bản / quy trình mặc định)</legend>
        <ConditionFields
          value={form.conditions}
          catalog={catalog}
          prefix="Áp dụng khi"
          onChange={(conditions) => setForm((current) => ({ ...current, conditions }))}
        />
        <span className={styles.hint}>Khớp điều kiện thì dùng quy trình này trước quy trình theo loại văn bản.</span>
      </fieldset>
      <div className={styles.flowPreview} aria-label="Luồng xử lý">
        {preview.map((label, index, all) => (
          <span key={`${index}-${label}`} className={index > 0 && index < all.length - 1 ? styles.flowPreviewStep : undefined}>
            {label}
            {index < all.length - 1 ? <ArrowRight size={12} /> : null}
          </span>
        ))}
      </div>
      {directory?.degraded ? <p className={styles.notice}>Chưa đọc được sơ đồ tổ chức; danh sách phòng ban, chức danh có thể thiếu.</p> : null}
      <div className={`${styles.stepEditor} ${styles.stepEditorFixed}`}>
        <div className={styles.stepEditorHead}>
          <b>Ô đầu · {direction === 'incoming' ? 'tiếp nhận, vào sổ' : 'soạn thảo'}</b>
        </div>
        <div className={styles.formRow}>
          <Field label="Tên ô đầu">
            <input
              value={form.startName}
              maxLength={160}
              placeholder={FLOW_START_NAMES[direction]}
              onChange={(event) => setForm((current) => ({ ...current, startName: event.target.value }))}
            />
          </Field>
          {direction === 'incoming' ? (
            <CheckGroup label="Chuyển bước">
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={form.autoStart}
                  onChange={(event) => setForm((current) => ({ ...current, autoStart: event.target.checked }))}
                />
                Vào sổ xong tự chuyển sang bước đầu
              </label>
              {assignNextRow(-1)}
            </CheckGroup>
          ) : null}
        </div>
      </div>
      {form.steps.length === 0 ? (
        <p className={styles.sectionNote}>Chưa có bước nào ở giữa.</p>
      ) : null}
      {form.steps.map((step, index) => {
        const type = step.type ?? 'approve';
        return (
        <div key={step.key} className={styles.stepEditor}>
          <div className={styles.stepEditorHead}>
            <b>
              Bước {index + 1} · {STEP_TYPE_LABELS[type]}
            </b>
            <div className={styles.listActions}>
              <button type="button" className={styles.buttonSmall} aria-label="Lên" disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                className={styles.buttonSmall}
                aria-label="Xuống"
                disabled={index === form.steps.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={13} />
              </button>
              <button
                type="button"
                className={styles.buttonSmall}
                aria-label="Bỏ bước"
                onClick={() => setForm((current) => ({ ...current, steps: current.steps.filter((_, at) => at !== index) }))}
              >
                <X size={13} />
              </button>
            </div>
          </div>
          <div className={styles.formRow}>
            <SelectField label="Loại bước" required>
              <SearchableSelect
                options={STEP_TYPES.map((value) => ({ value, label: STEP_TYPE_LABELS[value] }))}
                value={type}
                searchInDropdown
                hideDropdownSearch
                onChange={(value) => value && changeType(index, value as StepType)}
              />
            </SelectField>
            <Field label="Tên bước" required>
              <input value={step.name} maxLength={160} onChange={(event) => setStep(index, { name: event.target.value })} />
            </Field>
          </div>
          {type === 'approve' && step.approver ? (
            <>
              <SelectField label="Người duyệt" required>
                <SearchableSelect
                  options={RULE_TYPES.map((value) => ({ value, label: APPROVER_RULE_LABELS[value] }))}
                  value={step.approver.type}
                  searchInDropdown
                  hideDropdownSearch
                  onChange={(value) => value && step.approver && setStep(index, { approver: ruleFor(value as ApproverRuleType, step.approver) })}
                />
              </SelectField>
              <RuleDetail
                rule={step.approver}
                unitOptions={unitOptions}
                positionOptions={positionOptions}
                peopleOptions={peopleOptions}
                onChange={(approver) => setStep(index, { approver })}
              />
              <SelectField label="Cách duyệt">
                <SearchableSelect
                  options={(['any', 'all'] as const).map((value) => ({ value, label: APPROVE_MODE_LABELS[value] }))}
                  value={step.mode === 'all' ? 'all' : 'any'}
                  searchInDropdown
                  hideDropdownSearch
                  onChange={(value) => setStep(index, { mode: value === 'all' ? 'all' : undefined })}
                />
              </SelectField>
              <CheckGroup label="Phân công">
                {assignNextRow(index)}
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={step.directs === true}
                    onChange={(event) => setStep(index, { directs: event.target.checked || undefined })}
                  />
                  Bút phê (ý kiến chỉ đạo, phòng chủ trì, phối hợp, hạn)
                </label>
              </CheckGroup>
              {step.directs && !form.steps.slice(index + 1).some((later) => (later.type ?? 'approve') === 'process') ? (
                <p className={styles.notice}>
                  Sau bước này chưa có bước Phòng ban xử lý: phòng ban được giao sẽ không phải xử lý gì. Tick "Giao phòng ban xử lý"
                  hoặc bỏ tick bút phê.
                </p>
              ) : null}
            </>
          ) : type === 'process' ? (
            <>
              <MultiPick
                label="Phòng ban cố định (trống là không cố định)"
                required={false}
                options={unitOptions}
                values={(step.units ?? []).map((unit) => unit.unitId)}
                onChange={(ids) =>
                  setStep(index, {
                    units:
                      ids.length > 0
                        ? ids.map((unitId, at) => ({
                            unitId,
                            role: step.units?.find((unit) => unit.unitId === unitId)?.role ?? (at === 0 ? 'lead' : 'support'),
                          }))
                        : undefined,
                    lockUnits: ids.length > 0 ? step.lockUnits : undefined,
                  })
                }
              />
              {step.units?.length ? (
                <CheckGroup label="Phòng ban cố định">
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={step.lockUnits === true}
                      onChange={(event) => setStep(index, { lockUnits: event.target.checked || undefined })}
                    />
                    Khoá: luôn giao đúng các phòng này (phòng đầu chủ trì)
                  </label>
                </CheckGroup>
              ) : null}
              <SelectField label="Bước xong khi">
                <SearchableSelect
                  options={(['all', 'lead'] as const).map((value) => ({ value, label: PROCESS_MODE_LABELS[value] }))}
                  value={step.mode === 'lead' ? 'lead' : 'all'}
                  searchInDropdown
                  hideDropdownSearch
                  onChange={(value) => setStep(index, { mode: value === 'lead' ? 'lead' : undefined })}
                />
              </SelectField>
            </>
          ) : (
            <>
              <SelectField label="Người làm bước">
                <SearchableSelect
                  options={[
                    { value: 'clerk', label: 'Người làm văn thư (Cấu hình sổ)' },
                    ...RULE_TYPES.map((value) => ({ value, label: APPROVER_RULE_LABELS[value] })),
                  ]}
                  value={step.approver?.type ?? 'clerk'}
                  searchInDropdown
                  hideDropdownSearch
                  onChange={(value) =>
                    setStep(index, {
                      approver:
                        !value || value === 'clerk'
                          ? undefined
                          : ruleFor(value as ApproverRuleType, step.approver ?? { type: 'handling_unit_heads' }),
                    })
                  }
                />
              </SelectField>
              {step.approver ? (
                <RuleDetail
                  rule={step.approver}
                  unitOptions={unitOptions}
                  positionOptions={positionOptions}
                  peopleOptions={peopleOptions}
                  onChange={(approver) => setStep(index, { approver })}
                />
              ) : null}
              <CheckGroup label="Phân công">
                {assignNextRow(index)}
              </CheckGroup>
            </>
          )}
          <StepConditionFields
            condition={step.condition}
            catalog={catalog}
            onChange={(condition) => setStep(index, { condition })}
          />
          <div className={styles.formRow}>
            {type === 'process' ? (
              <p className={styles.sectionNote}>Phòng ban trả lại khi không thuộc phạm vi: về bước liền trước.</p>
            ) : (
            <SelectField label="Không đạt thì trả về">
              <SearchableSelect
                options={RETURN_TARGETS.map((value) => ({
                  value,
                  label: returnTargetLabel(value, direction),
                  description:
                    value === 'previous-step'
                      ? `Về "${index === 0 ? preview[0] : (form.steps[index - 1]?.name ?? 'bước trước')}"`
                      : undefined,
                }))}
                value={step.rejectTo ?? 'previous-step'}
                searchInDropdown
                hideDropdownSearch
                onChange={(value) => setStep(index, { rejectTo: value === 'previous-step' ? undefined : (value as ReturnTarget) })}
              />
            </SelectField>
            )}
            <Field label="Số ngày cho bước (để nhắc hạn)">
              <input
                type="number"
                min={0}
                max={365}
                value={step.dueDays ?? ''}
                placeholder="Theo hạn của công văn"
                onChange={(event) => setStep(index, { dueDays: event.target.value === '' ? undefined : Number(event.target.value) })}
              />
            </Field>
          </div>
        </div>
        );
      })}
      <div className={styles.uploadBar}>
        {STEP_TYPES.map((value) => (
          <button key={value} type="button" className={styles.buttonGhost} disabled={form.steps.length >= MAX_WORKFLOW_STEPS} onClick={() => addStep(value)}>
            <Plus size={14} /> {STEP_TYPE_LABELS[value]}
          </button>
        ))}
      </div>
      <div className={`${styles.stepEditor} ${styles.stepEditorFixed}`}>
        <div className={styles.stepEditorHead}>
          <b>Ô cuối · {direction === 'incoming' ? 'hoàn tất' : 'đánh số đi, ban hành'}</b>
        </div>
        <div className={styles.formRow}>
          <Field label="Tên ô cuối">
            <input
              value={form.endName}
              maxLength={160}
              placeholder={FLOW_END_NAMES[direction]}
              onChange={(event) => setForm((current) => ({ ...current, endName: event.target.value }))}
            />
          </Field>
          <CheckGroup label="Cách làm">
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={form.autoEnd}
                onChange={(event) => setForm((current) => ({ ...current, autoEnd: event.target.checked }))}
              />
              {direction === 'incoming'
                ? 'Xong bước cuối là tự hoàn tất, không chờ ai bấm'
                : 'Xong bước cuối là tự cấp số đi, ban hành gửi nơi nhận đã ghi'}
            </label>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={form.archive}
                onChange={(event) => setForm((current) => ({ ...current, archive: event.target.checked }))}
              />
              Cấp số hồ sơ, lưu trữ
            </label>
          </CheckGroup>
        </div>
        {!form.autoEnd ? (
          <>
            <SelectField label="Người làm ô cuối">
              <SearchableSelect
                options={[
                  { value: 'clerk', label: 'Văn thư' },
                  ...END_RULE_TYPES.map((value) => ({ value, label: APPROVER_RULE_LABELS[value] })),
                ]}
                value={form.endActor?.type ?? 'clerk'}
                searchInDropdown
                hideDropdownSearch
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    endActor:
                      !value || value === 'clerk'
                        ? null
                        : ruleFor(value as ApproverRuleType, current.endActor ?? { type: 'handling_unit_heads' }),
                  }))
                }
              />
            </SelectField>
            {form.endActor ? (
              <RuleDetail
                rule={form.endActor}
                unitOptions={unitOptions}
                positionOptions={positionOptions}
                peopleOptions={peopleOptions}
                onChange={(endActor) => setForm((current) => ({ ...current, endActor }))}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </FormDialog>
  );
}

type Option = { readonly value: string; readonly label: string; readonly description?: string };

/** Chọn nhiều mục bằng một ô tìm và dãy nhãn đã chọn. */
function MultiPick({
  label,
  options,
  values,
  required = true,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly Option[];
  readonly values: readonly string[];
  readonly required?: boolean;
  readonly onChange: (values: string[]) => void;
}) {
  const byValue = new Map(options.map((option) => [option.value, option]));
  return (
    <SelectField label={label} required={required}>
      <SearchableSelect
        options={options.filter((option) => !values.includes(option.value))}
        value=""
        placeholder="Tìm và thêm"
        emptyText="Không còn mục nào để thêm."
        onChange={(value) => value && onChange([...values, value])}
      />
      {values.length > 0 ? (
        <div className={styles.unitChips}>
          {values.map((value) => (
            <span key={value} className={styles.unitChip}>
              {byValue.get(value)?.label ?? 'Không còn trong sơ đồ'}
              <button type="button" aria-label="Bỏ" onClick={() => onChange(values.filter((item) => item !== value))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </SelectField>
  );
}

function RuleDetail({
  rule,
  unitOptions,
  positionOptions,
  peopleOptions,
  onChange,
}: {
  readonly rule: ApproverRule;
  readonly unitOptions: readonly Option[];
  readonly positionOptions: readonly Option[];
  readonly peopleOptions: readonly Option[];
  readonly onChange: (rule: ApproverRule) => void;
}) {
  switch (rule.type) {
    case 'choose':
      return (
        <div className={styles.formRow}>
          <SelectField label="Người trình (văn thư hay người duyệt bước trước) chọn trong">
            <SearchableSelect
              options={[
                { value: 'leaders', label: 'Lãnh đạo (người có quyền lãnh đạo trong Phân quyền)' },
                { value: 'positions', label: 'Người giữ các chức danh' },
                { value: 'units', label: 'Người thuộc các phòng ban' },
              ]}
              value={rule.pool}
              searchInDropdown
              hideDropdownSearch
              onChange={(value) =>
                onChange(value === 'positions' || value === 'units' ? { type: 'choose', pool: value, ids: [] } : { type: 'choose', pool: 'leaders' })
              }
            />
          </SelectField>
          {rule.pool !== 'leaders' ? (
            <MultiPick
              label={rule.pool === 'positions' ? 'Chức danh' : 'Phòng ban'}
              options={rule.pool === 'positions' ? positionOptions : unitOptions}
              values={rule.ids ?? []}
              onChange={(ids) => onChange({ ...rule, ids })}
            />
          ) : null}
        </div>
      );
    case 'users':
      return <MultiPick label="Người được chỉ định" options={peopleOptions} values={rule.userIds} onChange={(userIds) => onChange({ type: 'users', userIds })} />;
    case 'positions':
      return (
        <MultiPick
          label="Chức danh"
          options={positionOptions}
          values={rule.positionIds}
          onChange={(positionIds) => onChange({ type: 'positions', positionIds })}
        />
      );
    case 'unit_heads':
      return <MultiPick label="Đơn vị" options={unitOptions} values={rule.unitIds} onChange={(unitIds) => onChange({ type: 'unit_heads', unitIds })} />;
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- sơ đồ */

function OrganizationView({ directory }: { readonly directory?: CorrespondenceDirectory }) {
  const [search, setSearch] = useState('');
  if (!directory) return <div className={styles.empty}>Đang tải sơ đồ tổ chức…</div>;
  const needle = search.trim().toLowerCase();
  const units = directory.units.filter(
    (unit) =>
      !needle ||
      unit.name.toLowerCase().includes(needle) ||
      unit.members.some((member) => member.name.toLowerCase().includes(needle)),
  );
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Sơ đồ tổ chức</h2>
        <span className={styles.muted}>
          Sửa ở Tenant Portal
        </span>
      </div>
      {directory.degraded ? <p className={styles.notice}>Chưa đọc được sơ đồ tổ chức, đang hiện bản cũ (nếu có).</p> : null}
      <input
        className={styles.search}
        type="search"
        value={search}
        placeholder="Tìm phòng ban hoặc người"
        aria-label="Tìm trong sơ đồ tổ chức"
        onChange={(event) => setSearch(event.target.value)}
      />
      <p className={styles.sectionNote}>
        Lãnh đạo (được chọn duyệt công văn): {directory.leaders.map((leader) => leader.name).join(', ') || 'chưa ai được cấp quyền (Phân quyền)'}
      </p>
      {units.map((unit) => (
        <div key={unit.id} className={styles.orgUnit}>
          <b>{unit.name}</b>
          {unit.path ? <span className={styles.hint}>{unit.path}</span> : null}
          <div className={styles.memberChips}>
            {unit.members.length === 0 ? <span className={styles.muted}>Chưa có ai</span> : null}
            {unit.members.map((member) => (
              <span key={member.userId} className={member.isHead ? `${styles.memberChip} ${styles.memberHead}` : styles.memberChip}>
                {member.name}
                {member.positionName ? ` · ${member.positionName}` : ''}
                {member.isHead ? ' · Trưởng' : ''}
              </span>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
