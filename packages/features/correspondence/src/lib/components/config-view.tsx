'use client';

import {
  APPROVER_RULE_LABELS,
  CATALOG_KINDS,
  CATALOG_KIND_LABELS,
  type ApproverRule,
  type ApproverRuleType,
  type CatalogItem,
  type CatalogKind,
  type CorrespondenceConfig,
  type CorrespondenceDirectory,
  type Workflow,
  type WorkflowStep,
} from '@enterprise-platform/contracts-correspondence';
import { Popconfirm, SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { deleteCatalogItem, deleteWorkflow, errorMessage, saveCatalogItem, saveWorkflow } from '../correspondence-api';
import styles from '../correspondence.module.scss';
import { Field, FormDialog, SelectField } from './form-dialog';
import { SettingsView } from './settings-view';

type ConfigTab = 'register' | 'catalog' | 'workflows' | 'organization';

const TABS: readonly { readonly id: ConfigTab; readonly label: string }[] = [
  { id: 'workflows', label: 'Quy trình duyệt' },
  { id: 'catalog', label: 'Danh mục' },
  { id: 'register', label: 'Sổ và đánh số' },
  { id: 'organization', label: 'Sơ đồ tổ chức' },
];

/**
 * Cấu hình văn thư: quy trình duyệt (các bước, ai duyệt theo sơ đồ tổ chức), danh mục
 * (loại văn bản, độ khẩn, độ mật), sổ và đánh số, xem sơ đồ tổ chức đang dùng.
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
        <SettingsView settings={config.settings} onSaved={() => onChanged()} />
      ) : tab === 'catalog' ? (
        <CatalogManager config={config} onChanged={onChanged} />
      ) : tab === 'workflows' ? (
        <WorkflowManager config={config} directory={directory} onChanged={onChanged} />
      ) : (
        <OrganizationView directory={directory} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- danh mục */

function CatalogManager({ config, onChanged }: { readonly config: CorrespondenceConfig; readonly onChanged: () => void }) {
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
                    <th>{kind === 'letter_type' ? 'Hạn · Quy trình' : kind === 'urgency' ? 'Tô đỏ' : 'Chỉ người liên quan'}</th>
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
                              config.workflows.find((workflow) => workflow.id === item.workflowId)?.name ?? 'Quy trình mặc định'
                            }`
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
  onClose,
  onSaved,
}: {
  readonly kind: CatalogKind;
  readonly item?: CatalogItem;
  readonly workflows: readonly Workflow[];
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
      highlight: item?.highlight ?? false,
      restricted: item?.restricted ?? false,
    }),
    [item],
  );
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((key) => form[key] !== initial[key]);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

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
        highlight: form.highlight,
        restricted: form.restricted,
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
        <div className={styles.formRow}>
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
          <SelectField label="Quy trình duyệt mặc định">
            <SearchableSelect
              options={workflows.filter((workflow) => workflow.isActive).map((workflow) => ({ value: workflow.id, label: workflow.name }))}
              value={form.workflowId}
              placeholder="Quy trình mặc định của tenant"
              clearable
              onChange={(value) => set('workflowId', value)}
            />
          </SelectField>
        </div>
      ) : null}
      <div className={styles.formRow}>
        <Field label="Thứ tự">
          <input type="number" value={form.sortOrder} onChange={(event) => set('sortOrder', event.target.value)} />
        </Field>
        <div className={styles.field}>
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
        </div>
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
  const [editing, setEditing] = useState<{ workflow?: Workflow }>();
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
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Quy trình duyệt</h2>
        <button type="button" className={styles.buttonSmall} onClick={() => setEditing({})}>
          <Plus size={13} /> Thêm quy trình
        </button>
      </div>
      <p className={styles.muted} style={{ margin: '0 0 10px', fontSize: 13 }}>
        Mỗi quy trình gồm các bước theo thứ tự: bước xem xét (trước khi chỉ đạo), đúng một bước chỉ đạo giao phòng ban, rồi
        các bước duyệt văn bản phản hồi. Người thực hiện mỗi bước lấy theo sơ đồ tổ chức. Sửa quy trình không đổi công văn đã
        trình.
      </p>
      <div className={styles.list}>
        {config.workflows.map((workflow) => (
          <div key={workflow.id} className={styles.listRow}>
            <div className={styles.listMain}>
              <b>{workflow.name}</b>{' '}
              {workflow.isDefault ? <span className={`${styles.tag} ${styles['tone-info']}`}>Mặc định</span> : null}{' '}
              {!workflow.isActive ? <span className={`${styles.tag} ${styles['tone-muted']}`}>Ngừng dùng</span> : null}
              <span className={styles.hint}>{workflow.steps.map((step) => step.name).join(' → ')}</span>
              {workflow.description ? <p>{workflow.description}</p> : null}
            </div>
            <div className={styles.listActions}>
              <button type="button" className={styles.buttonSmall} onClick={() => setEditing({ workflow })}>
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
      {editing ? (
        <WorkflowDialog
          workflow={editing.workflow}
          directory={directory}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

const RULE_TYPES: readonly ApproverRuleType[] = ['choose', 'users', 'positions', 'unit_heads', 'assigned_unit_heads', 'director'];

function blankStep(index: number, kind: WorkflowStep['kind']): WorkflowStep {
  return {
    key: `step-${Date.now().toString(36)}-${index}`,
    name: kind === 'direct' ? 'Lãnh đạo chỉ đạo' : 'Duyệt',
    kind,
    approver: kind === 'direct' ? { type: 'choose', pool: 'leaders' } : { type: 'director' },
  };
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
      return { type };
  }
}

function WorkflowDialog({
  workflow,
  directory,
  onClose,
  onSaved,
}: {
  readonly workflow?: Workflow;
  readonly directory?: CorrespondenceDirectory;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const initial = useMemo(
    () => ({
      name: workflow?.name ?? '',
      description: workflow?.description ?? '',
      isActive: workflow?.isActive ?? true,
      isDefault: workflow?.isDefault ?? false,
      steps: workflow?.steps ?? [blankStep(0, 'direct'), { ...blankStep(1, 'approve'), name: 'Lãnh đạo duyệt và ký' }],
    }),
    [workflow],
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
        isActive: form.isActive,
        isDefault: form.isDefault,
        steps: form.steps,
      });
      toast.success('Đã lưu quy trình duyệt.');
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

  return (
    <FormDialog
      open
      wide
      title={workflow ? 'Sửa quy trình duyệt' : 'Thêm quy trình duyệt'}
      subtitle="Người thực hiện mỗi bước lấy theo sơ đồ tổ chức lúc bước bắt đầu."
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
        <div className={styles.field}>
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
            Quy trình mặc định (khi loại văn bản chưa gắn quy trình)
          </label>
        </div>
      </div>
      <Field label="Mô tả">
        <textarea
          value={form.description}
          maxLength={2000}
          rows={2}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
        />
      </Field>
      {directory?.degraded ? (
        <p className={styles.notice}>Chưa đọc được sơ đồ tổ chức; danh sách phòng ban, chức danh có thể thiếu.</p>
      ) : null}
      {form.steps.map((step, index) => (
        <div key={step.key} className={styles.stepEditor}>
          <div className={styles.stepEditorHead}>
            <b>Bước {index + 1}</b>
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
                disabled={form.steps.length === 1}
                onClick={() => setForm((current) => ({ ...current, steps: current.steps.filter((_, at) => at !== index) }))}
              >
                <X size={13} />
              </button>
            </div>
          </div>
          <div className={styles.formRow3}>
            <Field label="Tên bước" required>
              <input value={step.name} maxLength={160} onChange={(event) => setStep(index, { name: event.target.value })} />
            </Field>
            <SelectField label="Loại bước" required>
              <SearchableSelect
                options={[
                  { value: 'direct', label: 'Chỉ đạo, giao phòng ban' },
                  { value: 'approve', label: 'Xem xét / duyệt' },
                ]}
                value={step.kind}
                searchInDropdown
                hideDropdownSearch
                onChange={(value) => setStep(index, { kind: value === 'direct' ? 'direct' : 'approve' })}
              />
            </SelectField>
            <SelectField label="Người thực hiện" required>
              <SearchableSelect
                options={RULE_TYPES.map((type) => ({ value: type, label: APPROVER_RULE_LABELS[type] }))}
                value={step.approver.type}
                searchInDropdown
                hideDropdownSearch
                onChange={(value) => value && setStep(index, { approver: ruleFor(value as ApproverRuleType, step.approver) })}
              />
            </SelectField>
          </div>
          <RuleDetail
            rule={step.approver}
            unitOptions={unitOptions}
            positionOptions={positionOptions}
            peopleOptions={peopleOptions}
            onChange={(approver) => setStep(index, { approver })}
          />
        </div>
      ))}
      <div className={styles.uploadBar}>
        <button
          type="button"
          className={styles.buttonGhost}
          disabled={form.steps.length >= 10}
          onClick={() => setForm((current) => ({ ...current, steps: [...current.steps, blankStep(current.steps.length, 'approve')] }))}
        >
          <Plus size={14} /> Thêm bước
        </button>
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
  onChange,
}: {
  readonly label: string;
  readonly options: readonly Option[];
  readonly values: readonly string[];
  readonly onChange: (values: string[]) => void;
}) {
  const byValue = new Map(options.map((option) => [option.value, option]));
  return (
    <SelectField label={label} required>
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
          <SelectField label="Người trình chọn trong">
            <SearchableSelect
              options={[
                { value: 'leaders', label: 'Người có quyền chỉ đạo (Phân quyền)' },
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
    case 'assigned_unit_heads':
      return <p className={styles.muted} style={{ margin: 0, fontSize: 12.5 }}>Trưởng của từng phòng ban được giao ở bước chỉ đạo; đặt sau bước chỉ đạo.</p>;
    default:
      return <p className={styles.muted} style={{ margin: 0, fontSize: 12.5 }}>Chính người đã chỉ đạo công văn; đặt sau bước chỉ đạo.</p>;
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
        <span className={styles.muted} style={{ fontSize: 12.5 }}>
          Lấy từ Tenant Core; sửa ở trang Sơ đồ tổ chức của Tenant Portal
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
      <p className={styles.muted} style={{ fontSize: 12.5 }}>
        Người có quyền chỉ đạo: {directory.leaders.map((leader) => leader.name).join(', ') || 'chưa ai được cấp (Phân quyền)'}
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
