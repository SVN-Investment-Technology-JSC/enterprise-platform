'use client';

import {
  ModuleSettingsView,
  ModuleShell,
  useHashView,
  type ModuleNavItem,
  type ModuleSidebarSection,
} from '@enterprise-platform/feature-module-shell';
import type { ProjectSummary, ProjectTypeOption } from '@enterprise-platform/contracts-workspace';
import {
  BarChart3,
  ClipboardList,
  FileText,
  FolderKanban,
  FolderPlus,
  ListChecks,
  Plus,
  Settings,
  Upload,
  Users,
} from 'lucide-react';
import { initialReturnTarget, type ReturnTarget } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getProject,
  listAllProjects,
  listProjects,
  listProjectTypes,
  loadMyWork,
  loadCurrentUserId,
  loadTenantHomePath,
  loadWorkspaceStatus,
  type WorkspaceStatus,
} from './workspace-api';
import { DocumentPanel } from './components/document-panel';
import { ProjectAvatar } from './components/project-avatar';
import { MyWorkView } from './components/my-work-view';
import { QuickSearch, type QuickSearchTarget } from './components/quick-search';
import { ReportsView } from './components/reports-view';
import { ProjectGroupSettings } from './components/project-group-settings';
import { ProjectRoleSettings } from './components/project-role-settings';
import { TagSettings } from './components/tag-settings';
import { ProjectsView } from './components/projects-view';
import { ProjectsListView } from './components/projects-list-view';
import { CustomersView } from './components/customers-view';
import { StandaloneTasksView } from './components/standalone-tasks-view';
import styles from './workspace.module.scss';

/**
 * Bốn khu vực của module.
 *
 * `projects` gộp ba màn cũ Dự án, Công việc và Lịch biểu: cột trái là cây dự
 * án, cột phải là các tab đổi theo node đang chọn.
 */
type Tab = 'my-work' | 'tasks' | 'projects' | 'customers' | 'documents' | 'reports' | 'settings';

/**
 * Mục điều hướng. Trang Dự án (dải hai tab Dự án / Khách hàng ở đầu trang) không có dòng riêng: bấm
 * tiêu đề "DỰ ÁN" của mục dự án bên dưới để mở; các dự án nằm thẳng trong mục đó.
 */
const NAV: readonly ModuleNavItem<Tab>[] = [
  { id: 'my-work', label: 'Công việc của tôi', group: 'Công việc', icon: <ListChecks size={16} /> },
  {
    id: 'tasks',
    label: 'Công việc khác',
    group: 'Công việc',
    icon: <ClipboardList size={16} />,
  },
  // Mở bằng tiêu đề "DỰ ÁN" của mục dự án trên thanh bên, không có dòng riêng.
  {
    id: 'projects',
    label: 'Dự án',
    group: 'Công việc',
    icon: <FolderKanban size={16} />,
    hidden: true,
  },
  { id: 'documents', label: 'Tài liệu', group: 'Công việc', icon: <FileText size={16} /> },
  { id: 'reports', label: 'Báo cáo', group: 'Công việc', icon: <BarChart3 size={16} /> },
  // Tab "Khách hàng" nằm trong khu vực Dự án (dải hai tab ở đầu trang), không có dòng riêng.
  { id: 'customers', label: 'Khách hàng', group: 'Công việc', icon: <Users size={16} />, hidden: true },
  // Mở bằng nút bánh răng ở góc dưới thanh bên, không có dòng riêng.
  { id: 'settings', label: 'Cài đặt', icon: <Settings size={16} />, hidden: true },
];

/** Số dự án hiện sẵn ở mục Dự án trên thanh bên; còn lại vào "Tất cả dự án". */
const SIDEBAR_PROJECTS = 5;

const VIEWS = NAV.map((item) => item.id);

