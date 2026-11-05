'use client';

import {
  STAGE_SEMANTIC_LABELS,
  STAGE_ASSIGNEE_RULES,
  type AdminPipeline,
  type AdminPipelineStage,
  type CrmDocumentType,
  type PipelineProfile,
  type PipelineTemplate,
  type StageAssigneeRule,
  type StageRequirementInput,
  type StageSemantic,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import {
  createPipeline,
  createPipelineStage,
  deletePipeline,
  deletePipelineStage,
  errorMessage,
  listAdminPipelines,
  listDocumentTypes,
  listPipelineTemplates,
  reorderPipelineStages,
  reorderPipelines,
  setDefaultPipeline,
  setStageRequirements,
  setStageTransitions,
  updatePipeline,
  updatePipelineStage,
} from '../crm-api';
import { labelOptions, peopleOptions, useCrm } from '../crm-context';
import styles from '../sales.module.scss';
import local from './pipeline-settings.module.scss';
import {
  ASSIGNEE_RULE_LABELS,
  MAX_MANAGER_LEVEL,
  PIPELINE_CODE_PATTERN,
  PIPELINE_PROFILE_LABELS,
  REQUIREMENT_KIND_LABELS,
  STAGE_LOCK_HINT,
  TENDER_CARE_HINT,
  assigneeParamError,
  assigneeParamValue,
  defaultRequirementMessage,
  fieldRefOptions,
  moveId,
  normalizePipelineCode,
  pipelineActiveBlock,
  pipelineDefaultBlock,
  pipelineDeleteBlock,
  requirementFormError,
  requirementKindsFor,
  requirementNeedsRef,
  stageDeleteBlock,
  stageFormError,
  stageLabel,
  toRequirementInput,
  transitionTargets,
} from './pipeline.model';

/**
 * "Cấu hình luồng" (P2G-03): quản trị luồng cơ hội, giai đoạn, bước chuyển, điều kiện chuyển, cờ bỏ qua và quy tắc gán
 * người. Chỉ `crm.manage` (thẻ nằm trong Cấu hình; server kiểm quyền lại). Gộp luôn công tắc "Gợi ý chăm sóc lại khi Thua"
 * của P2F-02 nên mục "Luồng bán hàng" cũ ở tab Chung đã bỏ.
 */
export function PipelineSettings() {
  const [pipelines, setPipelines] = useState<AdminPipeline[]>([]);
  const [templates, setTemplates] = useState<PipelineTemplate[]>([]);
  const [documentTypes, setDocumentTypes] = useState<CrmDocumentType[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [stageId, setStageId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [addingStage, setAddingStage] = useState(false);

  useEffect(() => {
    listAdminPipelines()
      .then((rows) => {
        setPipelines(rows);
        setSelectedId((current) => current ?? rows.find((row) => row.isDefault)?.id ?? rows[0]?.id);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được các luồng.')))
      .finally(() => setLoading(false));
    listPipelineTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
    listDocumentTypes(true)
      .then(setDocumentTypes)
      .catch(() => setDocumentTypes([]));
  }, []);

  const pipeline = pipelines.find((row) => row.id === selectedId) ?? pipelines[0];
  const stage = pipeline?.stages.find((row) => row.id === stageId);

  /** Chạy một thao tác ghi; thành công thì thay danh sách luồng, thất bại thì hiện đúng lời server. */
  const apply = useCallback(async (action: () => Promise<AdminPipeline[]>, success: string, fallback: string): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      setPipelines(await action());
      toast.success(success);
      return true;
    } catch (cause) {
      setError(errorMessage(cause, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className={local.layout}>
      <div className={local.column}>
        <section className={styles.panel} aria-label="Danh sách luồng">
          <div className={styles.toolbar}>
            <h2 className={styles.title}>Luồng cơ hội</h2>
            <button type="button" className={styles.buttonPrimary} onClick={() => setCreating(true)}>
              <Plus size={14} /> Tạo luồng
            </button>
          </div>
          {error ? (
            <p className={styles.alert} role="alert">
              {error}
            </p>
          ) : null}
          {loading ? <p className={styles.muted}>Đang tải…</p> : null}
          {!loading && pipelines.length === 0 ? <p className={styles.muted}>Chưa có luồng nào.</p> : null}
          {pipelines.map((row, index) => (
            <div key={row.id} className={`${local.item} ${row.id === pipeline?.id ? local.itemActive : ''}`}>
              <button
                type="button"
                className={local.itemMain}
                aria-current={row.id === pipeline?.id}
                onClick={() => {
                  setSelectedId(row.id);
                  setStageId(undefined);
                }}
              >
                <span className={local.itemTitle}>{row.name}</span>
                <span className={local.itemMeta}>
                  <span className={styles.mono}>{row.code}</span>
                  <span>{PIPELINE_PROFILE_LABELS[row.profile]}</span>
                  <span>{row.opportunityCount} cơ hội</span>
                  {row.isDefault ? <span className={`${styles.pill} ${styles.pill_info}`}>Mặc định</span> : null}
                  {!row.active ? <span className={`${styles.pill} ${styles.pill_neutral}`}>Đã tắt</span> : null}
                </span>
              </button>
              <span className={local.moveButtons}>
                <button
                  type="button"
                  className={styles.rowAction}
                  aria-label={`Đưa luồng ${row.name} lên`}
                  disabled={busy || index === 0}
                  onClick={() => void apply(() => reorderPipelines(moveId(pipelines.map((p) => p.id), row.id, -1)), 'Đã đổi thứ tự luồng.', 'Không đổi được thứ tự luồng.')}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className={styles.rowAction}
                  aria-label={`Đưa luồng ${row.name} xuống`}
                  disabled={busy || index === pipelines.length - 1}
                  onClick={() => void apply(() => reorderPipelines(moveId(pipelines.map((p) => p.id), row.id, 1)), 'Đã đổi thứ tự luồng.', 'Không đổi được thứ tự luồng.')}
                >
                  <ArrowDown size={14} />
                </button>
              </span>
            </div>
          ))}
        </section>
      </div>

      <div className={local.column}>
        {pipeline ? (
          <>
            <PipelineHeader key={pipeline.id} pipeline={pipeline} busy={busy} apply={apply} onDeleted={() => setSelectedId(undefined)} />
            <section className={styles.panel} aria-label="Giai đoạn của luồng">
              <div className={styles.toolbar}>
                <h2 className={styles.title}>Giai đoạn</h2>
                <button type="button" className={styles.buttonPrimary} onClick={() => setAddingStage(true)}>
                  <Plus size={14} /> Thêm giai đoạn
                </button>
              </div>
              <StageList pipeline={pipeline} busy={busy} selectedStageId={stage?.id} onSelect={setStageId} apply={apply} onDeleted={(id) => id === stageId && setStageId(undefined)} />
            </section>
            {stage ? <StageEditor key={`${pipeline.id}:${stage.id}`} pipeline={pipeline} stage={stage} documentTypes={documentTypes} busy={busy} apply={apply} /> : (
              <p className={styles.muted}>Chọn "Cấu hình" ở một giai đoạn để sửa chi tiết, bước chuyển và điều kiện chuyển.</p>
            )}
          </>
        ) : null}
      </div>

      {creating ? (
        <CreatePipelineDialog
          templates={templates}
          onClose={() => setCreating(false)}
          onCreated={(rows, code) => {
            setPipelines(rows);
            setSelectedId(rows.find((row) => row.code === code)?.id);
            setStageId(undefined);
            setCreating(false);
          }}
        />
      ) : null}
      {addingStage && pipeline ? (
        <AddStageDialog
          pipeline={pipeline}
          onClose={() => setAddingStage(false)}
          onCreated={(rows) => {
            setPipelines(rows);
            setAddingStage(false);
          }}
        />
      ) : null}
    </div>
  );
}

type Apply = (action: () => Promise<AdminPipeline[]>, success: string, fallback: string) => Promise<boolean>;

function Reason({ text }: { text?: string }) {
  return text ? <p className={local.reason}>{text}</p> : null;
}

function PipelineHeader({ pipeline, busy, apply, onDeleted }: { pipeline: AdminPipeline; busy: boolean; apply: Apply; onDeleted: () => void }) {
  const [name, setName] = useState(pipeline.name);
  const tender = pipeline.profile === 'TENDER';
  const activeBlock = pipelineActiveBlock(pipeline);
  const defaultBlock = pipelineDefaultBlock(pipeline);
  const deleteBlock = pipelineDeleteBlock(pipeline);
  const nameChanged = name.trim() !== pipeline.name && name.trim() !== '';

  return (
    <section className={styles.panel} aria-label="Thông tin luồng">
      <h2 className={styles.title}>{pipeline.name}</h2>
      <div className={styles.fieldGrid}>
        <Field label="Tên luồng" required>
          <input className={styles.input} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Mã luồng" hint="Không đổi sau khi tạo">
          <input className={styles.input} value={pipeline.code} disabled />
        </Field>
      </div>
      <div className={local.actionRow}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={busy || !nameChanged}
          onClick={() => void apply(() => updatePipeline(pipeline.id, { name: name.trim() }), 'Đã lưu tên luồng.', 'Không lưu được tên luồng.')}
        >
          Lưu tên
        </button>
        <button
          type="button"
          className={styles.buttonGhost}
          disabled={busy || !!defaultBlock}
          onClick={() => void apply(() => setDefaultPipeline(pipeline.id), 'Đã đặt luồng mặc định.', 'Không đặt được luồng mặc định.')}
        >
          Đặt làm mặc định
        </button>
        <button
          type="button"
          className={styles.buttonGhost}
          disabled={busy || !!activeBlock}
          onClick={() => void apply(() => updatePipeline(pipeline.id, { active: !pipeline.active }), pipeline.active ? 'Đã tắt luồng.' : 'Đã bật luồng.', 'Không đổi được trạng thái luồng.')}
        >
          {pipeline.active ? 'Tắt luồng' : 'Bật luồng'}
        </button>
        <Popconfirm
          title="Xoá luồng?"
          description="Chỉ xoá được luồng chưa có cơ hội. Không hoàn tác được."
          okText="Xoá"
          cancelText="Huỷ"
          okType="danger"
          disabled={!!deleteBlock}
          onConfirm={async () => {
            if (await apply(() => deletePipeline(pipeline.id), 'Đã xoá luồng.', 'Không xoá được luồng.')) onDeleted();
          }}
        >
          <button type="button" className={styles.rowActionDanger} disabled={busy || !!deleteBlock}>
            Xoá luồng
          </button>
        </Popconfirm>
      </div>
      <Reason text={pipeline.isDefault ? undefined : defaultBlock} />
      <Reason text={pipeline.isDefault ? activeBlock : deleteBlock} />
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          role="switch"
          checked={!tender && pipeline.careSuggestion}
          disabled={tender || busy}
          onChange={(event) => void apply(() => updatePipeline(pipeline.id, { careSuggestion: event.target.checked }), 'Đã lưu cấu hình luồng.', 'Không lưu được cấu hình luồng.')}
        />
        <span>Gợi ý chăm sóc lại khi cơ hội Thua</span>
      </label>
      <Reason text={tender ? TENDER_CARE_HINT : undefined} />
    </section>
  );
}

function StageList({
  pipeline,
  busy,
  selectedStageId,
  onSelect,
  apply,
  onDeleted,
}: {
  pipeline: AdminPipeline;
  busy: boolean;
  selectedStageId?: string;
  onSelect: (id: string) => void;
  apply: Apply;
  onDeleted: (id: string) => void;
}) {
  const ids = pipeline.stages.map((row) => row.id);
  const reorder = (id: string, direction: -1 | 1) =>
    void apply(() => reorderPipelineStages(pipeline.id, moveId(ids, id, direction)), 'Đã đổi thứ tự giai đoạn.', 'Không đổi được thứ tự giai đoạn.');
  return (
    <div>
      {pipeline.stages.map((row, index) => {
        const deleteBlock = stageDeleteBlock(row);
        return (
          <div key={row.id} className={`${local.item} ${row.id === selectedStageId ? local.itemActive : ''}`}>
            <div className={local.itemMain} style={{ cursor: 'default' }}>
              <span className={local.itemTitle}>{row.name}</span>
              <span className={local.itemMeta}>
                <span className={styles.mono}>{row.code}</span>
                <span>{STAGE_SEMANTIC_LABELS[row.semantic]}</span>
                <span>Xác suất {row.defaultProbability}%</span>
                <span>{row.opportunityCount} cơ hội</span>
                {row.skippable ? <span className={`${styles.pill} ${styles.pill_warning}`}>Có thể bỏ qua</span> : null}
                {!row.active ? <span className={`${styles.pill} ${styles.pill_neutral}`}>Đã tắt</span> : null}
                {deleteBlock ? <span className={styles.muted}>Đã dùng: không xoá được</span> : null}
              </span>
            </div>
            <span className={styles.rowActions}>
              <button type="button" className={styles.rowAction} aria-label={`Đưa ${row.name} lên`} disabled={busy || index === 0} onClick={() => reorder(row.id, -1)}>
                <ArrowUp size={14} />
              </button>
              <button type="button" className={styles.rowAction} aria-label={`Đưa ${row.name} xuống`} disabled={busy || index === pipeline.stages.length - 1} onClick={() => reorder(row.id, 1)}>
                <ArrowDown size={14} />
              </button>
              <button type="button" className={styles.rowActionPrimary} onClick={() => onSelect(row.id)}>
                Cấu hình
              </button>
              <button
                type="button"
                className={row.active ? styles.rowActionDanger : styles.rowAction}
                disabled={busy}
                onClick={() => void apply(() => updatePipelineStage(pipeline.id, row.id, { active: !row.active }), row.active ? 'Đã tắt giai đoạn.' : 'Đã bật giai đoạn.', 'Không đổi được trạng thái giai đoạn.')}
              >
                {row.active ? 'Tắt' : 'Bật'}
              </button>
              <Popconfirm
                title="Xoá giai đoạn?"
                description="Chỉ xoá được giai đoạn chưa từng dùng. Không hoàn tác được."
                okText="Xoá"
                cancelText="Huỷ"
                okType="danger"
                disabled={!!deleteBlock}
                onConfirm={async () => {
                  if (await apply(() => deletePipelineStage(pipeline.id, row.id), 'Đã xoá giai đoạn.', 'Không xoá được giai đoạn.')) onDeleted(row.id);
                }}
              >
                <button type="button" className={styles.rowActionDanger} disabled={busy || !!deleteBlock} title={deleteBlock}>
                  Xoá
                </button>
              </Popconfirm>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StageEditor({
  pipeline,
  stage,
  documentTypes,
  busy,
  apply,
}: {
  pipeline: AdminPipeline;
  stage: AdminPipelineStage;
  documentTypes: readonly CrmDocumentType[];
  busy: boolean;
  apply: Apply;
}) {
  return (
    <section className={styles.panel} aria-label={`Cấu hình giai đoạn ${stage.name}`}>
      <h2 className={styles.title}>Giai đoạn: {stage.name}</h2>
      <StageForm pipeline={pipeline} stage={stage} busy={busy} apply={apply} />
      <TransitionsEditor pipeline={pipeline} stage={stage} busy={busy} apply={apply} />
      <RequirementsEditor pipeline={pipeline} stage={stage} documentTypes={documentTypes} busy={busy} apply={apply} />
    </section>
  );
}

function StageForm({ pipeline, stage, busy, apply }: { pipeline: AdminPipeline; stage: AdminPipelineStage; busy: boolean; apply: Apply }) {
  const { people } = useCrm();
  const [code, setCode] = useState(stage.code);
  const [name, setName] = useState(stage.name);
  const [semantic, setSemantic] = useState<StageSemantic>(stage.semantic);
  const [probability, setProbability] = useState(String(stage.defaultProbability));
  const [skippable, setSkippable] = useState(stage.skippable);
  const [rule, setRule] = useState<StageAssigneeRule>(stage.assigneeRule);
  const [param, setParam] = useState(stage.assigneeParam ?? '');
  const [formError, setFormError] = useState<string>();
  const semanticOptions = useMemo(() => labelOptions(STAGE_SEMANTIC_LABELS), []);
  const ruleOptions = useMemo(() => labelOptions(Object.fromEntries(STAGE_ASSIGNEE_RULES.map((item) => [item, ASSIGNEE_RULE_LABELS[item]]))), []);

  async function save() {
    const invalid = stageFormError({ code: stage.used ? undefined : code, name, probability }) ?? assigneeParamError(rule, param);
    if (invalid) return setFormError(invalid);
    setFormError(undefined);
    const body = {
      ...(!stage.used && normalizePipelineCode(code) !== stage.code ? { code: normalizePipelineCode(code) } : {}),
      name: name.trim(),
      ...(!stage.used && semantic !== stage.semantic ? { semantic } : {}),
      defaultProbability: probability.trim() === '' ? stage.defaultProbability : Number(probability),
      skippable,
      assigneeRule: rule,
      assigneeParam: assigneeParamValue(rule, param),
    };
    await apply(() => updatePipelineStage(pipeline.id, stage.id, body), 'Đã lưu giai đoạn.', 'Không lưu được giai đoạn.');
  }

  return (
    <div>
      {formError ? <p className={styles.alert}>{formError}</p> : null}
      <div className={styles.fieldGrid}>
        <Field label="Mã giai đoạn" hint={stage.used ? STAGE_LOCK_HINT : 'Chữ hoa, số, gạch dưới'}>
          <input className={styles.input} value={code} maxLength={32} disabled={stage.used} onChange={(event) => setCode(event.target.value)} />
        </Field>
        <Field label="Tên giai đoạn" required>
          <input className={styles.input} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Nghĩa của giai đoạn" hint={stage.used ? STAGE_LOCK_HINT : 'Báo cáo gom theo nghĩa'}>
          <SearchableSelect options={semanticOptions} value={semantic} disabled={stage.used} onChange={(value) => setSemantic(value as StageSemantic)} />
        </Field>
        <Field label="Xác suất mặc định (%)">
          <input className={styles.input} inputMode="numeric" value={probability} maxLength={3} onChange={(event) => setProbability(event.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Field label="Người đảm nhận mặc định">
          <SearchableSelect
            options={ruleOptions}
            value={rule}
            onChange={(value) => {
              setRule(value as StageAssigneeRule);
              setParam('');
            }}
          />
        </Field>
        {rule === 'FIXED_USER' ? (
          <Field label="Người được gán" required>
            <SearchableSelect options={peopleOptions(people)} value={param} placeholder="Chọn người" onChange={setParam} />
          </Field>
        ) : null}
        {rule === 'MANAGER_LEVEL' ? (
          <Field label="Số bậc cấp trên" required hint={`Từ 1 đến ${MAX_MANAGER_LEVEL}`}>
            <input className={styles.input} inputMode="numeric" value={param} maxLength={2} onChange={(event) => setParam(event.target.value.replace(/[^\d]/g, ''))} />
          </Field>
        ) : null}
        {rule === 'POSITION' ? (
          <Field label="Mã chức danh" required hint="Nhập mã (id) chức danh trong sơ đồ tổ chức; người đang giữ chức danh được gán">
            <input className={styles.input} value={param} maxLength={64} onChange={(event) => setParam(event.target.value)} />
          </Field>
        ) : null}
      </div>
      <label className={styles.checkbox}>
        <input type="checkbox" checked={skippable} onChange={(event) => setSkippable(event.target.checked)} />
        <span>Có thể bỏ qua giai đoạn này</span>
      </label>
      <div className={local.actionRow}>
        <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void save()}>
          Lưu giai đoạn
        </button>
      </div>
    </div>
  );
}

function TransitionsEditor({ pipeline, stage, busy, apply }: { pipeline: AdminPipeline; stage: AdminPipelineStage; busy: boolean; apply: Apply }) {
  const targets = transitionTargets(pipeline, stage);
  const [selected, setSelected] = useState<string[]>([...stage.nextStageIds]);
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  return (
    <div>
      <h3 className={local.subTitle}>Bước chuyển tiếp theo</h3>
      {stage.semantic !== 'OPEN' ? (
        <p className={styles.muted}>Giai đoạn Thắng hoặc Thua là điểm cuối, không có bước chuyển đi.</p>
      ) : (
        <>
          <div className={local.targets}>
            {targets.map((target) => (
              <label key={target.id} className={styles.checkbox}>
                <input type="checkbox" checked={selected.includes(target.id)} onChange={() => toggle(target.id)} />
                <span>{stageLabel(target)}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy}
            onClick={() => void apply(() => setStageTransitions(pipeline.id, stage.id, selected), 'Đã lưu bước chuyển.', 'Không lưu được bước chuyển.')}
          >
            Lưu bước chuyển
          </button>
        </>
      )}
    </div>
  );
}

function RequirementsEditor({
  pipeline,
  stage,
  documentTypes,
  busy,
  apply,
}: {
  pipeline: AdminPipeline;
  stage: AdminPipelineStage;
  documentTypes: readonly CrmDocumentType[];
  busy: boolean;
  apply: Apply;
}) {
  const [rows, setRows] = useState<StageRequirementInput[]>(() =>
    stage.requirements.map((item) => ({ kind: item.kind, ref: item.ref, required: item.required, message: item.message })),
  );
  const [formError, setFormError] = useState<string>();
  const kindOptions = useMemo(() => requirementKindsFor(pipeline.profile).map((kind) => ({ value: kind, label: REQUIREMENT_KIND_LABELS[kind] })), [pipeline.profile]);
  const docOptions = useMemo(() => documentTypes.map((type) => ({ value: type.code, label: type.name, badge: type.code })), [documentTypes]);

  const patch = (index: number, change: Partial<StageRequirementInput>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));
  const refOptionsOf = (kind: StageRequirementInput['kind'], ref?: string) => {
    const options = kind === 'DOCUMENT_TYPE' ? docOptions : fieldRefOptions(kind);
    return ref && !options.some((option) => option.value === ref) ? [...options, { value: ref, label: ref }] : options;
  };
  const refLabel = (kind: StageRequirementInput['kind'], ref?: string) => refOptionsOf(kind, ref).find((option) => option.value === ref)?.label;

  async function save() {
    for (const row of rows) {
      const invalid = requirementFormError(row);
      if (invalid) return setFormError(invalid);
    }
    setFormError(undefined);
    await apply(() => setStageRequirements(pipeline.id, stage.id, { requirements: rows.map(toRequirementInput) }), 'Đã lưu điều kiện chuyển.', 'Không lưu được điều kiện chuyển.');
  }

  return (
    <div>
      <h3 className={local.subTitle}>Điều kiện chuyển vào giai đoạn này</h3>
      {formError ? <p className={styles.alert}>{formError}</p> : null}
      {rows.length === 0 ? <p className={styles.muted}>Chưa có điều kiện nào.</p> : null}
      {rows.map((row, index) => (
        <div key={index} className={local.reqRow}>
          <SearchableSelect
            options={kindOptions}
            value={row.kind}
            onChange={(value) => {
              const kind = value as StageRequirementInput['kind'];
              patch(index, { kind, ref: '', required: true, message: row.message || defaultRequirementMessage(kind) });
            }}
          />
          {requirementNeedsRef(row.kind) ? (
            <SearchableSelect
              options={refOptionsOf(row.kind, row.ref)}
              value={row.ref || undefined}
              placeholder={row.kind === 'DOCUMENT_TYPE' ? 'Chọn loại tài liệu' : 'Chọn trường'}
              onChange={(value) => patch(index, { ref: value, message: row.message || defaultRequirementMessage(row.kind, refLabel(row.kind, value)) })}
            />
          ) : (
            <span />
          )}
          {row.kind === 'DOCUMENT_TYPE' ? (
            <label className={styles.checkbox}>
              <input type="checkbox" checked={row.required !== false} onChange={(event) => patch(index, { required: event.target.checked })} />
              <span>Bắt buộc</span>
            </label>
          ) : (
            <span />
          )}
          <input className={styles.input} value={row.message} maxLength={500} placeholder="Thông báo khi thiếu" aria-label="Thông báo khi thiếu" onChange={(event) => patch(index, { message: event.target.value })} />
          <button type="button" className={styles.rowActionDanger} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>
            Xoá
          </button>
        </div>
      ))}
      <div className={local.actionRow}>
        <button type="button" className={styles.buttonGhost} onClick={() => setRows((current) => [...current, { kind: 'REASON', message: defaultRequirementMessage('REASON'), required: true }])}>
          <Plus size={14} /> Thêm điều kiện
        </button>
        <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void save()}>
          Lưu điều kiện
        </button>
      </div>
    </div>
  );
}

const BLANK_PREFIX = 'blank:';
const TEMPLATE_PREFIX = 'tpl:';

function CreatePipelineDialog({ templates, onClose, onCreated }: { templates: readonly PipelineTemplate[]; onClose: () => void; onCreated: (rows: AdminPipeline[], code: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [source, setSource] = useState(`${BLANK_PREFIX}STANDARD`);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const options = useMemo(
    () => [
      { value: `${BLANK_PREFIX}STANDARD`, label: 'Khung trống (bán hàng tiêu chuẩn)' },
      { value: `${BLANK_PREFIX}TENDER`, label: 'Khung trống (chào thầu)' },
      ...templates.map((template) => ({ value: `${TEMPLATE_PREFIX}${template.id}`, label: `Mẫu: ${template.name}` })),
    ],
    [templates],
  );
  const template = source.startsWith(TEMPLATE_PREFIX) ? templates.find((item) => `${TEMPLATE_PREFIX}${item.id}` === source) : undefined;

  async function submit() {
    const normalized = normalizePipelineCode(code);
    if (!PIPELINE_CODE_PATTERN.test(normalized)) return setError('Mã gồm chữ hoa, số, gạch dưới, bắt đầu bằng chữ, tối đa 32 ký tự.');
    if (!name.trim()) return setError('Vui lòng nhập tên luồng.');
    setSubmitting(true);
    setError(undefined);
    try {
      const body = template
        ? { code: normalized, name: name.trim(), templateId: template.id }
        : { code: normalized, name: name.trim(), profile: source.slice(BLANK_PREFIX.length) as PipelineProfile };
      const rows = await createPipeline(body);
      toast.success('Đã tạo luồng.');
      onCreated(rows, normalized);
    } catch (cause) {
      setError(errorMessage(cause, 'Không tạo được luồng.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog open title="Tạo luồng" submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <div className={styles.fieldGrid}>
        <Field label="Mã luồng" required hint="Chữ hoa, số, gạch dưới; không đổi sau khi tạo">
          <input className={styles.input} value={code} maxLength={32} autoFocus onChange={(event) => setCode(event.target.value)} />
        </Field>
        <Field label="Tên luồng" required>
          <input className={styles.input} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Tạo từ" wide hint={template ? template.description : 'Khung trống gồm sẵn giai đoạn Mới, Thắng, Thua'}>
          <SearchableSelect options={options} value={source} onChange={setSource} />
        </Field>
      </div>
    </CrmDialog>
  );
}

function AddStageDialog({ pipeline, onClose, onCreated }: { pipeline: AdminPipeline; onClose: () => void; onCreated: (rows: AdminPipeline[]) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [semantic, setSemantic] = useState<StageSemantic>('OPEN');
  const [probability, setProbability] = useState('10');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const semanticOptions = useMemo(() => labelOptions(STAGE_SEMANTIC_LABELS), []);

  async function submit() {
    const invalid = stageFormError({ code, name, probability });
    if (invalid) return setError(invalid);
    setSubmitting(true);
    setError(undefined);
    try {
      const rows = await createPipelineStage(pipeline.id, {
        code: normalizePipelineCode(code),
        name: name.trim(),
        semantic,
        defaultProbability: probability.trim() === '' ? 0 : Number(probability),
      });
      toast.success('Đã thêm giai đoạn.');
      onCreated(rows);
    } catch (cause) {
      setError(errorMessage(cause, 'Không thêm được giai đoạn.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog open title={`Thêm giai đoạn vào ${pipeline.name}`} submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <div className={styles.fieldGrid}>
        <Field label="Mã giai đoạn" required hint="Chữ hoa, số, gạch dưới; khoá khi đã dùng">
          <input className={styles.input} value={code} maxLength={32} autoFocus onChange={(event) => setCode(event.target.value)} />
        </Field>
        <Field label="Tên giai đoạn" required>
          <input className={styles.input} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Nghĩa của giai đoạn">
          <SearchableSelect options={semanticOptions} value={semantic} onChange={(value) => setSemantic(value as StageSemantic)} />
        </Field>
        <Field label="Xác suất mặc định (%)">
          <input className={styles.input} inputMode="numeric" value={probability} maxLength={3} onChange={(event) => setProbability(event.target.value.replace(/[^\d]/g, ''))} />
        </Field>
      </div>
    </CrmDialog>
  );
}
