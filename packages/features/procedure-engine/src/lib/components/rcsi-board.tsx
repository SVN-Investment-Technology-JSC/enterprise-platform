'use client';

import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type {
  CreateProcedureStepInput,
  ProcedureStepMaterial,
  ProcedureDefinition,
  ProcedureRaciAssignment,
  ProcedureRaciRole,
  ProcedureStepDefinition,
} from '@enterprise-platform/contracts-procedure-engine';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ancestorsOfUsed,
  buildHeaderTree,
  flattenColumns,
  leafCount,
  pruneEmpty,
  rootUnitIds,
  treeDepth,
  type HeaderNode,
  type MatrixColumn,
} from './rcsi/columns';
import { MinimalPopupForm } from '@enterprise-platform/shared-ui';
import styles from './rcsi-board.module.scss';

const ROLE_LABEL: Record<ProcedureRaciRole, string> = {
  S: 'Submit — khởi tạo',
  R: 'Review — xem xét',
  E: 'Executor — thực thi',
  C: 'Check — kiểm soát',
  A: 'Approve — phê duyệt',
  I: 'Inform — nhận thông tin',
};

const ROLE_ORDER: readonly ProcedureRaciRole[] = ['S', 'R', 'E', 'C', 'A', 'I'];

/**
 * Một phân công có thuộc về một cột hay không.
 *
 * Khớp theo `subjectId`, KHÔNG đòi trùng `subjectType`. Cùng một node chức danh
 * đang tồn tại dưới hai tên loại: bản gán ở cấp đơn vị và dữ liệu seed ghi
 * `organization_unit`, còn bảng ma trận dựng cột chức danh thì ghi `position`.
 * Đòi trùng cả hai thì vai gán cho chức danh không khớp cột nào và biến mất khỏi
 * bảng ngay khi sổ đơn vị ra — dù dữ liệu vẫn còn nguyên.
 *
 * Vẫn tách riêng `user`: id người dùng thuộc một không gian định danh khác với
 * id node tổ chức, gộp chung sẽ khớp nhầm nếu hai bên trùng UUID.
 */
function sameSubject(
  assignment: Pick<ProcedureRaciAssignment, 'subjectType' | 'subjectId'>,
  column: Pick<MatrixColumn, 'subjectType' | 'subjectId'>,
): boolean {
  if (assignment.subjectId !== column.subjectId) return false;
  return (assignment.subjectType === 'user') === (column.subjectType === 'user');
}

interface CellTarget {
  readonly definitionId: string;
  readonly stepId: string;
  readonly column: MatrixColumn;
  readonly anchor: { top: number; left: number };
}

function toStepInput(step: ProcedureStepDefinition): CreateProcedureStepInput {
  return {
    key: step.key,
    order: step.order,
    name: step.name,
    description: step.description,
    linkedDefinitionId: step.linkedDefinitionId,
    slaHours: step.slaHours,
    // Phễu duy nhất của mọi thao tác sửa quy trình: thiếu một trường ở đây là
    // mất trường đó mỗi lần người dùng bấm một ô RACI.
    materials: step.materials?.map((item) => ({ ...item })),
    assignments: step.assignments.map((item) => ({
      role: item.role,
      subjectType: item.subjectType,
      subjectId: item.subjectId,
      subjectLabel: item.subjectLabel,
      fixedRollbackStepId: item.fixedRollbackStepId,
      eTaskSource: item.eTaskSource,
      eTaskConfig: item.eTaskConfig,
    })),
  };
}