const TITLES: Record<Tab, { title: string; subtitle: string }> = {
  'my-work': {
    title: 'Công việc của tôi',
    subtitle: 'Việc được giao, lịch hôm nay và những nơi có người nhắc tên bạn.',
  },
  tasks: {
    title: 'Công việc khác',
    subtitle: 'Giao việc cho bất kỳ ai trong tổ chức mà không cần dự án; người giao duyệt kết quả.',
  },
  projects: {
    title: 'Dự án',
    subtitle: 'Cây dự án nhiều cấp, công việc, tiến độ và lịch biểu của từng hạng mục.',
  },
  customers: {
    title: 'Khách hàng',
    subtitle: 'Khách hàng chủ quản của dự án và các hợp đồng của từng khách hàng.',
  },
  documents: {
    title: 'Tài liệu',
    subtitle: 'Kho tài liệu theo dự án và theo đơn vị, có phiên bản và khoá chỉnh sửa.',
  },
  reports: {
    title: 'Báo cáo',
    subtitle: 'Số liệu của bạn và của các dự án bạn tham gia.',
  },
  settings: {
    title: 'Cài đặt',
    subtitle: 'Cấu hình dùng chung cho mọi dự án của Không gian làm việc.',
  },
};

/** Các mục trong trang Cài đặt; `#settings/<id>` mở thẳng mục đó. */
const SETTINGS_SECTIONS = [
  {
    id: 'project-roles',
    label: 'Vai trò trong dự án',
    description:
      'Định nghĩa vai trò gán cho thành viên dự án và những gì mỗi vai được làm. Mặc định có Chủ nhiệm, Quản lý, Thành viên và Người xem.',
    render: () => <ProjectRoleSettings />,
  },
  {
    id: 'project-groups',
    label: 'Nhóm dự án',
    description:
      'Danh mục nhóm để phân loại dự án, chọn khi tạo dự án và lọc trên trang Dự án. Đổi tên nhóm thì các dự án của nhóm đổi theo.',
    render: () => <ProjectGroupSettings />,
  },
  {
    id: 'tags',
    label: 'Nhãn',
    description:
      'Danh mục nhãn dùng chung cho công việc và dự án. Sửa tên, màu, ẩn nhãn không còn dùng hoặc xoá hẳn.',
    render: () => <TagSettings />,
  },
] as const;

