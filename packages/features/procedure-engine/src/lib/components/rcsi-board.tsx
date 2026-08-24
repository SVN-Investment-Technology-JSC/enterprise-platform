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
import { useMemo, useState, type ReactNode } from 'react';
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
  busy = false,
  onCreateDefinition,
  onUpdateDefinition,
  onPublishDefinition,
  onReviseDefinition,
  onDeleteDefinition,
}: {
  definitions: readonly ProcedureDefinition[];
  organization?: TenantOrganizationSnapshot;
  busy?: boolean;
  onCreateDefinition?: (input: {
    code: string;
    name: string;
    kind: ProcedureDefinition['kind'];
  }) => void;
  onUpdateDefinition?: (definitionId: string, steps: CreateProcedureStepInput[]) => void;
  /** Danh mục vật tư lấy từ Kho, để chọn thay vì gõ mã tự do. */
  materialCatalog?: readonly { code: string; name: string; unit: string }[];
  onDeleteDefinition?: (definitionId: string) => void;
  onPublishDefinition?: (definitionId: string) => void;
  onReviseDefinition?: (definitionId: string) => void;
}) {
  /**
   * Mặc định mọi quy trình đều đóng: bảng mở ra chỉ có tên quy trình và cột đơn
   * vị ở cấp lớn nhất. Cột hiển thị suy ra từ quy trình nào đang mở, nên không
   * cần một bộ lọc cột riêng nữa.
   */
  const [mode, setMode] = useState<'compact' | 'full'>('compact');
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  /** Người dùng tự bấm [+]/[−] trên một cột: ghi đè trạng thái suy ra. */
  const [manual, setManual] = useState<Map<string, boolean>>(new Map());
  const [cell, setCell] = useState<CellTarget>();
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');

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
  }, [definitions, search]);

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
        (item) => !(item.subjectType === column.subjectType && item.subjectId === column.subjectId),
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

  const addStep = (definition: ProcedureDefinition) => {
    if (!onUpdateDefinition) return;
    const order = definition.steps.length + 1;
    const name = window.prompt('Tên bước mới', `Bước ${order}`);
    if (!name?.trim()) return;
    onUpdateDefinition(definition.id, [
      ...definition.steps.map(toStepInput),
      { key: `B${order}`, order, name: name.trim(), assignments: [] },
    ]);
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
          <div>
            <h2>
              <i className={styles.dot} aria-hidden="true" />
              Bảng thiết kế quy trình
              <span className={styles.count}>
                {search.trim()
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
          </div>
          <div className={styles.cardActions}>
            <input
              className={styles.searchBox}
              type="search"
              placeholder="Tìm theo tên quy trình hoặc đơn vị tham gia…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Tìm quy trình"
            />
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
        </header>

        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              {/* Mọi hàng header đều phải có key: trộn hàng có key với hàng không
                  key trong cùng một parent làm React reconcile sai khi số tầng đổi. */}
              <tr key="level-0">
                <th className={styles.corner} rowSpan={depth}>
                  <span className={styles.cornerTitle}>Danh mục Quy trình &amp; Các bước</span>
                  <span className={styles.cornerHint}>
                    {openDefinitions.length === 0
                      ? `${definitions.length} quy trình · bấm để mở`
                      : `${openDefinitions.length}/${definitions.length} quy trình đang mở · ${columns.length} cột`}
                  </span>
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
                  onAddStep={() => addStep(definition)}
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

            {editable && onCreateDefinition ? (
              <tfoot>
                <tr>
                  <td colSpan={totalColumns}>
                    <form
                      className={styles.newForm}
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!newCode.trim() || !newName.trim()) return;
                        onCreateDefinition({
                          code: newCode.trim().toUpperCase(),
                          name: newName.trim(),
                          kind: 'process',
                        });
                        setNewCode('');
                        setNewName('');
                      }}
                    >
                      <input
                        className={styles.codeInput}
                        placeholder="Mã (VD: QT-MUA-VT)"
                        value={newCode}
                        onChange={(event) => setNewCode(event.target.value)}
                      />
                      <input
                        className={styles.nameInput}
                        placeholder="Thêm quy trình mới vào bảng…"
                        value={newName}
                        onChange={(event) => setNewName(event.target.value)}
                      />
                      <button type="submit" className={styles.addDefinition} disabled={busy}>
                        <span aria-hidden="true">+</span> Thêm Quy Trình
                      </button>
                    </form>
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

        <ul className={styles.legend}>
          {ROLE_ORDER.map((role) => (
            <li key={role}>
              <i className={`${styles.role} ${styles[`role${role}`]}`}>{role}</i>
              {ROLE_LABEL[role]}
            </li>
          ))}
        </ul>
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
          className={isLeaf ? styles.leafHead : styles.groupHead}
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
  onRemoveStep,
  onPublish,
  onRevise,
  onDelete,
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
  onAddStep: () => void;
  onRemoveStep: (stepId: string) => void;
  onPublish?: () => void;
  onRevise?: () => void;
  onDelete?: () => void;
  onPickCell: (stepId: string, column: MatrixColumn, anchor: { top: number; left: number }) => void;
  onSetStepSla?: (stepId: string, slaHours?: number) => void;
  materialCatalog?: readonly { code: string; name: string; unit: string }[];
  onSetStepMaterials?: (stepId: string, materials: ProcedureStepMaterial[]) => void;
  onSetStepLink?: (stepId: string, linkedDefinitionId?: string) => void;
  /** Các quy trình đã công bố, để chọn làm bước nối tiếp. */
  linkTargets: readonly ProcedureDefinition[];
}) {
  const stepKeyById = new Map(definition.steps.map((step) => [step.id, step.key]));
  const [materialStep, setMaterialStep] = useState<string>();
  const editingMaterials = definition.steps.find((step) => step.id === materialStep);

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
    const direct = assignments.filter(
      (item) => item.subjectType === column.subjectType && item.subjectId === column.subjectId,
    );
    const collapsed = !expandedIds.has(column.subjectId);
    const deeper = collapsed
      ? assignments.filter((item) => column.descendantSubjectIds.includes(item.subjectId))
      : [];
    return { direct, deeper };
  };

  /** Dòng tổng hợp: gom vai trò của mọi bước theo từng cột. */
  const summary = (column: MatrixColumn) => {
    const all = definition.steps.flatMap((step) => step.assignments);
    const { direct, deeper } = ownedBy(column, all);
    return labelRoles([...direct, ...deeper]);
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
            {onDelete ? (
              <button
                type="button"
                className={styles.deleteDefinition}
                disabled={busy}
                title="Xoá hẳn quy trình. Chỉ xoá được khi không còn hồ sơ nào dùng nó."
                onClick={() => {
                  if (window.confirm(`Xoá hẳn quy trình “${definition.name}” (${definition.code})?`)) {
                    onDelete();
                  }
                }}
              >
                Xoá
              </button>
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
          {editable ? (
            <button type="button" className={styles.stepAdd} onClick={onAddStep} disabled={busy}>
              <span aria-hidden="true">+</span> Bước
            </button>
          ) : null}
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
                <span className={styles.stepName}>
                  {step.order}-{step.name}
                </span>
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
                {editable ? (
                  <button
                    type="button"
                    className={styles.materialButton}
                    disabled={busy}
                    title="Vật tư và dụng cụ bước này cần. Thiếu hàng thì bước bị chặn hoàn tất."
                    onClick={() => setMaterialStep(step.id)}
                  >
                    Vật tư{step.materials?.length ? ` (${step.materials.length})` : ''}
                  </button>
                ) : step.materials?.length ? (
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
                const { direct: directList, deeper } = ownedBy(column, step.assignments);
                const direct = directList[0];
                const rollbackKey = direct?.fixedRollbackStepId
                  ? stepKeyById.get(direct.fixedRollbackStepId)
                  : undefined;
                const open = (event: { currentTarget: HTMLElement }) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  onPickCell(step.id, column, { top: box.bottom + 4, left: box.left });
                };

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
                          : 'Bản đã công bố không sửa được — bấm “Mở lại để sửa” trên dòng quy trình.'
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
            editingMaterials?.id === step.id ? (
              <tr key={`${step.id}-materials`} className={styles.materialRow}>
                <td colSpan={columns.length + 1}>
                  <MaterialEditor
                    step={step}
                    catalog={materialCatalog ?? []}
                    busy={busy}
                    onCancel={() => setMaterialStep(undefined)}
                    onSave={(materials) => {
                      onSetStepMaterials?.(step.id, materials);
                      setMaterialStep(undefined);
                    }}
                  />
                </td>
              </tr>
            ) : null,
          ])
        : null}
    </>
  );
}

