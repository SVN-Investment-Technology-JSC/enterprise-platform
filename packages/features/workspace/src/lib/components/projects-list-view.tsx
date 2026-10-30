'use client';

import {
  type CreateProjectRequest,
  type CustomerSummary,
  type ProjectRole,
  type ProjectStatus,
  type ProjectSummary,
  type ProjectTypeOption,
  type Tag,
  type UpdateProjectRequest,
} from '@enterprise-platform/contracts-workspace';
import {
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  Building2,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderInput,
  Plus,
  RefreshCw,
  Tag as TagIcon,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EMPTY_PROJECT_FILTER, matchProjectFilter, type ProjectFilter } from '../project-filter.model';
import { mergeNewProjectMembers } from '../project-tree.model';
import { initialTasksWarning } from '../project-created';
import * as api from '../workspace-api';
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONE, projectStatusKeys } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { ChipButton, ChipSelect, GroupCounts, ProgressCell } from './inline-cells';
import { Dialog, Field } from './dialog';
import { ProjectForm } from './project-form';
import { ContextMenu } from './project-tree';
import { TagPicker } from './tag-picker';
import { tagColor, useTags } from './use-tags';
import { Confirm } from './confirm-box';
import { ProjectFilterButton } from './project-filter-panel';
import { useDirectory } from './use-directory';

const messageOf = (cause: unknown, fallback: string): string =>
  (cause as { message?: string })?.message ?? fallback;

/** Tên nhóm cho dự án chưa gắn nhóm. */
const UNCLASSIFIED = 'Chưa phân loại';

/** Dự án đã đóng hoặc huỷ thì không còn đóng hồ sơ được nữa. */
const CLOSED_PROJECT_STATUSES: readonly ProjectStatus[] = ['completed', 'cancelled'];

/** Cách xếp dự án trong từng nhóm; chạy cùng lúc với bộ lọc. */
type ProjectSort = 'name' | 'code' | 'updated';

const SORT_OPTIONS: readonly { value: ProjectSort; label: string }[] = [
  { value: 'name', label: 'Theo tên' },
  { value: 'code', label: 'Theo mã' },
  { value: 'updated', label: 'Cập nhật gần nhất' },
];

