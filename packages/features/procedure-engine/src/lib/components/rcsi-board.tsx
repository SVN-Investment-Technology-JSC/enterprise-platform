'use client';

import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type {
  CreateProcedureStepInput,
  ProcedureStepMaterial,
  ProcedureDefinition,
  ETaskSource,
  ProcedureAttributeDefinition,
  ProcedureGatewayDefinition,
  ProcedureRaciAssignment,
  ProcedureRaciRole,
  ProcedureStepDefinition,
  ProcedureValidationReport,
  UpdateProcedureDefinitionRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import { buildFlowIndex, dominatorStepIds } from '@enterprise-platform/contracts-procedure-engine';
import { AttributeEditor } from './rcsi/attribute-editor';
import { DynamicApproverEditor } from './rcsi/dynamic-approver-editor';
import {
  addGateway,
  addStepToBranch,
  branchLetters,
  flowRowInfo,
  moveStepToBranch,
  removeFlowStep,
  removeGateway,
  replaceGateway,
  type BranchTarget,
  type FlowChange,
} from './rcsi/flow-edit';
import { GatewayEditor } from './rcsi/gateway-editor';
import { OrgPane } from './rcsi/org-pane';
import { StepConfigDialog, type StepConfigChange } from './rcsi/step-config-dialog';
import flowStyles from './rcsi/flow-editors.module.scss';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  buildHeaderTree,
  flattenColumns,
  getAvailableTrees,
  getPositionPreviewData,
  leafCount,
  markTreeBoundaries,
  filterColumnsByText,
  pruneEmpty,
  treeDepth,
  type HeaderNode,
  type MatrixColumn,
} from './rcsi/columns';
import { MinimalPopupForm, SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  Archive,
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  Eye,
  Layers,
  Link2,
  Network,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SquarePen,
  Users,
} from 'lucide-react';
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

/** Số quy trình tối đa mỗi trang của ma trận. */
const DEFINITIONS_PER_PAGE = 10;

const E_TASK_SOURCE_OPTIONS: readonly {
  readonly value: ETaskSource;
  readonly label: string;
  readonly description: string;
}[] = [
    { value: 'manual', label: 'Tự khai báo khi thực hiện', description: 'Đơn vị thực hiện lập đầu việc khi quy trình được khởi chạy.' },
    { value: 'task_list', label: 'Danh sách đầu việc mẫu', description: 'Dùng danh sách đầu việc được cấu hình sẵn.' },
    { value: 'equipment_template', label: 'Mẫu theo loại thiết bị', description: 'Lấy đầu việc từ mẫu của loại thiết bị.' },
    { value: 'inventory_asset', label: 'Theo thiết bị cụ thể', description: 'Lấy đầu việc từ thiết bị được gắn với hồ sơ.' },
    { value: 'inventory_material', label: 'Theo vật tư', description: 'Lấy đầu việc từ vật tư được chọn.' },
  ];

/**
 * Một phân công có thuộc về một cột hay không.
 */
function sameSubject(
  assignment: Pick<ProcedureRaciAssignment, 'subjectType' | 'subjectId'>,
  column: Pick<MatrixColumn, 'subjectType' | 'subjectId'>,
): boolean {
  if (assignment.subjectId !== column.subjectId) return false;
  return (assignment.subjectType === 'user') === (column.subjectType === 'user');
}

/**
 * Kiểm tra phân công có thuộc về cột chức danh hay không:
 * - Trùng subjectId/subjectType (hoặc position/unit id tương thích qua sameSubject)
 * - Hoặc là phân công cũ ở cấp đơn vị (organization_unit) gán cho đơn vị của chức danh Quản lý (isHead === true).
 */
function isAssignedToColumn(
  assignment: Pick<ProcedureRaciAssignment, 'subjectType' | 'subjectId'>,
  column: MatrixColumn,
): boolean {
  if (sameSubject(assignment, column)) return true;
  if (
    column.isHead === true &&
    assignment.subjectType === 'organization_unit' &&
    assignment.subjectId === column.unitId
  ) {
    return true;
  }
  return false;
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
    attributes: step.attributes?.map((item) => ({ ...item })),
    assignments: step.assignments.map((item) => ({
      role: item.role,
      subjectType: item.subjectType,
      subjectId: item.subjectId,
      subjectLabel: item.subjectLabel,
      fixedRollbackStepId: item.fixedRollbackStepId,
      eTaskSource: item.eTaskSource,
      eTaskConfig: item.eTaskConfig,
      managerFallback: item.managerFallback,
    })),
  };
}

