'use client';

import {
  ModuleShell,
  useHashView,
  type ModuleNavItem,
} from '@enterprise-platform/feature-module-shell';
import { BarChart3, FileText, FolderKanban, ListChecks } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  loadCurrentUserId,
  loadTenantHomePath,
  loadWorkspaceStatus,
  type WorkspaceStatus,
} from './workspace-api';
import { DocumentPanel } from './components/document-panel';
import { MyWorkView } from './components/my-work-view';
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

const NAV: readonly ModuleNavItem<Tab>[] = [
  { id: 'my-work', label: 'Công việc của tôi', icon: <ListChecks size={16} /> },
  { id: 'projects', label: 'Dự án', group: 'Điều hành', icon: <FolderKanban size={16} /> },
  { id: 'documents', label: 'Tài liệu', group: 'Điều hành', icon: <FileText size={16} /> },
  { id: 'reports', label: 'Báo cáo', group: 'Quản trị', icon: <BarChart3 size={16} /> },
];

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
  const { view, navigate } = useHashView<Tab>({ views: VIEWS, fallback: 'my-work' });
  const [homePath, setHomePath] = useState<string>('/');
  const [me, setMe] = useState('');
  /**
   * Thu rail là cách nhường chỗ cho khung trao đổi: trang Dự án chỉ mở sẵn
   * khung chat khi rail đã thu, còn lại phải bấm nút Trao đổi.
   */
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [status, setStatus] = useState<WorkspaceStatus>();
  const [error, setError] = useState<string>();

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
  const nav = NAV.filter((item) => item.id !== 'documents' || canSeeDocuments);

  /** Xoá tài liệu và thư mục: mặc định chỉ quản trị tenant. */
  const canDelete = Boolean(status?.capabilities?.canDeleteDocuments);

  return (
    <ModuleShell<Tab>
      moduleKey="workspace"
      // Tiêu đề của **module**, không phải của trang đang mở: breadcrumb là
      // "SVN DTS / Không gian làm việc / Dự án". Trước đây chỗ này truyền tên
      // trang nên nó lặp lại chính nó — "SVN DTS / Dự án / Dự án".
      title="Không gian làm việc"
      subtitle={TITLES[view].subtitle}
      nav={nav}
      view={view}
      onViewChange={navigate}
      homeHref={homePath}
      collapsible
      collapsed={railCollapsed}
      onCollapsedChange={setRailCollapsed}
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
        <MyWorkView />
      ) : view === 'projects' && !provisioning ? (
        <ProjectsView railCollapsed={railCollapsed} canDelete={canDelete} />
      ) : view === 'reports' && !provisioning ? (
        <ReportsView />
      ) : view === 'documents' && !provisioning ? (
        // Trang Tài liệu không giới hạn theo dự án: hiện cả kho cấp đơn vị
        // lẫn tài liệu của những dự án người dùng tham gia.
        <DocumentPanel canWrite canDelete={canDelete} currentUserId={me} />
      ) : (
        <section className={styles.placeholder}>
          <h2>{TITLES[view].title}</h2>
          <p>{TITLES[view].subtitle}</p>
          <p className={styles.phase}>
            Khu vực này được xây dựng ở các giai đoạn sau. Xem tiến độ tại{' '}
            <code>plan_Workspace/task.md</code>.
          </p>
        </section>
      )}
    </ModuleShell>
  );
}