const PROJECT_SORTS: Record<ProjectSort, (a: ProjectSummary, b: ProjectSummary) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, 'vi'),
  code: (a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }),
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
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
  onOpenProject,
  createProjectRequest = 0,
  onCreateProjectHandled,
  onProjectsChanged,
  actionsSlot,
}: ProjectsListViewProps) {
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [types, setTypes] = useState<readonly ProjectTypeOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  /** Dự án đang làm, hay danh sách lưu trữ (dự án đã hoàn thành tự vào lưu trữ). */
  const [scope, setScope] = useState<'active' | 'archived'>('active');
  /** Số dự án trong lưu trữ, hiện trên nút chuyển sang danh sách lưu trữ. */
  const [archivedTotal, setArchivedTotal] = useState<number>();

  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  /** Bộ lọc nhiều điều kiện từ nút "Lọc sâu"; chạy chồng lên các ô lọc nhanh. */
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>(EMPTY_PROJECT_FILTER);
  const directory = useDirectory();
  const hasFilter = Boolean(statusFilter || typeFilter || tagFilter || customerFilter);
  const tags = useTags();

  /** Nhóm dự án đang mở; mới vào trang thì mọi nhóm thu gọn. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sortKey, setSortKey] = useState<ProjectSort>('name');
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
  const [tagIds, setTagIds] = useState<readonly string[]>([]);
  /** Menu chuột phải: vị trí và các dự án nó áp dụng. */
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] }>();
  const [createOpen, setCreateOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [items, archived, customerList, typeList] = await Promise.all([
        api.listAllProjects(20, { archived: scope === 'archived' ? 'only' : 'exclude' }),
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

  /** Gom dòng theo nhóm dự án; dự án chưa có nhóm rơi vào "Chưa phân loại". */
  const groups = useMemo(() => {
    const byType = new Map<string, ProjectSummary[]>();
    for (const project of visible) {
      const key = project.projectType?.trim() || UNCLASSIFIED;
      const bucket = byType.get(key);
      if (bucket) bucket.push(project);
      else byType.set(key, [project]);
    }
    for (const rows of byType.values()) rows.sort(PROJECT_SORTS[sortKey]);
    const latest = (rows: readonly ProjectSummary[]) =>
      rows.reduce((max, project) => (project.updatedAt > max ? project.updatedAt : max), '');
    return [...byType.entries()].sort(([a, aRows], [b, bRows]) => {
      // Xếp theo cập nhật: nhóm có dự án vừa sửa lên đầu.
      if (sortKey === 'updated') return latest(bRows).localeCompare(latest(aRows));
      // "Chưa phân loại" xuống cuối; còn lại xếp theo chữ cái tiếng Việt.
      if (a === UNCLASSIFIED) return 1;
      if (b === UNCLASSIFIED) return -1;
      return a.localeCompare(b, 'vi');
    });
  }, [visible, sortKey]);

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

  const allVisibleSelected = visible.length > 0 && visible.every((project) => selected.has(project.id));
  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((project) => project.id)));

  /* -------------------------------------------------------------- Thao tác */

  /** Sửa một trường của dự án ngay trên bảng rồi thay dòng đó bằng bản server trả về. */
  const patchProject = useCallback<PatchProject>(
    (projectId, patch, fallback) => {
      setSavingProject(projectId);
      setNotice(undefined);
      api
        .updateProject(projectId, patch)
        .then((updated) => {
          setError(undefined);
          setProjects((current) =>
            current.map((project) => (project.id === updated.id ? { ...project, ...updated } : project)),
          );
          // Đổi nhóm làm thanh bên đổi theo.
          if (patch.projectType !== undefined) onProjectsChanged?.();
          // Hoàn thành có thể tự đóng hồ sơ (vào Lưu trữ): tải lại để dự án rời đúng danh sách.
          if (patch.status !== undefined) void reload();
        })
        .catch((cause) => setError(messageOf(cause, fallback)))
        .finally(() => setSavingProject(undefined));
    },
    [onProjectsChanged, reload],
  );

  const closeProject = useCallback(
    async (projectId: string) => {
      try {
        // Đóng hồ sơ chỉ đưa vào Lưu trữ, không đổi trạng thái dự án.
        await api.archiveProject(projectId);
        setError(undefined);
        setNotice('Đã đóng hồ sơ; dự án đã chuyển vào Lưu trữ, trạng thái giữ nguyên.');
        await reload();
        onProjectsChanged?.();
      } catch (cause) {
        // Server chặn khi dự án còn công việc chưa đóng: nói rõ cho người dùng.
        setError(messageOf(cause, 'Không đóng được hồ sơ dự án.'));
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
        setNotice(`Đã mở lưu trữ ${project.code}; dự án về lại danh sách đang làm.`);
        await reload();
        onProjectsChanged?.();
      } catch (cause) {
        setError(messageOf(cause, 'Không mở được lưu trữ dự án.'));
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

  const handleCreate = useCallback(
    async (
      input: CreateProjectRequest,
      contractValue?: number | null,
      members?: ReadonlyArray<{ readonly userId: string; readonly role: ProjectRole }>,
    ) => {
      const created = await api.createProject(input);
      const warning = initialTasksWarning(created);
      if (warning) setError(warning);
      // Số tiền và thành viên đi đường riêng, cùng cách như trong ProjectsView.
      if (contractValue !== undefined) {
        await api.updateProjectFinance(created.id, { contractValue });
      }
      if (members && members.length > 0) {
        const existing = await api.listMembers(created.id);
        await api.setMembers(created.id, {
          members: mergeNewProjectMembers(existing.items, members),
        });
      }
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
  const groupCellOptions = types.map((type) => ({ value: type.name, label: type.name }));

  return (
    <div className={styles.listPage}>
      {(() => {
        // Nút thao tác nằm ở dòng tiêu đề khu vực Dự án (trang cha đưa chỗ đặt); thiếu chỗ thì để ngay đầu trang.
        const actions = (
          <>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Tải lại"
              title="Tải lại"
              onClick={() => void reload()}
            >
              <RefreshCw size={15} />
            </button>
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={selected.size === 0}
              title={
                selected.size === 0
                  ? 'Tích chọn dự án trong bảng, hoặc chuột phải trên một dự án, để chuyển nhóm.'
                  : undefined
              }
              onClick={() => setMoveIds([...selected])}
            >
              <FolderInput size={15} /> Chuyển nhóm
              {selected.size > 0 ? <span className={styles.countBadge}>{selected.size}</span> : null}
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

      <div className={styles.underlineTabs}>
        <div role="tablist" aria-label="Danh sách dự án" className={styles.chipGroup}>
          {(['active', 'archived'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scope === value}
              className={scope === value ? styles.underlineTabActive : styles.underlineTab}
              onClick={() => {
                setScope(value);
                setSelected(new Set());
                setNotice(undefined);
              }}
            >
              {value === 'active' ? 'Đang làm' : 'Lưu trữ'}
              {value === 'archived' && archivedTotal !== undefined ? (
                <span className={styles.countPill}>{archivedTotal}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className={`${styles.pageMeta} ${styles.chipBarEnd}`}>
          {!loaded ? <span className={styles.muted}>Đang tải…</span> : null}
          <span>
            <b>{loaded ? visible.length : '—'}</b> dự án
          </span>
          <span>
            Đang chạy <b>{loaded ? activeCount : '—'}</b>
          </span>
          <span>
            Hoàn thành <b className={styles.textSuccess}>{loaded ? completedCount : '—'}</b>
          </span>
        </div>
      </div>

      <div className={styles.chipBar} role="group" aria-label="Bộ lọc và sắp xếp dự án">
        <ChipSelect
          variant="filter"
          label="Sắp xếp"
          prefix="Sắp xếp"
          lead={<ArrowUpDown size={13} aria-hidden />}
          value={sortKey}
          options={SORT_OPTIONS}
          maxWidth={240}
          onChange={(value) => setSortKey((value || 'name') as ProjectSort)}
        />
        <ChipSelect
          variant="filter"
          label="Trạng thái"
          prefix="Trạng thái"
          emptyLabel="Tất cả"
          value={statusFilter}
          options={statusOptions}
          maxWidth={240}
          onChange={setStatusFilter}
        />
        <ChipSelect
          variant="filter"
          label="Nhóm dự án"
          prefix="Nhóm"
          emptyLabel="Tất cả"
          value={typeFilter}
          options={typeOptions}
          maxWidth={260}
          onChange={setTypeFilter}
        />
        <ChipSelect
          variant="filter"
          label="Nhãn"
          prefix="Nhãn"
          emptyLabel="Tất cả"
          value={tagFilter}
          options={tagOptions}
          maxWidth={220}
          onChange={setTagFilter}
        />
        <ChipSelect
          variant="filter"
          label="Khách hàng"
          prefix="Khách hàng"
          emptyLabel="Tất cả"
          value={customerFilter}
          options={customerOptions}
          maxWidth={280}
          onChange={setCustomerFilter}
        />
        {hasFilter ? (
          <button
            type="button"
            className={styles.textButton}
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
        <div className={styles.chipBarEnd}>
          <ProjectFilterButton filter={projectFilter} onChange={setProjectFilter} />
        </div>
      </div>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}

      <div className={styles.listScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  aria-label="Chọn tất cả"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                />
              </th>
              <th>Dự án</th>
              <th>Nhóm</th>
              <th>Nhãn</th>
              <th>Khách hàng</th>
              <th>Trạng thái</th>
              <th className={styles.numeric}>% hoàn thành</th>
              <th aria-label="Thao tác" />
            </tr>
          </thead>
          <tbody>
            {groups.map(([type, rows]) => (
              <GroupRows
                key={type}
                type={type}
                rows={rows}
                collapsed={!expanded.has(type)}
                onToggleGroup={() => toggleGroup(type)}
                selected={selected}
                savingId={savingProject}
                customerOf={customerOf}
                customerOptions={customerCellOptions}
                groupOptions={groupCellOptions}
                onPatch={patchProject}
                onEditTags={(id) => setTagIds([id])}
                tagOf={tags.find}
                onToggle={toggleOne}
                onMenu={openMenu}
                onOpen={onOpenProject}
                onClose={closeProject}
                onUnarchive={unarchive}
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
          ]}
          onClose={() => setMenu(undefined)}
          onPick={(actionId) => {
            const ids = menu.ids;
            setMenu(undefined);
            if (actionId === 'open') onOpenProject(ids[0] as string);
            if (actionId === 'move') setMoveIds(ids);
            if (actionId === 'tags') setTagIds(ids);
          }}
        />
      ) : null}

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
function GroupRows({
  type,
  rows,
  collapsed,
  onToggleGroup,
  selected,
  savingId,
  customerOf,
  customerOptions,
  groupOptions,
  onPatch,
  onEditTags,
  tagOf,
  onToggle,
  onMenu,
  onOpen,
  onClose,
  onUnarchive,
}: {
  type: string;
  rows: readonly ProjectSummary[];
  collapsed: boolean;
  onToggleGroup: () => void;
  selected: ReadonlySet<string>;
  savingId?: string;
  customerOf: (id?: string) => CustomerSummary | undefined;
  customerOptions: readonly { value: string; label: string; description: string }[];
  groupOptions: readonly { value: string; label: string }[];
  onPatch: PatchProject;
  onEditTags: (id: string) => void;
  tagOf: (tagId: string) => Tag | undefined;
  onToggle: (id: string) => void;
  onMenu: (id: string, at: { x: number; y: number }) => void;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  /** Mở lưu trữ (chỉ dòng của dự án đang lưu trữ). */
  onUnarchive: (id: string) => void;
}) {
  const today = new Date().toLocaleDateString('en-CA');
  const countOf = (test: (project: ProjectSummary) => boolean) => rows.filter(test).length;
  const counts = {
    // Trễ hạn: đã qua ngày kết thúc mà chưa hoàn thành hay huỷ.
    overdue: countOf(
      (project) =>
        Boolean(project.endDate && project.endDate < today) && !CLOSED_PROJECT_STATUSES.includes(project.status),
    ),
    notStarted: countOf((project) => project.status === 'planning'),
    active: countOf((project) => project.status === 'active' || project.status === 'on_hold'),
    finished: countOf((project) => project.status === 'completed'),
  };
  return (
    <>
      <tr className={styles.groupRow}>
        <th colSpan={8} scope="colgroup">
          <button
            type="button"
            className={styles.groupToggle}
            aria-expanded={!collapsed}
            onClick={onToggleGroup}
          >
            {collapsed ? (
              <ChevronRight size={14} aria-hidden />
            ) : (
              <ChevronDown size={14} aria-hidden />
            )}
            {type}
          </button>
          <GroupCounts counts={counts} unit="dự án" />
        </th>
      </tr>
      {collapsed ? null : rows.map((project) => {
        const closable = !CLOSED_PROJECT_STATUSES.includes(project.status);
        const checked = selected.has(project.id);
        const busy = savingId === project.id;
        // Server vẫn kiểm quyền; ở đây chỉ khoá ô để người không có quyền khỏi bấm rồi nhận lỗi.
        // Dự án đã lưu trữ chỉ xem: muốn sửa phải mở lưu trữ (nút ở cuối dòng) trước.
        const canEdit = !busy && !project.archivedAt && Boolean(project.myPermissions?.includes('project.update_all'));
        const canEditStatus =
          !busy && !project.archivedAt && Boolean(project.myPermissions?.includes('project.update_status'));
        const customer = customerOf(project.customerId);
        const statusChoices = projectStatusKeys()
          // Huỷ dự án đi qua hộp riêng (kèm lý do) ở trang chi tiết.
          .filter((status) => status !== 'cancelled' || project.status === 'cancelled')
          .map((status) => ({
            value: status,
            label: PROJECT_STATUS_LABELS[status],
            tone: PROJECT_STATUS_TONE[status],
          }));
        return (
          <tr
            key={project.id}
            className={checked ? styles.rowSelected : undefined}
            onContextMenu={(event) => {
              event.preventDefault();
              onMenu(project.id, { x: event.clientX, y: event.clientY });
            }}
          >
            <td>
              <input
                type="checkbox"
                aria-label={`Chọn ${project.code}`}
                checked={checked}
                onChange={() => onToggle(project.id)}
              />
            </td>
            <td>
              <button
                type="button"
                className={styles.cellTitleButton}
                onClick={() => onOpen(project.id)}
              >
                <span className={styles.treeCode}>{project.code}</span>
                {project.name}
              </button>
            </td>
            <td className={styles.inlineCell}>
              <ChipSelect
                label={`Nhóm của ${project.code}`}
                value={project.projectType ?? ''}
                emptyLabel={UNCLASSIFIED}
                options={groupOptions}
                lead={<Folder size={13} aria-hidden />}
                maxWidth={150}
                disabled={!canEdit}
                onChange={(value) =>
                  onPatch(project.id, { projectType: value || null }, 'Không đổi được nhóm dự án.')
                }
              />
            </td>
            <td className={styles.inlineCell}>
              {project.tagIds?.length ? (
                <span className={styles.chipGroup}>
                  {project.tagIds.map((tagId) => {
                    const tag = tagOf(tagId);
                    if (!tag) return null;
                    const color = tagColor(tag);
                    return (
                      <ChipButton
                        key={tagId}
                        tone={{ bg: `${color}14`, fg: color }}
                        title={canEdit ? 'Bấm để sửa nhãn' : tag.name}
                        onClick={canEdit ? () => onEditTags(project.id) : undefined}
                      >
                        <span className={styles.chipDot} />
                        {tag.name}
                      </ChipButton>
                    );
                  })}
                </span>
              ) : canEdit ? (
                <ChipButton dashed label={`Gắn nhãn cho ${project.code}`} onClick={() => onEditTags(project.id)}>
                  <TagIcon size={13} aria-hidden /> Gắn nhãn
                </ChipButton>
              ) : (
                <span className={styles.muted}>—</span>
              )}
            </td>
            <td className={styles.inlineCell}>
              <ChipSelect
                label={`Khách hàng của ${project.code}`}
                title={customer?.name ?? 'Chưa gắn khách hàng'}
                value={project.customerId ?? ''}
                emptyLabel="Chọn khách hàng"
                options={customerOptions}
                lead={<Building2 size={13} aria-hidden />}
                maxWidth={150}
                disabled={!canEdit}
                onChange={(value) =>
                  onPatch(project.id, { customerId: value || null }, 'Không đổi được khách hàng.')
                }
              />
            </td>
            <td className={styles.inlineCell}>
              <ChipSelect
                label={`Trạng thái của ${project.code}`}
                value={project.status}
                options={statusChoices}
                dot
                disabled={!canEditStatus}
                onChange={(status) =>
                  onPatch(project.id, { status: status as ProjectStatus }, 'Không đổi được trạng thái dự án.')
                }
              />
            </td>
            <td>
              <ProgressCell
                label={`Tiến độ của ${project.code}`}
                value={project.progressPercent}
                manual={Boolean(project.progressManual)}
                auto={project.autoProgressPercent}
                disabled={!canEdit}
                onCommit={(next) =>
                  onPatch(project.id, { manualProgressPercent: next }, 'Không lưu được tiến độ.')
                }
              />
            </td>
            <td>
              <div className={styles.rowActions}>
                {project.archivedAt ? (
                  <Confirm
                    title="Bạn có chắc chắn muốn mở lưu trữ dự án này?"
                    description={'Dự án về lại danh sách đang làm và chỉnh sửa được. Dự án đang "Hoàn thành" về "Đang chạy" hoặc giữ nguyên trạng thái, theo Cấu hình chung.'}
                    okText="Mở lưu trữ"
                    onConfirm={() => onUnarchive(project.id)}
                  >
                    <button type="button" className={styles.textButton}>
                      <ArchiveRestore size={13} aria-hidden /> Mở lưu trữ
                    </button>
                  </Confirm>
                ) : closable ? (
                  <Confirm
                    title="Bạn có chắc chắn muốn đóng hồ sơ dự án này?"
                    description="Dự án vào Lưu trữ, trạng thái giữ nguyên. Đóng được cả khi còn công việc chưa xong; mở lại bằng Mở lưu trữ."
                    okText="Đóng hồ sơ"
                    okType="warning"
                    onConfirm={() => onClose(project.id)}
                  >
                    <button type="button" className={styles.textButton}>
                      <Archive size={13} aria-hidden /> Đóng hồ sơ
                    </button>
                  </Confirm>
                ) : null}
              </div>
            </td>
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
