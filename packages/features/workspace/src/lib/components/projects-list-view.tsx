'use client';

import {
  type CreateProjectRequest,
  type CustomerSummary,
  type ProjectMember,
  type ProjectRole,
  type ProjectStatus,
  type ProjectSummary,
  type ProjectTypeOption,
  type Tag,
  type UpdateProjectRequest,
} from '@enterprise-platform/contracts-workspace';
import { Building2, ChevronDown, ChevronRight, Download, FolderInput, ListFilter, Plus, RefreshCw, Tag as TagIcon, MoreHorizontal, TextWrap } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { explicitTableStyle, useColumnOrder, useColumnWidths } from '../column-order';
import { ReorderableTh, ResetColumnLayoutButton } from './reorderable-th';
import { matchProjectFilter, type ProjectFilter } from '../project-filter.model';
import { compareByColumn, nextColumnSort, type ProjectColumnSort, type ProjectSortColumn } from '../project-column-sort';
import { earliestStartDate, isProjectOverdue, nextEndDate } from '../project-dates';
import { finishProjectCreate } from '../related-objects-link';
import type { PendingRelatedObject } from '../related-objects.model';
import {
  clearReturnedProject,
  markProjectOpened,
  peekReturnedProject,
  readProjectListMemory,
  writeProjectListMemory,
} from '../project-list-memory';
import { initialTasksWarning } from '../project-created';
import type { ProjectListScope } from '../project-list-memory';
import {
  DEFAULT_PROJECT_EXPORT_KEYS,
  PROJECT_EXPORT_COLUMNS,
  buildProjectExportRows,
  needsMembers,
  projectExportFileName,
  selectedExportColumns,
  type ProjectExportLookups,
} from '../project-export';
import { downloadProjectReportXlsx, downloadProjectsXlsx } from '../project-export-xlsx';
import { buildProjectReportSheet, projectReportFileName } from '../project-report-export';
import { useProjectCellWrap } from '../project-cell-wrap';
import { mergeUpdated } from '../merge-updated';
import { toast } from '@enterprise-platform/shared-ui';
import * as api from '../workspace-api';
import { formatVnd } from '../money';
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONE, formatDate, projectStatusKeys } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { ErrorToast } from './error-toast';
import { Choice } from './choice';
import { ChipButton, ChipSelect, GroupCounts } from './inline-cells';
import { ProjectProgressBar } from './project-progress-bar';
import { Dialog, Field } from './dialog';
import { ProjectForm } from './project-form';
import { ContextMenu } from './project-tree';
import { TagPicker } from './tag-picker';
import { tagColor, useTags } from './use-tags';
import { ConfirmBox } from './confirm-box';
import { Tooltip } from './tooltip';
import { ProjectFilterButton } from './project-filter-panel';
import { useDirectory } from './use-directory';
import { useFillViewportHeight } from './use-fill-viewport';

const messageOf = (cause: unknown, fallback: string): string =>
  (cause as { message?: string })?.message ?? fallback;

/** Lời báo thành công theo trường vừa sửa ngay trên bảng; `code` là mã dự án để biết dòng nào. */
function savedProjectText(patch: UpdateProjectRequest, code?: string): string {
  const subject = code ? ` dự án ${code}` : ' dự án';
  if (patch.status !== undefined) return `Đã đổi trạng thái${subject} sang "${PROJECT_STATUS_LABELS[patch.status]}".`;
  if (patch.projectType !== undefined) return `Đã đổi nhóm${subject}.`;
  if (patch.customerId !== undefined) return `Đã cập nhật khách hàng${subject}.`;
  return `Đã lưu thay đổi${subject}.`;
}

/** Dấu "Vừa xem" ở dòng dự án vừa quay về còn hiện chừng này (ms). */
const RETURNED_MARK_MS = 8000;

/** Tên nhóm cho dự án chưa gắn nhóm. */
const UNCLASSIFIED = 'Chưa phân loại';

/** Khoá của "nhóm" duy nhất trong tab Tất cả (danh sách phẳng, không có hàng nhóm). */
const FLAT_GROUP = '';

const SCOPE_LABELS: Record<ProjectListScope, string> = { active: 'Đang làm', archived: 'Lưu trữ', all: 'Tất cả' };

/** Dự án đã đóng hoặc huỷ thì không còn đóng hồ sơ được nữa. */
const CLOSED_PROJECT_STATUSES: readonly ProjectStatus[] = ['completed', 'cancelled'];

/** Xếp mặc định trong từng nhóm (và làm tiêu chí phụ khi sắp xếp theo cột): theo tên. */
const byName = (a: ProjectSummary, b: ProjectSummary) => a.name.localeCompare(b.name, 'vi');

/** Cột bấm tiêu đề để sắp xếp được (ô chọn và nút "⋯" thì không). */
const SORTABLE_COLUMNS: ReadonlySet<string> = new Set(['project', 'customer', 'tags', 'status', 'startDate', 'endDate', 'progress']);

/** Các cột của bảng, theo thứ tự mặc định. */
type ProjectColumn =
  | 'select'
  | 'index'
  | 'project'
  | 'group'
  | 'customer'
  | 'contractValue'
  | 'tags'
  | 'status'
  | 'startDate'
  | 'endDate'
  | 'progress'
  | 'actions';

const PROJECT_COLUMNS: readonly ProjectColumn[] = [
  'select',
  'index',
  'project',
  'group',
  'customer',
  'contractValue',
  'tags',
  'status',
  'startDate',
  'endDate',
  'progress',
  'actions',
];

/** Ô chọn và cột tên dự án luôn đứng đầu, không kéo được. */
const PROJECT_PINNED: readonly ProjectColumn[] = ['select', 'index', 'project'];

const PROJECT_COLUMN_LABELS: Record<ProjectColumn, string> = {
  select: 'Chọn',
  index: 'STT',
  project: 'Dự án',
  group: 'Nhóm dự án',
  customer: 'Khách hàng',
  contractValue: 'Giá trị hợp đồng (trước VAT)',
  tags: 'Nhãn',
  status: 'Trạng thái',
  startDate: 'Bắt đầu',
  endDate: 'Kết thúc',
  progress: '% hoàn thành',
  actions: 'Thao tác',
};

const PROJECT_COL_CLASS: Record<ProjectColumn, string | undefined> = {
  select: styles.projectsColCheck,
  index: styles.projectsColIndex,
  project: undefined,
  group: styles.projectsColGroup,
  customer: styles.projectsColCustomer,
  contractValue: styles.projectsColContract,
  tags: styles.projectsColTags,
  status: styles.projectsColStatus,
  startDate: styles.projectsColDate,
  endDate: styles.projectsColDate,
  progress: styles.projectsColProgress,
  actions: styles.projectsColActions,
};

/** Hai kiểu xuất: chọn trường (mẫu 1office) và báo cáo doanh thu theo lĩnh vực (nhóm báo cáo). */
type ExportMode = 'fields' | 'report';

const EXPORT_MODE_LABELS: Record<ExportMode, string> = {
  fields: 'Danh sách dự án (chọn trường)',
  report: 'Báo cáo doanh thu theo lĩnh vực (nhóm báo cáo)',
};

/** Sửa trên bảng một dự án: `fallback` là thông báo khi server không trả lý do. */
type PatchProject = (projectId: string, patch: UpdateProjectRequest, fallback: string) => void;

export interface ProjectsListViewProps {
  /** Mở trang chi tiết của một dự án (đặt `?project=` rồi hiện ProjectsView). */
  readonly onOpenProject: (projectId: string) => void;
  /** Tăng lên mỗi lần bấm "+" ở mục Dự án trên thanh bên: mở hộp tạo dự án. */
  readonly createProjectRequest?: number;
  /** Đã mở hộp tạo dự án theo yêu cầu trên; trang cha đặt bộ đếm về 0. */
  readonly onCreateProjectHandled?: () => void;
  /** Đã tạo, đổi nhóm hay đóng hồ sơ dự án: trang cha nạp lại thanh bên. */
  readonly onProjectsChanged?: () => void;
  /** Chỗ ở dòng tiêu đề khu vực Dự án để đặt nút Tải lại, Chuyển nhóm, Tạo dự án. */
  readonly actionsSlot?: HTMLElement | null;
}

