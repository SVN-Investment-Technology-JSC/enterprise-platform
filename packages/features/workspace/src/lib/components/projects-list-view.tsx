'use client';

import {
  PROJECT_STATUSES,
  type CreateProjectRequest,
  type CustomerSummary,
  type ProjectRole,
  type ProjectStatus,
  type ProjectSummary,
  type ProjectTypeOption,
  type Tag,
  type UpdateProjectRequest,
} from '@enterprise-platform/contracts-workspace';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { ChevronDown, ChevronRight, FolderInput, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { mergeNewProjectMembers } from '../project-tree.model';
import * as api from '../workspace-api';
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONE } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';
import { ProjectForm } from './project-form';
import { ContextMenu } from './project-tree';
import { TagPicker } from './tag-picker';
import { tagColor, useTags } from './use-tags';

const messageOf = (cause: unknown, fallback: string): string =>
  (cause as { message?: string })?.message ?? fallback;

/** Tên nhóm cho dự án chưa gắn nhóm. */
const UNCLASSIFIED = 'Chưa phân loại';

/** Huy hiệu trạng thái dự án, cùng kiểu với các huy hiệu khác trong module. */
function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const tone = PROJECT_STATUS_TONE[status];
  return (
    <span className={styles.pill} style={{ background: tone.bg, color: tone.fg }}>
      {PROJECT_STATUS_LABELS[status]}
    </span>
  );
}

/** Dự án đã đóng hoặc huỷ thì không còn đóng hồ sơ được nữa. */
const CLOSED_PROJECT_STATUSES: readonly ProjectStatus[] = ['completed', 'cancelled'];

export interface ProjectsListViewProps {
  /** Mở trang chi tiết của một dự án (đặt `?project=` rồi hiện ProjectsView). */
  readonly onOpenProject: (projectId: string) => void;
  /** Tăng lên mỗi lần bấm "+" ở mục Dự án trên thanh bên: mở hộp tạo dự án. */
  readonly createProjectRequest?: number;
  /** Đã mở hộp tạo dự án theo yêu cầu trên; trang cha đặt bộ đếm về 0. */
  readonly onCreateProjectHandled?: () => void;
  /** Đã tạo, đổi nhóm hay đóng hồ sơ dự án: trang cha nạp lại thanh bên. */
  readonly onProjectsChanged?: () => void;
}

/**
 * Trang danh sách "Dự án".
 *
 * Bố cục theo trang "Công việc của tôi": dòng tóm tắt kèm nút thao tác, thanh
 * lọc (trạng thái, nhóm, nhãn, khách hàng), rồi MỘT bảng gom theo nhóm
 * dự án — nhóm thu gọn được, cuộn dọc độc lập. Chọn nhiều dòng để chuyển nhóm;
 * chuột phải trên một dòng (hay trên các dòng đang chọn) để chuyển nhóm, gắn
 * nhãn; đóng hồ sơ từng dự án qua Popconfirm. Mở một dự án thì trang cha chuyển sang
 * ProjectsView chi tiết.
 */