export function WorkspaceScreen() {
  const { view, sub, navigate } = useHashView<Tab>({ views: VIEWS, fallback: 'my-work' });
  const [homePath, setHomePath] = useState<string>('/');
  const [me, setMe] = useState('');
  /** Thanh bên thu về dải biểu tượng, nhường bề ngang cho bảng và cây. */
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [status, setStatus] = useState<WorkspaceStatus>();

  /**
   * Mở một chỗ trong trang Dự án từ trang khác: `?project=` chọn dự án, đoạn
   * hash sau `projects/` chọn node (`work-item/{id}`, `calendar/{id}`,
   * `chat/{loại}/{id}`) — cùng dạng với link trong thông báo.
   */
  const openInProject = useCallback((projectId: string, target: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('project', projectId);
    // Việc và tab của dự án trước không áp sang dự án vừa chọn.
    url.searchParams.delete('item');
    url.searchParams.delete('tab');
    url.hash = `projects/${target}`;
    window.history.pushState(null, '', url);
    // pushState không phát `hashchange`, nên báo cho useHashView tự đọc lại.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, []);

  /** Mở một dự án ở tab Công việc. */
  const openProject = useCallback(
    (projectId: string) => openInProject(projectId, `project/${projectId}`),
    [openInProject],
  );
  /** Về trang Dự án: bỏ dự án đang chọn trên đường dẫn để hiện danh sách toàn bộ. */
  const openProjectList = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('project');
    url.searchParams.delete('item');
    url.searchParams.delete('tab');
    url.hash = 'projects';
    window.history.pushState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, []);
  /**
   * Điều hướng từ thanh bên và breadcrumb: vào khu "Dự án" luôn mở trang danh
   * sách (không giữ lại dự án đang xem); các trang khác giữ nguyên.
   */
  const handleViewChange = useCallback(
    (next: Tab) => {
      if (next === 'projects') openProjectList();
      else navigate(next);
    },
    [navigate, openProjectList],
  );
  const [error, setError] = useState<string>();
  const [quickOpen, setQuickOpen] = useState(false);
  /** Mở từ trang khác kèm `?returnTo=`: hiện dải "xử lý xong sẽ tự quay về". Đọc sau khi gắn để khớp SSR. */
  const [returnTarget, setReturnTarget] = useState<ReturnTarget>();
  useEffect(() => setReturnTarget(initialReturnTarget()), []);
  /** Mục Dự án trên thanh bên: vài dự án đầu (hay tất cả, khi đã bung) và tổng số. */
  const [sidebarProjects, setSidebarProjects] = useState<readonly ProjectSummary[]>([]);
  const [projectTotal, setProjectTotal] = useState(0);
  /** "Tất cả dự án" bung toàn bộ dự án ngay trên thanh bên; bấm lần nữa thì thu lại. */
  const [showAllProjects, setShowAllProjects] = useState(false);
  /** Lọc thanh bên theo nhóm dự án; rỗng là mọi nhóm. */
  const [projectType, setProjectType] = useState('');
  const [projectTypes, setProjectTypes] = useState<readonly ProjectTypeOption[]>([]);
  /** Dự án đang mở ở trang Dự án, để tô sáng dòng tương ứng. */
  const [openProjectId, setOpenProjectId] = useState<string>();
  /** Bản tóm tắt của dự án đang mở, để giữ dòng của nó dù không nằm trong vài dự án đầu. */
  const [openProjectInfo, setOpenProjectInfo] = useState<ProjectSummary>();
  const onOpenProjectChange = useCallback(
    (projectId: string | undefined, project?: ProjectSummary) => {
      setOpenProjectId(projectId);
      if (project) setOpenProjectInfo(project);
    },
    [],
  );
  /**
   * Dự án ghi trên đường dẫn (`?project=`). Đây là nguồn quyết định hiện trang
   * danh sách dự án hay trang chi tiết: chưa có thì hiện danh sách, có thì mở
   * chi tiết (và tab Khách hàng thu về đúng khách hàng của dự án đó).
   */
  const [urlProjectId, setUrlProjectId] = useState<string>();
  useEffect(() => {
    const sync = () => {
      const next = new URLSearchParams(window.location.search).get('project') ?? undefined;
      setUrlProjectId(next);
      // Không còn dự án trên đường dẫn (về trang danh sách): bỏ tô sáng dòng dự
      // án trên thanh bên. Khi mở một dự án, ProjectsView sẽ gán lại kèm tóm tắt.
      if (!next) setOpenProjectId(undefined);
    };
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  // Vào thẳng tab Khách hàng của một dự án (link sâu) mà trang Dự án chưa từng
  // mở: nạp bản tóm tắt dự án để biết khách hàng chủ quản mà thu hẹp theo.
  useEffect(() => {
    if (view !== 'customers' || !urlProjectId) return;
    if (openProjectInfo?.id === urlProjectId) return;
    let active = true;
    void getProject(urlProjectId)
      .then((project) => {
        if (active) setOpenProjectInfo(project);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [view, urlProjectId, openProjectInfo]);
  /** Chỗ nút ở đầu trang, nơi trang Dự án đặt nút Trao đổi và "⋯" của dự án. */
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  /** Bấm lại dự án đang mở: trang Dự án đóng hộp chi tiết, về tab Công việc. */
  const [focusProjectRequest, setFocusProjectRequest] = useState(0);
  /** Việc quá hạn và đến hạn hôm nay: con số cạnh "Công việc của tôi". */
  const [attention, setAttention] = useState(0);
  /** Bộ đếm lượt bấm "+" ở mục Dự án; trang Dự án mở hộp tạo dự án khi nó tăng. */
  const [createProjectRequest, setCreateProjectRequest] = useState(0);
  const clearCreateProjectRequest = useCallback(() => setCreateProjectRequest(0), []);
  /** Bộ đếm lượt bấm "Giao việc" ở đầu trang Công việc ngoài dự án. */
  const [createTaskRequest, setCreateTaskRequest] = useState(0);
  const clearCreateTaskRequest = useCallback(() => setCreateTaskRequest(0), []);
  const openTask = useCallback(
    (taskId: string | undefined) => navigate('tasks', taskId),
    [navigate],
  );
  /** Lệnh từ hai nút đầu trang Tài liệu, chuyển xuống DocumentPanel. */
  const [documentRequest, setDocumentRequest] = useState<{
    kind: 'upload' | 'folder';
    nonce: number;
  }>();
  const openQuickSearch = useCallback(() => setQuickOpen(true), []);

  const onQuickPick = (target: QuickSearchTarget) => {
    if (target.kind === 'page') navigate(target.view);
    else if (target.kind === 'project') openInProject(target.projectId, `project/${target.projectId}`);
    else if (target.kind === 'work-item') {
      openInProject(target.projectId, `work-item/${target.workItemId}`);
    } else navigate('documents', target.documentId);
  };

  const reloadSidebarProjects = useCallback(() => {
    // Dự án lưu trữ (đã hoàn thành) không hiện trên thanh bên; xem ở tab Lưu trữ của trang Dự án.
    const filter = { projectType: projectType || undefined, archived: 'exclude' as const };
    const load = showAllProjects
      ? listAllProjects(20, filter).then((items) => ({ items, total: items.length }))
      : listProjects({ ...filter, pageSize: SIDEBAR_PROJECTS });
    load
      .then((page) => {
        setSidebarProjects(page.items);
        // Khi đã bung, tổng là số vừa nạp; giữ tổng cũ nếu nó lớn hơn (danh
        // sách gom qua từng trang có trần số trang).
        setProjectTotal((current) =>
          showAllProjects ? Math.max(current, page.total) : page.total,
        );
      })
      .catch(() => undefined);
    listProjectTypes()
      .then((result) => setProjectTypes(result.items))
      .catch(() => undefined);
  }, [showAllProjects, projectType]);

  useEffect(() => {
    reloadSidebarProjects();
  }, [reloadSidebarProjects]);

  // Mở một dự án chưa có trên thanh bên (thường là vừa tạo) thì nạp lại một
  // lần cho đúng tổng số. Chỉ chạy khi đổi dự án: nạp lại mà dự án vẫn nằm
  // ngoài vài dự án đầu thì không được nạp tiếp thành vòng lặp.
  const sidebarProjectsRef = useRef(sidebarProjects);
  sidebarProjectsRef.current = sidebarProjects;
  useEffect(() => {
    if (
      openProjectId &&
      !sidebarProjectsRef.current.some((project) => project.id === openProjectId)
    ) {
      reloadSidebarProjects();
    }
  }, [openProjectId, reloadSidebarProjects]);

  // Con số nhắc việc: đổi khi rời trang Công việc của tôi hay quay lại.
  useEffect(() => {
    loadMyWork()
      .then((summary) => setAttention(summary.counters.overdueItems + summary.counters.dueToday))
      .catch(() => undefined);
  }, [view]);

  useEffect(() => {
    void loadTenantHomePath().then(setHomePath);
    void loadCurrentUserId().then(setMe);
  }, []);

  useEffect(() => {
    loadWorkspaceStatus()
      .then((next) => {
        setStatus(next);
        setError(undefined);
      })
      .catch((cause: { message?: string }) => {
        setError(cause?.message ?? 'Không tải được trạng thái Workspace.');
      });
  }, []);

  // Tenant đã bật module nhưng migration chưa tạo bảng: nói rõ đang chờ, thay
  // vì để người dùng nhìn màn hình trống và tưởng hỏng.
  const provisioning = status && !status.tablesReady;

  /**
   * Trang Tài liệu tổng quan gom kho của **mọi** dự án, nên chỉ mở cho người
   * được Platform cấp quyền ghi tài liệu — văn thư, quản trị. Thành viên dự án
   * vẫn có đủ tài liệu của mình ngay trong trang Dự án.
   *
   * Server chưa trả `capabilities` (bản cũ) thì giữ nguyên như trước, không tự
   * dưng giấu mất một trang đang dùng được.
   */
  const canSeeDocuments =
    !status?.capabilities ||
    status.capabilities.canWriteDocuments ||
    status.capabilities.isTenantAdmin;
  const nav = NAV.filter((item) => item.id !== 'documents' || canSeeDocuments).map((item) =>
    item.id === 'my-work' && attention > 0 ? { ...item, badge: attention } : item,
  );

  /**
   * Dòng dự án trên thanh bên: vài dự án đầu, cộng dự án đang mở nếu nó nằm
   * ngoài số đó, để luôn thấy mình đang ở dự án nào.
   */
  const sidebarItems = useMemo(() => {
    // Đang lọc theo loại thì không chen dự án đang mở thuộc loại khác vào.
    const open =
      view === 'projects' &&
      openProjectInfo?.id === openProjectId &&
      (!projectType || openProjectInfo?.projectType === projectType)
        ? openProjectInfo
        : undefined;
    const list =
      !open || sidebarProjects.some((project) => project.id === open.id)
        ? sidebarProjects
        : [open, ...sidebarProjects];
    // Bung "Tất cả dự án" mà chưa lọc loại: xếp theo loại để thanh bên chia nhóm.
    if (!showAllProjects || projectType || projectTypes.length === 0) return list;
    return [...list].sort((a, b) =>
      (a.projectType ?? '\uffff').localeCompare(b.projectType ?? '\uffff', 'vi'),
    );
  }, [
    sidebarProjects,
    openProjectInfo,
    openProjectId,
    view,
    showAllProjects,
    projectType,
    projectTypes,
  ]);
  const groupByType = showAllProjects && !projectType && projectTypes.length > 0;

  const sidebarSections = useMemo<readonly ModuleSidebarSection[]>(
    () => [
      {
        id: 'projects',
        title: 'Dự án',
        count: projectTotal,
        onTitleClick: openProjectList,
        titleActive: view === 'projects' && !openProjectId,
        action: {
          label: 'Tạo dự án',
          onClick: () => {
            navigate('projects');
            setCreateProjectRequest((count) => count + 1);
          },
        },
        items: sidebarItems.map((project) => {
          const active = view === 'projects' && openProjectId === project.id;
          return {
            id: project.id,
            // Hiển thị theo "[Mã dự án]-[Tên dự án]" để nhận ra dự án nhanh
            // ngay trên thanh bên, không chỉ bằng tên.
            label: `${project.code}-${project.name}`,
            title: `${project.code} · ${project.name}`,
            leading: <ProjectAvatar id={project.id} name={project.name} />,
            trailing: `${project.progressPercent}%`,
            group: groupByType ? (project.projectType ?? 'Chưa phân loại') : undefined,
            active,
            onSelect: () =>
              active ? setFocusProjectRequest((count) => count + 1) : openProject(project.id),
          };
        }),
        filter:
          projectTypes.length > 0
            ? {
                label: 'Lọc dự án theo nhóm',
                value: projectType,
                options: [
                  { value: '', label: 'Mọi nhóm dự án' },
                  ...projectTypes.map((type) => ({
                    value: type.name,
                    label: `${type.name} (${type.count})`,
                  })),
                ],
                onChange: setProjectType,
              }
            : undefined,
        emptyText: projectType ? 'Không có dự án thuộc nhóm này.' : 'Chưa có dự án nào.',
        // Chỉ có dòng này khi còn dự án chưa hiện, hay khi đang bung để thu lại.
        footer:
          showAllProjects || projectTotal > SIDEBAR_PROJECTS
            ? {
                label: showAllProjects ? 'Thu gọn' : `Tất cả dự án (${projectTotal})`,
                onClick: () => setShowAllProjects((current) => !current),
              }
            : undefined,
      },
    ],
    [
      sidebarItems,
      projectTotal,
      showAllProjects,
      view,
      openProjectId,
      navigate,
      openProject,
      projectType,
      projectTypes,
      groupByType,
      openProjectList,
    ],
  );

  /** Xoá tài liệu và thư mục: mặc định chỉ quản trị tenant. */
  const canDelete = Boolean(status?.capabilities?.canDeleteDocuments);

  return (
    <ModuleShell<Tab>
      moduleKey="workspace"
      appearance="light"
      // Tiêu đề của **module**, không phải của trang đang mở: breadcrumb là
      // "SVN DTS / Không gian làm việc / Dự án". Trước đây chỗ này truyền tên
      // trang nên nó lặp lại chính nó — "SVN DTS / Dự án / Dự án".
      title="Không gian làm việc"
      nav={nav}
      view={view}
      onViewChange={handleViewChange}
      homeHref={homePath}
      collapsible
      collapsed={railCollapsed}
      onCollapsedChange={setRailCollapsed}
      onQuickSearch={openQuickSearch}
      sidebarSections={sidebarSections}
      settings={{
        label: 'Cài đặt',
        active: view === 'settings',
        onOpen: () => navigate('settings'),
      }}
      crumbs={
        view === 'projects' && urlProjectId && openProjectInfo ? [openProjectInfo.name] : undefined
      }
      actions={
        view === 'projects' && !provisioning ? (
          // Trang Dự án tự đặt nút Trao đổi và "⋯" của dự án đang mở vào đây.
          <div ref={setActionsSlot} className={styles.headActions} />
        ) : view === 'tasks' && !provisioning ? (
          <button
            type="button"
            className={styles.buttonPrimary}
            onClick={() => setCreateTaskRequest((count) => count + 1)}
          >
            <Plus size={15} /> Giao việc
          </button>
        ) : view === 'documents' && canSeeDocuments && !provisioning ? (
          <>
            <button
              type="button"
              className={styles.buttonGhost}
              onClick={() => setDocumentRequest({ kind: 'folder', nonce: Date.now() })}
            >
              <FolderPlus size={15} /> Thư mục
            </button>
            <button
              type="button"
              className={styles.buttonPrimary}
              onClick={() => setDocumentRequest({ kind: 'upload', nonce: Date.now() })}
            >
              <Upload size={15} /> Tải lên
            </button>
          </>
        ) : undefined
      }
      banner={
        <>
          {returnTarget ? (
            <p className={styles.notice} role="status">
              Mở từ Trang chủ · xử lý xong việc này sẽ tự quay về.{' '}
              <a href={returnTarget.path}>Về Trang chủ</a>
            </p>
          ) : null}
          {error ? (
            <p role="alert" className={styles.alert}>
              {error}
            </p>
          ) : null}
          {provisioning ? (
            <p className={styles.notice}>
              Dữ liệu Workspace của tenant đang được khởi tạo. Màn hình sẽ có dữ liệu sau khi
              quá trình này hoàn tất.
            </p>
          ) : null}
        </>
      }
    >
      {view === 'my-work' && !provisioning ? (
        <MyWorkView onOpen={openInProject} onOpenTask={openTask} />
      ) : view === 'tasks' && !provisioning ? (
        <StandaloneTasksView
          focusTaskId={sub}
          onFocusChange={openTask}
          createRequest={createTaskRequest}
          onCreateHandled={clearCreateTaskRequest}
        />
      ) : (view === 'projects' || view === 'customers') && !provisioning ? (
        <>
          {/* Dải hai tab ở đầu khu vực Dự án: "Dự án" giữ nguyên hành vi cũ,
              "Khách hàng" mở danh mục khách hàng và hợp đồng. */}
          <div className={styles.tabBar} role="tablist" aria-label="Khu vực Dự án">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'projects'}
              className={view === 'projects' ? styles.tabActive : styles.tab}
              onClick={() => navigate('projects')}
            >
              Dự án
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'customers'}
              className={view === 'customers' ? styles.tabActive : styles.tab}
              onClick={() => navigate('customers')}
            >
              Khách hàng
            </button>
          </div>
          {view === 'projects' ? (
            urlProjectId ? (
              <ProjectsView
                canDelete={canDelete}
                notificationTarget={sub}
                onOpenProjectChange={onOpenProjectChange}
                onOpenProject={openProject}
                actionsSlot={actionsSlot}
                onProjectsChanged={reloadSidebarProjects}
                focusProjectRequest={focusProjectRequest}
                createProjectRequest={createProjectRequest}
                onCreateProjectHandled={clearCreateProjectRequest}
              />
            ) : (
              <ProjectsListView
                onOpenProject={openProject}
                createProjectRequest={createProjectRequest}
                onCreateProjectHandled={clearCreateProjectRequest}
                onProjectsChanged={reloadSidebarProjects}
              />
            )
          ) : urlProjectId ? (
            // Trong một dự án: tab Khách hàng chỉ hiện khách hàng của dự án đó.
            <CustomersView
              scoped
              scopeCustomerId={openProjectInfo?.customerId}
              scopeProjectId={urlProjectId}
              onOpenProject={openProject}
            />
          ) : (
            <CustomersView onOpenProject={openProject} />
          )}
        </>
      ) : view === 'reports' && !provisioning ? (
        <ReportsView onOpenItem={(projectId, workItemId) => openInProject(projectId, `work-item/${workItemId}`)} />
      ) : view === 'settings' && !provisioning ? (
        <ModuleSettingsView
          sections={SETTINGS_SECTIONS}
          activeSectionId={sub}
          onSectionChange={(id) => navigate('settings', id)}
        />
      ) : view === 'documents' && !provisioning ? (
        // Trang Tài liệu không giới hạn theo dự án: hiện cả kho cấp đơn vị
        // lẫn tài liệu của những dự án người dùng tham gia.
        <DocumentPanel
          canWrite
          canDelete={canDelete}
          currentUserId={me}
          focusDocumentId={sub}
          request={documentRequest}
        />
      ) : (
        <section className={styles.placeholder}>
          <h2>{TITLES[view].title}</h2>
          <p>{TITLES[view].subtitle}</p>
        </section>
      )}
      <QuickSearch open={quickOpen} onClose={() => setQuickOpen(false)} onPick={onQuickPick} />
    </ModuleShell>
  );
}