/**
 * Khai vật tư cho một bước.
 *
 * Chọn từ danh mục Kho chứ không gõ mã tự do: mã sai chỉ lộ ra lúc công bố, và
 * lúc đó người thiết kế đã quên mình gõ gì.
 */
function MaterialEditor({
  step,
  catalog,
  busy,
  onCancel,
  onSave,
}: {
  step: ProcedureStepDefinition;
  catalog: readonly { code: string; name: string; unit: string }[];
  busy: boolean;
  onCancel: () => void;
  onSave: (materials: ProcedureStepMaterial[]) => void;
}) {
  const [rows, setRows] = useState<ProcedureStepMaterial[]>(
    () => step.materials?.map((item) => ({ ...item })) ?? [],
  );

  const patch = (index: number, change: Partial<ProcedureStepMaterial>) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const valid = rows.every((row) => row.materialCode && row.quantity > 0);

  return (
    <div className={styles.materialEditor}>
      <strong>Vật tư cần cho bước “{step.name}”</strong>
      <p>
        Khi hồ sơ chạy tới bước này, hệ thống kiểm tồn kho. Thiếu hàng thì bước bị chặn hoàn tất
        cho tới khi bổ sung đủ.
      </p>

      {rows.map((row, index) => {
        const item = catalog.find((candidate) => candidate.code === row.materialCode);
        return (
          <div key={index} className={styles.materialRowEdit}>
            <select
              value={row.materialCode}
              disabled={busy}
              onChange={(event) => patch(index, { materialCode: event.target.value })}
            >
              <option value="">— Chọn vật tư —</option>
              {catalog.map((candidate) => (
                <option key={candidate.code} value={candidate.code}>
                  {candidate.code} — {candidate.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              step="any"
              aria-label="Số lượng"
              value={row.quantity || ''}
              disabled={busy}
              onChange={(event) => patch(index, { quantity: Number(event.target.value) })}
            />
            <span>{item?.unit ?? row.unit ?? ''}</span>
            <button
              type="button"
              aria-label="Xoá dòng vật tư"
              disabled={busy}
              onClick={() => setRows((list) => list.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
        );
      })}

      <div className={styles.materialActions}>
        <button
          type="button"
          className={styles.ghostSmall}
          disabled={busy}
          onClick={() => setRows((list) => [...list, { materialCode: '', quantity: 1 }])}
        >
          + Dòng vật tư
        </button>
        <button
          type="button"
          className={styles.primarySmall}
          disabled={busy || !valid}
          onClick={() => onSave(rows.filter((row) => row.materialCode && row.quantity > 0))}
        >
          Lưu vật tư
        </button>
        <button type="button" className={styles.ghostSmall} disabled={busy} onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </div>
  );
}

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
      item.subjectType === target.column.subjectType && item.subjectId === target.column.subjectId,
  );
  const priorSteps = (definition?.steps ?? []).filter(
    (item) => step !== undefined && item.order < step.order,
  );
  const [rollback, setRollback] = useState(
    current?.fixedRollbackStepId ?? priorSteps.at(-1)?.id ?? '',
  );
  const [assetCode, setAssetCode] = useState(current?.eTaskConfig?.assetCode ?? '');
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
    if (role === 'E' && !assetCode.trim()) {
      setPendingRole('E');
      return;
    }
    onApply({
      id: current?.id ?? '',
      role,
      subjectType: target.column.subjectType,
      subjectId: target.column.subjectId,
      subjectLabel: target.column.label,
      fixedRollbackStepId: role === 'C' && rollback ? rollback : undefined,
      eTaskSource: role === 'E' ? 'inventory_asset' : undefined,
      eTaskConfig: role === 'E' ? { assetCode: assetCode.trim() } : undefined,
    });
  };

  return (
    <>
      <div className={styles.overlay} onClick={onClose} role="presentation" />
      <div className={styles.popover} style={{ top: target.anchor.top, left: target.anchor.left }}>
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

        {pendingRole === 'E' || current?.role === 'E' ? (
          <label className={styles.field}>
            Mã thiết bị lấy đầu việc (từ Kho)
            <input
              value={assetCode}
              onChange={(event) => setAssetCode(event.target.value)}
              placeholder="VD: MBA-T1"
            />
            {pendingRole === 'E' ? (
              <button type="button" className={styles.confirm} onClick={() => apply('E')}>
                Lưu vai trò E
              </button>
            ) : null}
          </label>
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