/** Mã thuộc tính đang được điều kiện rẽ nhánh dùng, theo phạm vi (quy trình / một bước). */
function usedAttributeCodes(definition: ProcedureDefinition, stepId: string | null): Set<string> {
  const codes = new Set<string>();
  for (const gateway of definition.gateways ?? []) {
    for (const branch of gateway.branches) {
      for (const rule of branch.condition?.rules ?? []) {
        const ref = rule.attribute;
        if (stepId === null ? ref.scope === 'process' : ref.scope === 'step' && ref.stepId === stepId) {
          codes.add(ref.code);
        }
      }
    }
  }
  return codes;
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
  onValidateDefinition,
  railCollapsed = false,
}: {
  /**
   * Rail điều hướng đang thu. Thu rail là để lấy chỗ cho sơ đồ tổ chức, nên
   * panel sơ đồ mở theo; mở rail thì panel ẩn, bấm nút để bật lại.
   */
  railCollapsed?: boolean;
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
  onUpdateDefinition?: (
    definitionId: string,
    steps: CreateProcedureStepInput[],
    flow?: Pick<UpdateProcedureDefinitionRequest, 'attributes' | 'gateways'>,
  ) => void;
  /** Kiểm tra trước khi công bố: trả hết lỗi và cảnh báo. */
  onValidateDefinition?: (definitionId: string) => Promise<ProcedureValidationReport>;
  /** Danh mục vật tư lấy từ Kho, để chọn thay vì gõ mã tự do. */
  materialCatalog?: readonly { code: string; name: string; unit: string }[];
  onDeleteDefinition?: (definitionId: string) => void;
  /** Đổi nhóm quy trình; dùng route riêng nên chạy được cả trên bản đã công bố. */
  onChangeGroupDefinition?: (definitionId: string, category: string | undefined) => void;
  onPublishDefinition?: (definitionId: string) => void;
  onReviseDefinition?: (definitionId: string) => void;
}) {
  /**
   * Chế độ hiển thị cột chức danh trên ma trận:
   * - 'compact': Chỉ hiện các chức danh có tham gia trong các quy trình đang mở (Đang tham gia).
   * - 'full': Hiện tất cả chức danh trong toàn công ty để thuận tiện gán vai trò mới (Tất cả chức danh).
   */
  const [mode, setMode] = useState<'compact' | 'full'>('compact');
  /** Từ khoá lọc cột chức danh trên ma trận. */
  const [positionQuery, setPositionQuery] = useState('');
  const [orgPaneOpen, setOrgPaneOpen] = useState(railCollapsed);
  // Cùng logic trang Dự án của Workspace: panel bám theo rail.
  useEffect(() => {
    setOrgPaneOpen(railCollapsed);
  }, [railCollapsed]);
  const [stepConfigTarget, setStepConfigTarget] = useState<{ definitionId: string; stepId: string }>();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const [cell, setCell] = useState<CellTarget>();
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [newGroup, setNewGroup] = useState('');
  /** Chỉ giữ trong phiên hiện tại để quy trình vừa tạo luôn dễ nhận biết ở đầu bảng. */
  const [newlyCreatedCode, setNewlyCreatedCode] = useState<string>();

  const [selectedTreeIds, setSelectedTreeIds] = useState<Set<string>>(() => new Set());
  const [treeFilterOpen, setTreeFilterOpen] = useState(false);
  const treeFilterRef = useRef<HTMLDivElement | null>(null);

  const [previewPositionId, setPreviewPositionId] = useState<string>();
  const previewData = useMemo(
    () =>
      previewPositionId ? getPositionPreviewData(organization, previewPositionId) : undefined,
    [organization, previewPositionId],
  );

  // Đóng dropdown bộ lọc sơ đồ khi click ra ngoài hoặc bấm Escape
  useEffect(() => {
    if (!treeFilterOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (treeFilterRef.current && !treeFilterRef.current.contains(event.target as Node)) {
        setTreeFilterOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTreeFilterOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [treeFilterOpen]);

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
    const filtered = definitions.filter((definition) => {
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

    // Không thay đổi thứ tự chuẩn từ máy chủ; chỉ ghim quy trình vừa tạo lên đầu
    // trong phiên hiện tại. Reload sẽ bỏ trạng thái này và quay về thứ tự chữ cái.
    if (!newlyCreatedCode) return filtered;
    return filtered.sort((left, right) => {
      const leftIsNew = left.code === newlyCreatedCode;
      const rightIsNew = right.code === newlyCreatedCode;
      if (leftIsNew === rightIsNew) return 0;
      return leftIsNew ? -1 : 1;
    });
  }, [definitions, search, groupFilter, newlyCreatedCode]);

  // Mỗi trang tối đa 10 quy trình. Đổi bộ lọc thì về trang 1, và quy trình
  // vừa tạo (được ghim lên đầu) luôn thấy ngay.
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [search, groupFilter, newlyCreatedCode]);
  const pageCount = Math.max(1, Math.ceil(visibleDefinitions.length / DEFINITIONS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pagedDefinitions = useMemo(
    () =>
      visibleDefinitions.slice(
        (currentPage - 1) * DEFINITIONS_PER_PAGE,
        currentPage * DEFINITIONS_PER_PAGE,
      ),
    [visibleDefinitions, currentPage],
  );

  const openDefinitions = useMemo(
    () => pagedDefinitions.filter((definition) => openRows.has(definition.id)),
    [pagedDefinitions, openRows],
  );

  const openSubjects = useMemo(() => subjectsOf(openDefinitions), [openDefinitions]);
  // Cột "Đang tham gia" theo các quy trình của trang đang xem.
  const allSubjects = useMemo(() => subjectsOf(pagedDefinitions), [pagedDefinitions]);

  /**
   * Chưa mở quy trình nào thì lọc theo toàn bộ chức danh có tham gia.
   * Mở quy trình nào thì hiển thị chức danh của các quy trình đang mở đó.
   */
  const relevantSubjects = openDefinitions.length > 0 ? openSubjects : allSubjects;

  const availableTrees = useMemo(
    () => getAvailableTrees(organization, relevantSubjects),
    [organization, relevantSubjects],
  );

  // Đồng bộ danh sách sơ đồ được chọn khi danh sách availableTrees thay đổi
  useEffect(() => {
    if (availableTrees.length > 0) {
      setSelectedTreeIds((prev) => {
        const valid = new Set([...prev].filter((id) => availableTrees.some((t) => t.id === id)));
        if (valid.size > 0) {
          if (valid.size === prev.size && [...prev].every((id) => valid.has(id))) {
            return prev;
          }
          return valid;
        }
        return new Set(availableTrees.map((t) => t.id));
      });
    }
  }, [availableTrees]);

  const isAllTreesSelected =
    availableTrees.length > 0 && selectedTreeIds.size === availableTrees.length;

  const totalActive = useMemo(
    () => availableTrees.reduce((acc, t) => acc + t.activePositionCount, 0),
    [availableTrees],
  );
  const totalPositions = useMemo(
    () => availableTrees.reduce((acc, t) => acc + t.positionCount, 0),
    [availableTrees],
  );
  const selectedActive = useMemo(
    () =>
      availableTrees
        .filter((t) => selectedTreeIds.has(t.id))
        .reduce((acc, t) => acc + t.activePositionCount, 0),
    [availableTrees, selectedTreeIds],
  );

  const triggerLabel = useMemo(() => {
    if (availableTrees.length === 0) return 'Chọn sơ đồ';
    if (isAllTreesSelected) {
      if (mode === 'compact') {
        return `Tất cả sơ đồ (${totalActive} đang tham gia)`;
      }
      return `Tất cả sơ đồ (${availableTrees.length})`;
    }
    if (selectedTreeIds.size === 1) {
      const singleTree = availableTrees.find((t) => selectedTreeIds.has(t.id));
      if (!singleTree) return '1 sơ đồ';
      if (mode === 'compact') {
        return `${singleTree.name} (${singleTree.activePositionCount} đang tham gia)`;
      }
      return `${singleTree.name} (${singleTree.positionCount} chức danh)`;
    }
    if (mode === 'compact') {
      return `${selectedTreeIds.size}/${availableTrees.length} sơ đồ (${selectedActive} đang tham gia)`;
    }
    return `${selectedTreeIds.size}/${availableTrees.length} sơ đồ`;
  }, [availableTrees, isAllTreesSelected, selectedTreeIds, mode, totalActive, selectedActive]);

  const fullTree = useMemo(
    () =>
      buildHeaderTree(
        organization,
        undefined,
        selectedTreeIds.size > 0 ? selectedTreeIds : undefined,
      ),
    [organization, selectedTreeIds],
  );

  const tree = useMemo(() => {
    const baseTree = mode === 'full' ? fullTree : pruneEmpty(fullTree, relevantSubjects);
    return markTreeBoundaries(filterColumnsByText(baseTree, positionQuery));
  }, [fullTree, mode, relevantSubjects, positionQuery]);
  const columns = useMemo(() => flattenColumns(tree), [tree]);
  const depth = useMemo(() => treeDepth(tree), [tree]);

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
        (item) => !isAssignedToColumn(item, column),
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


  const addStep = (definition: ProcedureDefinition, customName?: string) => {
    if (!onUpdateDefinition) return;
    const order = definition.steps.length + 1;
    // Tên mặc định theo số trên trục chính (bước trong nhánh không tính), khớp số hiển thị.
    const inBranch = new Set((definition.gateways ?? []).flatMap((gateway) => gateway.branches.flatMap((branch) => branch.stepIds)));
    const name = customName?.trim() || `Bước ${definition.steps.filter((step) => !inBranch.has(step.id)).length + 1}`;
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
    if (definition.steps.length <= 1) {
      window.alert('Quy trình phải còn ít nhất một bước.');
      return;
    }
    // Dọn luôn tham chiếu tới bước bị xoá: khỏi nhánh, khỏi điểm quay về của C.
    applyFlow(definition, removeFlowStep(definition, stepId, toStepInput));
  };

  // ---------------------------------------------------------------- Rẽ nhánh
  const [attributeTarget, setAttributeTarget] = useState<{ definitionId: string; stepId: string | null }>();
  const [gatewayTarget, setGatewayTarget] = useState<{ definitionId: string; gatewayId: string }>();
  const [dynamicTarget, setDynamicTarget] = useState<{ definitionId: string; stepId: string }>();
  const [report, setReport] = useState<{ definitionId: string; report: ProcedureValidationReport }>();

  const applyFlow = (definition: ProcedureDefinition, change: FlowChange) => {
    onUpdateDefinition?.(definition.id, change.steps, { gateways: change.gateways });
  };

  const saveAttributes = (
    definition: ProcedureDefinition,
    stepId: string | null,
    attributes: ProcedureAttributeDefinition[],
  ) => {
    if (!onUpdateDefinition) return;
    if (stepId === null) {
      onUpdateDefinition(definition.id, definition.steps.map(toStepInput), { attributes });
    } else {
      onUpdateDefinition(
        definition.id,
        definition.steps.map((step) =>
          step.id === stepId
            ? { ...toStepInput(step), attributes: attributes.length ? attributes : undefined }
            : toStepInput(step),
        ),
      );
    }
    setAttributeTarget(undefined);
  };

  const saveDynamicApprover = (
    definition: ProcedureDefinition,
    stepId: string,
    next: { role: ProcedureRaciRole; managerFallback: NonNullable<ProcedureRaciAssignment['managerFallback']> } | undefined,
  ) => {
    if (!onUpdateDefinition) return;
    onUpdateDefinition(
      definition.id,
      definition.steps.map((step) => {
        const input = toStepInput(step);
        if (step.id !== stepId) return input;
        const kept = input.assignments.filter((item) => item.subjectType !== 'initiator_manager');
        return {
          ...input,
          assignments: next
            ? [
                ...kept,
                {
                  role: next.role,
                  subjectType: 'initiator_manager' as const,
                  subjectId: '',
                  subjectLabel: 'Quản lý trực tiếp của người khởi tạo',
                  managerFallback: next.managerFallback,
                },
              ]
            : kept,
        };
      }),
    );
    setDynamicTarget(undefined);
  };

  /** Lưu Dialog Cấu hình bước: SLA + nối tiếp + đổi nhánh trong MỘT lần ghi. */
  const saveStepConfig = (definition: ProcedureDefinition, stepId: string, change: StepConfigChange) => {
    if (!onUpdateDefinition) return;
    const withStep = (step: ProcedureStepDefinition): CreateProcedureStepInput =>
      step.id === stepId
        ? { ...toStepInput(step), slaHours: change.slaHours, linkedDefinitionId: change.linkedDefinitionId }
        : toStepInput(step);
    if (change.branch !== undefined) {
      applyFlow(definition, moveStepToBranch(definition, stepId, change.branch, withStep));
    } else {
      onUpdateDefinition(definition.id, definition.steps.map(withStep));
    }
    setStepConfigTarget(undefined);
  };

  /**
   * Công bố qua một lượt kiểm tra: có lỗi thì hiện danh sách lỗi thay vì chỉ
   * báo lỗi đầu tiên; chỉ có cảnh báo thì hỏi lại trước khi công bố.
   */
  const publishWithCheck = async (definition: ProcedureDefinition) => {
    if (!onPublishDefinition) return;
    if (!onValidateDefinition) {
      onPublishDefinition(definition.id);
      return;
    }
    try {
      const result = await onValidateDefinition(definition.id);
      if (result.errors.length || result.warnings.length) {
        setReport({ definitionId: definition.id, report: result });
        return;
      }
    } catch {
      // Không kiểm được thì để server tự chặn ở bước công bố.
    }
    onPublishDefinition(definition.id);
  };

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const activeScrollerRef = useRef<'table' | 'rail' | null>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrollTrackWidth, setScrollTrackWidth] = useState(0);

  const handleTableScroll = () => {
    if (activeScrollerRef.current === 'rail') return;
    activeScrollerRef.current = 'table';
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      activeScrollerRef.current = null;
    }, 120);

    if (tableContainerRef.current && railRef.current) {
      const diff = Math.abs(railRef.current.scrollLeft - tableContainerRef.current.scrollLeft);
      if (diff >= 1) {
        railRef.current.scrollLeft = tableContainerRef.current.scrollLeft;
      }
    }
  };

  const handleRailScroll = () => {
    if (activeScrollerRef.current === 'table') return;
    activeScrollerRef.current = 'rail';
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      activeScrollerRef.current = null;
    }, 120);

    if (tableContainerRef.current && railRef.current) {
      const diff = Math.abs(tableContainerRef.current.scrollLeft - railRef.current.scrollLeft);
      if (diff >= 1) {
        tableContainerRef.current.scrollLeft = railRef.current.scrollLeft;
      }
    }
  };

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const updateScrollWidth = () => {
      if (!tableContainerRef.current || !railRef.current) return;
      const maxScroll = Math.max(
        0,
        tableContainerRef.current.scrollWidth - tableContainerRef.current.clientWidth,
      );
      const railClientWidth = railRef.current.clientWidth;
      setScrollTrackWidth(railClientWidth + maxScroll);
    };

    updateScrollWidth();

    const container = tableContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      updateScrollWidth();
    });
    observer.observe(container);

    const tableEl = container.querySelector('table');
    if (tableEl) {
      observer.observe(tableEl);
    }

    window.addEventListener('resize', updateScrollWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScrollWidth);
    };
  }, [columns, openRows, pagedDefinitions]);

  return (
    <section className={orgPaneOpen ? `${styles.board} ${styles.boardSplit}` : styles.board}>
      <article className={styles.card}>
        <header className={styles.cardHead}>
          <div className={styles.cardHeadLeft}>
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
              Bấm vào tên một quy trình để xem các bước và phân vai RACI theo từng chức danh.
              Chuyển sang <strong>Tất cả chức danh</strong> để hiển thị toàn bộ các chức danh trong công ty khi cần gán vai trò mới.
            </p>
          </div>
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
            <div className={styles.toolbarLeft}>
              {availableTrees.length > 0 ? (
                <div className={styles.treeFilterContainer} ref={treeFilterRef}>
                  <button
                    type="button"
                    className={`${styles.treeFilterTrigger} ${treeFilterOpen ? styles.treeFilterTriggerOpen : ''
                      }`}
                    onClick={() => setTreeFilterOpen((prev) => !prev)}
                    aria-expanded={treeFilterOpen}
                    aria-haspopup="listbox"
                    title="Chọn sơ đồ tổ chức để hiển thị trên ma trận"
                  >
                    <Layers className={styles.treeFilterTriggerIcon} />
                    <span className={styles.treeFilterTriggerLabel}>
                      {triggerLabel}
                    </span>
                    <ChevronDown
                      className={`${styles.treeFilterTriggerChevron} ${treeFilterOpen ? styles.treeFilterTriggerChevronRotated : ''
                        }`}
                    />
                  </button>

                  {treeFilterOpen ? (
                    <div className={styles.treeFilterPopover} role="listbox">
                      {/* Nhóm 1: Tất cả sơ đồ */}
                      <div className={styles.treeFilterGroup}>
                        {/* <div className={styles.treeFilterGroupLabel}>Chế độ xem</div> */}
                        <div
                          role="option"
                          tabIndex={0}
                          aria-selected={isAllTreesSelected}
                          className={`${styles.treeFilterItem} ${isAllTreesSelected ? styles.treeFilterItemActive : ''
                            }`}
                          onClick={() => {
                            setSelectedTreeIds(new Set(availableTrees.map((t) => t.id)));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedTreeIds(new Set(availableTrees.map((t) => t.id)));
                            }
                          }}
                        >
                          <span className={styles.treeFilterCheckWrap}>
                            {isAllTreesSelected ? (
                              <Check className={styles.treeFilterCheck} />
                            ) : null}
                          </span>
                          <span className={styles.treeFilterItemLabel}>Tất cả sơ đồ</span>
                          <span className={styles.treeFilterBadge}>
                            {mode === 'compact'
                              ? `${totalActive} đang tham gia`
                              : `${totalPositions} chức danh`}
                          </span>
                        </div>
                      </div>

                      <div className={styles.treeFilterSeparator} />

                      {/* Nhóm 2: Các sơ đồ cụ thể với checkbox chọn nhiều */}
                      <div className={styles.treeFilterGroup}>
                        <div className={styles.treeFilterGroupLabel}>Sơ đồ tổ chức</div>
                        {availableTrees.map((tree) => {
                          const isSelected = selectedTreeIds.has(tree.id);
                          return (
                            <div
                              key={tree.id}
                              role="option"
                              tabIndex={0}
                              aria-selected={isSelected}
                              className={`${styles.treeFilterItem} ${isSelected ? styles.treeFilterItemActive : ''
                                }`}
                              onClick={() => {
                                setSelectedTreeIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(tree.id)) {
                                    // Không cho bỏ chọn nếu chỉ còn duy nhất 1 sơ đồ
                                    if (next.size <= 1) return prev;
                                    next.delete(tree.id);
                                  } else {
                                    next.add(tree.id);
                                  }
                                  return next;
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedTreeIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(tree.id)) {
                                      if (next.size <= 1) return prev;
                                      next.delete(tree.id);
                                    } else {
                                      next.add(tree.id);
                                    }
                                    return next;
                                  });
                                }
                              }}
                            >
                              <span
                                className={`${styles.treeFilterCheckbox} ${isSelected ? styles.treeFilterCheckboxChecked : ''
                                  }`}
                              >
                                {isSelected ? (
                                  <Check className={styles.treeFilterCheckboxCheck} />
                                ) : null}
                              </span>
                              <div className={styles.treeFilterTreeContent}>
                                <div className={styles.treeFilterTreeHeader}>
                                  <span className={styles.treeFilterTreeName}>{tree.name}</span>
                                  {tree.isPrimary ? (
                                    <span className={styles.treeFilterPrimaryBadge}>Chính</span>
                                  ) : null}
                                </div>
                                <span className={styles.treeFilterTreeDesc}>
                                  {mode === 'compact'
                                    ? `${tree.activePositionCount} / ${tree.positionCount} đang tham gia`
                                    : `${tree.positionCount} chức danh`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className={styles.toolbarRight}>
              <label className={styles.positionSearch} title="Tìm chức danh trên ma trận (gõ không dấu được)">
                <Search size={14} aria-hidden="true" />
                <input
                  value={positionQuery}
                  placeholder="Tìm chức danh…"
                  aria-label="Tìm chức danh"
                  onChange={(event) => setPositionQuery(event.target.value)}
                />
                {positionQuery ? (
                  <button type="button" aria-label="Xoá tìm kiếm" onClick={() => setPositionQuery('')}>
                    ×
                  </button>
                ) : null}
              </label>
              <button
                type="button"
                className={mode === 'compact' ? styles.filterOn : styles.filter}
                onClick={() => setMode('compact')}
                title="Chỉ hiện các chức danh có tham gia trong các quy trình đang mở."
              >
                Đang tham gia
              </button>
              <button
                type="button"
                className={mode === 'full' ? styles.filterOn : styles.filter}
                onClick={() => setMode('full')}
                title="Hiện tất cả chức danh trong tổ chức để gán vai trò mới."
              >
                Tất cả chức danh
              </button>
              <button
                type="button"
                className={orgPaneOpen ? styles.orgToggleOn : styles.orgToggle}
                aria-pressed={orgPaneOpen}
                aria-label={orgPaneOpen ? 'Ẩn sơ đồ tổ chức' : 'Hiện sơ đồ tổ chức'}
                title={orgPaneOpen ? 'Ẩn sơ đồ tổ chức' : 'Hiện sơ đồ tổ chức để gán việc'}
                onClick={() => setOrgPaneOpen((open) => !open)}
              >
                <Network size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {/* BẢNG MA TRẬN RCSI HỢP NHẤT (SINGLE TABLE ĐẢM BẢO 100% THẲNG HÀNG) */}
        <div
          className={styles.scroll}
          ref={tableContainerRef}
          onScroll={handleTableScroll}
        >
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr key="level-0">
                <th className={styles.corner} rowSpan={depth}>
                  <div className={styles.cornerHeader}>
                    <span className={styles.cornerTitle}>Danh mục Quy trình &amp; Các bước</span>
                    <span className={styles.cornerHint}>
                      {openDefinitions.length === 0
                        ? `${definitions.length} quy trình · bấm để mở`
                        : `${openDefinitions.length}/${definitions.length} quy trình đang mở`}
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
                {columns.length === 0 ? (
                  <th className={styles.emptyColumnsHead} rowSpan={depth}>
                    <div className={styles.emptyColumnsBox}>
                      <span>
                        {mode === 'compact'
                          ? 'Không có chức danh nào trong sơ đồ đang chọn tham gia các quy trình này.'
                          : 'Sơ đồ tổ chức chưa có chức danh.'}
                      </span>
                      {mode === 'compact' ? (
                        <button
                          type="button"
                          className={styles.switchModeBtn}
                          onClick={() => setMode('full')}
                        >
                          Xem tất cả chức danh
                        </button>
                      ) : null}
                    </div>
                  </th>
                ) : (
                  renderHeaderLevel(tree, 0, depth, setPreviewPositionId)
                )}
              </tr>
              {columns.length > 0
                ? Array.from({ length: depth - 1 }, (_, level) => (
                  <tr key={`level-${level + 1}`}>
                    {renderHeaderLevel(tree, level + 1, depth, setPreviewPositionId)}
                  </tr>
                ))
                : null}
            </thead>

            <tbody>
              {visibleDefinitions.length === 0 ? (
                <tr className={styles.emptyRow}>
                  <td colSpan={1 + Math.max(1, columns.length)} className={styles.empty}>
                    {definitions.length === 0
                      ? 'Chưa có quy trình nào. Dùng ô bên dưới để tạo quy trình đầu tiên.'
                      : 'Không có quy trình nào thuộc nhóm đang lọc.'}
                  </td>
                </tr>
              ) : null}

              {pagedDefinitions.map((definition) => (
                <DefinitionRows
                  key={definition.id}
                  definition={definition}
                  columns={columns}
                  open={openRows.has(definition.id)}
                  editable={editable && definition.status === 'draft'}
                  busy={busy}
                  onToggle={() => toggleRow(definition.id)}
                  onAddStep={(name) => addStep(definition, name)}
                  onRenameStep={(stepId, name) => renameStep(definition, stepId, name)}
                  onRemoveStep={(stepId) => removeStep(definition, stepId)}
                  onPublish={
                    onPublishDefinition ? () => void publishWithCheck(definition) : undefined
                  }
                  onEditAttributes={(stepId) =>
                    setAttributeTarget({ definitionId: definition.id, stepId })
                  }
                  onAddGateway={(stepId) => applyFlow(definition, addGateway(definition, stepId, toStepInput))}
                  onAddBranchStep={(target, name) =>
                    applyFlow(definition, addStepToBranch(definition, target, name, toStepInput))
                  }
                  onEditGateway={(gatewayId) => setGatewayTarget({ definitionId: definition.id, gatewayId })}
                  onConfigureStep={(stepId) => setStepConfigTarget({ definitionId: definition.id, stepId })}
                  onEditDynamicApprover={(stepId) => setDynamicTarget({ definitionId: definition.id, stepId })}
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
                  materialCatalog={materialCatalog}
                  onSetStepMaterials={(stepId, materials) =>
                    setStepMaterials(definition, stepId, materials)
                  }
                  linkTargets={publishedDefinitions}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* THANH CUỘN NGANG ĐỘC LẬP CHỈ DÀNH CHO CỘT CHỨC DANH & RACI */}
        <div className={styles.bottomScrollbarTrack}>
          <div className={styles.bottomScrollbarSpacer} />
          <div
            className={styles.bottomScrollbarRail}
            ref={railRef}
            onScroll={handleRailScroll}
          >
            <div style={{ width: scrollTrackWidth, height: 1 }} />
          </div>
        </div>

        {visibleDefinitions.length > DEFINITIONS_PER_PAGE ? (
          <div className={styles.pagerRow}>
            <span>
              Hiển thị{' '}
              <strong>
                {(currentPage - 1) * DEFINITIONS_PER_PAGE + 1}–
                {Math.min(currentPage * DEFINITIONS_PER_PAGE, visibleDefinitions.length)}
              </strong>{' '}
              / <strong>{visibleDefinitions.length}</strong> quy trình
            </span>
            <div className={styles.pagerControls}>
              <button
                type="button"
                className={styles.pagerBtn}
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                ← Trước
              </button>
              <span className={styles.pagerCurrent}>
                {currentPage} / {pageCount}
              </span>
              <button
                type="button"
                className={styles.pagerBtn}
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                Sau →
              </button>
            </div>
          </div>
        ) : null}
      </article>

      {orgPaneOpen ? (
        <OrgPane
          organization={organization}
          activePositionName={positionQuery}
          onPickPosition={(name) => {
            // Chọn một chức danh trên sơ đồ là muốn gán việc cho nó: lọc ma trận
            // về đúng cột đó, kể cả khi nó chưa tham gia quy trình nào.
            setMode('full');
            setPositionQuery(name);
          }}
          onClose={() => setOrgPaneOpen(false)}
        />
      ) : null}

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

      {(() => {
        const definition = definitions.find((item) => item.id === attributeTarget?.definitionId);
        if (!attributeTarget || !definition) return null;
        const step = definition.steps.find((item) => item.id === attributeTarget.stepId);
        return (
          <AttributeEditor
            title={step ? `Thuộc tính bước “${step.name}”` : `Thuộc tính quy trình “${definition.name}”`}
            subtitle={
              step
                ? 'Người thực hiện bước nhập các trường này khi chạy hồ sơ. Điểm rẽ nhánh đặt sau bước dùng chúng làm điều kiện.'
                : 'Dùng chung cho mọi bước, nhập lúc mở hồ sơ hoặc trong bước đầu.'
            }
            attributes={step ? step.attributes : definition.attributes}
            usedCodes={usedAttributeCodes(definition, attributeTarget.stepId)}
            onClose={() => setAttributeTarget(undefined)}
            onSave={(next) => saveAttributes(definition, attributeTarget.stepId, next)}
          />
        );
      })()}

      {(() => {
        const definition = definitions.find((item) => item.id === gatewayTarget?.definitionId);
        const gateway = definition?.gateways?.find((item) => item.id === gatewayTarget?.gatewayId);
        if (!definition || !gateway) return null;
        return (
          <GatewayEditor
            key={gateway.id}
            definition={definition}
            gateway={gateway}
            onClose={() => setGatewayTarget(undefined)}
            onSave={(next: ProcedureGatewayDefinition) => {
              applyFlow(definition, replaceGateway(definition, next, toStepInput));
              setGatewayTarget(undefined);
            }}
            onRemove={() => {
              applyFlow(definition, removeGateway(definition, gateway.id, toStepInput));
              setGatewayTarget(undefined);
            }}
          />
        );
      })()}

      {(() => {
        const definition = definitions.find((item) => item.id === stepConfigTarget?.definitionId);
        const step = definition?.steps.find((item) => item.id === stepConfigTarget?.stepId);
        if (!definition || !step) return null;
        return (
          <StepConfigDialog
            key={step.id}
            definition={definition}
            step={step}
            linkTargets={publishedDefinitions}
            readOnly={!editable || definition.status !== 'draft'}
            onClose={() => setStepConfigTarget(undefined)}
            onSave={(change) => saveStepConfig(definition, step.id, change)}
            onOpenAttributes={() => {
              setStepConfigTarget(undefined);
              setAttributeTarget({ definitionId: definition.id, stepId: step.id });
            }}
          />
        );
      })()}

      {(() => {
        const definition = definitions.find((item) => item.id === dynamicTarget?.definitionId);
        const step = definition?.steps.find((item) => item.id === dynamicTarget?.stepId);
        if (!definition || !step) return null;
        return (
          <DynamicApproverEditor
            stepName={step.name}
            current={step.assignments.find((item) => item.subjectType === 'initiator_manager')}
            organization={organization}
            onClose={() => setDynamicTarget(undefined)}
            onSave={(next) => saveDynamicApprover(definition, step.id, next)}
          />
        );
      })()}

      {report ? (
        <MinimalPopupForm
          isOpen
          title={report.report.errors.length ? 'Chưa công bố được' : 'Kiểm tra trước khi công bố'}
          subtitle={
            report.report.errors.length
              ? `Còn ${report.report.errors.length} lỗi cần sửa trước khi công bố.`
              : 'Không có lỗi, nhưng có điểm nên xem lại.'
          }
          maxWidth="640px"
          onClose={() => setReport(undefined)}
        >
          <div className={flowStyles.editor}>
            <ul className={flowStyles.report}>
              {report.report.errors.map((issue, index) => (
                <li key={`e${index}`} className={flowStyles.reportError}>
                  {issue.message}
                </li>
              ))}
              {report.report.warnings.map((issue, index) => (
                <li key={`w${index}`} className={flowStyles.reportWarning}>
                  {issue.message}
                </li>
              ))}
            </ul>
            <footer className={flowStyles.footer}>
              <span />
              <div className={flowStyles.footerRight}>
                <button type="button" className={flowStyles.cancelButton} onClick={() => setReport(undefined)}>
                  Đóng
                </button>
                {!report.report.errors.length && onPublishDefinition ? (
                  <button
                    type="button"
                    className={flowStyles.submitButton}
                    onClick={() => {
                      onPublishDefinition(report.definitionId);
                      setReport(undefined);
                    }}
                  >
                    Vẫn công bố
                  </button>
                ) : null}
              </div>
            </footer>
          </div>
        </MinimalPopupForm>
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
              const code = newCode.trim().toUpperCase();
              onCreateDefinition({
                code,
                name: newName.trim(),
                kind: 'process',
                category: newGroup || undefined,
              });
              setNewlyCreatedCode(code);
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

      {/* POPUP PREVIEW CHỨC DANH (CÂY TỔ CHỨC TRỰC THUỘC & DANH SÁCH NHÂN SỰ) */}
      <MinimalPopupForm
        isOpen={Boolean(previewPositionId && previewData)}
        title={previewData?.position.name || 'Chi tiết chức danh'}
        subtitle={
          previewData
            ? `Sơ đồ: ${previewData.treeInfo?.name || 'Mặc định'} · Đơn vị: ${previewData.lineage.at(-1)?.name || '–'
            }`
            : undefined
        }
        maxWidth="820px"
        popupClassName={styles.positionPreviewPopup}
        onClose={() => setPreviewPositionId(undefined)}
      >
        {previewData ? (
          <div className={styles.positionPreviewContent}>
            <div className={styles.positionPreviewGrid}>
              {/* CỘT TRÁI: CÂY TỔ CHỨC TRỰC THUỘC (Ancestor Lineage Tree) */}
              <div className={styles.previewTreeCol}>
                <div className={styles.previewColHeader}>
                  <Network className={styles.previewColIcon} />
                  <div>
                    <h4 className={styles.previewColTitle}>Cây tổ chức trực thuộc</h4>
                    <div className={styles.previewColSubtitle}>
                      <span>{previewData.treeInfo?.name || 'Sơ đồ tổ chức'}</span>
                      {previewData.treeInfo?.isPrimary ? (
                        <span className={styles.previewPrimaryBadge}>Chính</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className={styles.lineageTimeline}>
                  {previewData.lineage.map((unit) => {
                    return (
                      <div key={unit.id} className={styles.lineageStep}>
                        <div className={styles.lineageNodeIconWrap}>
                          <Building2 className={styles.lineageNodeIcon} />
                        </div>
                        <div className={styles.lineageNodeContent}>
                          <div className={styles.lineageNodeHeader}>
                            <span className={styles.lineageNodeName}>{unit.name}</span>
                            {/* <span className={styles.lineageNodeTag}>
                              {isRoot ? 'Đơn vị gốc' : unit.typeName || 'Đơn vị'}
                            </span> */}
                          </div>
                          {unit.headName ? (
                            <span className={styles.lineageNodeHead}>
                              Trưởng đơn vị: <strong>{unit.headName}</strong>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {/* NODE CHỨC DANH ĐƯỢC HIGHLIGHT NHẸ (Ở CUỐI NHÁNH) */}
                  <div className={`${styles.lineageStep} ${styles.lineageStepTarget}`}>
                    <div className={styles.lineageTargetIconWrap}>
                      {previewData.isHead ? (
                        <ShieldCheck className={styles.lineageTargetIcon} />
                      ) : (
                        <Briefcase className={styles.lineageTargetIcon} />
                      )}
                    </div>
                    <div className={styles.lineageTargetCard}>
                      <div className={styles.lineageTargetHeader}>
                        <span className={styles.lineageTargetName}>
                          {previewData.position.name}
                        </span>
                        <span className={styles.lineageTargetSelectedBadge}>Đang xem</span>
                      </div>
                      <div className={styles.lineageTargetMeta}>
                        {/* <span>Mã: {previewData.position.key}</span> */}
                        {previewData.isHead ? (
                          <span className={styles.managerBadge}>★ Chức danh Quản lý</span>
                        ) : (
                          <span className={styles.regularBadge}>Chức danh thành viên</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* CỘT PHẢI: DANH SÁCH NHÂN SỰ BỔ NHIỆM */}
              <div className={styles.previewMembersCol}>
                <div className={styles.previewColHeader}>
                  <Users className={styles.previewColIcon} />
                  <div>
                    <h4 className={styles.previewColTitle}>Nhân sự bổ nhiệm</h4>
                    <div className={styles.previewColSubtitle}>
                      <span>{previewData.members.length} nhân sự thuộc chức danh</span>
                    </div>
                  </div>
                </div>

                <div className={styles.membersList}>
                  {previewData.members.length === 0 ? (
                    <div className={styles.membersEmpty}>
                      <Users className={styles.membersEmptyIcon} />
                      <p className={styles.membersEmptyTitle}>Chưa có nhân sự</p>
                      <p className={styles.membersEmptyDesc}>
                        Chức danh này hiện chưa được bổ nhiệm nhân sự nào trong hệ thống.
                      </p>
                    </div>
                  ) : (
                    previewData.members.map((member) => {
                      const initials =
                        member.displayName
                          .trim()
                          .split(/\s+/)
                          .slice(-2)
                          .map((w) => w[0])
                          .join('')
                          .toUpperCase() || 'NV';
                      return (
                        <div
                          key={member.membershipId || member.userId}
                          className={styles.memberCard}
                        >
                          <div className={styles.memberAvatar}>{initials}</div>
                          <div className={styles.memberInfo}>
                            <div className={styles.memberNameRow}>
                              <span className={styles.memberName}>{member.displayName}</span>
                              {member.isHead ? (
                                <span className={styles.memberHeadBadge}>★ Trưởng đơn vị</span>
                              ) : null}
                            </div>
                            <span className={styles.memberEmail}>{member.email || '–'}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className={styles.positionPreviewActions}>
              <button
                type="button"
                className={styles.positionPreviewCloseBtn}
                onClick={() => setPreviewPositionId(undefined)}
              >
                Đóng
              </button>
            </div>
          </div>
        ) : null}
      </MinimalPopupForm>
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
  onPreviewPosition?: (positionId: string) => void,
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
            node.isTreeBoundary ? styles.treeBoundaryHead : '',
          ]
            .filter(Boolean)
            .join(' ')}
          title={node.tooltip}
        >
          <span className={styles.headLabel}>
            {node.label}
            {node.highlight === 'head' && node.column?.subjectType === 'position' ? (
              <span className={styles.managerBadge}>★ Quản lý</span>
            ) : null}
          </span>
          {node.caption ? <span className={styles.headCaption}>{node.caption}</span> : null}
          {isLeaf && node.column?.subjectType === 'position' && onPreviewPosition ? (
            <button
              type="button"
              className={styles.positionPreviewBtn}
              onClick={(e) => {
                e.stopPropagation();
                onPreviewPosition(node.column!.subjectId);
              }}
              title="Xem cây tổ chức & danh sách nhân sự"
              aria-label={`Xem cây tổ chức và danh sách nhân sự của ${node.label}`}
            >
              <Eye className={styles.positionPreviewIcon} />
            </button>
          ) : null}
        </th>,
      );
      return;
    }
    for (const child of node.children) walk(child, current + 1);
  };

  for (const node of nodes) walk(node, 0);
  return cells;
}

/**
 * Hàng "Điểm rẽ nhánh" chen ngay sau bước đặt gateway. Không có ô RCSI: điểm rẽ
 * nhánh là node tự động, không ai phải làm gì ở đây.
 */
/**
 * Hàng cuối mỗi nhánh: ô nhập tên để thêm bước vào đúng nhánh đó. Nhánh rỗng
 * luôn có hàng này (cả khi chỉ xem) để thấy nhánh đó đi thẳng tới điểm hợp.
 */
function BranchAddRow({
  letter,
  branchIndex,
  label,
  nextNumber,
  empty,
  columns,
  busy,
  onAdd,
}: {
  letter: string;
  branchIndex: number;
  label: string;
  nextNumber: number;
  empty: boolean;
  columns: readonly MatrixColumn[];
  busy: boolean;
  onAdd?: (name: string) => void;
}) {
  return (
    <tr className={`${styles.branchStepRow} ${styles.branchAddRow}`} data-branch={branchIndex % 6}>
      <td className={styles.masterCell}>
        <div className={styles.branchAddInner}>
          {empty ? (
            <span className={styles.branchChip} title={`Nhánh ${letter}: “${label}”`}>
              {letter} · {label}
            </span>
          ) : null}
          {onAdd ? (
            <form
              className={styles.addStepForm}
              onSubmit={(event) => {
                event.preventDefault();
                const input = event.currentTarget.elements.namedItem('branchStepName') as HTMLInputElement | null;
                const name = input?.value.trim() || `Bước ${letter}${nextNumber}`;
                onAdd(name);
                if (input) input.value = '';
              }}
            >
              <span className={styles.addStepNumberBadge}>+{letter}{nextNumber}</span>
              <input
                name="branchStepName"
                className={styles.addStepInput}
                placeholder={
                  empty
                    ? `Nhánh chưa có bước (đi thẳng tới bước hợp) — nhập tên bước ${letter}1…`
                    : `Thêm bước ${letter}${nextNumber} vào nhánh “${label}”…`
                }
                autoComplete="off"
                disabled={busy}
              />
              <button type="submit" className={styles.addStepButton} disabled={busy} title={`Thêm bước vào nhánh ${letter}`}>
                <Plus size={12} aria-hidden="true" /> Thêm vào nhánh
              </button>
            </form>
          ) : (
            <span className={styles.branchEmptyNote}>Không có bước — đi thẳng tới bước hợp nhánh</span>
          )}
        </div>
      </td>
      {columns.length === 0 ? (
        <td className={styles.addStepEmptyCell} />
      ) : (
        columns.map((column) => (
          <td
            key={column.key}
            className={`${styles.addStepEmptyCell} ${column.isTreeBoundary ? styles.treeBoundaryCell : ''}`}
          />
        ))
      )}
    </tr>
  );
}

function GatewayRow({
  gateway,
  definition,
  columnSpan,
  editable,
  busy,
  onEdit,
}: {
  gateway: ProcedureGatewayDefinition;
  definition: ProcedureDefinition;
  columnSpan: number;
  editable: boolean;
  busy: boolean;
  onEdit?: () => void;
}) {
  const attributes = new Set(
    gateway.branches.flatMap((branch) =>
      (branch.condition?.rules ?? []).map((rule) => {
        const ref = rule.attribute;
        const owner =
          ref.scope === 'process'
            ? definition.attributes
            : definition.steps.find((step) => step.id === ref.stepId)?.attributes;
        return owner?.find((item) => item.code === ref.code)?.name ?? ref.code;
      }),
    ),
  );
  return (
    <tr className={styles.gatewayRow}>
      <td className={styles.masterCell}>
        <div className={styles.gatewayInner}>
          <span className={styles.gatewayDiamond} aria-hidden="true" />
          <div className={styles.gatewayText}>
            <strong>{gateway.name}</strong>
            <span>
              {attributes.size ? `Theo ${[...attributes].join(', ')}` : 'Chưa có điều kiện'} · {gateway.branches.length} nhánh
            </span>
          </div>
          {onEdit ? (
            <button type="button" className={styles.flowToolBtn} disabled={busy} onClick={onEdit}>
              {editable ? 'Cấu hình điều kiện' : 'Xem điều kiện'}
            </button>
          ) : null}
        </div>
      </td>
      <td className={styles.gatewayFill} colSpan={columnSpan} />
    </tr>
  );
}

function DefinitionRows({
  definition,
  columns,
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
  materialCatalog,
  onSetStepMaterials,
  linkTargets,
  onEditAttributes,
  onAddGateway,
  onEditGateway,
  onConfigureStep,
  onEditDynamicApprover,
  onAddBranchStep,
}: {
  /** stepId = null: thuộc tính cấp quy trình. */
  onEditAttributes?: (stepId: string | null) => void;
  onAddGateway?: (afterStepId: string) => void;
  onAddBranchStep?: (target: BranchTarget, name: string) => void;
  onEditGateway?: (gatewayId: string) => void;
  /** Mở Dialog cấu hình bước (SLA, nối tiếp, nhánh, thuộc tính). */
  onConfigureStep?: (stepId: string) => void;
  onEditDynamicApprover?: (stepId: string) => void;
  definition: ProcedureDefinition;
  columns: readonly MatrixColumn[];
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
  materialCatalog?: readonly { code: string; name: string; unit: string }[];
  onSetStepMaterials?: (stepId: string, materials: ProcedureStepMaterial[]) => void;
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
  const flow = useMemo(() => flowRowInfo(definition), [definition]);
  const letters = useMemo(() => branchLetters(definition), [definition]);
  const orderedSteps = useMemo(
    () => [...definition.steps].sort((left, right) => left.order - right.order),
    [definition.steps],
  );
  const trunkCount = orderedSteps.filter((step) => !flow.get(step.id)?.branch).length;
  const branchRow = (gateway: ProcedureGatewayDefinition, branchIndex: number) => {
    const branch = gateway.branches[branchIndex];
    return (
      <BranchAddRow
        key={`branch-add-${gateway.id}-${branch.id}`}
        letter={letters.get(`${gateway.id}:${branchIndex}`) ?? '?'}
        branchIndex={branchIndex}
        label={branch.label}
        nextNumber={branch.stepIds.length + 1}
        empty={branch.stepIds.length === 0}
        columns={columns}
        busy={busy}
        onAdd={
          editable && onAddBranchStep
            ? (name) => onAddBranchStep({ gatewayId: gateway.id, branchId: branch.id }, name)
            : undefined
        }
      />
    );
  };
  /** Nhánh rỗng đứng liền sau nhánh `from - 1` (theo thứ tự nhánh), tới nhánh có bước kế tiếp. */
  const emptyBranchRows = (gateway: ProcedureGatewayDefinition, from: number) => {
    const rows = [];
    for (let index = from; index < gateway.branches.length && gateway.branches[index].stepIds.length === 0; index += 1) {
      rows.push(branchRow(gateway, index));
    }
    return rows;
  };

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
   * Phân công thuộc về một cột chức danh.
   * Tự động ánh xạ phân công cũ ở cấp đơn vị sang chức danh Quản lý nếu có.
   */
  const ownedBy = (column: MatrixColumn, assignments: readonly ProcedureRaciAssignment[]) => {
    return assignments.filter((item) => isAssignedToColumn(item, column));
  };

  /** Dòng tổng hợp: gom vai trò của mọi bước theo từng cột. */
  const summary = (column: MatrixColumn) => {
    const all = definition.steps.flatMap((step) => step.assignments);
    const list = ownedBy(column, all);
    return labelRoles(list);
  };

  return (
    <>
      <tr className={styles.definitionRow}>
        <td className={styles.masterCell}>
          <div className={styles.definitionCell}>
            {/* HÀNG 1: Expander + Mã + Tên quy trình [trái] ------- Trạng thái [phải] */}
            <div className={styles.definitionRowTop}>
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
                {/* <span className={styles.codeChip}>{definition.code}</span> */}
                <span className={styles.definitionName} title={definition.name}>
                  {definition.name}
                </span>
              </button>

              <span className={`${styles.status} ${styles[definition.status]}`}>
                {definition.status === 'draft'
                  ? 'Nháp'
                  : definition.status === 'published'
                    ? 'Đã công bố'
                    : 'Lưu trữ'}
              </span>
            </div>

            {/* HÀNG 2: Số bước & phiên bản [trái] ------- Nhóm + Thao tác [phải] */}
            <div className={styles.definitionRowBottom}>
              <span className={styles.definitionSubtitle}>
                {definition.steps.length} bước
                {definition.gateways?.length ? ` · ${definition.gateways.length} rẽ nhánh` : ''} · v
                {definition.versionNumber}
                {open ? '' : ' · bấm để xem phân vai'}
              </span>

              <div className={styles.rowTools}>
                {onEditAttributes && (editable || definition.attributes?.length) ? (
                  <button
                    type="button"
                    className={styles.flowToolBtn}
                    disabled={busy || !editable}
                    title="Thuộc tính dùng chung cho mọi bước của quy trình"
                    onClick={() => onEditAttributes(null)}
                  >
                    Thuộc tính QT{definition.attributes?.length ? ` (${definition.attributes.length})` : ''}
                  </button>
                ) : null}
                {onChangeGroup && groups && groups.length > 0 ? (
                  <select
                    className={styles.groupPicker}
                    value={definition.category ?? ''}
                    disabled={busy}
                    title="Nhóm quy trình"
                    aria-label={`Nhóm của quy trình ${definition.name}`}
                    onChange={(event) => onChangeGroup(event.target.value || undefined)}
                  >
                    <option value="">— Nhóm —</option>
                    {groups.map((group) => (
                      <option key={group.code} value={group.code}>
                        {group.label}
                      </option>
                    ))}
                  </select>
                ) : null}

                {/* KHI QUY TRÌNH LÀ BẢN NHÁP: Nút Công bố */}
                {definition.status === 'draft' && editable && onPublish ? (
                  <button
                    type="button"
                    className={styles.publishBtn}
                    onClick={onPublish}
                    disabled={busy}
                  >
                    Công bố
                  </button>
                ) : null}

                {/* KHI QUY TRÌNH LÀ ĐÃ CÔNG BỐ: Nút Sửa dạng icon SquarePen */}
                {definition.status === 'published' && onRevise ? (
                  <button
                    type="button"
                    className={styles.squarePenBtn}
                    onClick={onRevise}
                    disabled={busy}
                    title="Sửa quy trình (chuyển về bản nháp để sửa phân vai)"
                    aria-label={`Sửa quy trình ${definition.name}`}
                  >
                    <SquarePen size={14} aria-hidden="true" />
                  </button>
                ) : null}

                {/* KHI QUY TRÌNH LÀ LƯU TRỮ (ARCHIVED): Nút Tái kích hoạt */}
                {definition.status === 'archived' && onRevise ? (
                  <button
                    type="button"
                    className={styles.reactivateBtn}
                    onClick={onRevise}
                    disabled={busy}
                    title="Tái kích hoạt quy trình (chuyển về bản nháp để chỉnh sửa và công bố lại)"
                  >
                    Tái kích hoạt
                  </button>
                ) : null}

                {/* NÚT LƯU TRỮ DẠNG ICON ARCHIVE (CHỈ HIỂN THỊ KHI QUY TRÌNH LÀ BẢN NHÁP) */}
                {onDelete && definition.status === 'draft' ? (
                  <div className={styles.popconfirmWrapper}>
                    <button
                      type="button"
                      className={styles.archiveIconBtn}
                      disabled={busy}
                      title="Lưu trữ bản nháp này."
                      aria-label={`Lưu trữ bản nháp ${definition.name}`}
                      onClick={handleDeleteClick}
                    >
                      <Archive size={14} aria-hidden="true" />
                    </button>

                    {deleteConfirmAnchor && typeof document !== 'undefined'
                      ? createPortal(
                        <div className={styles.popconfirmPortalLayer}>
                          <div
                            className={styles.popconfirmBackdrop}
                            onClick={() => setDeleteConfirmAnchor(null)}
                          />
                          <div
                            className={`${styles.popconfirmBox} ${deleteConfirmAnchor.placement === 'bottom'
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
                              {`Lưu trữ bản nháp “${definition.name}”?`}
                            </div>
                            <div className={styles.popconfirmDesc}>
                              Bản nháp sẽ được chuyển vào danh mục Lưu trữ. Bạn có thể bấm “Tái kích hoạt” bất cứ lúc nào để tiếp tục thiết kế.
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
                                Xác nhận lưu trữ
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
            </div>
          </div>
        </td>

        {columns.length === 0 ? (
          <td className={styles.emptyColumnsCell}>
            <span className={styles.emptyColumnsText}>–</span>
          </td>
        ) : (
          columns.map((column) => {
            const roles = summary(column);
            return (
              <td
                key={column.key}
                className={`${styles.summaryCell} ${column.isTreeBoundary ? styles.treeBoundaryCell : ''
                  }`}
              >
                {roles.length > 0 ? <span className={styles.summaryPill}>{roles.join(', ')}</span> : '–'}
              </td>
            );
          })
        )}
      </tr>

      {open
        ? orderedSteps.map((step) => {
          const info = flow.get(step.id);
          const gatewayAfter = info?.gatewayAfter;
          const isTrunk = !info?.branch;
          const dynamic = step.assignments.find((item) => item.subjectType === 'initiator_manager');
          return (
          <Fragment key={step.id}>
          <tr
            className={`${styles.stepRow} ${info?.branch ? styles.branchStepRow : ''}`}
            data-branch={info?.branch ? info.branch.branchIndex % 6 : undefined}
          >
            <td className={styles.masterCell}>
              <div className={styles.stickyInner}>
                {info?.branch ? (
                  <span className={styles.branchChip} title={`Nhánh ${info.branch.letter}: “${info.branch.branch.label}”`}>
                    {info.branch.letter} · {info.branch.branch.label}
                  </span>
                ) : null}
                {info?.joinOf.length ? (
                  <span className={styles.joinChip} title="Các nhánh hợp về bước này">
                    Hợp nhánh
                  </span>
                ) : null}
                <span className={styles.stepOrderBadge}>{info?.label ?? step.order}</span>
                {editable ? (
                  <input
                    className={styles.stepNameInput}
                    defaultValue={step.name}
                    title="Click để đổi tên bước trực tiếp trên bảng"
                    placeholder="Tên bước…"
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
                  <span className={styles.stepName} title={step.name}>
                    {step.name}
                  </span>
                )}

                <div className={styles.stepControls}>
                  {/* Tóm tắt chỉ đọc; sửa trong Dialog "Cấu hình" để hàng bước gọn. */}
                  {step.slaHours ? <span className={styles.slaTag}>SLA {step.slaHours}h</span> : null}
                  {step.attributes?.length ? (
                    <span className={styles.attrTag}>{step.attributes.length} thuộc tính</span>
                  ) : null}
                  {step.materials?.length ? (
                    <span className={styles.materialTag}>{step.materials.length} vật tư</span>
                  ) : null}

                  {onConfigureStep ? (
                    <button
                      type="button"
                      className={styles.flowToolBtn}
                      disabled={busy}
                      title="SLA, quy trình nối tiếp, nhánh và thuộc tính của bước"
                      onClick={() => onConfigureStep(step.id)}
                    >
                      <Settings2 size={12} aria-hidden="true" /> {editable ? 'Cấu hình' : 'Xem cấu hình'}
                    </button>
                  ) : null}

                  {onEditDynamicApprover && (editable || dynamic) ? (
                    <button
                      type="button"
                      className={`${styles.flowToolBtn} ${dynamic ? styles.flowToolOn : ''}`}
                      disabled={busy || !editable}
                      title="Gán vai cho quản lý trực tiếp của người khởi tạo"
                      onClick={() => onEditDynamicApprover(step.id)}
                    >
                      {dynamic ? `${dynamic.role}: QL trực tiếp` : 'QL trực tiếp'}
                    </button>
                  ) : null}

                  {editable && isTrunk && !gatewayAfter && onAddGateway ? (
                    <button
                      type="button"
                      className={styles.flowToolBtn}
                      disabled={busy}
                      title="Thêm điểm rẽ nhánh ngay sau bước này"
                      onClick={() => onAddGateway(step.id)}
                    >
                      + Rẽ nhánh
                    </button>
                  ) : null}

                  {editable ? (
                    <button
                      type="button"
                      className={styles.stepRemove}
                      onClick={() => onRemoveStep(step.id)}
                      disabled={busy}
                      aria-label={`Xoá bước ${step.name}`}
                      title="Xoá bước này"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </div>
              {step.linkedDefinitionId ? (
                <span
                  className={styles.linkCorner}
                  title={`Nối tiếp quy trình “${
                    linkTargets.find((candidate) => candidate.id === step.linkedDefinitionId)?.name ?? 'khác'
                  }” khi bước này xong`}
                >
                  <Link2 size={12} aria-hidden="true" />
                </span>
              ) : null}
            </td>

            {columns.length === 0 ? (
              <td className={styles.emptyColumnsCell}>
                <span className={styles.emptyColumnsText}>–</span>
              </td>
            ) : (
              columns.map((column) => {
                const list = ownedBy(column, step.assignments);
                const direct = list[0];
                const rollbackKey = direct?.fixedRollbackStepId
                  ? stepKeyById.get(direct.fixedRollbackStepId)
                  : undefined;
                const openCell = (event: { currentTarget: HTMLElement }) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  onPickCell(step.id, column, { top: box.bottom + 4, left: box.left });
                };

                return (
                  <td
                    key={column.key}
                    className={`${styles.cell} ${column.isTreeBoundary ? styles.treeBoundaryCell : ''
                      }`}
                  >
                    <button
                      type="button"
                      className={`${styles.cellButton} ${direct ? styles[`role${direct.role}`] : styles.cellEmpty
                        }`}
                      disabled={!editable || busy}
                      title={
                        editable
                          ? `${column.label} · ${step.name}`
                          : definition.status === 'archived'
                            ? `Quy trình đang lưu trữ không sửa được. Bấm nút “Tái kích hoạt” ở đầu dòng quy trình để đưa về nháp.`
                            : definition.status === 'published'
                              ? `Quy trình đã công bố không sửa trực tiếp được. Bấm biểu tượng “Sửa” ở đầu dòng quy trình để đưa về nháp, sửa xong thì bấm “Công bố” lại.`
                              : `${column.label} · ${step.name}`
                      }
                      onClick={openCell}
                    >
                      {direct ? direct.role : '–'}
                      {rollbackKey ? <em className={styles.rollback}>{rollbackKey}</em> : null}
                    </button>
                  </td>
                );
              })
            )}
          </tr>
          {info?.branch?.isLast && editable ? branchRow(info.branch.gateway, info.branch.branchIndex) : null}
          {info?.branch?.isLast ? emptyBranchRows(info.branch.gateway, info.branch.branchIndex + 1) : null}
          {gatewayAfter ? (
            <>
              <GatewayRow
                gateway={gatewayAfter}
                definition={definition}
                columnSpan={Math.max(1, columns.length)}
                editable={editable}
                busy={busy}
                onEdit={onEditGateway ? () => onEditGateway(gatewayAfter.id) : undefined}
              />
              {/* Nhánh rỗng không có hàng bước: hiện đúng vị trí theo thứ tự nhánh. */}
              {emptyBranchRows(gatewayAfter, 0)}
            </>
          ) : null}
          </Fragment>
          );
        })
        : null}

      {/* DIRECT INLINE ADD STEP ROW */}
      {open && editable ? (
        <tr key="direct-add-step" className={styles.addStepRow}>
          <td className={styles.masterCell}>
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
                  +{trunkCount + 1}
                </span>
                <input
                  name="directStepName"
                  className={styles.addStepInput}
                  placeholder={
                    definition.gateways?.length
                      ? `Nhập tên bước ${trunkCount + 1} trên trục chính, sau các nhánh (Enter để thêm)…`
                      : `Nhập tên bước ${trunkCount + 1} (Enter để thêm vào bảng)…`
                  }
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
          {columns.length === 0 ? (
            <td className={styles.emptyColumnsCell}></td>
          ) : (
            columns.map((column) => (
              <td
                key={column.key}
                className={`${styles.addStepEmptyCell} ${column.isTreeBoundary ? styles.treeBoundaryCell : ''
                  }`}
              ></td>
            ))
          )}
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
    (item) => isAssignedToColumn(item, target.column),
  );
  // Bước quay về phải CHẮC CHẮN đã đi qua trên mọi đường tới bước này (cùng luật
  // server kiểm lúc công bố). Khi có nhánh, "đứng trước theo thứ tự" không còn
  // đủ: bước ở điểm hợp không được quay về một bước nằm trong một nhánh.
  const priorSteps = useMemo(() => {
    if (!definition || !step) return [];
    const allowed = dominatorStepIds(buildFlowIndex(definition.steps, definition.gateways), step.id);
    return definition.steps
      .filter((item) => allowed.has(item.id))
      .sort((left, right) => left.order - right.order);
  }, [definition, step]);
  const [rollback, setRollback] = useState(
    current?.fixedRollbackStepId ?? priorSteps.at(-1)?.id ?? '',
  );
  const [pendingRole, setPendingRole] = useState<ProcedureRaciRole>();
  const [eTaskSource, setETaskSource] = useState<ETaskSource>(
    current?.eTaskSource ?? 'manual',
  );

  const cTakenElsewhere = Boolean(
    step?.assignments.some(
      (item) => item.role === 'C' && item.subjectId !== target.column.subjectId,
    ),
  );
  // E phải là chức danh Quản lý (hoặc node gốc). Node position không phải
  // là "Quản lý" thì không được gắn quyền E. Chặn ngay tại nút thay vì để người dùng
  // gán rồi mới báo lỗi lúc công bố.
  const eDisabled = target.column.subjectType === 'position' && !target.column.isHead;

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
      eTaskSource: role === 'E' ? eTaskSource : undefined,
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
              className={`${styles.roleChoice} ${styles[`role${role}`]} ${current?.role === role ? styles.roleChoiceActive : ''
                }`}
              disabled={busy || (role === 'C' && cTakenElsewhere) || (role === 'E' && eDisabled)}
              title={
                role === 'C' && cTakenElsewhere
                  ? 'Bước này đã có vai trò C ở cột khác.'
                  : role === 'E' && eDisabled
                    ? 'Vai trò E (Thực thi) chỉ được gán cho chức danh Quản lý.'
                    : ROLE_LABEL[role]
              }
              onClick={() => {
                if (role === 'E') {
                  setPendingRole('E');
                  return;
                }
                apply(role);
              }}
            >
              {role}
            </button>
          ))}
        </div>

        {pendingRole === 'C' || current?.role === 'C' ? (
          <div className={styles.field}>
            <span>Bước quay về khi C trả lại</span>
            <SearchableSelect
              options={priorSteps.map((item) => ({ value: item.id, label: `${item.key} · ${item.name}` }))}
              value={rollback}
              placeholder="Không quay về cố định"
              disabled={busy}
              onChange={setRollback}
            />
            {pendingRole === 'C' ? (
              <button type="button" className={styles.confirm} onClick={() => apply('C')}>
                Lưu vai trò C
              </button>
            ) : null}
          </div>
        ) : null}

        {pendingRole === 'E' || current?.role === 'E' ? (
          <div className={styles.field}>
            <span>Nguồn đầu việc</span>
            <SearchableSelect
              options={E_TASK_SOURCE_OPTIONS}
              value={eTaskSource}
              placeholder="Chọn nguồn đầu việc…"
              clearable={false}
              disabled={busy}
              onChange={(value) => setETaskSource(value as ETaskSource)}
            />
            <p className={styles.fieldHint}>
              Chọn cách khởi tạo đầu việc cho đơn vị thực hiện ở bước này.
            </p>
            <button
              type="button"
              className={styles.confirm}
              disabled={busy}
              onClick={() => apply('E')}
            >
              {pendingRole === 'E' ? 'Lưu vai trò E' : 'Cập nhật nguồn đầu việc'}
            </button>
          </div>
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
