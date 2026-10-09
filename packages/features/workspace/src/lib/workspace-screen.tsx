'use client';

import {
  ModuleShell,
  useHashView,
  type ModuleNavItem,
  type ModuleSidebarSection,
} from '@enterprise-platform/feature-module-shell';
import type { ProjectSummary } from '@enterprise-platform/contracts-workspace';
import { BarChart3, FileText, FolderKanban, FolderPlus, ListChecks, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listProjects,
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
import { ProjectsView } from './components/projects-view';
import styles from './workspace.module.scss';

/**
 * Bốn khu vực của module.
 *
 * `projects` gộp ba màn cũ Dự án, Công việc và Lịch biểu: cột trái là cây dự
 * án, cột phải là các tab đổi theo node đang chọn.
 */
type Tab = 'my-work' | 'projects' | 'documents' | 'reports';

/**
 * Mục điều hướng. "Dự án" không có dòng riêng: các dự án nằm thẳng ở mục Dự
 * án bên dưới, và dòng "Tất cả dự án" mở danh mục đầy đủ (trang `projects`).
 */
const NAV: readonly ModuleNavItem<Tab>[] = [
  { id: 'my-work', label: 'Công việc của tôi', group: 'Công việc', icon: <ListChecks size={16} /> },
  { id: 'documents', label: 'Tài liệu', group: 'Công việc', icon: <FileText size={16} /> },
  { id: 'reports', label: 'Báo cáo', group: 'Công việc', icon: <BarChart3 size={16} /> },
  { id: 'projects', label: 'Dự án', group: 'Công việc', icon: <FolderKanban size={16} />, hidden: true },
];

/** Số dự án hiện sẵn ở mục Dự án trên thanh bên; còn lại vào "Tất cả dự án". */
const SIDEBAR_PROJECTS = 5;

const VIEWS = NAV.map((item) => item.id);

const TITLES: Record<Tab, { title: string; subtitle: string }> = {
  'my-work': {
    title: 'Công việc của tôi',
    subtitle: 'Việc được giao, lịch hôm nay và những nơi có người nhắc tên bạn.',
  },
  projects: {
    title: 'Dự án',
    subtitle: 'Cây dự án nhiều cấp, công việc, tiến độ và lịch biểu của từng hạng mục.',
  },
  documents: {
    title: 'Tài liệu',
    subtitle: 'Kho tài liệu theo dự án và theo đơn vị, có phiên bản và khoá chỉnh sửa.',
  },
  reports: {
    title: 'Báo cáo',
    subtitle: 'Số liệu của bạn và của các dự án bạn tham gia.',
  },
};

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
    url.hash = `projects/${target}`;
    window.history.pushState(null, '', url);
    // pushState không phát `hashchange`, nên báo cho useHashView tự đọc lại.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, []);

  /**
   * Mở dự án từ trang Dự án, hay về bảng Tất cả dự án khi `projectId` rỗng —
   * bỏ `?project=` thì trang Dự án không còn dự án nào đang mở.
   */
  const openProject = useCallback(
    (projectId: string | undefined) => {
      if (projectId) {
        openInProject(projectId, `project/${projectId}`);
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('project');
      url.hash = 'projects';
      window.history.pushState(null, '', url);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
    [openInProject],
  );
  const [error, setError] = useState<string>();
  const [quickOpen, setQuickOpen] = useState(false);
  /** Mục Dự án trên thanh bên: vài dự án đầu và tổng số. */
  const [sidebarProjects, setSidebarProjects] = useState<readonly ProjectSummary[]>([]);
  const [projectTotal, setProjectTotal] = useState(0);
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
  /** Chỗ dưới dòng dự án đang mở, nơi trang Dự án vẽ cây công việc. */
  const [treeSlot, setTreeSlot] = useState<HTMLDivElement | null>(null);
  /** Bấm lại dự án đang mở: trang Dự án về node dự án. */
  const [focusProjectRequest, setFocusProjectRequest] = useState(0);
  /** Việc quá hạn và đến hạn hôm nay: con số cạnh "Công việc của tôi". */
  const [attention, setAttention] = useState(0);
  /** Bộ đếm lượt bấm "+" ở mục Dự án; trang Dự án mở hộp tạo dự án khi nó tăng. */
  const [createProjectRequest, setCreateProjectRequest] = useState(0);
  const clearCreateProjectRequest = useCallback(() => setCreateProjectRequest(0), []);
  /** Ô lọc dự án trên thanh bên, và từ khoá đã gửi lên server sau một nhịp gõ. */
  const [projectSearch, setProjectSearch] = useState('');
  const [projectTerm, setProjectTerm] = useState('');
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

  useEffect(() => {
    const timer = setTimeout(() => setProjectTerm(projectSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [projectSearch]);

  const reloadSidebarProjects = useCallback(() => {
    listProjects({ pageSize: SIDEBAR_PROJECTS, search: projectTerm || undefined })
      .then((page) => {
        setSidebarProjects(page.items);
        setProjectTotal(page.total);
      })
      .catch(() => undefined);
  }, [projectTerm]);

  useEffect(() => {
    reloadSidebarProjects();
  }, [reloadSidebarProjects]);

  // Mở một dự án chưa có trên thanh bên (thường là vừa tạo) thì nạp lại một
  // lần cho đúng tổng số — trừ khi đang lọc: khi đó dự án đang mở không khớp
  // từ khoá là chuyện bình thường. Chỉ chạy khi đổi dự án: nạp lại mà dự án
  // vẫn nằm ngoài vài dự án đầu thì không được nạp tiếp thành vòng lặp.
  const sidebarProjectsRef = useRef(sidebarProjects);
  sidebarProjectsRef.current = sidebarProjects;
  useEffect(() => {
    if (
      !projectTerm &&
      openProjectId &&
      !sidebarProjectsRef.current.some((project) => project.id === openProjectId)
    ) {
      reloadSidebarProjects();
    }
  }, [openProjectId, reloadSidebarProjects, projectTerm]);

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
   * ngoài số đó (hay không khớp từ khoá) — cây công việc của nó cần một dòng
   * để bung ra bên dưới.
   */
  const sidebarItems = useMemo(() => {
    const open =
      view === 'projects' && openProjectInfo?.id === openProjectId ? openProjectInfo : undefined;
    if (!open || sidebarProjects.some((project) => project.id === open.id)) {
      return sidebarProjects;
    }
    return [open, ...sidebarProjects];
  }, [sidebarProjects, openProjectInfo, openProjectId, view]);

  const sidebarSections = useMemo<readonly ModuleSidebarSection[]>(
    () => [
      {
        id: 'projects',
        title: 'Dự án',
        count: projectTerm ? undefined : projectTotal,
        search: {
          value: projectSearch,
          placeholder: 'Tìm dự án, công việc',
          onChange: setProjectSearch,
        },
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
            label: project.name,
            title: `${project.code} · ${project.name}`,
            leading: <ProjectAvatar id={project.id} name={project.name} />,
            trailing: `${project.progressPercent}%`,
            active,
            onSelect: () =>
              active
                ? setFocusProjectRequest((count) => count + 1)
                : openInProject(project.id, `project/${project.id}`),
            // Cây công việc của dự án đang mở bung ngay dưới dòng của nó.
            children: active ? <div ref={setTreeSlot} /> : undefined,
          };
        }),
        emptyText: projectTerm ? 'Không có dự án nào khớp từ khoá.' : 'Chưa có dự án nào.',
        footer: {
          label: projectTerm
            ? `Xem cả ${projectTotal} kết quả`
            : `Tất cả dự án (${projectTotal})`,
          onClick: () => openProject(undefined),
        },
      },
    ],
    [
      sidebarItems,
      projectTotal,
      projectSearch,
      projectTerm,
      view,
      openProjectId,
      navigate,
      openInProject,
      openProject,
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
      onViewChange={navigate}
      homeHref={homePath}
      collapsible
      collapsed={railCollapsed}
      onCollapsedChange={setRailCollapsed}
      onQuickSearch={openQuickSearch}
      sidebarSections={sidebarSections}
      actions={
        view === 'documents' && canSeeDocuments && !provisioning ? (
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
        <MyWorkView onOpen={openInProject} />
      ) : view === 'projects' && !provisioning ? (
        <ProjectsView
          canDelete={canDelete}
          notificationTarget={sub}
          onOpenProjectChange={onOpenProjectChange}
          onOpenProject={openProject}
          treeSlot={treeSlot}
          treeFallback={railCollapsed}
          focusProjectRequest={focusProjectRequest}
          createProjectRequest={createProjectRequest}
          onCreateProjectHandled={clearCreateProjectRequest}
          projectSearch={projectSearch}
        />
      ) : view === 'reports' && !provisioning ? (
        <ReportsView />
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
