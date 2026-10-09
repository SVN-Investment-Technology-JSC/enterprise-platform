'use client';

import type { ProjectSummary } from '@enterprise-platform/contracts-workspace';
import { Plus } from 'lucide-react';
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONE, formatDate } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { ProjectAvatar } from './project-avatar';

export interface ProjectListProps {
  readonly projects: readonly ProjectSummary[];
  readonly total: number;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  /** Đang lọc theo từ khoá ở ô tìm trên thanh bên. */
  readonly filtered: boolean;
  readonly onOpen: (projectId: string) => void;
  readonly onCreate: () => void;
  readonly onLoadMore: () => void;
}

/**
 * "Tất cả dự án": bảng đầy đủ trên vùng chính, hiện khi chưa mở dự án nào.
 *
 * Thanh bên chỉ có chỗ cho vài dự án đầu; bảng này là nơi xem hết, so tiến độ
 * và việc quá hạn giữa các dự án, rồi bấm vào một dự án để mở nó.
 */
export function ProjectList({
  projects,
  total,
  loading,
  loadingMore,
  filtered,
  onOpen,
  onCreate,
  onLoadMore,
}: ProjectListProps) {
  return (
    <div className={styles.tabBody}>
      <div className={styles.projectListHead}>
        <h2 className={styles.nodeTitle}>
          {filtered ? 'Dự án khớp từ khoá' : 'Tất cả dự án'}
          <span className={styles.countPill}>{total}</span>
        </h2>
        <button type="button" className={styles.buttonPrimary} onClick={onCreate}>
          <Plus size={14} /> Tạo dự án mới
        </button>
      </div>

      {projects.length === 0 ? (
        <div className={styles.emptyState}>
          <p>
            {loading
              ? 'Đang tải danh sách dự án…'
              : filtered
                ? 'Không có dự án nào khớp từ khoá.'
                : 'Chưa có dự án nào trong phạm vi của bạn.'}
          </p>
        </div>
      ) : (
        <div className={styles.tableCard}>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Dự án</th>
                  <th>Trạng thái</th>
                  <th>Tiến độ</th>
                  <th className={styles.numeric}>Công việc</th>
                  <th className={styles.numeric}>Quá hạn</th>
                  <th>Kết thúc</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const tone = PROJECT_STATUS_TONE[project.status];
                  return (
                    <tr key={project.id}>
                      <td>
                        <button
                          type="button"
                          className={styles.projectListName}
                          data-project={project.id}
                          onClick={() => onOpen(project.id)}
                        >
                          <ProjectAvatar id={project.id} name={project.name} />
                          <span className={styles.treeCode}>{project.code}</span>
                          <span className={styles.treeTitle}>{project.name}</span>
                        </button>
                      </td>
                      <td>
                        <span
                          className={styles.pill}
                          style={{ background: tone.bg, color: tone.fg }}
                        >
                          {PROJECT_STATUS_LABELS[project.status]}
                        </span>
                      </td>
                      <td>
                        <span className={styles.progressCell}>
                          <span
                            className={styles.progressTrack}
                            aria-label={`${project.progressPercent}%`}
                          >
                            <span
                              className={styles.progressFill}
                              style={{ width: `${project.progressPercent}%` }}
                            />
                          </span>
                          {project.progressPercent}%
                        </span>
                      </td>
                      <td className={styles.numeric}>
                        {project.closedItems}/{project.totalItems}
                      </td>
                      <td className={styles.numeric}>
                        {project.overdueItems > 0 ? (
                          <span className={styles.treeOverdue}>{project.overdueItems}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{formatDate(project.endDate) || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {projects.length < total ? (
        <div className={styles.projectListMore}>
          <span className={styles.muted}>
            Đang hiện {projects.length}/{total} dự án
          </span>
          <button
            type="button"
            className={styles.buttonSmall}
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? 'Đang tải…' : 'Tải thêm'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
