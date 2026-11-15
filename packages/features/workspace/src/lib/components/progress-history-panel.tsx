'use client';

import type { StandaloneTaskProgressReport, WorkItem, WorkItemProgressReport } from '@enterprise-platform/contracts-workspace';
import { useEffect, useRef, useState } from 'react';
import * as api from '../workspace-api';
import { formatDate } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { useDirectory } from './use-directory';

/**
 * Lịch sử báo cáo tiến độ của một công việc: ngày, người báo, phần trăm và mô tả, mới nhất trước.
 * Nạp lại khi tiến độ hay trạng thái của việc đổi (vừa có báo cáo mới hoặc việc được mở lại).
 */
export function ProgressHistoryPanel({
  item,
  load = (id) => api.listWorkItemProgressReports(id),
}: {
  item: Pick<WorkItem, 'id' | 'progressPercent' | 'status' | 'updatedAt'>;
  /** Cách nạp lịch sử; mặc định là việc trong dự án, Công việc khác truyền hàm riêng. */
  load?: (id: string) => Promise<{ items: (WorkItemProgressReport | StandaloneTaskProgressReport)[] }>;
}) {
  const directory = useDirectory();
  const [reports, setReports] = useState<readonly (WorkItemProgressReport | StandaloneTaskProgressReport)[]>();
  const [failed, setFailed] = useState(false);
  // Hàm nạp có thể là hàm tạo mới mỗi lần vẽ: giữ bản mới nhất mà không chạy lại effect chỉ vì nó đổi.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    setFailed(false);
    loadRef.current(item.id)
      .then((result) => alive && setReports(result.items))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [item.id, item.progressPercent, item.status, item.updatedAt]);

  return (
    <section className={styles.panel}>
      <h3>Lịch sử tiến độ</h3>
      {failed ? (
        <p className={styles.muted}>Không tải được lịch sử tiến độ lúc này.</p>
      ) : !reports ? (
        <p className={styles.muted}>Đang tải…</p>
      ) : reports.length === 0 ? (
        <p className={styles.muted}>Chưa có báo cáo tiến độ nào. Bấm vào thanh tiến độ để báo cáo.</p>
      ) : (
        <ul className={styles.progressHistory}>
          {reports.map((report) => (
            <li key={report.id}>
              <div className={styles.progressHistoryHead}>
                <b>{report.percent}%</b>
                <span>
                  {formatDate(report.reportedOn)} · {directory.nameOf(report.reportedBy)}
                </span>
              </div>
              {report.description ? <p>{report.description}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
