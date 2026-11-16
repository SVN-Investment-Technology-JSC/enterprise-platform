'use client';

import type { Project } from '@enterprise-platform/contracts-workspace';
import { progressMethodLabel } from '../project-progress-methods';
import styles from '../workspace.module.scss';
import { Tooltip } from './tooltip';

/**
 * Thanh tiến độ dự án (chỉ xem, tiến độ tự tính): lớp đậm là tiến độ thực tế, lớp sáng phía sau là tiến độ dự kiến
 * theo thời gian. Chậm hơn dự kiến thì số chuyển màu cảnh báo. Rê chuột để xem đủ số và cách tính.
 */
export function ProjectProgressBar({
  project,
  wide,
}: {
  project: Pick<Project, 'code' | 'progressPercent' | 'expectedProgressPercent' | 'progressMethod'>;
  wide?: boolean;
}) {
  const actual = project.progressPercent;
  const expected = project.expectedProgressPercent;
  const late = expected !== undefined && actual < expected;
  const lines = [
    `Tiến độ thực tế: ${actual}%`,
    expected === undefined ? 'Tiến độ dự kiến: chưa đủ ngày bắt đầu và kết thúc' : `Tiến độ dự kiến theo thời gian: ${expected}%`,
    `Cách tính: ${progressMethodLabel(project.progressMethod)}`,
  ];
  return (
    <Tooltip
      content={lines.map((line) => (
        <span key={line} style={{ display: 'block' }}>
          {line}
        </span>
      ))}
    >
      <span className={styles.progressCell} aria-label={`Tiến độ của ${project.code}: ${actual}%`}>
        <span className={`${styles.progressTrack} ${styles.progressTrackLayered} ${wide ? styles.progressTrackWide : ''}`}>
          {expected === undefined ? null : <span className={styles.progressExpected} style={{ width: `${expected}%` }} />}
          <span className={actual >= 100 ? styles.progressFillDone : styles.progressFill} style={{ width: `${actual}%` }} />
        </span>
        <b className={late ? styles.progressLate : undefined}>{actual}%</b>
      </span>
    </Tooltip>
  );
}
