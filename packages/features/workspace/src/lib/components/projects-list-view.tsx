'use client';

import {
  PROJECT_STATUSES,
  type CreateProjectRequest,
  type CustomerSummary,
  type ProjectRole,
  type ProjectStatus,
  type ProjectSummary,
  type ProjectTypeOption,
  type UpdateProjectRequest,
} from '@enterprise-platform/contracts-workspace';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { FolderInput, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { mergeNewProjectMembers } from '../project-tree.model';
import * as api from '../workspace-api';
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONE } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Dialog, Field } from './dialog';
import { ProjectForm } from './project-form';

const messageOf = (cause: unknown, fallback: string): string =>
  (cause as { message?: string })?.message ?? fallback;

/** Nhãn nhóm cho dự án chưa gắn loại. */
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
 * Bảng gom nhóm theo loại dự án, cuộn dọc độc lập; lọc theo trạng thái, loại và
 * khách hàng; chọn nhiều dòng để chuyển nhóm; đóng hồ sơ từng dự án qua
 * Popconfirm. Mở một dự án thì trang cha chuyển sang ProjectsView chi tiết.
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
  const [customerFilter, setCustomerFilter] = useState('');

  /** Ids đang được chọn để chuyển nhóm. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
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
        if (customerFilter && (project.customerId ?? '') !== customerFilter) return false;
        return true;
      }),
    [projects, statusFilter, typeFilter, customerFilter],
  );

  /** Gom dòng theo loại dự án; dự án chưa có loại rơi vào "Chưa phân loại". */
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
      const ids = [...selected];
      // Ném lỗi ra để hộp thoại tự hiện; dừng ở dòng đầu hỏng.
      for (const id of ids) {
        await api.updateProject(id, { projectType: next } as UpdateProjectRequest);
      }
      setSelected(new Set());
      setMoveOpen(false);
      await reload();
      onProjectsChanged?.();
    },
    [selected, reload, onProjectsChanged],
  );

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
  const customerOptions = customers.map((customer) => ({
    value: customer.id,
    label: `${customer.code} · ${customer.name}`,
  }));

  return (
    <div className={styles.listPage}>
      <div className={styles.listToolbar}>
        <button type="button" className={styles.buttonPrimary} onClick={() => setCreateOpen(true)}>
          <Plus size={15} /> Tạo dự án
        </button>
        <button
          type="button"
          className={styles.buttonGhost}
          disabled={selected.size === 0}
          onClick={() => setMoveOpen(true)}
        >
          <FolderInput size={15} /> Chuyển nhóm
          {selected.size > 0 ? <span className={styles.countBadge}>{selected.size}</span> : null}
        </button>
        <span className={styles.listToolbarSpacer} />
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Tải lại"
          title="Tải lại"
          onClick={() => void reload()}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      <div className={styles.filterBar}>
        <SearchableSelect
          options={statusOptions}
          value={statusFilter}
          placeholder="Mọi trạng thái"
          searchInDropdown
          clearable
          onChange={setStatusFilter}
        />
        <SearchableSelect
          options={typeOptions}
          value={typeFilter}
          placeholder="Mọi loại dự án"
          searchInDropdown
          clearable
          onChange={setTypeFilter}
        />
        <SearchableSelect
          options={customerOptions}
          value={customerFilter}
          placeholder="Mọi khách hàng"
          clearable
          onChange={setCustomerFilter}
        />
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
              <th>Loại dự án</th>
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
                selected={selected}
                customerName={customerName}
                onToggle={toggleOne}
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

      <MoveGroupDialog
        open={moveOpen}
        count={selected.size}
        types={types}
        onClose={() => setMoveOpen(false)}
        onMove={moveGroup}
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

/** Một nhóm theo loại: dòng tiêu đề nhóm rồi các dòng dự án của nhóm. */
function GroupRows({
  type,
  rows,
  selected,
  customerName,
  onToggle,
  onOpen,
  onClose,
}: {
  type: string;
  rows: readonly ProjectSummary[];
  selected: ReadonlySet<string>;
  customerName: (id?: string) => string;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <>
      <tr className={styles.groupRow}>
        <th colSpan={7}>
          {type}
          <span className={styles.countPill}>{rows.length}</span>
        </th>
      </tr>
      {rows.map((project) => {
        const closable = !CLOSED_PROJECT_STATUSES.includes(project.status);
        const checked = selected.has(project.id);
        return (
          <tr key={project.id} className={checked ? styles.rowSelected : undefined}>
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
            <td>{project.projectType ?? '—'}</td>
            <td>{customerName(project.customerId)}</td>
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
                    <button type="button" className={styles.buttonGhost}>
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

/** Hộp thoại chọn hoặc gõ loại đích cho các dự án đang chọn. */
function MoveGroupDialog({
  open,
  count,
  types,
  onClose,
  onMove,
}: {
  open: boolean;
  count: number;
  types: readonly ProjectTypeOption[];
  onClose: () => void;
  onMove: (projectType: string) => Promise<void>;
}) {
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget('');
    setError(undefined);
    setSubmitting(false);
  }, [open]);

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
      subtitle={`Đổi loại cho ${count} dự án đang chọn.`}
      submitLabel="Chuyển nhóm"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Loại dự án đích" hint="Chọn loại đã có hoặc gõ loại mới. Bỏ trống để gỡ loại.">
        <input
          value={target}
          maxLength={80}
          list="workspace-move-project-types"
          placeholder="Ví dụ: Dịch vụ thí nghiệm"
          onChange={(event) => setTarget(event.target.value)}
        />
        <datalist id="workspace-move-project-types">
          {types.map((type) => (
            <option key={type.name} value={type.name} />
          ))}
        </datalist>
      </Field>
    </Dialog>
  );
}