export function ProjectsListView({
  onOpenProject,
  createProjectRequest = 0,
  onCreateProjectHandled,
  onProjectsChanged,
}: ProjectsListViewProps) {
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [types, setTypes] = useState<readonly ProjectTypeOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();

  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const hasFilter = Boolean(statusFilter || typeFilter || tagFilter || customerFilter);
  const tags = useTags();

  /** Nhóm dự án đang thu gọn. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = (type: string) =>
    setCollapsed((current) => {
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
      const [items, customerList, typeList] = await Promise.all([
        api.listAllProjects(),
        api.listCustomers(),
        api.listProjectTypes(),
      ]);
      setProjects(items);
      setCustomers(customerList);
      setTypes(typeList.items);
      setError(undefined);
    } catch (cause) {
      setError(messageOf(cause, 'Không tải được danh sách dự án.'));
    } finally {
      setLoaded(true);
    }
  }, []);

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

  /** Tên khách hàng theo id, để cột Khách hàng khỏi gọi thêm API từng dòng. */
  const customerName = useMemo(() => {
    const byId = new Map(customers.map((customer) => [customer.id, customer.name]));
    return (id?: string) => (id ? (byId.get(id) ?? '—') : '—');
  }, [customers]);

  const visible = useMemo(
    () =>
      projects.filter((project) => {
        if (statusFilter && project.status !== statusFilter) return false;
        if (typeFilter && (project.projectType ?? '') !== typeFilter) return false;
        if (tagFilter && !(project.tagIds ?? []).includes(tagFilter)) return false;
        if (customerFilter && (project.customerId ?? '') !== customerFilter) return false;
        return true;
      }),
    [projects, statusFilter, typeFilter, tagFilter, customerFilter],
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
    return [...byType.entries()].sort(([a], [b]) => {
      // "Chưa phân loại" xuống cuối; còn lại xếp theo chữ cái tiếng Việt.
      if (a === UNCLASSIFIED) return 1;
      if (b === UNCLASSIFIED) return -1;
      return a.localeCompare(b, 'vi');
    });
  }, [visible]);

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

  const closeProject = useCallback(
    async (projectId: string) => {
      try {
        await api.updateProject(projectId, { status: 'completed' });
        setError(undefined);
        await reload();
        onProjectsChanged?.();
      } catch (cause) {
        // Server chặn khi dự án còn công việc chưa đóng: nói rõ cho người dùng.
        setError(messageOf(cause, 'Không đóng được hồ sơ dự án.'));
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

  const statusOptions = PROJECT_STATUSES.map((status) => ({
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

  return (
    <div className={styles.listPage}>
      <div className={styles.summaryLine}>
        <span>
          <b>{loaded ? visible.length : '—'}</b> dự án
        </span>
        <span>
          Đang chạy <b>{loaded ? activeCount : '—'}</b>
        </span>
        <span>
          Hoàn thành <b className={styles.textSuccess}>{loaded ? completedCount : '—'}</b>
        </span>
        <span className={styles.summarySpacer} />
        {!loaded ? <span className={styles.muted}>Đang tải…</span> : null}
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
      </div>

      <div className={styles.filterBar} role="group" aria-label="Bộ lọc dự án">
        <div className={`${styles.filterField} ${styles.filterFieldWide}`}>
          <span className={styles.filterLabel}>Trạng thái</span>
          <Choice
            label="Trạng thái"
            value={statusFilter}
            emptyOption="Mọi trạng thái"
            options={statusOptions}
            onChange={setStatusFilter}
          />
        </div>
        <div className={`${styles.filterField} ${styles.filterFieldWide}`}>
          <span className={styles.filterLabel}>Nhóm dự án</span>
          <Choice
            label="Nhóm dự án"
            value={typeFilter}
            emptyOption="Mọi nhóm dự án"
            options={typeOptions}
            onChange={setTypeFilter}
          />
        </div>
        <div className={`${styles.filterField} ${styles.filterFieldWide}`}>
          <span className={styles.filterLabel}>Nhãn</span>
          <Choice
            label="Nhãn"
            value={tagFilter}
            emptyOption="Mọi nhãn"
            options={tagOptions}
            onChange={setTagFilter}
          />
        </div>
        <div className={`${styles.filterField} ${styles.filterFieldWide}`}>
          <span className={styles.filterLabel}>Khách hàng</span>
          <Choice
            label="Khách hàng"
            value={customerFilter}
            emptyOption="Mọi khách hàng"
            options={customerOptions}
            onChange={setCustomerFilter}
          />
        </div>
        {hasFilter ? (
          <button
            type="button"
            className={styles.buttonSmall}
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

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
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
                collapsed={collapsed.has(type)}
                onToggleGroup={() => toggleGroup(type)}
                selected={selected}
                customerName={customerName}
                tagOf={tags.find}
                onToggle={toggleOne}
                onMenu={openMenu}
                onOpen={onOpenProject}
                onClose={closeProject}
              />
            ))}
          </tbody>
        </table>
        {loaded && visible.length === 0 ? (
          <p className={styles.emptyRow}>
            {projects.length === 0 ? 'Chưa có dự án nào.' : 'Không có dự án nào khớp bộ lọc.'}
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
  customerName,
  tagOf,
  onToggle,
  onMenu,
  onOpen,
  onClose,
}: {
  type: string;
  rows: readonly ProjectSummary[];
  collapsed: boolean;
  onToggleGroup: () => void;
  selected: ReadonlySet<string>;
  customerName: (id?: string) => string;
  tagOf: (tagId: string) => Tag | undefined;
  onToggle: (id: string) => void;
  onMenu: (id: string, at: { x: number; y: number }) => void;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const activeCount = rows.filter((project) => project.status === 'active').length;
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
          <span className={styles.countPill}>{rows.length}</span>
          {activeCount > 0 ? <span className={styles.muted}> · {activeCount} đang chạy</span> : null}
        </th>
      </tr>
      {collapsed ? null : rows.map((project) => {
        const closable = !CLOSED_PROJECT_STATUSES.includes(project.status);
        const checked = selected.has(project.id);
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
            <td className={styles.cellSub}>{project.projectType ?? UNCLASSIFIED}</td>
            <td>
              {project.tagIds?.length ? (
                <span className={styles.wbsTags}>
                  {project.tagIds.map((tagId) => {
                    const tag = tagOf(tagId);
                    return tag ? (
                      <span key={tagId} className={styles.wbsTag} style={{ color: tagColor(tag) }}>
                        {tag.name}
                      </span>
                    ) : null;
                  })}
                </span>
              ) : (
                <span className={styles.muted}>—</span>
              )}
            </td>
            <td className={styles.cellSub}>{customerName(project.customerId)}</td>
            <td>
              <ProjectStatusBadge status={project.status} />
            </td>
            <td className={styles.numeric}>{project.progressPercent}%</td>
            <td>
              <div className={styles.rowActions}>
                {closable ? (
                  <Popconfirm
                    title="Đóng hồ sơ dự án?"
                    description="Dự án chuyển sang Hoàn thành. Chỉ đóng được khi mọi công việc đã hoàn thành hoặc đã huỷ."
                    okText="Đóng hồ sơ"
                    cancelText="Đóng"
                    okType="warning"
                    placement="bottom-end"
                    onConfirm={() => onClose(project.id)}
                  >
                    <button type="button" className={styles.buttonSmall}>
                      Đóng hồ sơ
                    </button>
                  </Popconfirm>
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
