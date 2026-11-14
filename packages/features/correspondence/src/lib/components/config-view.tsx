'use client';

import {
  APPROVER_RULE_LABELS,
  CATALOG_KINDS,
  CATALOG_KIND_LABELS,
  LETTER_DIRECTIONS,
  RETURN_TARGETS,
  returnTargetLabel,
  type ApproverRule,
  type ApproverRuleType,
  type CatalogItem,
  type CatalogKind,
  type CorrespondenceConfig,
  type CorrespondenceDirectory,
  type LetterDirection,
  type ReturnTarget,
  type Workflow,
  type WorkflowStep,
} from '@enterprise-platform/contracts-correspondence';
import { Popconfirm, SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { ArrowDown, ArrowRight, ArrowUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { deleteCatalogItem, deleteWorkflow, errorMessage, saveCatalogItem, saveWorkflow } from '../correspondence-api';
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
        <SettingsView settings={config.settings} directory={directory} onSaved={() => onChanged()} />
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

const DIRECTION_HELP: Readonly<Record<LetterDirection, string>> = {
  incoming:
    'Công văn đến: Văn thư tiếp nhận → Phòng ban xử lý → các bước duyệt dưới đây → Văn thư hoàn tất, lưu trữ. Quy trình lấy theo loại văn bản, không gắn thì dùng quy trình mặc định.',
  outgoing:
    'Công văn đi: Phòng ban soạn thảo → Văn thư kiểm tra → các bước duyệt dưới đây → Văn thư đánh số, ban hành, lưu trữ. Quy trình lấy theo loại văn bản, không gắn thì dùng quy trình mặc định.',
};

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
              <h2>Quy trình duyệt {direction === 'incoming' ? 'công văn đến' : 'công văn đi'}</h2>
              <button type="button" className={styles.buttonSmall} onClick={() => setEditing({ direction })}>
                <Plus size={13} /> Thêm quy trình
              </button>
            </div>
            <p className={styles.sectionNote}>
              {DIRECTION_HELP[direction]} Sửa quy trình không đổi công văn đã trình.
            </p>
            <div className={styles.list}>
              {items.length === 0 ? <p className={styles.muted}>Chưa có quy trình nào.</p> : null}
              {items.map((workflow) => (
                <div key={workflow.id} className={styles.listRow}>
                  <div className={styles.listMain}>
                    <b>{workflow.name}</b>{' '}
                    {workflow.isDefault ? <span className={`${styles.tag} ${styles['tone-info']}`}>Mặc định</span> : null}{' '}
                    {!workflow.isActive ? <span className={`${styles.tag} ${styles['tone-muted']}`}>Ngừng dùng</span> : null}
                    <div className={styles.stepChips}>
                      {workflow.steps.length === 0 ? (
                        <span className={styles.muted}>Không cần duyệt</span>
                      ) : (
                        workflow.steps.map((step, index) => (
                          <span key={step.key} className={styles.stepChip}>
                            {index + 1}. {step.name}
                          </span>
                        ))
                      )}
                    </div>
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

function blankStep(index: number, direction: LetterDirection): WorkflowStep {
  return {
    key: `step-${Date.now().toString(36)}-${index}`,
    name: index === 0 ? (direction === 'incoming' ? 'Trưởng phòng kiểm tra' : 'Trưởng phòng soạn thảo duyệt') : 'Lãnh đạo duyệt',
    approver: index === 0 ? { type: 'handling_unit_heads' } : { type: 'choose', pool: 'leaders' },
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
      return { type: 'handling_unit_heads' };
  }
}

function WorkflowDialog({
  direction,
  workflow,
  directory,
  onClose,
  onSaved,
}: {
  readonly direction: LetterDirection;
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
      steps: workflow?.steps ?? [blankStep(0, direction), blankStep(1, direction)],
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
  const fixedStart = direction === 'incoming' ? ['Văn thư tiếp nhận', 'Phòng ban xử lý'] : ['Phòng ban soạn thảo', 'Văn thư kiểm tra'];
  const fixedEnd = direction === 'incoming' ? ['Văn thư hoàn tất, lưu trữ'] : ['Văn thư ban hành, lưu trữ'];

  return (
    <FormDialog
      open
      wide
      title={`${workflow ? 'Sửa' : 'Thêm'} quy trình duyệt ${direction === 'incoming' ? 'công văn đến' : 'công văn đi'}`}
      subtitle="Người duyệt mỗi bước lấy theo sơ đồ tổ chức lúc bước bắt đầu. Không đạt thì trả về nơi cấu hình cho bước (mặc định bước trước)."
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
      <div className={styles.flowPreview} aria-label="Luồng xử lý">
        {[...fixedStart, ...form.steps.map((step) => step.name || 'Bước chưa đặt tên'), ...fixedEnd].map((label, index, all) => (
          <span key={`${index}-${label}`} className={index >= fixedStart.length && index < all.length - fixedEnd.length ? styles.flowPreviewStep : undefined}>
            {label}
            {index < all.length - 1 ? <ArrowRight size={12} /> : null}
          </span>
        ))}
      </div>
      {directory?.degraded ? <p className={styles.notice}>Chưa đọc được sơ đồ tổ chức; danh sách phòng ban, chức danh có thể thiếu.</p> : null}
      {form.steps.length === 0 ? (
        <p className={styles.muted} style={{ margin: 0 }}>
          Quy trình không có bước duyệt: xử lý xong là chuyển văn thư {direction === 'incoming' ? 'hoàn tất' : 'ban hành'}.
        </p>
      ) : null}
      {form.steps.map((step, index) => (
        <div key={step.key} className={styles.stepEditor}>
          <div className={styles.stepEditorHead}>
            <b>Bước duyệt {index + 1}</b>
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
            <Field label="Tên bước" required>
              <input value={step.name} maxLength={160} onChange={(event) => setStep(index, { name: event.target.value })} />
            </Field>
            <SelectField label="Người duyệt" required>
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
            direction={direction}
            unitOptions={unitOptions}
            positionOptions={positionOptions}
            peopleOptions={peopleOptions}
            onChange={(approver) => setStep(index, { approver })}
          />
          <div className={styles.formRow}>
            <SelectField label="Không đạt thì trả về">
              <SearchableSelect
                options={RETURN_TARGETS.map((value) => ({
                  value,
                  label: returnTargetLabel(value, direction),
                  description:
                    value === 'previous-step'
                      ? index === 0
                        ? `Bước đầu: về ${direction === 'incoming' ? 'phòng ban xử lý' : 'văn thư kiểm tra'}`
                        : `Về "${form.steps[index - 1]?.name ?? 'bước trước'}"`
                      : undefined,
                }))}
                value={step.rejectTo ?? 'previous-step'}
                searchInDropdown
                hideDropdownSearch
                onChange={(value) => setStep(index, { rejectTo: value === 'previous-step' ? undefined : (value as ReturnTarget) })}
              />
            </SelectField>
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
      ))}
      <div className={styles.uploadBar}>
        <button
          type="button"
          className={styles.buttonGhost}
          disabled={form.steps.length >= 10}
          onClick={() => setForm((current) => ({ ...current, steps: [...current.steps, blankStep(current.steps.length, direction)] }))}
        >
          <Plus size={14} /> Thêm bước duyệt
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
  direction,
  unitOptions,
  positionOptions,
  peopleOptions,
  onChange,
}: {
  readonly rule: ApproverRule;
  readonly direction: LetterDirection;
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
      return (
        <p className={styles.sectionNote}>
          {direction === 'incoming'
            ? 'Trưởng của từng phòng ban văn thư đã giao xử lý công văn (theo sơ đồ tổ chức).'
            : 'Trưởng phòng ban soạn thảo công văn đi (theo sơ đồ tổ chức).'}
        </p>
      );
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
