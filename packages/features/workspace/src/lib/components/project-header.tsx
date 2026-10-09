'use client';

import type { ProjectMember, ProjectSummary } from '@enterprise-platform/contracts-workspace';
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONE, formatDate } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { ProjectAvatar } from './project-avatar';
import { useDirectory } from './use-directory';

/** Số ô người hiện trước khi gom phần còn lại thành "+N". */
const AVATARS_SHOWN = 3;

export interface ProjectHeaderProps {
  readonly project: ProjectSummary;
  readonly members: readonly ProjectMember[];
  readonly documentCount: number;
  readonly onOpenMembers: () => void;
}

/**
 * Khối đầu của trang dự án: tên, trạng thái, một dòng số liệu, tiến độ và
 * những người trong dự án. Hàng tab nằm ngay dưới.
 */
export function ProjectHeader({
  project,
  members,
  documentCount,
  onOpenMembers,
}: ProjectHeaderProps) {
  const directory = useDirectory();
  const tone = PROJECT_STATUS_TONE[project.status];
  const facts = [
    project.code,
    `${project.totalItems} công việc`,
    `${members.length} thành viên`,
    `${documentCount} tài liệu`,
  ];
  if (project.startDate || project.endDate) {
    facts.push(`${formatDate(project.startDate) || '—'} → ${formatDate(project.endDate) || '—'}`);
  }

  return (
    <section className={styles.projectHeader}>
      <ProjectAvatar id={project.id} name={project.name} size="large" />
      <div className={styles.projectHeaderMain}>
        <h2 className={styles.projectHeaderTitle}>
          {project.name}
          <span
            className={`${styles.pill} ${styles.pillCaps}`}
            style={{ background: tone.bg, color: tone.fg }}
          >
            {PROJECT_STATUS_LABELS[project.status]}
          </span>
        </h2>
        <p className={styles.projectHeaderFacts}>{facts.join(' · ')}</p>
      </div>

      <span className={styles.progressCell}>
        <span
          className={`${styles.progressTrack} ${styles.progressTrackWide}`}
          aria-label={`Tiến độ ${project.progressPercent}%`}
        >
          <span className={styles.progressFill} style={{ width: `${project.progressPercent}%` }} />
        </span>
        <b>{project.progressPercent}%</b>
      </span>

      <span className={styles.avatarStack} aria-label={`${members.length} thành viên`}>
        {members.slice(0, AVATARS_SHOWN).map((member) => (
          <span key={member.id} className={styles.avatar} title={directory.nameOf(member.userId)}>
            {initials(directory.nameOf(member.userId))}
          </span>
        ))}
        {members.length > AVATARS_SHOWN ? (
          <span className={`${styles.avatar} ${styles.avatarMore}`}>
            +{members.length - AVATARS_SHOWN}
          </span>
        ) : null}
      </span>
      <button type="button" className={styles.buttonGhost} onClick={onOpenMembers}>
        Thành viên
      </button>
    </section>
  );
}

/** "Nguyễn Văn An" → "NA": chữ đầu của họ và của tên gọi. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return `${first}${last}`.toUpperCase();
}