export function RcsiBoard({
  definitions,
  organization,
  materialCatalog,
  groups,
  busy = false,
  onCreateDefinition,
  onUpdateDefinition,
  onPublishDefinition,
  onReviseDefinition,
  onDeleteDefinition,
  onChangeGroupDefinition,
}: {
  definitions: readonly ProcedureDefinition[];
  organization?: TenantOrganizationSnapshot;
  busy?: boolean;
  onCreateDefinition?: (input: {
    code: string;
    name: string;
    kind: ProcedureDefinition['kind'];
    category?: string;
  }) => void;
  /** Danh mục nhóm quy trình, lấy từ cấu hình module. */
  groups?: readonly { code: string; label: string }[];
  onUpdateDefinition?: (definitionId: string, steps: CreateProcedureStepInput[]) => void;
  /** Danh mục vật tư lấy từ Kho, để chọn thay vì gõ mã tự do. */
  materialCatalog?: readonly { code: string; name: string; unit: string }[];
  onDeleteDefinition?: (definitionId: string) => void;
  /** Đổi nhóm quy trình; dùng route riêng nên chạy được cả trên bản đã công bố. */
  onChangeGroupDefinition?: (definitionId: string, category: string | undefined) => void;
  onPublishDefinition?: (definitionId: string) => void;
  onReviseDefinition?: (definitionId: string) => void;
}) {
  /**
   * Mặc định mọi quy trình đều đóng: bảng mở ra chỉ có tên quy trình và cột đơn
   * vị ở cấp lớn nhất. Cột hiển thị suy ra từ quy trình nào đang mở, nên không
   * cần một bộ lọc cột riêng nữa.
   */
  const [mode, setMode] = useState<'compact' | 'full'>('compact');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  /** Người dùng tự bấm [+]/[−] trên một cột: ghi đè trạng thái suy ra. */
  const [manual, setManual] = useState<Map<string, boolean>>(new Map());
  const [cell, setCell] = useState<CellTarget>();
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [newGroup, setNewGroup] = useState('');

  const editable = Boolean(onUpdateDefinition);

  const subjectsOf = (list: readonly ProcedureDefinition[]) => {
    const set = new Set<string>();
    for (const definition of list) {
      for (const step of definition.steps) {
        for (const assignment of step.assignments) set.add(assignment.subjectId);
      }
    }
    return set;
  };

  /**
   * Tìm theo tên/mã quy trình **hoặc tên đơn vị tham gia**.
   *
   * Tìm theo đơn vị là nhu cầu thật: người phụ trách một phòng muốn biết phòng
   * mình dính vào những quy trình nào, mà tên phòng không nằm trong tên quy trình.
   */
  const visibleDefinitions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return definitions.filter((definition) => {
      // Lọc nhóm áp trước tìm kiếm: hai bộ lọc cộng dồn chứ không thay nhau.
      if (groupFilter && definition.category !== groupFilter) return false;
      if (!needle) return true;
      if (
        definition.name.toLowerCase().includes(needle) ||
        definition.code.toLowerCase().includes(needle)
      ) {
        return true;
      }
      return definition.steps.some((step) =>
        step.assignments.some((assignment) =>
          (assignment.subjectLabel ?? '').toLowerCase().includes(needle),
        ),
      );
    });
  }, [definitions, search, groupFilter]);

  const openDefinitions = useMemo(
    () => visibleDefinitions.filter((definition) => openRows.has(definition.id)),
    [visibleDefinitions, openRows],
  );

  const openSubjects = useMemo(() => subjectsOf(openDefinitions), [openDefinitions]);
  const allSubjects = useMemo(() => subjectsOf(visibleDefinitions), [visibleDefinitions]);

  /**
   * Chưa mở quy trình nào thì lọc theo toàn bộ đơn vị có tham gia — cột nào cũng
   * thu gọn nên chỉ còn cấp lớn nhất. Mở một quy trình thì chỉ giữ đơn vị của
   * chính quy trình đó; mở thêm quy trình nữa thì cột của nó được cộng vào.
   */
  const relevantSubjects = openDefinitions.length > 0 ? openSubjects : allSubjects;

  const effectiveExpanded = useMemo(() => {
    const derived =
      mode === 'full'
        ? new Set(rootUnitIds(organization))
        : ancestorsOfUsed(organization, openSubjects);
    for (const [id, isOpen] of manual) {
      if (isOpen) derived.add(id);
      else derived.delete(id);
    }
    return derived;
  }, [manual, mode, openSubjects, organization]);

  const fullTree = useMemo(
    () => buildHeaderTree(organization, effectiveExpanded),
    [organization, effectiveExpanded],
  );

  /**
   * Thu gọn nghĩa là CHỈ đơn vị có tham gia, không có ngoại lệ nào — kể cả khi
   * người dùng tự bấm [+]. Muốn thấy đơn vị chưa có vai trò để gán mới thì dùng
   * chế độ Mở rộng.
   */
  const tree = useMemo(
    () => (mode === 'full' ? fullTree : pruneEmpty(fullTree, relevantSubjects)),
    [fullTree, mode, relevantSubjects],
  );
  const columns = useMemo(() => flattenColumns(tree), [tree]);
  const depth = useMemo(() => treeDepth(tree), [tree]);

  const toggleColumn = (id: string) =>
    setManual((current) => {
      const next = new Map(current);
      next.set(id, !effectiveExpanded.has(id));
      return next;
    });

  const toggleRow = (id: string) =>
    setOpenRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Ghi lại cả bản nháp sau khi đổi đúng một ô — server kiểm trên trạng thái đầy đủ. */
  const writeCell = (
    definition: ProcedureDefinition,
    stepId: string,
    column: MatrixColumn,
    change: ProcedureRaciAssignment | undefined,
  ) => {
    if (!onUpdateDefinition) return;
    const steps = definition.steps.map((step) => {
      const input = toStepInput(step);
      if (step.id !== stepId) return input;
      const kept = input.assignments.filter(
        (item) => !sameSubject(item, column),
      );
      return {
        ...input,
        assignments: change
          ? [
              ...kept,
              {
                role: change.role,
                subjectType: column.subjectType,
                subjectId: column.subjectId,
                subjectLabel: column.label,
                fixedRollbackStepId: change.fixedRollbackStepId,
                eTaskSource: change.eTaskSource,
                eTaskConfig: change.eTaskConfig,
              },
            ]
          : kept,
      };
    });
    onUpdateDefinition(definition.id, steps);
    setCell(undefined);
  };

  /** Đổi SLA của một bước; vẫn ghi cả bản nháp để server kiểm trên trạng thái đầy đủ. */
  const setStepSla = (
    definition: ProcedureDefinition,
    stepId: string,
    slaHours: number | undefined,
  ) => {
    if (!onUpdateDefinition) return;
    onUpdateDefinition(
      definition.id,
      definition.steps.map((step) =>
        step.id === stepId ? { ...toStepInput(step), slaHours } : toStepInput(step),
      ),
    );
  };

  /** Đổi danh sách vật tư của một bước; ghi cả bản nháp như mọi thao tác khác. */
  const setStepMaterials = (
    definition: ProcedureDefinition,
    stepId: string,
    materials: ProcedureStepMaterial[],
  ) => {
    if (!onUpdateDefinition) return;
    onUpdateDefinition(
      definition.id,
      definition.steps.map((step) =>
        step.id === stepId
          ? { ...toStepInput(step), materials: materials.length ? materials : undefined }
          : toStepInput(step),
      ),
    );
  };

  /** Quy trình đã công bố mới mở hồ sơ được, nên chỉ những cái đó làm đích nối tiếp. */
  const publishedDefinitions = useMemo(
    () => definitions.filter((item) => item.status === 'published'),
    [definitions],
  );

  const setStepLink = (
    definition: ProcedureDefinition,
    stepId: string,
    linkedDefinitionId: string | undefined,
  ) => {
    if (!onUpdateDefinition) return;
    onUpdateDefinition(
      definition.id,
      definition.steps.map((step) =>
        step.id === stepId
          ? { ...toStepInput(step), linkedDefinitionId }
          : toStepInput(step),
      ),
    );
  };

  const addStep = (definition: ProcedureDefinition, customName?: string) => {
    if (!onUpdateDefinition) return;
    const order = definition.steps.length + 1;
    const name = customName?.trim() || `Bước ${order}`;
    if (!openRows.has(definition.id)) {
      setOpenRows((prev) => new Set([...prev, definition.id]));
    }

    // Tìm mã key không bị trùng lặp với bất kỳ bước nào đang có
    const existingKeys = new Set(
      definition.steps.map((s) => s.key.trim().toUpperCase()),
    );
    let nextNum = order;
    while (existingKeys.has(`B${nextNum}`)) {
      nextNum += 1;
    }
    const key = `B${nextNum}`;

    onUpdateDefinition(definition.id, [
      ...definition.steps.map(toStepInput),
      { key, order, name, assignments: [] },
    ]);
  };

  const renameStep = (definition: ProcedureDefinition, stepId: string, newName: string) => {
    if (!onUpdateDefinition || !newName.trim()) return;
    onUpdateDefinition(
      definition.id,
      definition.steps.map((step) =>
        step.id === stepId ? { ...toStepInput(step), name: newName.trim() } : toStepInput(step),
      ),
    );
  };

  const removeStep = (definition: ProcedureDefinition, stepId: string) => {
    if (!onUpdateDefinition) return;
    const remaining = definition.steps.filter((step) => step.id !== stepId);
    if (remaining.length === 0) {
      window.alert('Quy trình phải còn ít nhất một bước.');
      return;
    }
    onUpdateDefinition(
      definition.id,
      remaining.map((step, index) => ({ ...toStepInput(step), order: index + 1 })),
    );
  };

  const totalColumns = columns.length + 1;

  return (
    <section className={styles.board}>
      <article className={styles.card}>
        <header className={styles.cardHead}>
          <h2>
            <i className={styles.dot} aria-hidden="true" />
            Bảng thiết kế quy trình
            <span className={styles.count}>
              {search.trim() || groupFilter
                ? `${visibleDefinitions.length}/${definitions.length} quy trình`
                : `${definitions.length} quy trình`}
            </span>
          </h2>
          <p>
            Bấm vào tên một quy trình để sổ các bước của nó ra; chỉ những đơn vị có tham gia quy
            trình đó hiện thành cột, mở thêm quy trình khác thì cột của nó được cộng vào. Cần gán
            vai trò cho một đơn vị hoặc cá nhân chưa tham gia thì chuyển sang{' '}
            <strong>Mở rộng</strong> để thấy toàn bộ công ty.
          </p>
          <ul className={styles.legend}>
            {ROLE_ORDER.map((role) => (
              <li key={role}>
                <i className={`${styles.role} ${styles[`role${role}`]}`}>{role}</i>
                {ROLE_LABEL[role]}
              </li>
            ))}
          </ul>
        </header>

        {/* WORKSPACE CONTROLS & ACTIONS BELOW HEADER */}
        <div className={styles.workspaceControls}>
          {/* Chuyển chế độ xem */}
          <div className={styles.workspaceToolbar}>
            <div className={styles.toolbarRight}>
              <button
                type="button"
                className={mode === 'compact' ? styles.filterOn : styles.filter}
                onClick={() => {
                  setMode('compact');
                  setManual(new Map());
                }}
                title="Chỉ hiện đơn vị có tham gia các quy trình đang mở, không hiện đơn vị nào khác."
              >
                Thu gọn
              </button>
              <button
                type="button"
                className={mode === 'full' ? styles.filterOn : styles.filter}
                onClick={() => {
                  setMode('full');
                  setManual(new Map());
                }}
                title="Hiện các đơn vị con của pháp nhân; bấm [+] trên từng cột để đi sâu tiếp và gán vai trò cho đối tượng mới."
              >
                Mở rộng
              </button>
            </div>
          </div>
        </div>

        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              {/* Mọi hàng header đều phải có key: trộn hàng có key với hàng không
                  key trong cùng một parent làm React reconcile sai khi số tầng đổi. */}
              <tr key="level-0">
                <th className={styles.corner} rowSpan={depth}>
                  <div className={styles.cornerHeader}>
                    <span className={styles.cornerTitle}>Danh mục Quy trình &amp; Các bước</span>
                    <span className={styles.cornerHint}>
                      {openDefinitions.length === 0
                        ? `${definitions.length} quy trình · bấm để mở`
                        : `${openDefinitions.length}/${definitions.length} quy trình đang mở · ${columns.length} cột`}
                    </span>
                  </div>

                  <div className={styles.cornerControls}>
                    {onCreateDefinition ? (
                      <button
                        type="button"
                        className={styles.cornerAddBtn}
                        onClick={() => setCreateModalOpen(true)}
                        disabled={busy}
                        title="Thêm quy trình mới"
                      >
                        <span aria-hidden="true">+</span> Thêm mới
                      </button>
                    ) : null}
                    <input
                      className={styles.cornerSearchInput}
                      type="search"
                      placeholder="Tìm quy trình, đơn vị…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      aria-label="Tìm quy trình"
                    />
                    {groups && groups.length > 0 ? (
                      <select
                        className={styles.cornerGroupSelect}
                        value={groupFilter}
                        onChange={(event) => setGroupFilter(event.target.value)}
                        aria-label="Lọc theo nhóm quy trình"
                      >
                        <option value="">Tất cả nhóm</option>
                        {groups.map((group) => (
                          <option key={group.code} value={group.code}>
                            {group.label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                </th>
                {renderHeaderLevel(tree, 0, depth, effectiveExpanded, toggleColumn)}
              </tr>
              {Array.from({ length: depth - 1 }, (_, level) => (
                <tr key={`level-${level + 1}`}>
                  {renderHeaderLevel(tree, level + 1, depth, effectiveExpanded, toggleColumn)}
                </tr>
              ))}
            </thead>

            <tbody>
              {visibleDefinitions.length === 0 ? (
                <tr>
                  <td colSpan={totalColumns} className={styles.empty}>
                    {definitions.length === 0
                      ? 'Chưa có quy trình nào. Dùng ô bên dưới để tạo quy trình đầu tiên.'
                      : 'Không có quy trình nào thuộc nhóm đang lọc.'}
                  </td>
                </tr>
              ) : null}

              {visibleDefinitions.map((definition) => (
                <DefinitionRows
                  key={definition.id}
                  definition={definition}
                  columns={columns}
                  expandedIds={effectiveExpanded}
                  open={openRows.has(definition.id)}
                  editable={editable && definition.status === 'draft'}
                  busy={busy}
                  onToggle={() => toggleRow(definition.id)}
                  onAddStep={(name) => addStep(definition, name)}
                  onRenameStep={(stepId, name) => renameStep(definition, stepId, name)}
                  onRemoveStep={(stepId) => removeStep(definition, stepId)}
                  onPublish={
                    onPublishDefinition ? () => onPublishDefinition(definition.id) : undefined
                  }
                  onRevise={
                    editable && onReviseDefinition
                      ? () => onReviseDefinition(definition.id)
                      : undefined
                  }
                  onPickCell={(stepId, column, anchor) =>
                    setCell({ definitionId: definition.id, stepId, column, anchor })
                  }
                  groups={groups}
                  onChangeGroup={
                    onChangeGroupDefinition
                      ? (category) => onChangeGroupDefinition(definition.id, category)
                      : undefined
                  }
                  onDelete={
                    onDeleteDefinition ? () => onDeleteDefinition(definition.id) : undefined
                  }
                  onSetStepSla={(stepId, slaHours) => setStepSla(definition, stepId, slaHours)}
                  materialCatalog={materialCatalog}
                  onSetStepMaterials={(stepId, materials) =>
                    setStepMaterials(definition, stepId, materials)
                  }
                  onSetStepLink={(stepId, linkedDefinitionId) =>
                    setStepLink(definition, stepId, linkedDefinitionId)
                  }
                  linkTargets={publishedDefinitions}
                />
              ))}
            </tbody>

          </table>
        </div>
      </article>

      {cell ? (
        <RolePopover
          target={cell}
          definition={definitions.find((item) => item.id === cell.definitionId)}
          busy={busy}
          onClose={() => setCell(undefined)}
          onApply={(change) => {
            const definition = definitions.find((item) => item.id === cell.definitionId);
            if (definition) writeCell(definition, cell.stepId, cell.column, change);
          }}
        />
      ) : null}

      {/* POPUP FORM DIALOG: THÊM QUY TRÌNH MỚI */}
      {onCreateDefinition ? (
        <MinimalPopupForm
          isOpen={createModalOpen}
          title="Thêm Quy Trình Mới"
          subtitle="Khởi tạo một quy trình mới vào bảng thiết kế và ma trận RACI"
          onClose={() => setCreateModalOpen(false)}
        >
          <form
            className={styles.popupBody}
            onSubmit={(event) => {
              event.preventDefault();
              if (!newCode.trim() || !newName.trim()) return;
              onCreateDefinition({
                code: newCode.trim().toUpperCase(),
                name: newName.trim(),
                kind: 'process',
                category: newGroup || undefined,
              });
              setNewCode('');
              setNewName('');
              setNewGroup('');
              setCreateModalOpen(false);
            }}
          >
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Mã quy trình <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className={styles.formInput}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
                placeholder="VD: QT-MUA-VT, QT-BT-MBA..."
                value={newCode}
                onChange={(event) => setNewCode(event.target.value)}
                autoFocus
                required
              />
              <span className={styles.formHint}>Mã viết hoa, ngắn gọn, phân tách bằng dấu gạch ngang</span>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Tên quy trình <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className={styles.formInput}
                placeholder="VD: Mua sắm vật tư kỹ thuật, Bảo trì định kỳ máy biến áp..."
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                required
              />
            </div>

            {groups && groups.length > 0 ? (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Nhóm / Danh mục quy trình</label>
                <select
                  className={styles.formSelect}
                  value={newGroup}
                  onChange={(event) => setNewGroup(event.target.value)}
                >
                  <option value="">Chưa phân nhóm</option>
                  {groups.map((group) => (
                    <option key={group.code} value={group.code}>
                      {group.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className={styles.popupFoot}>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => setCreateModalOpen(false)}
              >
                Huỷ bỏ
              </button>
              <button
                type="submit"
                className={styles.primarySubmitBtn}
                disabled={busy || !newCode.trim() || !newName.trim()}
              >
                {busy ? 'Đang tạo…' : '+ Tạo Quy Trình'}
              </button>
            </div>
          </form>
        </MinimalPopupForm>
      ) : null}
    </section>
  );
}

/**
 * Một hàng header. Node lá nằm ở tầng cạn hơn được kéo dài xuống hết bảng bằng
 * rowSpan, nhờ đó lưới header phủ kín mà không chồng ô.
 */
function renderHeaderLevel(
  nodes: readonly HeaderNode[],
  level: number,
  depth: number,
  expanded: ReadonlySet<string>,
  onToggle: (id: string) => void,
): ReactNode[] {
  const cells: ReactNode[] = [];

  const walk = (node: HeaderNode, current: number) => {
    if (current === level) {
      const isLeaf = node.children.length === 0;
      cells.push(
        <th
          key={node.key}
          colSpan={isLeaf ? 1 : leafCount(node)}
          rowSpan={isLeaf ? depth - level : 1}
          className={[
            isLeaf ? styles.leafHead : styles.groupHead,
            node.highlight === 'head' ? styles.headOfUnit : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.headLabel}>
            {node.toggleId ? (
              <button
                type="button"
                className={styles.expander}
                onClick={() => onToggle(node.toggleId ?? '')}
                title={expanded.has(node.toggleId) ? 'Thu gọn cột' : 'Sổ ngang xuống cấp dưới'}
                aria-label={expanded.has(node.toggleId) ? 'Thu gọn cột' : 'Sổ ngang xuống cấp dưới'}
              >
                {expanded.has(node.toggleId) ? '−' : '+'}
              </button>
            ) : null}
            {node.label}
          </span>
          {node.caption ? <span className={styles.headCaption}>{node.caption}</span> : null}
        </th>,
      );
      return;
    }
    for (const child of node.children) walk(child, current + 1);
  };

  for (const node of nodes) walk(node, 0);
  return cells;
}

function DefinitionRows({
  definition,
  columns,
  expandedIds,
  open,
  editable,
  busy,
  onToggle,
  onAddStep,
  onRenameStep,
  onRemoveStep,
  onPublish,
  onRevise,
  onDelete,
  groups,
  onChangeGroup,
  onPickCell,
  onSetStepSla,
  materialCatalog,
  onSetStepMaterials,
  onSetStepLink,
  linkTargets,
}: {
  definition: ProcedureDefinition;
  columns: readonly MatrixColumn[];
  expandedIds: ReadonlySet<string>;
  open: boolean;
  editable: boolean;
  busy: boolean;
  onToggle: () => void;
  onAddStep: (name?: string) => void;
  onRenameStep?: (stepId: string, name: string) => void;
  onRemoveStep: (stepId: string) => void;
  onPublish?: () => void;
  onRevise?: () => void;
  onDelete?: () => void;
  groups?: readonly { code: string; label: string }[];
  /** Đổi nhóm — chạy được cả khi quy trình đã công bố, khác mọi thao tác sửa khác. */
  onChangeGroup?: (category: string | undefined) => void;
  onPickCell: (stepId: string, column: MatrixColumn, anchor: { top: number; left: number }) => void;
  onSetStepSla?: (stepId: string, slaHours?: number) => void;
  materialCatalog?: readonly { code: string; name: string; unit: string }[];
  onSetStepMaterials?: (stepId: string, materials: ProcedureStepMaterial[]) => void;
  onSetStepLink?: (stepId: string, linkedDefinitionId?: string) => void;
  /** Các quy trình đã công bố, để chọn làm bước nối tiếp. */
  linkTargets: readonly ProcedureDefinition[];
}) {
  const [deleteConfirmAnchor, setDeleteConfirmAnchor] = useState<{
    top: number;
    left: number;
    arrowLeft: number;
    placement: 'top' | 'bottom';
  } | null>(null);
  const stepKeyById = new Map(definition.steps.map((step) => [step.id, step.key]));

  const handleDeleteClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (deleteConfirmAnchor) {
      setDeleteConfirmAnchor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement = spaceAbove > 180 || spaceAbove > spaceBelow ? 'top' : 'bottom';
    const top = placement === 'top' ? rect.top - 8 : rect.bottom + 8;
    const boxWidth = 280;
    const btnCenterX = rect.left + rect.width / 2;
    const left = Math.max(16, Math.min(window.innerWidth - boxWidth - 16, btnCenterX - 36));
    const arrowLeft = Math.max(12, Math.min(boxWidth - 20, btnCenterX - left - 4));
    setDeleteConfirmAnchor({ top, left, arrowLeft, placement });
  };

  /**
   * Nhãn gộp cho một tập phân công: “R, C[B2], I”. C kèm mã bước quay về.
   */
  const labelRoles = (assignments: readonly ProcedureRaciAssignment[]) => {
    const parts: string[] = [];
    for (const role of ROLE_ORDER) {
      const match = assignments.find((item) => item.role === role);
      if (!match) continue;
      const rollback = match.fixedRollbackStepId
        ? stepKeyById.get(match.fixedRollbackStepId)
        : undefined;
      parts.push(rollback ? `${role}[${rollback}]` : role);
    }
    return parts;
  };

  /**
   * Phân công “thuộc về” một cột. Cột đang thu gọn phải gánh luôn vai trò của
   * đơn vị con và cá nhân bên dưới, nếu không thu gọn lại là làm biến mất cấu
   * hình mà người dùng đã đặt.
   */
  const ownedBy = (column: MatrixColumn, assignments: readonly ProcedureRaciAssignment[]) => {
    const direct = assignments.filter((item) => sameSubject(item, column));
    const collapsed = !expandedIds.has(column.subjectId);
    const deeper = collapsed
      ? assignments.filter((item) => column.descendantSubjectIds.includes(item.subjectId))
      : [];

    /**
     * Vai gán ở CẤP ĐƠN VỊ chảy xuống thành viên, đúng luật backend đang chạy
     * (`actingSubjectIds`): vai S giao cho MỌI thành viên trong đơn vị, các vai
     * còn lại giao cho TRƯỞNG ĐƠN VỊ.
     *
     * Chỉ là hiển thị suy ra, không phải phân công riêng: dữ liệu vẫn chỉ có một
     * dòng gán ở cấp đơn vị. Không vẽ ra thì người thiết kế sổ đơn vị ra sẽ thấy
     * các ô trống và tưởng chưa gán ai, trong khi lúc chạy thật những người này
     * mới là người có quyền thao tác.
     */
    const inherited = column.unitId
      ? assignments.filter(
          (item) =>
            item.subjectId === column.unitId &&
            item.subjectType !== 'user' &&
            (item.role === 'S' || column.isHead === true),
        )
      : [];

    return { direct, deeper, inherited };
  };

  /** Dòng tổng hợp: gom vai trò của mọi bước theo từng cột. */
  const summary = (column: MatrixColumn) => {
    const all = definition.steps.flatMap((step) => step.assignments);
    const { direct, deeper, inherited } = ownedBy(column, all);
    return labelRoles([...direct, ...deeper, ...inherited]);
  };

  return (
    <>
      <tr className={styles.definitionRow}>
        <td className={styles.stickyCell}>
          <div className={styles.definitionCell}>
          {/* Nút thao tác gom về bên trái, luôn nằm trên một hàng ngang: trước
              đây chúng đứng cuối một hàng dài nên "Xoá" bị đẩy xuống dòng. */}
          <div className={styles.rowTools}>
            {editable && onPublish ? (
              <button type="button" className={styles.publish} onClick={onPublish} disabled={busy}>
                Công bố
              </button>
            ) : null}
            {!editable && onRevise ? (
              <button
                type="button"
                className={styles.stepAdd}
                onClick={onRevise}
                disabled={busy}
                title="Chuyển về bản nháp để sửa phân vai. Hồ sơ đang chạy không bị ảnh hưởng, nhưng không mở được hồ sơ mới cho tới khi công bố lại."
              >
                Sửa
              </button>
            ) : null}
            {onChangeGroup && groups && groups.length > 0 ? (
              <select
                className={styles.groupPicker}
                value={definition.category ?? ''}
                disabled={busy}
                title="Nhóm quy trình. Đổi được cả khi đã công bố — nhóm chỉ để phân loại, không ảnh hưởng hồ sơ đang chạy."
                aria-label={`Nhóm của quy trình ${definition.name}`}
                onChange={(event) => onChangeGroup(event.target.value || undefined)}
              >
                <option value="">— Chưa có nhóm —</option>
                {groups.map((group) => (
                  <option key={group.code} value={group.code}>
                    {group.label}
                  </option>
                ))}
              </select>
            ) : null}
            {onDelete ? (
              <div className={styles.popconfirmWrapper}>
                <button
                  type="button"
                  className={styles.deleteDefinition}
                  disabled={busy}
                  title="Xoá hẳn quy trình. Chỉ xoá được khi không còn hồ sơ nào dùng nó."
                  onClick={handleDeleteClick}
                >
                  Xoá
                </button>

                {deleteConfirmAnchor && typeof document !== 'undefined'
                  ? createPortal(
                      <div className={styles.popconfirmPortalLayer}>
                        <div
                          className={styles.popconfirmBackdrop}
                          onClick={() => setDeleteConfirmAnchor(null)}
                        />
                        <div
                          className={`${styles.popconfirmBox} ${
                            deleteConfirmAnchor.placement === 'bottom'
                              ? styles.popconfirmBoxBottom
                              : styles.popconfirmBoxTop
                          }`}
                          style={{
                            position: 'fixed',
                            top: `${deleteConfirmAnchor.top}px`,
                            left: `${deleteConfirmAnchor.left}px`,
                            zIndex: 99999,
                          }}
                        >
                          <div
                            className={
                              deleteConfirmAnchor.placement === 'bottom'
                                ? styles.popconfirmArrowTop
                                : styles.popconfirmArrowBottom
                            }
                            style={{ left: `${deleteConfirmAnchor.arrowLeft}px` }}
                          />
                          <div className={styles.popconfirmTitle}>
                            Xoá quy trình “{definition.name}”?
                          </div>
                          <div className={styles.popconfirmDesc}>
                            Hành động này sẽ xoá vĩnh viễn cấu hình quy trình ({definition.code}). Chỉ thực hiện được khi chưa có hồ sơ phát sinh.
                          </div>
                          <div className={styles.popconfirmActions}>
                            <button
                              type="button"
                              className={styles.popconfirmCancelBtn}
                              onClick={() => setDeleteConfirmAnchor(null)}
                            >
                              Huỷ
                            </button>
                            <button
                              type="button"
                              className={styles.popconfirmDangerBtn}
                              onClick={() => {
                                setDeleteConfirmAnchor(null);
                                onDelete();
                              }}
                            >
                              Xác nhận xoá
                            </button>
                          </div>
                        </div>
                      </div>,
                      document.body,
                    )
                  : null}
              </div>
            ) : null}
          </div>

          <div className={styles.definitionMain}>
          {/* Hàng 1: mã và tên. Hàng 2: trạng thái công bố và thao tác.
                Cả hàng 1 là vùng bấm, không chỉ dấu +/− — đích bấm to hơn nhiều
                và người dùng vốn nhắm vào tên quy trình chứ không nhắm vào ký
                hiệu nhỏ trước mã. Dùng cùng dấu +/− với cột đơn vị để một ký
                hiệu chỉ mang một nghĩa trên toàn bảng. */}
            <button
              type="button"
              className={styles.rowToggle}
              onClick={onToggle}
              aria-expanded={open}
              title={open ? 'Thu gọn các bước' : 'Sổ các bước và phân vai'}
            >
              <span className={styles.expander} aria-hidden="true">
                {open ? '−' : '+'}
              </span>
              <span className={styles.codeChip}>{definition.code}</span>
              <span>
                <strong>{definition.name}</strong>
                <small>
                  {definition.steps.length} bước · v{definition.versionNumber}
                  {open ? '' : ' · bấm để xem phân vai'}
                </small>
              </span>
            </button>

            <div className={styles.definitionMeta}>
              <span className={`${styles.status} ${styles[definition.status]}`}>
                {definition.status === 'draft' ? 'Nháp' : 'Đã công bố'}
              </span>
            </div>
          </div>
          </div>
        </td>
        {columns.map((column) => {
          const roles = summary(column);
          return (
            <td key={column.key} className={styles.summaryCell}>
              {roles.length > 0 ? <span className={styles.summaryPill}>{roles.join(', ')}</span> : '–'}
            </td>
          );
        })}
      </tr>

      {open
        ? definition.steps.flatMap((step) => [
            <tr key={step.id} className={styles.stepRow}>
              <td className={styles.stickyCell}>
                <div className={styles.stickyInner}>
                <span className={styles.stepOrderBadge}>{step.order}</span>
                {editable ? (
                  <input
                    className={styles.stepNameInput}
                    defaultValue={step.name}
                    title="Click để đổi tên bước trực tiếp trên bảng"
                    onBlur={(event) => {
                      const val = event.target.value.trim();
                      if (val && val !== step.name) {
                        onRenameStep?.(step.id, val);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                ) : (
                  <span className={styles.stepName}>
                    {step.name}
                  </span>
                )}
                {editable ? (
                  <label className={styles.slaInput} title="Cam kết thời gian hoàn thành bước, tính bằng giờ. Bỏ trống là không có SLA.">
                    SLA
                    <input
                      type="number"
                      min={1}
                      max={8760}
                      step={1}
                      placeholder="—"
                      defaultValue={step.slaHours ?? ''}
                      disabled={busy}
                      onBlur={(event) => {
                        const raw = event.target.value.trim();
                        const next = raw === '' ? undefined : Number(raw);
                        if (next === step.slaHours) return;
                        onSetStepSla?.(step.id, next);
                      }}
                    />
                    <span>giờ</span>
                  </label>
                ) : step.slaHours ? (
                  <span className={styles.slaTag}>SLA {step.slaHours}h</span>
                ) : null}
                {/* Vật tư KHÔNG còn khai lúc thiết kế. Người trực tiếp làm mới
                    biết cần gì; khai sẵn ở đây chỉ tạo một danh sách phỏng đoán
                    mà không ai sửa được lúc chạy. Bước cũ đã khai thì vẫn hiện
                    để không giấu mất dữ liệu đang có. */}
                {step.materials?.length ? (
                  <span className={styles.materialTag}>{step.materials.length} vật tư</span>
                ) : null}
                {editable ? (
                  <label
                    className={styles.linkSelect}
                    title="Bước này xong thì tự mở hồ sơ cho quy trình được chọn."
                  >
                    Nối tiếp
                    <select
                      value={step.linkedDefinitionId ?? ''}
                      disabled={busy}
                      onChange={(event) =>
                        onSetStepLink?.(step.id, event.target.value || undefined)
                      }
                    >
                      <option value="">— không —</option>
                      {linkTargets
                        .filter((candidate) => candidate.id !== definition.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.code}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : step.linkedDefinitionId ? (
                  <span className={styles.linkChip}>
                    → {linkTargets.find((c) => c.id === step.linkedDefinitionId)?.code ?? 'liên kết'}
                  </span>
                ) : null}
                {step.linkedDefinitionId ? (
                  <span className={styles.linkChip}>liên kết</span>
                ) : null}
                {editable ? (
                  <button
                    type="button"
                    className={styles.stepRemove}
                    onClick={() => onRemoveStep(step.id)}
                    disabled={busy}
                    aria-label={`Xoá bước ${step.name}`}
                  >
                    ×
                  </button>
                ) : null}
                </div>
              </td>
              {columns.map((column) => {
                const { direct: directList, deeper, inherited } = ownedBy(column, step.assignments);
                const direct = directList[0];
                const rollbackKey = direct?.fixedRollbackStepId
                  ? stepKeyById.get(direct.fixedRollbackStepId)
                  : undefined;
                const open = (event: { currentTarget: HTMLElement }) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  onPickCell(step.id, column, { top: box.bottom + 4, left: box.left });
                };

                /**
                 * Không có vai trực tiếp, nhưng đơn vị cấp trên đã gán và vai đó
                 * chảy xuống người này. Vẽ mờ để phân biệt với vai gán đích danh,
                 * và KHÔNG cho bấm: sửa phải sửa ở ô cấp đơn vị, chứ bấm vào đây
                 * sẽ đẻ ra một phân công thứ hai chồng lên cái đang có.
                 */
                if (!direct && inherited.length > 0) {
                  const roles = labelRoles(inherited).join(', ');
                  const why = inherited.every((item) => item.role === 'S')
                    ? 'Vai S gán ở cấp đơn vị nên mọi thành viên đều nhận.'
                    : 'Vai gán ở cấp đơn vị nên trưởng đơn vị nhận.';
                  return (
                    <td key={column.key} className={styles.cell}>
                      <span
                        className={styles.cellInherited}
                        title={`${roles} — ${why} Sửa ở ô cấp đơn vị.`}
                      >
                        {roles}
                      </span>
                    </td>
                  );
                }

                // Không có vai trò trực tiếp nhưng cấp dưới có: ô hiện chip gộp
                // nét đứt. Bấm vào vẫn gán được vai trò cho chính cấp này.
                if (!direct && deeper.length > 0) {
                  return (
                    <td key={column.key} className={styles.cell}>
                      <button
                        type="button"
                        className={styles.cellRollup}
                        disabled={!editable || busy}
                        title={`Cấu hình nằm ở cấp dưới của “${column.label}”. Sổ cột ra để xem chi tiết.`}
                        onClick={open}
                      >
                        {labelRoles(deeper).join(', ')}
                      </button>
                    </td>
                  );
                }

                return (
                  <td key={column.key} className={styles.cell}>
                    <button
                      type="button"
                      className={`${styles.cellButton} ${
                        direct ? styles[`role${direct.role}`] : styles.cellEmpty
                      }`}
                      disabled={!editable || busy}
                      title={
                        editable
                          ? `${column.label} · ${step.name}`
                          : 'Bản đã công bố không sửa được. Bấm nút “Sửa” ở đầu dòng quy trình để đưa về nháp, sửa xong thì bấm “Công bố” lại.'
                      }
                      onClick={open}
                    >
                      {direct ? direct.role : '–'}
                      {rollbackKey ? <em className={styles.rollback}>{rollbackKey}</em> : null}
                    </button>
                    {deeper.length > 0 ? (
                      <span className={styles.deeper}>+ {labelRoles(deeper).join(', ')} ở cấp dưới</span>
                    ) : null}
                  </td>
                );
              })}
            </tr>,
          ])
        : null}

      {/* DIRECT INLINE ADD STEP ROW */}
      {open && editable ? (
        <tr key="direct-add-step" className={styles.addStepRow}>
          <td className={styles.stickyCell}>
            <div className={styles.addStepInner}>
              <form
                className={styles.addStepForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const input = form.elements.namedItem('directStepName') as HTMLInputElement;
                  const val = input?.value?.trim();
                  onAddStep(val || undefined);
                  if (input) input.value = '';
                }}
              >
                <span className={styles.addStepNumberBadge}>
                  +{definition.steps.length + 1}
                </span>
                <input
                  name="directStepName"
                  className={styles.addStepInput}
                  placeholder={`Nhập tên bước ${definition.steps.length + 1} (Enter để thêm vào bảng)…`}
                  autoComplete="off"
                  disabled={busy}
                />
                <button
                  type="submit"
                  className={styles.addStepButton}
                  disabled={busy}
                  title="Thêm bước trực tiếp vào bảng"
                >
                  <span aria-hidden="true">+</span> Thêm bước
                </button>
              </form>
            </div>
          </td>
          {columns.map((column) => (
            <td key={column.key} className={styles.addStepEmptyCell}></td>
          ))}
        </tr>
      ) : null}
    </>
  );
}

/**
 * Khai vật tư cho một bước.
 *
 * Chọn từ danh mục Kho chứ không gõ mã tự do: mã sai chỉ lộ ra lúc công bố, và
 * lúc đó người thiết kế đã quên mình gõ gì.
 */

/** Dùng position: fixed vì container bảng có overflow sẽ cắt popover absolute. */
function RolePopover({
  target,
  definition,
  busy,
  onClose,
  onApply,
}: {
  target: CellTarget;
  definition?: ProcedureDefinition;
  busy: boolean;
  onClose: () => void;
  onApply: (change: ProcedureRaciAssignment | undefined) => void;
}) {
  const step = definition?.steps.find((item) => item.id === target.stepId);
  const current = step?.assignments.find(
    (item) =>
      sameSubject(item, target.column),
  );
  const priorSteps = (definition?.steps ?? []).filter(
    (item) => step !== undefined && item.order < step.order,
  );
  const [rollback, setRollback] = useState(
    current?.fixedRollbackStepId ?? priorSteps.at(-1)?.id ?? '',
  );
  const [pendingRole, setPendingRole] = useState<ProcedureRaciRole>();

  const cTakenElsewhere = Boolean(
    step?.assignments.some(
      (item) => item.role === 'C' && item.subjectId !== target.column.subjectId,
    ),
  );
  // E phải là người phụ trách đơn vị. Chặn ngay tại nút thay vì để người dùng
  // gán rồi mới báo lỗi lúc công bố.
  const eNeedsUnit = target.column.subjectType !== 'organization_unit';

  const apply = (role: ProcedureRaciRole) => {
    if (role === 'C' && priorSteps.length > 0 && !rollback) {
      setPendingRole('C');
      return;
    }
    onApply({
      id: current?.id ?? '',
      role,
      subjectType: target.column.subjectType,
      subjectId: target.column.subjectId,
      subjectLabel: target.column.label,
      fixedRollbackStepId: role === 'C' && rollback ? rollback : undefined,
      // Thiết bị KHÔNG còn khai lúc thiết kế. Một quy trình bảo trì dùng chung
      // cho cả dãy máy, khai cứng ở đây thì mọi phiếu sinh ra đều trỏ về đúng
      // một máy. Người giữ vai E chọn thiết bị lúc chạy, ở màn phân rã công việc.
      eTaskSource: undefined,
      eTaskConfig: undefined,
    });
  };

  const [pos, setPos] = useState<{ top: number; left: number }>(() => ({
    top: target.anchor.top,
    left: target.anchor.left,
  }));

  useEffect(() => {
    const popoverWidth = 280;
    const popoverHeight = 320;
    const margin = 12;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = target.anchor.left;
    let top = target.anchor.top;

    if (left + popoverWidth > viewportWidth - margin) {
      left = Math.max(margin, viewportWidth - popoverWidth - margin);
    }
    if (left < margin) {
      left = margin;
    }

    if (top + popoverHeight > viewportHeight - margin) {
      const aboveTop = target.anchor.top - popoverHeight - 8;
      if (aboveTop >= margin) {
        top = aboveTop;
      } else {
        top = Math.max(margin, viewportHeight - popoverHeight - margin);
      }
    }

    setPos({ top, left });
  }, [target.anchor.top, target.anchor.left]);

  return (
    <>
      <div className={styles.overlay} onClick={onClose} role="presentation" />
      <div
        className={styles.popover}
        style={{
          top: pos.top,
          left: pos.left,
          maxHeight: 'calc(100vh - 24px)',
          overflowY: 'auto',
        }}
      >
        <header>
          <strong>{target.column.label}</strong>
          <small>
            {target.column.caption ? `${target.column.caption} · ` : ''}
            {step?.name}
          </small>
        </header>

        <div className={styles.roleGrid}>
          {ROLE_ORDER.map((role) => (
            <button
              key={role}
              type="button"
              className={`${styles.roleChoice} ${styles[`role${role}`]} ${
                current?.role === role ? styles.roleChoiceActive : ''
              }`}
              disabled={busy || (role === 'C' && cTakenElsewhere) || (role === 'E' && eNeedsUnit)}
              title={
                role === 'C' && cTakenElsewhere
                  ? 'Bước này đã có vai trò C ở cột khác.'
                  : role === 'E' && eNeedsUnit
                    ? 'Vai trò E chỉ gán được ở cấp đơn vị — nó định tuyến tới người phụ trách đơn vị.'
                    : ROLE_LABEL[role]
              }
              onClick={() => apply(role)}
            >
              {role}
            </button>
          ))}
        </div>

        {pendingRole === 'C' || current?.role === 'C' ? (
          <label className={styles.field}>
            Bước quay về khi C trả lại
            <select value={rollback} onChange={(event) => setRollback(event.target.value)}>
              <option value="">— Không quay về —</option>
              {priorSteps.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.key} · {item.name}
                </option>
              ))}
            </select>
            {pendingRole === 'C' ? (
              <button type="button" className={styles.confirm} onClick={() => apply('C')}>
                Lưu vai trò C
              </button>
            ) : null}
          </label>
        ) : null}

        {current?.role === 'E' ? (
          <p className={styles.fieldHint}>
            Thiết bị và vật tư do người giữ vai E chọn lúc chạy, ở màn “Phân rã việc”.
          </p>
        ) : null}

        <button
          type="button"
          className={styles.clear}
          disabled={busy || !current}
          onClick={() => onApply(undefined)}
        >
          Xoá vai trò khỏi ô này
        </button>
      </div>
    </>
  );
}