/**
 * Trang danh sách "Dự án".
 *
 * Bố cục theo trang "Công việc của tôi": dòng tóm tắt kèm nút thao tác, thanh
 * lọc (trạng thái, nhóm, nhãn, khách hàng), rồi MỘT bảng gom theo nhóm
 * dự án — nhóm thu gọn được, cuộn dọc độc lập. Chọn nhiều dòng để chuyển nhóm;
 * chuột phải trên một dòng (hay trên các dòng đang chọn) để chuyển nhóm, gắn
 * nhãn; đóng hồ sơ từng dự án qua hộp xác nhận. Mở một dự án thì trang cha chuyển sang
 * ProjectsView chi tiết.
 */
export function ProjectsListView({
  onOpenProject: openProjectPage,
  createProjectRequest = 0,
  onCreateProjectHandled,
  onProjectsChanged,
  actionsSlot,
}: ProjectsListViewProps) {
  // Trang này bị gỡ khỏi cây giao diện khi mở một dự án: lấy lại nhóm đang mở, tab, bộ lọc, cách sắp xếp của lần trước
  // và dự án vừa mở (để đánh dấu khi quay lại). Xem project-list-memory.
  const [memory] = useState(readProjectListMemory);
  const [returnedId, setReturnedId] = useState<string | undefined>(peekReturnedProject);
  // Đã lấy dấu "vừa xem": xoá khỏi trí nhớ để lần vào trang sau không đánh dấu lại.
  useEffect(() => clearReturnedProject(), []);
  const onOpenProject = useCallback(
    (projectId: string) => {
      markProjectOpened(projectId);
      openProjectPage(projectId);
    },
    [openProjectPage],
  );
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [types, setTypes] = useState<readonly ProjectTypeOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  /**
   * Dự án đang làm, danh sách lưu trữ (dự án đã hoàn thành tự vào lưu trữ), hay tất cả dự án (cả hai phần trên, kể cả đã
   * hoàn thành). Tab "Tất cả" hiện một danh sách phẳng, không gom theo nhóm dự án.
   */
  const [scope, setScope] = useState<ProjectListScope>(memory.scope);
  /** Số dự án trong lưu trữ, hiện trên nút chuyển sang danh sách lưu trữ. */
  const [archivedTotal, setArchivedTotal] = useState<number>();

  const [statusFilter, setStatusFilter] = useState(memory.statusFilter);
  const [typeFilter, setTypeFilter] = useState(memory.typeFilter);
  const [tagFilter, setTagFilter] = useState(memory.tagFilter);
  const [customerFilter, setCustomerFilter] = useState(memory.customerFilter);
  /** Bộ lọc nhiều điều kiện từ nút "Lọc sâu"; chạy chồng lên các ô lọc nhanh. */
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>(memory.projectFilter);
  const directory = useDirectory();
  const hasFilter = Boolean(statusFilter || typeFilter || tagFilter || customerFilter);
  const facets = [statusFilter, typeFilter, tagFilter, customerFilter].filter(Boolean).length;
  const tags = useTags();
  // Chưa có id người dùng sẵn trong trang này nên thứ tự cột lưu chung cho trình duyệt.
  const columnOrder = useColumnOrder('projects-list', undefined, PROJECT_COLUMNS, PROJECT_PINNED);
  const { move } = columnOrder;
  // Cột "Nhóm dự án" chỉ có ở tab Tất cả (danh sách phẳng, không có hàng nhóm); hai tab kia đã gom theo nhóm rồi.
  // Cột "Giá trị hợp đồng" chỉ hiện khi người xem được xem tài chính ít nhất một dự án trong danh sách (server chỉ trả
  // `contractValue` cho dự án đó).
  const showContract = projects.some((project) => project.contractValue !== undefined);
  const order = (columnOrder.order as readonly ProjectColumn[]).filter(
    (id) => (id !== 'group' || scope === 'all') && (id !== 'contractValue' || showContract),
  );
  const sizing = useColumnWidths('projects-list', undefined, PROJECT_COLUMNS);
  const tableSizeStyle = explicitTableStyle(order, sizing.widths);
  /** Chữ dài xuống dòng (mặc định) hay gọn một dòng; lưu theo trình duyệt. */
  const [cellWrap, setCellWrap] = useProjectCellWrap();
  const wrapCells = cellWrap === 'wrap';

  /** Nhóm dự án đang mở; mới vào trang thì mọi nhóm thu gọn. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(memory.expanded));
  /** Sắp xếp theo cột đang bấm trên tiêu đề; chưa bấm là xếp theo tên. */
  const [columnSort, setColumnSort] = useState<ProjectColumnSort | undefined>(memory.columnSort);

  // Nhớ mọi thao tác trên danh sách để quay lại từ một dự án vẫn thấy đúng như đã để.
  useEffect(() => {
    writeProjectListMemory({
      scope,
      expanded: [...expanded],
      statusFilter,
      typeFilter,
      tagFilter,
      customerFilter,
      columnSort,
      projectFilter,
    });
  }, [scope, expanded, statusFilter, typeFilter, tagFilter, customerFilter, columnSort, projectFilter]);
  /** Dự án đang được lưu sau khi sửa trên bảng: khoá ô của dòng đó cho tới khi xong. */
  const [savingProject, setSavingProject] = useState<string>();
  const toggleGroup = (type: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  /** Ids đang được chọn để chuyển nhóm. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  /** Dự án mà hộp "Chuyển nhóm" / "Gắn nhãn" đang thao tác; rỗng là hộp đóng. */
  const [moveIds, setMoveIds] = useState<readonly string[]>([]);
  /** Dự án đang chờ xác nhận đóng hồ sơ hoặc mở lưu trữ (từ menu "⋯"). */
  const [archiveAsk, setArchiveAsk] = useState<{ id: string; mode: 'close' | 'restore' }>();
  const [tagIds, setTagIds] = useState<readonly string[]>([]);
  /** Menu chuột phải: vị trí và các dự án nó áp dụng. */
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] }>();
  const [createOpen, setCreateOpen] = useState(false);
  /** Menu "Export" (vị trí dưới nút), hộp chọn trường và việc xuất đang chạy. */
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number }>();
  const [exportPickOpen, setExportPickOpen] = useState(false);
  const [exportKeys, setExportKeys] = useState<readonly string[]>(DEFAULT_PROJECT_EXPORT_KEYS);
  const [exporting, setExporting] = useState(false);
  /** Kiểu xuất trong hộp Export: danh sách dự án theo mẫu 1office, hay báo cáo doanh thu theo lĩnh vực. */
  const [exportMode, setExportMode] = useState<ExportMode>('fields');
  const [panelOpen, setPanelOpen] = useState(false);
  const panelBox = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  // Thẻ danh sách chiếm đúng phần cao còn lại và cuộn bên trong, nên trang không bị cuộn thêm.
  useFillViewportHeight(frame, undefined, scope);

  // Bấm ra ngoài bảng lọc thì đóng; bấm vào danh sách xổ của ô chọn (nằm trong bảng) thì không.
  useEffect(() => {
    if (!panelOpen) return undefined;
    const close = (event: MouseEvent) => {
      if (!panelBox.current?.contains(event.target as Node)) setPanelOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [panelOpen]);

  const reload = useCallback(async () => {
    try {
      const [items, archived, customerList, typeList] = await Promise.all([
        api.listAllProjects(20, scope === 'all' ? {} : { archived: scope === 'archived' ? 'only' : 'exclude' }),
        api.listProjects({ archived: 'only', pageSize: 1 }),
        api.listCustomers(),
        api.listProjectTypes(),
      ]);
      setProjects(items);
      setArchivedTotal(archived.total);
      setCustomers(customerList);
      setTypes(typeList.items);
      setError(undefined);
    } catch (cause) {
      setError(messageOf(cause, 'Không tải được danh sách dự án.'));
    } finally {
      setLoaded(true);
    }
  }, [scope]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Nút "+" ở mục Dự án trên thanh bên mở thẳng hộp tạo dự án; báo lại ngay để
  // quay lại trang này sau đó không tự mở hộp lần nữa.
  useEffect(() => {
    if (createProjectRequest <= 0) return;
    setCreateOpen(true);
    onCreateProjectHandled?.();
  }, [createProjectRequest, onCreateProjectHandled]);

  /**
   * Xuất MỌI dự án người dùng xem được (cả đang làm lẫn lưu trữ, không theo bộ lọc hay tab đang mở) ra Excel theo các cột
   * đã chọn. Dữ liệu là đúng thứ danh sách dự án đã trả cho người này, nên không mở thêm quyền nào; thành viên chỉ nạp khi
   * có cột cần đến, mỗi lần vài dự án để không dồn máy chủ.
   */
  /** Tra tên (người, phòng ban, khách hàng, nhãn) cho các ô của tệp xuất, từ dữ liệu trang đã nạp sẵn. */
  const exportLookups = (members: ReadonlyMap<string, readonly ProjectMember[]>): ProjectExportLookups => {
    const orgName = new Map(directory.orgNodes.map((node) => [node.id, node.name]));
    return {
      personName: directory.nameOf,
      orgUnitName: (id) => (id ? (orgName.get(id) ?? '') : ''),
      customerName: (id) => customerOf(id)?.name ?? '',
      tagName: (tagId) => tags.find(tagId)?.name ?? '',
      membersOf: (projectId) => members.get(projectId),
    };
  };

  /**
   * Báo cáo doanh thu theo lĩnh vực: cùng tập dự án như cách xuất danh sách ở dưới (mọi dự án người này xem được), mỗi
   * dự án đưa giá trị hợp đồng vào cột nhóm báo cáo của nó. Giá trị hợp đồng chỉ có khi được xem tài chính; không có
   * thì vẫn xuất, các ô số để trống.
   */
  const runReportExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const [everything, catalog] = await Promise.all([api.listAllProjects(20, {}), api.listProjectReportGroups()]);
      const report = buildProjectReportSheet(everything, catalog.items, exportLookups(new Map()));
      downloadProjectReportXlsx(projectReportFileName(), report);
      toast.success(`Đã xuất báo cáo doanh thu theo lĩnh vực: ${report.projectCount} dự án.`);
    } catch (cause) {
      toast.error(messageOf(cause, 'Không xuất được báo cáo doanh thu theo lĩnh vực.'));
    } finally {
      setExporting(false);
    }
  };

  const runExport = async (keys: readonly string[]) => {
    const columns = selectedExportColumns(keys);
    if (columns.length === 0 || exporting) return;
    setExporting(true);
    try {
      const everything = await api.listAllProjects(20, {});
      const members = new Map<string, readonly ProjectMember[]>();
      let memberFailures = 0;
      if (needsMembers(columns)) {
        let next = 0;
        const worker = async () => {
          while (next < everything.length) {
            const project = everything[next++] as ProjectSummary;
            try {
              members.set(project.id, (await api.listMembers(project.id)).items);
            } catch {
              memberFailures += 1;
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(6, everything.length) }, worker));
      }
      const { headers, rows } = buildProjectExportRows(everything, columns, exportLookups(members));
      downloadProjectsXlsx(projectExportFileName(rows.length), headers, rows);
      toast.success(`Đã xuất ${rows.length} dự án.`);
      if (memberFailures > 0) {
        toast.error(`${memberFailures} dự án không nạp được danh sách người tham gia; các ô đó để trống.`);
      }
    } catch (cause) {
      toast.error(messageOf(cause, 'Không xuất được danh sách dự án.'));
    } finally {
      setExporting(false);
    }
  };

  /** Khách hàng theo id, để cột Khách hàng khỏi gọi thêm API từng dòng. */
  const customerOf = useMemo(() => {
    const byId = new Map(customers.map((customer) => [customer.id, customer]));
    return (id?: string) => (id ? byId.get(id) : undefined);
  }, [customers]);

  const visible = useMemo(
    () =>
      projects.filter((project) => {
        if (statusFilter && project.status !== statusFilter) return false;
        if (typeFilter && (project.projectType ?? '') !== typeFilter) return false;
        if (tagFilter && !(project.tagIds ?? []).includes(tagFilter)) return false;
        if (customerFilter && (project.customerId ?? '') !== customerFilter) return false;
        return matchProjectFilter(project, projectFilter, { today: new Date(), orgNodes: directory.orgNodes });
      }),
    [projects, statusFilter, typeFilter, tagFilter, customerFilter, projectFilter, directory.orgNodes],
  );

  // Quay về từ một dự án: mở nhóm chứa nó (nếu người dùng đã thu gọn) rồi đưa dòng đó vào giữa khung nhìn. Dấu "Vừa xem"
  // tự tắt sau một lúc hoặc khi người dùng bấm vào đâu đó.
  useEffect(() => {
    if (!returnedId || !loaded) return undefined;
    const project = projects.find((entry) => entry.id === returnedId);
    if (!project) {
      // Dự án không còn trong danh sách này (đã lưu trữ, bị xoá, hay khác tab): thôi đánh dấu.
      setReturnedId(undefined);
      return undefined;
    }
    const group = project.projectType?.trim() || UNCLASSIFIED;
    setExpanded((current) => (current.has(group) ? current : new Set(current).add(group)));
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-project-row="${CSS.escape(returnedId)}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }),
    );
    const timer = window.setTimeout(() => setReturnedId(undefined), RETURNED_MARK_MS);
    const clear = () => setReturnedId(undefined);
    document.addEventListener('pointerdown', clear, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', clear);
    };
  }, [returnedId, loaded, projects]);

  /** Gom dòng theo nhóm dự án; dự án chưa có nhóm rơi vào "Chưa phân loại". */
  const groups = useMemo(() => {
    const byType = new Map<string, ProjectSummary[]>();
    for (const project of visible) {
      // Tab "Tất cả" là một danh sách phẳng: mọi dự án vào cùng một nhóm không tên (GroupRows không vẽ hàng nhóm).
      const key = scope === 'all' ? FLAT_GROUP : project.projectType?.trim() || UNCLASSIFIED;
      const bucket = byType.get(key);
      if (bucket) bucket.push(project);
      else byType.set(key, [project]);
    }
    // Sắp xếp theo cột chỉ đổi thứ tự dòng trong từng nhóm; thứ tự các nhóm giữ nguyên.
    const statuses = projectStatusKeys();
    const lookups = {
      customerName: (project: ProjectSummary) => customerOf(project.customerId)?.name ?? '',
      tagNames: (project: ProjectSummary) =>
        (project.tagIds ?? []).map((tagId) => tags.find(tagId)?.name ?? '').filter(Boolean),
      statusRank: (status: string) => {
        const rank = statuses.indexOf(status as ProjectStatus);
        return rank < 0 ? statuses.length : rank;
      },
    };
    for (const rows of byType.values()) {
      rows.sort((a, b) => (columnSort ? compareByColumn(columnSort, lookups, a, b) : 0) || byName(a, b));
    }
    return [...byType.entries()].sort(([a], [b]) => {
      // "Chưa phân loại" xuống cuối; còn lại xếp theo chữ cái tiếng Việt.
      if (a === UNCLASSIFIED) return 1;
      if (b === UNCLASSIFIED) return -1;
      return a.localeCompare(b, 'vi');
    });
  }, [visible, scope, columnSort, customerOf, tags]);

  /** Số dự án đang chạy / đã hoàn thành trong phần đang hiện, cho dòng tóm tắt. */
  const activeCount = visible.filter((project) => project.status === 'active').length;
  const completedCount = visible.filter((project) => project.status === 'completed').length;

  const toggleOne = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setMany = (ids: readonly string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const allVisibleSelected = visible.length > 0 && visible.every((project) => selected.has(project.id));
  const someVisibleSelected = !allVisibleSelected && visible.some((project) => selected.has(project.id));
  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((project) => project.id)));

  /* -------------------------------------------------------------- Thao tác */

  /** Sửa một trường của dự án ngay trên bảng rồi thay dòng đó bằng bản server trả về. */
  const patchProject = useCallback<PatchProject>(
    (projectId, patch, fallback) => {
      setSavingProject(projectId);
      const code = projects.find((project) => project.id === projectId)?.code;
      api
        .updateProject(projectId, patch)
        .then((updated) => {
          setProjects((current) =>
            current.map((project) => (project.id === updated.id ? mergeUpdated(project, updated, patch) : project)),
          );
          // Báo bằng toast: banner trên đầu bảng đẩy cả bảng xuống mỗi lần sửa.
          toast.success(savedProjectText(patch, code));
          // Đổi nhóm làm thanh bên đổi theo.
          if (patch.projectType !== undefined) onProjectsChanged?.();
          // Hoàn thành có thể tự đóng hồ sơ (vào Lưu trữ): tải lại để dự án rời đúng danh sách.
          if (patch.status !== undefined) void reload();
        })
        .catch((cause) => toast.error(messageOf(cause, fallback)))
        .finally(() => setSavingProject(undefined));
    },
    [onProjectsChanged, reload, projects],
  );

  const closeProject = useCallback(
    async (projectId: string) => {
      try {
        // Đóng hồ sơ chỉ đưa vào Lưu trữ, không đổi trạng thái dự án.
        await api.archiveProject(projectId);
        setError(undefined);
        toast.success('Đã đóng hồ sơ; dự án đã chuyển vào Lưu trữ, trạng thái giữ nguyên.');
        await reload();
        onProjectsChanged?.();
      } catch (cause) {
        // Server chặn khi dự án còn công việc chưa đóng: nói rõ cho người dùng.
        toast.error(messageOf(cause, 'Không đóng được hồ sơ dự án.'));
      }
    },
    [reload, onProjectsChanged],
  );

  /** Mở lưu trữ: dự án rời danh sách lưu trữ và chỉnh sửa được; trạng thái Hoàn thành về Đang chạy hoặc giữ nguyên theo cài đặt. */
  const unarchive = useCallback(
    async (projectId: string) => {
      try {
        const project = await api.unarchiveProject(projectId);
        setError(undefined);
        toast.success(`Đã mở lưu trữ ${project.code}; dự án về lại danh sách đang làm.`);
        await reload();
        onProjectsChanged?.();
      } catch (cause) {
        toast.error(messageOf(cause, 'Không mở được lưu trữ dự án.'));
      }
    },
    [reload, onProjectsChanged],
  );

  const moveGroup = useCallback(
    async (projectType: string) => {
      const next = projectType.trim() || null;
      // Ném lỗi ra để hộp thoại tự hiện; dừng ở dòng đầu hỏng.
      for (const id of moveIds) {
        await api.updateProject(id, { projectType: next } as UpdateProjectRequest);
      }
      setSelected(new Set());
      setMoveIds([]);
      await reload();
      onProjectsChanged?.();
    },
    [moveIds, reload, onProjectsChanged],
  );

  /**
   * Lưu nhãn: một dự án thì thay đúng bộ nhãn đã chọn; nhiều dự án thì THÊM
   * nhãn đã chọn vào nhãn sẵn có của từng dự án, không xoá nhãn riêng của ai.
   */
  const saveTags = useCallback(
    async (chosen: readonly string[]) => {
      const single = tagIds.length === 1;
      for (const id of tagIds) {
        const current = projects.find((project) => project.id === id)?.tagIds ?? [];
        const next = single ? [...chosen] : [...new Set([...current, ...chosen])];
        await api.updateProject(id, { tagIds: next });
      }
      setTagIds([]);
      await reload();
    },
    [tagIds, projects, reload],
  );

  /** Chuột phải trên dòng đang nằm trong vùng chọn nhiều thì áp cho cả vùng chọn. */
  const openMenu = (projectId: string, at: { x: number; y: number }) => {
    const ids = selected.has(projectId) && selected.size > 1 ? [...selected] : [projectId];
    setMenu({ ...at, ids });
  };

  const menuProject = menu && menu.ids.length === 1 ? projects.find((project) => project.id === menu.ids[0]) : undefined;

  const handleCreate = useCallback(
    async (
      input: CreateProjectRequest,
      contractValue?: number | null,
      members?: ReadonlyArray<{ readonly userId: string; readonly role: ProjectRole }>,
      relatedObjects?: readonly PendingRelatedObject[],
      reportGroupId?: string,
    ) => {
      const created = await api.createProject(input);
      const warning = initialTasksWarning(created);
      if (warning) toast.warning(warning);
      // Số tiền, thành viên, đối tượng liên quan và nhóm báo cáo đi đường riêng, cùng cách như trong ProjectsView.
      const warnings = await finishProjectCreate(created, { contractValue, members, relatedObjects, reportGroupId });
      for (const text of warnings) toast.warning(text);
      await reload();
      onProjectsChanged?.();
      onOpenProject(created.id);
    },
    [reload, onProjectsChanged, onOpenProject],
  );

  /* ------------------------------------------------------------- Render */

  const statusOptions = projectStatusKeys().map((status) => ({
    value: status,
    label: PROJECT_STATUS_LABELS[status],
  }));
  const typeOptions = types.map((type) => ({
    value: type.name,
    label: `${type.name} (${type.count})`,
  }));
  const tagOptions = tags.tags
    .filter((tag) => tag.isActive)
    .map((tag) => ({ value: tag.id, label: tag.name }));
  const customerOptions = customers.map((customer) => ({
    value: customer.id,
    label: `${customer.code} · ${customer.name}`,
  }));
  // Ô khách hàng trên bảng hiện mã cho gọn; tên đầy đủ nằm ở dòng phụ để vẫn gõ tên mà tìm được.
  const customerCellOptions = customers.map((customer) => ({
    value: customer.id,
    label: customer.code,
    description: customer.name,
  }));

  return (
    <div className={styles.tabBody}>
      {(() => {
        // Nút thao tác nằm ở dòng tiêu đề khu vực Dự án (trang cha đưa chỗ đặt); thiếu chỗ thì để ngay đầu trang.
        const actions = (
          <>
            <Tooltip content="Tải lại">
              <button type="button" className={styles.iconButton} aria-label="Tải lại" onClick={() => void reload()}>
                <RefreshCw size={15} />
              </button>
            </Tooltip>
            <Tooltip
              content={
                selected.size === 0
                  ? 'Tích chọn dự án trong bảng, hoặc chuột phải trên một dự án, để chuyển nhóm.'
                  : undefined
              }
            >
              <span className={styles.tooltipAnchor}>
                <button
                  type="button"
                  className={styles.buttonGhost}
                  disabled={selected.size === 0}
                  onClick={() => setMoveIds([...selected])}
                >
                  <FolderInput size={15} /> Chuyển nhóm
                  {selected.size > 0 ? <span className={styles.countBadge}>{selected.size}</span> : null}
                </button>
              </span>
            </Tooltip>
            <button
              type="button"
              className={styles.buttonGhost}
              aria-haspopup="menu"
              aria-expanded={Boolean(exportMenu)}
              disabled={exporting}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                setExportMenu({ x: box.left, y: box.bottom + 4 });
              }}
            >
              <Download size={15} /> {exporting ? 'Đang xuất…' : 'Export'}
            </button>
            <button type="button" className={styles.buttonPrimary} onClick={() => setCreateOpen(true)}>
              <Plus size={15} /> Tạo dự án
            </button>
          </>
        );
        return actionsSlot ? (
          createPortal(actions, actionsSlot)
        ) : (
          <div className={styles.pageHeadEnd}>{actions}</div>
        );
      })()}

      <div ref={frame} className={styles.ledgerCard}>
        <header className={styles.ledgerHead}>
          <div className={styles.reqHeadLeft}>
            <div className={styles.segmented} role="tablist" aria-label="Danh sách dự án">
              {(['active', 'archived', 'all'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={scope === value}
                  className={scope === value ? styles.segmentActive : styles.segment}
                  onClick={() => {
                    setScope(value);
                    setSelected(new Set());
                  }}
                >
                  {SCOPE_LABELS[value]}
                  {value === 'archived' && archivedTotal !== undefined ? (
                    <span className={styles.countPill}>{archivedTotal}</span>
                  ) : null}
                </button>
              ))}
            </div>
            <div ref={panelBox} className={styles.timelinePanelBox}>
              <button
                type="button"
                className={facets > 0 || panelOpen ? styles.timelineToggleOn : styles.timelineToggle}
                aria-haspopup="dialog"
                aria-expanded={panelOpen}
                onClick={() => setPanelOpen((value) => !value)}
              >
                <ListFilter size={13} aria-hidden />
                Bộ lọc
                {facets > 0 ? <span className={styles.countBadge}>{facets}</span> : null}
              </button>
              {panelOpen ? (
                <div
                  className={`${styles.timelinePanel} ${styles.timelinePanelLeft} ${styles.reqPanel}`}
                  role="dialog"
                  aria-label="Bộ lọc dự án"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      setPanelOpen(false);
                    }
                  }}
                >
                  <div className={styles.reqPanelGrid}>
                    <div className={styles.filterField}>
                      <span className={styles.filterLabel}>Trạng thái</span>
                      <Choice
                        label="Trạng thái"
                        selectOnly
                        value={statusFilter}
                        emptyOption="Tất cả"
                        options={statusOptions}
                        onChange={setStatusFilter}
                      />
                    </div>
                    <div className={styles.filterField}>
                      <span className={styles.filterLabel}>Nhóm dự án</span>
                      <Choice
                        label="Nhóm dự án"
                        selectOnly
                        value={typeFilter}
                        emptyOption="Tất cả"
                        options={typeOptions}
                        onChange={setTypeFilter}
                      />
                    </div>
                    <div className={styles.filterField}>
                      <span className={styles.filterLabel}>Nhãn</span>
                      <Choice
                        label="Nhãn"
                        selectOnly
                        value={tagFilter}
                        emptyOption="Tất cả"
                        options={tagOptions}
                        onChange={setTagFilter}
                      />
                    </div>
                    <div className={styles.filterField}>
                      <span className={styles.filterLabel}>Khách hàng</span>
                      <Choice
                        label="Khách hàng"
                        selectOnly
                        value={customerFilter}
                        emptyOption="Tất cả"
                        options={customerOptions}
                        onChange={setCustomerFilter}
                      />
                    </div>
                  </div>
                  <div className={styles.reqPanelFoot}>
                    {hasFilter ? (
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => {
                          setStatusFilter('');
                          setTypeFilter('');
                          setTagFilter('');
                          setCustomerFilter('');
                        }}
                      >
                        Xoá lọc
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            <ProjectFilterButton filter={projectFilter} onChange={setProjectFilter} />
            <Tooltip
              content={
                wrapCells
                  ? 'Chữ dài đang xuống dòng để hiện đủ. Bấm để gọn mỗi dự án một dòng (rê chuột xem đủ chữ).'
                  : 'Đang gọn một dòng, chữ dài bị cắt. Bấm để chữ xuống dòng, hiện đủ tên.'
              }
            >
              <button
                type="button"
                className={wrapCells ? styles.timelineToggleOn : styles.timelineToggle}
                aria-pressed={wrapCells}
                onClick={() => setCellWrap(wrapCells ? 'compact' : 'wrap')}
              >
                <TextWrap size={13} aria-hidden />
                {wrapCells ? 'Xuống dòng' : 'Gọn một dòng'}
              </button>
            </Tooltip>
            <ResetColumnLayoutButton order={columnOrder} sizing={sizing} />
            <span className={styles.reqCount}>
              {!loaded ? 'Đang tải…' : `${visible.length} dự án`}
              {selected.size > 0 ? ` · đã chọn ${selected.size}` : ''}
            </span>
          </div>
          <div className={styles.pageMeta}>
            <span>
              Đang chạy <b>{loaded ? activeCount : '—'}</b>
            </span>
            <span>
              Hoàn thành <b className={styles.textSuccess}>{loaded ? completedCount : '—'}</b>
            </span>
          </div>
        </header>

        <ErrorToast message={error} />

        <div className={styles.ledgerScroll}>
          <table
            className={`${styles.table} ${styles.ledgerTable} ${styles.treeTable} ${styles.projectsTable}${wrapCells ? ` ${styles.projectsWrap}` : ''}${sizing.customized ? ` ${styles.columnsResized}` : ''}`}
            style={tableSizeStyle}
          >
            {/* Chiều rộng cột cố định: mở hay thu một nhóm không làm các cột dịch chỗ. */}
            <colgroup>
              {order.map((id) => (
                <col
                  key={id}
                  className={PROJECT_COL_CLASS[id]}
                  style={tableSizeStyle && sizing.widths ? { width: sizing.widths[id] } : undefined}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                {order.map((id) => (
                  <ReorderableTh
                    key={id}
                    tableKey="projects-list"
                    id={id}
                    order={order}
                    pinned={PROJECT_PINNED}
                    onMove={move}
                    sizing={sizing}
                    label={PROJECT_COLUMN_LABELS[id]}
                    className={id === 'progress' || id === 'contractValue' ? styles.numeric : undefined}
                    sortDirection={columnSort?.column === id ? columnSort.direction : undefined}
                    onSort={
                      SORTABLE_COLUMNS.has(id)
                        ? () => setColumnSort((current) => nextColumnSort(current, id as ProjectSortColumn))
                        : undefined
                    }
                  >
                    {id === 'select' ? (
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả"
                        ref={(element) => {
                          if (element) element.indeterminate = someVisibleSelected;
                        }}
                        checked={allVisibleSelected}
                        onChange={toggleAll}
                      />
                    ) : id === 'actions' ? null : (
                      PROJECT_COLUMN_LABELS[id]
                    )}
                  </ReorderableTh>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(([type, rows]) => (
                <GroupRows
                  key={type}
                  type={type}
                  rows={rows}
                  flat={scope === 'all'}
                  collapsed={scope === 'all' ? false : !expanded.has(type)}
                  onToggleGroup={() => toggleGroup(type)}
                  selected={selected}
                  returnedId={returnedId}
                  onSelectMany={setMany}
                  savingId={savingProject}
                  customerOf={customerOf}
                  customerOptions={customerCellOptions}
                  onPatch={patchProject}
                  onEditTags={(id) => setTagIds([id])}
                  tagOf={tags.find}
                  onToggle={toggleOne}
                  onMenu={openMenu}
                  onOpen={onOpenProject}
                  order={order}
                  wrap={wrapCells}
                />
              ))}
            </tbody>
          </table>
          {loaded && visible.length === 0 ? (
            <p className={styles.emptyRow}>
              {projects.length > 0
                ? 'Không có dự án nào khớp bộ lọc.'
                : scope === 'archived'
                  ? 'Chưa có dự án nào trong lưu trữ. Dự án hoàn thành sẽ tự vào đây.'
                  : 'Chưa có dự án nào.'}
            </p>
          ) : null}
          {!loaded ? <p className={styles.emptyRow}>Đang tải…</p> : null}
        </div>
      </div>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={[
            ...(menu.ids.length === 1 ? [{ id: 'open', label: 'Mở dự án' }] : []),
            {
              id: 'move',
              label: menu.ids.length > 1 ? `Chuyển nhóm ${menu.ids.length} dự án…` : 'Chuyển nhóm…',
              separatorBefore: menu.ids.length === 1,
            },
            {
              id: 'tags',
              label: menu.ids.length > 1 ? `Gắn nhãn ${menu.ids.length} dự án…` : 'Gắn nhãn…',
            },
            // Đóng hồ sơ / mở lưu trữ chỉ làm với một dự án mỗi lần.
            ...(menuProject
              ? [
                  menuProject.archivedAt
                    ? { id: 'restore', label: 'Mở lưu trữ…', separatorBefore: true }
                    : !CLOSED_PROJECT_STATUSES.includes(menuProject.status)
                      ? { id: 'close', label: 'Đóng hồ sơ…', separatorBefore: true }
                      : undefined,
                ].filter((action): action is { id: string; label: string; separatorBefore: boolean } => Boolean(action))
              : []),
          ]}
          onClose={() => setMenu(undefined)}
          onPick={(actionId) => {
            const ids = menu.ids;
            setMenu(undefined);
            if (actionId === 'open') onOpenProject(ids[0] as string);
            if (actionId === 'move') setMoveIds(ids);
            if (actionId === 'tags') setTagIds(ids);
            if (actionId === 'close' || actionId === 'restore') {
              setArchiveAsk({ id: ids[0] as string, mode: actionId });
            }
          }}
        />
      ) : null}

      {exportMenu ? (
        <ContextMenu
          x={exportMenu.x}
          y={exportMenu.y}
          actions={[
            { id: 'all', label: 'Xuất tất cả' },
            { id: 'pick', label: 'Chọn trường để export' },
            { id: 'report', label: 'Xuất theo nhóm báo cáo', separatorBefore: true },
          ]}
          onClose={() => setExportMenu(undefined)}
          onPick={(actionId) => {
            setExportMenu(undefined);
            if (actionId === 'all') void runExport(DEFAULT_PROJECT_EXPORT_KEYS);
            if (actionId === 'pick' || actionId === 'report') {
              setExportMode(actionId === 'report' ? 'report' : 'fields');
              setExportPickOpen(true);
            }
          }}
        />
      ) : null}

      <Dialog
        open={exportPickOpen}
        title={exportMode === 'report' ? 'Xuất theo nhóm báo cáo' : 'Chọn trường để export'}
        submitLabel="Export"
        submitDisabled={exportMode === 'fields' && exportKeys.length === 0}
        guardDiscard={false}
        onClose={() => setExportPickOpen(false)}
        onSubmit={() => {
          setExportPickOpen(false);
          void (exportMode === 'report' ? runReportExport() : runExport(exportKeys));
        }}
      >
        <div className={`${styles.segmented} ${styles.exportModeTabs}`} role="tablist" aria-label="Kiểu xuất">
          {(['fields', 'report'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={exportMode === mode}
              className={exportMode === mode ? styles.segmentActive : styles.segment}
              onClick={() => setExportMode(mode)}
            >
              {EXPORT_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        {exportMode === 'report' ? (
          <div className={styles.exportReportNote}>
            <p>
              Theo mẫu &quot;Chi tiết doanh thu dự án&quot;: mỗi dự án một dòng, giá trị hợp đồng (trước VAT) nằm ở cột
              tổng và ở đúng cột lĩnh vực theo nhóm báo cáo của dự án; dòng tổng dùng công thức SUBTOTAL nên lọc trong
              Excel vẫn ra tổng đúng.
            </p>
            <p>Dự án chưa gán nhóm báo cáo (hay gán nhóm đã xoá) vào cột &quot;Chưa phân nhóm&quot;.</p>
            {showContract ? null : (
              <p className={styles.exportReportHint}>Bạn không xem được giá trị hợp đồng nên các cột số sẽ trống.</p>
            )}
          </div>
        ) : null}
        {exportMode === 'fields' ? (
          <>
            <div className={styles.exportFieldActions}>
              <button type="button" className={styles.linkButton} onClick={() => setExportKeys(DEFAULT_PROJECT_EXPORT_KEYS)}>
                Chọn tất cả
              </button>
              <button type="button" className={styles.linkButton} onClick={() => setExportKeys([])}>
                Bỏ chọn tất cả
              </button>
            </div>
            <div className={styles.exportFieldGrid}>
              {PROJECT_EXPORT_COLUMNS.map((column) => (
                <label key={column.key} className={styles.columnPickerItem}>
                  <input
                    type="checkbox"
                    checked={exportKeys.includes(column.key)}
                    onChange={(event) =>
                      setExportKeys((current) =>
                        event.target.checked
                          ? [...current, column.key]
                          : current.filter((key) => key !== column.key),
                      )
                    }
                  />
                  <span>{column.label}</span>
                </label>
              ))}
            </div>
          </>
        ) : null}
      </Dialog>

      <ConfirmBox
        open={Boolean(archiveAsk)}
        title={
          archiveAsk?.mode === 'restore'
            ? 'Bạn có chắc chắn muốn mở lưu trữ dự án này?'
            : 'Bạn có chắc chắn muốn đóng hồ sơ dự án này?'
        }
        message={
          archiveAsk?.mode === 'restore'
            ? 'Dự án về lại danh sách đang làm và chỉnh sửa được. Dự án đang "Hoàn thành" về "Đang chạy" hoặc giữ nguyên trạng thái, theo Cấu hình chung.'
            : 'Dự án vào Lưu trữ, trạng thái giữ nguyên. Đóng được cả khi còn công việc chưa xong; mở lại bằng Mở lưu trữ.'
        }
        confirmLabel={archiveAsk?.mode === 'restore' ? 'Mở lưu trữ' : 'Đóng hồ sơ'}
        tone={archiveAsk?.mode === 'restore' ? 'primary' : 'warning'}
        onConfirm={() => {
          const ask = archiveAsk;
          setArchiveAsk(undefined);
          if (!ask) return;
          void (ask.mode === 'restore' ? unarchive(ask.id) : closeProject(ask.id));
        }}
        onCancel={() => setArchiveAsk(undefined)}
      />

      <MoveGroupDialog
        open={moveIds.length > 0}
        count={moveIds.length}
        initial={
          moveIds.length === 1
            ? (projects.find((project) => project.id === moveIds[0])?.projectType ?? '')
            : ''
        }
        types={types}
        onClose={() => setMoveIds([])}
        onMove={moveGroup}
      />

      <ProjectTagsDialog
        open={tagIds.length > 0}
        projects={projects.filter((project) => tagIds.includes(project.id))}
        onClose={() => setTagIds([])}
        onSave={saveTags}
      />

      <ProjectForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        // Người tạo tự thành chủ nhiệm, nên luôn được đặt giá trị hợp đồng.
        financeEnabled
        onCreate={handleCreate}
        // Không mở chi tiết từ danh sách nên không có nhánh sửa ở đây.
        onUpdate={async () => undefined}
      />
    </div>
  );
}

/* ========================================================================= */

/** Một nhóm dự án: dòng tiêu đề nhóm rồi các dòng dự án của nhóm. */
/**
 * Hàng chip tự vừa bề rộng ô: hiện được bao nhiêu chip thì hiện, phần còn lại gộp thành "+N" (luôn hiện ít nhất một
 * chip). Đo bằng một bản ẩn của toàn bộ chip nên đổi độ rộng cột là tính lại ngay.
 */
function FitChips({
  chips,
  more,
  measureKey,
  wrapAll = false,
}: {
  chips: readonly ReactNode[];
  more: (hidden: number) => ReactNode;
  /** Đổi khi nội dung chip đổi (vd ghép tên các nhãn), để đo lại. */
  measureKey: string;
  /** Chế độ xuống dòng: hiện đủ mọi chip, xuống dòng khi hết chỗ, không đo. */
  wrapAll?: boolean;
}) {
  const wrap = useRef<HTMLSpanElement>(null);
  const meter = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(chips.length);
  useLayoutEffect(() => {
    const wrapEl = wrap.current;
    const meterEl = meter.current;
    if (!wrapEl || !meterEl) return;
    const GAP = 4;
    const compute = () => {
      const widths = [...meterEl.querySelectorAll<HTMLElement>('[data-fit-chip]')].map(
        (el) => el.getBoundingClientRect().width,
      );
      const moreWidth = meterEl.querySelector<HTMLElement>('[data-fit-more]')?.getBoundingClientRect().width ?? 0;
      const available = wrapEl.clientWidth;
      let used = 0;
      let count = 0;
      for (let index = 0; index < widths.length; index += 1) {
        const next = used + (index > 0 ? GAP : 0) + widths[index];
        const reserve = index < widths.length - 1 ? GAP + moreWidth : 0;
        if (next + reserve > available) break;
        used = next;
        count = index + 1;
      }
      setVisible(Math.max(1, count));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(wrapEl);
    return () => observer.disconnect();
  }, [chips.length, measureKey, wrapAll]);

  if (wrapAll) return <span className={styles.chipGroup}>{chips}</span>;
  const shown = Math.min(visible, chips.length);
  const hidden = chips.length - shown;
  return (
    <span ref={wrap} className={styles.fitChips}>
      <span className={styles.chipGroup}>
        {chips.slice(0, shown)}
        {hidden > 0 ? more(hidden) : null}
      </span>
      {/* Bản ẩn để đo độ rộng tự nhiên của từng chip và của nhãn "+N" rộng nhất. */}
      <span ref={meter} className={styles.fitChipsMeter} aria-hidden {...({ inert: '' } as object)}>
        {chips.map((chip, index) => (
          <span key={index} data-fit-chip>
            {chip}
          </span>
        ))}
        <span data-fit-more>{more(chips.length - 1)}</span>
      </span>
    </span>
  );
}

function GroupRows({
  type,
  rows,
  collapsed,
  onToggleGroup,
  selected,
  returnedId,
  onSelectMany,
  savingId,
  customerOf,
  customerOptions,
  onPatch,
  onEditTags,
  tagOf,
  onToggle,
  onMenu,
  onOpen,
  order,
  flat = false,
  wrap = false,
}: {
  /** Tab Tất cả: không vẽ hàng nhóm; tên nhóm dự án có cột riêng. */
  flat?: boolean;
  /** Chữ dài xuống dòng: hiện thêm tên khách hàng dưới mã, hiện đủ mọi nhãn (không gộp "+N"). */
  wrap?: boolean;
  /** Thứ tự cột hiện tại; mọi ô của dòng nhóm và dòng dự án theo đúng thứ tự này. */
  order: readonly ProjectColumn[];
  type: string;
  rows: readonly ProjectSummary[];
  collapsed: boolean;
  onToggleGroup: () => void;
  selected: ReadonlySet<string>;
  /** Dự án người dùng vừa quay về từ trang chi tiết: dòng của nó được đánh dấu "Vừa xem". */
  returnedId?: string;
  /** Chọn hoặc bỏ chọn cả nhóm một lượt. */
  onSelectMany: (ids: readonly string[], on: boolean) => void;
  savingId?: string;
  customerOf: (id?: string) => CustomerSummary | undefined;
  customerOptions: readonly { value: string; label: string; description: string }[];
  onPatch: PatchProject;
  onEditTags: (id: string) => void;
  tagOf: (tagId: string) => Tag | undefined;
  onToggle: (id: string) => void;
  onMenu: (id: string, at: { x: number; y: number }) => void;
  onOpen: (id: string) => void;
}) {
  const today = new Date().toLocaleDateString('en-CA');
  const countOf = (test: (project: ProjectSummary) => boolean) => rows.filter(test).length;
  const counts = {
    // Trễ hạn: đã qua ngày kết thúc mà chưa hoàn thành hay huỷ.
    overdue: countOf((project) => isProjectOverdue(project, today, CLOSED_PROJECT_STATUSES)),
    notStarted: countOf((project) => project.status === 'planning'),
    active: countOf((project) => project.status === 'active' || project.status === 'on_hold'),
    finished: countOf((project) => project.status === 'completed'),
  };
  // Hàng nhóm là hàng TÓM TẮT: mỗi ô ứng đúng tiêu đề cột, nên thu gọn nhóm vẫn đọc được số liệu của nó.
  const customerCount = new Set(rows.map((project) => project.customerId).filter(Boolean)).size;
  const tagCount = new Set(rows.flatMap((project) => project.tagIds ?? [])).size;
  const nextEnd = nextEndDate(rows, CLOSED_PROJECT_STATUSES);
  const earliestStart = earliestStartDate(rows);
  const progress = rows.length
    ? Math.round(rows.reduce((sum, project) => sum + (project.progressPercent ?? 0), 0) / rows.length)
    : 0;
  // Tổng giá trị hợp đồng của nhóm; không dự án nào có số (hay người xem không được xem tài chính) thì không có tổng.
  const contractValues = rows.flatMap((project) => (typeof project.contractValue === 'number' ? [project.contractValue] : []));
  const contractTotal = contractValues.length > 0 ? contractValues.reduce((sum, value) => sum + value, 0) : undefined;
  const allSelected = rows.length > 0 && rows.every((project) => selected.has(project.id));
  // Chọn một phần dự án trong nhóm: ô nhóm ở trạng thái nửa vời; chọn đủ mới đánh dấu đầy.
  const someSelected = !allSelected && rows.some((project) => selected.has(project.id));
  const groupCells: Record<ProjectColumn, ReactNode> = {
    select: (
        <td>
          <input
            type="checkbox"
            aria-label={`Chọn cả nhóm ${type}`}
            ref={(element) => {
              if (element) element.indeterminate = someSelected;
            }}
            checked={allSelected}
            onChange={() => onSelectMany(rows.map((project) => project.id), !allSelected)}
          />
        </td>
    ),
    index: <td />,
    project: (
        <th scope="row">
          <div className={styles.workCell}>
            <button type="button" className={styles.groupToggle} aria-expanded={!collapsed} onClick={onToggleGroup}>
              {collapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
              <Tooltip content={type}>
                <span className={styles.workTitle}>
                  {type}
                  <span className={styles.groupSummaryMuted}> · {rows.length} dự án</span>
                </span>
              </Tooltip>
            </button>
          </div>
        </th>
    ),
    group: <td />,
    contractValue: (
        <td className={styles.numeric}>
          {contractTotal === undefined ? (
            <span className={styles.groupSummaryMuted}>—</span>
          ) : (
            <Tooltip content={`Tổng giá trị hợp đồng (trước VAT) của ${rows.length} dự án trong nhóm`}>
              <span className={styles.groupSummaryText}>{formatVnd(contractTotal)}</span>
            </Tooltip>
          )}
        </td>
    ),
    customer: (
        <td>
          {customerCount > 0 ? (
            <span className={styles.groupSummaryText}>{customerCount} khách hàng</span>
          ) : (
            <span className={styles.groupSummaryMuted}>—</span>
          )}
        </td>
    ),
    tags: (
        <td>
          {tagCount > 0 ? (
            <span className={styles.groupSummaryText}>{tagCount} nhãn</span>
          ) : (
            <span className={styles.groupSummaryMuted}>—</span>
          )}
        </td>
    ),
    status: (
        <td>
          <GroupCounts counts={counts} unit="dự án" />
        </td>
    ),
    startDate: (
        <td>
          {earliestStart ? (
            <Tooltip content="Ngày bắt đầu sớm nhất trong nhóm">
              <span className={styles.groupSummaryText}>{formatDate(earliestStart)}</span>
            </Tooltip>
          ) : (
            <span className={styles.groupSummaryMuted}>—</span>
          )}
        </td>
    ),
    endDate: (
        <td>
          {counts.overdue > 0 ? (
            <span className={styles.groupOverdue}>Trễ hạn {counts.overdue}</span>
          ) : nextEnd ? (
            <Tooltip content="Hạn kết thúc gần nhất trong nhóm">
              <span className={styles.groupSummaryText}>{formatDate(nextEnd)}</span>
            </Tooltip>
          ) : (
            <span className={styles.groupSummaryMuted}>—</span>
          )}
        </td>
    ),
    progress: (
        <td>
          <Tooltip content={`Tiến độ trung bình của ${rows.length} dự án`}>
            <span className={styles.progressCell}>
              <span className={styles.progressTrack} aria-label={`Tiến độ trung bình ${progress}%`}>
                <span className={styles.progressFill} style={{ width: `${progress}%` }} />
              </span>
              <b>{progress}%</b>
            </span>
          </Tooltip>
        </td>
    ),
    actions: <td />,
  };
  return (
    <>
      {flat ? null : (
        <tr className={styles.groupRow}>
          {order.map((id) => (
            <Fragment key={id}>{groupCells[id]}</Fragment>
          ))}
        </tr>
      )}
      {collapsed ? null : rows.map((project, rowIndex) => {
        const checked = selected.has(project.id);
        const busy = savingId === project.id;
        // Server vẫn kiểm quyền; ở đây chỉ khoá ô để người không có quyền khỏi bấm rồi nhận lỗi.
        // Dự án đã lưu trữ chỉ xem: muốn sửa phải mở lưu trữ (nút ở cuối dòng) trước.
        // Quyền quyết định CẤU TRÚC dòng (ô nhãn, nút); đang lưu (`busy`) chỉ khoá điều khiển, để dòng không đổi hình
        // và các cột không bị xê dịch.
        const canEdit = !project.archivedAt && Boolean(project.myPermissions?.includes('project.update_all'));
        const canEditStatus = !project.archivedAt && Boolean(project.myPermissions?.includes('project.update_status'));
        const customer = customerOf(project.customerId);
        const statusChoices = projectStatusKeys()
          // Huỷ dự án đi qua hộp riêng (kèm lý do) ở trang chi tiết.
          .filter((status) => status !== 'cancelled' || project.status === 'cancelled')
          .map((status) => ({
            value: status,
            label: PROJECT_STATUS_LABELS[status],
            tone: PROJECT_STATUS_TONE[status],
          }));
        const cells: Record<ProjectColumn, ReactNode> = {
          select: (
            <td>
              <input
                type="checkbox"
                aria-label={`Chọn ${project.code}`}
                checked={checked}
                onChange={() => onToggle(project.id)}
              />
            </td>
          ),
          index: <td className={`${styles.numeric} ${styles.muted}`}>{rowIndex + 1}</td>,
          project: (
            <td>
              <div className={flat ? styles.workCell : `${styles.workCell} ${styles.workChild}`}>
                {flat ? null : <span className={styles.workIndent} aria-hidden />}
                <button type="button" className={styles.cellTitleButton} onClick={() => onOpen(project.id)}>
                  {/* Chỉ hiện tên dự án (mã ít ai nhớ, chiếm chỗ); mã vẫn tìm được và hiện khi rê chuột. */}
                  <Tooltip content={`${project.name} · ${project.code}`}>
                    <span className={styles.workTitle}>{project.name}</span>
                  </Tooltip>
                  {returnedId === project.id ? <span className={styles.returnedBadge}>Vừa xem</span> : null}
                </button>
              </div>
            </td>
          ),
          group: (
            <td>
              {project.projectType?.trim() ? (
                <Tooltip content={project.projectType.trim()}>
                  <span className={styles.projectGroupCell}>{project.projectType.trim()}</span>
                </Tooltip>
              ) : (
                <span className={styles.muted}>—</span>
              )}
            </td>
          ),
          contractValue: (
            <td className={styles.numeric}>
              {typeof project.contractValue === 'number' ? formatVnd(project.contractValue) : (
                <span className={styles.muted}>—</span>
              )}
            </td>
          ),
          customer: (
            <td className={customer || !canEdit ? styles.inlineCell : `${styles.inlineCell} ${styles.emptyEdit}`}>
              {!customer && !canEdit ? (
                <span className={styles.muted}>—</span>
              ) : (
                <>
                  {customer ? null : <span className={styles.emptyDash}>—</span>}
                  {/* Chỉ hiện mã cho gọn; tên khách hàng hiện khi rê chuột vào mã (tooltip của chip, `title`). */}
                  <ChipSelect
                    label={`Khách hàng của ${project.code}`}
                    title={customer?.name ?? 'Chưa gắn khách hàng'}
                    value={project.customerId ?? ''}
                    emptyLabel="Chọn khách hàng"
                    options={customerOptions}
                    lead={<Building2 size={13} aria-hidden />}
                    maxWidth={150}
                    disabled={!canEdit || busy}
                    onChange={(value) =>
                      onPatch(project.id, { customerId: value || null }, 'Không đổi được khách hàng.')
                    }
                  />
                </>
              )}
            </td>
          ),
          tags: (
            <td
              className={
                project.tagIds?.length || !canEdit ? styles.inlineCell : `${styles.inlineCell} ${styles.emptyEdit}`
              }
            >
              {project.tagIds?.length ? (
                <FitChips
                  measureKey={project.tagIds.map((tagId) => tagOf(tagId)?.name ?? '').join('|')}
                  wrapAll={wrap}
                  chips={project.tagIds.flatMap((tagId) => {
                    const tag = tagOf(tagId);
                    if (!tag) return [];
                    const color = tagColor(tag);
                    return [
                      <ChipButton
                        key={tagId}
                        tone={{ bg: `${color}14`, fg: color }}
                        title={canEdit ? 'Bấm để sửa nhãn' : tag.name}
                        onClick={canEdit && !busy ? () => onEditTags(project.id) : undefined}
                      >
                        <span className={styles.chipDot} />
                        {tag.name}
                      </ChipButton>,
                    ];
                  })}
                  more={(hidden) => (
                    <Tooltip
                      content={(project.tagIds ?? [])
                        .slice((project.tagIds ?? []).length - hidden)
                        .map((tagId) => tagOf(tagId)?.name)
                        .filter(Boolean)
                        .join(', ')}
                    >
                      <span className={styles.muted}>+{hidden}</span>
                    </Tooltip>
                  )}
                />
              ) : canEdit ? (
                <>
                  <span className={styles.emptyDash}>—</span>
                  <ChipButton dashed label={`Gắn nhãn cho ${project.code}`} onClick={() => onEditTags(project.id)}>
                    <TagIcon size={13} aria-hidden /> Gắn nhãn
                  </ChipButton>
                </>
              ) : (
                <span className={styles.muted}>—</span>
              )}
            </td>
          ),
          status: (
            <td className={styles.inlineCell}>
              <ChipSelect
                label={`Trạng thái của ${project.code}`}
                value={project.status}
                options={statusChoices}
                dot
                disabled={!canEditStatus || busy}
                onChange={(status) =>
                  onPatch(project.id, { status: status as ProjectStatus }, 'Không đổi được trạng thái dự án.')
                }
              />
            </td>
          ),
          startDate: (
            <td className={styles.nowrap}>
              {project.startDate ? formatDate(project.startDate) : <span className={styles.muted}>—</span>}
            </td>
          ),
          endDate: (
            <td className={styles.nowrap}>
              {project.endDate ? (
                isProjectOverdue(project, today, CLOSED_PROJECT_STATUSES) ? (
                  <Tooltip content="Đã quá hạn kết thúc">
                    <span className={styles.groupOverdue}>{formatDate(project.endDate)}</span>
                  </Tooltip>
                ) : (
                  formatDate(project.endDate)
                )
              ) : (
                <span className={styles.muted}>—</span>
              )}
            </td>
          ),
          progress: (
            <td>
              <ProjectProgressBar project={project} />
            </td>
          ),
          actions: (
            <td>
              <button
                type="button"
                className={styles.rowKebab}
                aria-label={`Thao tác với ${project.code}`}
                aria-haspopup="menu"
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  onMenu(project.id, { x: box.left, y: box.bottom + 4 });
                }}
              >
                <MoreHorizontal size={16} aria-hidden />
              </button>
            </td>
          ),
        };
        return (
          <tr
            key={project.id}
            data-project-row={project.id}
            className={
              [checked ? styles.rowSelected : '', returnedId === project.id ? styles.rowReturned : '']
                .filter(Boolean)
                .join(' ') || undefined
            }
            onContextMenu={(event) => {
              event.preventDefault();
              onMenu(project.id, { x: event.clientX, y: event.clientY });
            }}
          >
            {order.map((id) => (
              <Fragment key={id}>{cells[id]}</Fragment>
            ))}
          </tr>
        );
      })}
    </>
  );
}

/* ========================================================================= */

/** Hộp thoại chọn nhóm đích cho các dự án đang chọn. */
function MoveGroupDialog({
  open,
  count,
  initial,
  types,
  onClose,
  onMove,
}: {
  open: boolean;
  count: number;
  /** Nhóm hiện tại khi chỉ chuyển một dự án; rỗng khi nhiều dự án. */
  initial: string;
  types: readonly ProjectTypeOption[];
  onClose: () => void;
  onMove: (projectType: string) => Promise<void>;
}) {
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(initial);
    setError(undefined);
    setSubmitting(false);
  }, [open, initial]);

  const submit = async () => {
    setError(undefined);
    setSubmitting(true);
    try {
      await onMove(target);
    } catch (cause) {
      setError(messageOf(cause, 'Không chuyển nhóm được.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Chuyển nhóm dự án"
      subtitle={`Đổi nhóm cho ${count} dự án đang chọn.`}
      submitLabel="Chuyển nhóm"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Nhóm đích" hint="Thêm hoặc sửa nhóm ở Cài đặt > Nhóm dự án.">
        <Choice
          label="Nhóm đích"
          value={target}
          emptyOption="Chưa phân loại"
          options={types.map((type) => ({ value: type.name, label: type.name }))}
          onChange={setTarget}
        />
      </Field>
    </Dialog>
  );
}

/* ========================================================================= */

/** Hộp thoại gắn nhãn cho một hay nhiều dự án (mở từ menu chuột phải). */
function ProjectTagsDialog({
  open,
  projects,
  onClose,
  onSave,
}: {
  open: boolean;
  projects: readonly ProjectSummary[];
  onClose: () => void;
  onSave: (tagIds: readonly string[]) => Promise<void>;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const single = projects.length === 1 ? projects[0] : undefined;

  useEffect(() => {
    if (!open) return;
    // Một dự án: sửa thẳng bộ nhãn hiện có. Nhiều dự án: chọn nhãn để thêm vào.
    setChosen(single ? [...(single.tagIds ?? [])] : []);
    setError(undefined);
    setSubmitting(false);
  }, [open, single]);

  const submit = async () => {
    setError(undefined);
    setSubmitting(true);
    try {
      await onSave(chosen);
    } catch (cause) {
      setError(messageOf(cause, 'Không lưu được nhãn.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Gắn nhãn dự án"
      subtitle={
        single
          ? `${single.code} · ${single.name}`
          : `Thêm nhãn cho ${projects.length} dự án đang chọn; nhãn sẵn có của từng dự án được giữ.`
      }
      submitLabel="Lưu"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Nhãn" hint="Gõ để tìm, hoặc gõ tên mới rồi Enter để tạo nhãn.">
        <TagPicker selected={chosen} onChange={setChosen} />
      </Field>
    </Dialog>
  );
}
