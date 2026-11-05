'use client';

import {
  PROJECT_STATUSES,
  type ProjectMember,
  type ProjectStatus,
  type ProjectSummary,
} from '@enterprise-platform/contracts-workspace';
import { CalendarRange, Check, ChevronDown, FileText, Hash, ListChecks, Tag, Users } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  /** Vai trò có quyền "Có thể cập nhật trạng thái dự án". */
  readonly canChangeStatus?: boolean;
  readonly onChangeStatus?: (status: ProjectStatus) => Promise<void>;
  /**
   * Công tắc "Dự án | Khách hàng" của khu vực Dự án, đặt ở góc phải dưới của thẻ để thẻ và công tắc là MỘT khối (khỏi một
   * hàng tiêu đề riêng phía trên chỉ để chứa công tắc).
   */
  readonly viewSwitch?: ReactNode;
}

/**
 * Trạng thái chọn được ngay ở đầu trang. "Đã huỷ" không có ở đây: huỷ dự án
 * đi qua hộp xác nhận riêng ("Huỷ dự án" trong menu dự án).
 */
const PICKABLE_STATUSES = PROJECT_STATUSES.filter((status) => status !== 'cancelled');

/**
 * Khối đầu của trang dự án, hai hàng, luôn cao như nhau ở mọi tab (nên hàng tab bên dưới đứng yên khi đổi tab):
 *  - Hàng trên: logo, tên, trạng thái | tiến độ, người trong dự án, nút Thành viên.
 *  - Hàng dưới: số liệu có biểu tượng (mã, nhóm, công việc, thành viên, tài liệu, thời gian) | công tắc Dự án / Khách hàng.
 */
export function ProjectHeader({
  project,
  members,
  documentCount,
  onOpenMembers,
  canChangeStatus = false,
  onChangeStatus,
  viewSwitch,
}: ProjectHeaderProps) {
  const directory = useDirectory();
  const tone = PROJECT_STATUS_TONE[project.status];
  const dates =
    project.startDate || project.endDate
      ? `${formatDate(project.startDate) || '—'} → ${formatDate(project.endDate) || '—'}`
      : undefined;
  const facts: { key: string; icon: ReactNode; label: string; title: string; strong?: boolean }[] = [
    { key: 'code', icon: <Hash size={13} aria-hidden />, label: project.code, title: 'Mã dự án', strong: true },
    ...(project.projectType
      ? [{ key: 'type', icon: <Tag size={13} aria-hidden />, label: project.projectType, title: 'Nhóm dự án' }]
      : []),
    {
      key: 'items',
      icon: <ListChecks size={13} aria-hidden />,
      label: `${project.totalItems} công việc`,
      title: 'Số công việc',
    },
    { key: 'members', icon: <Users size={13} aria-hidden />, label: `${members.length} thành viên`, title: 'Số thành viên' },
    { key: 'docs', icon: <FileText size={13} aria-hidden />, label: `${documentCount} tài liệu`, title: 'Số tài liệu' },
    ...(dates ? [{ key: 'dates', icon: <CalendarRange size={13} aria-hidden />, label: dates, title: 'Thời gian dự án' }] : []),
  ];

  return (
    <section className={styles.projectHeader}>
      <span className={styles.projectHeaderAvatar}>
        <ProjectAvatar id={project.id} name={project.name} size="large" />
      </span>

      <div className={styles.projectHeaderTitleRow}>
        <h2 className={styles.projectHeaderTitle} title={project.name}>
          {project.name}
        </h2>
        {canChangeStatus && onChangeStatus ? (
          <StatusPicker status={project.status} onChange={onChangeStatus} />
        ) : (
          <span className={`${styles.pill} ${styles.pillCaps}`} style={{ background: tone.bg, color: tone.fg }}>
            {PROJECT_STATUS_LABELS[project.status]}
          </span>
        )}
      </div>

      <div className={styles.projectHeaderAside}>
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
            <span className={`${styles.avatar} ${styles.avatarMore}`}>+{members.length - AVATARS_SHOWN}</span>
          ) : null}
        </span>
        <button type="button" className={styles.buttonGhost} onClick={onOpenMembers}>
          Thành viên
        </button>
      </div>

      <ul className={styles.projectFacts} aria-label="Thông tin dự án">
        {facts.map((fact) => (
          <li
            key={fact.key}
            className={fact.strong ? `${styles.projectFact} ${styles.projectFactStrong}` : styles.projectFact}
            title={fact.title}
          >
            {fact.icon}
            {fact.label}
          </li>
        ))}
      </ul>

      {viewSwitch ? <div className={styles.projectHeaderSwitch}>{viewSwitch}</div> : null}
    </section>
  );
}

/**
 * Huy hiệu trạng thái bấm được: mở danh sách trạng thái ngay dưới, chọn là
 * lưu luôn. Bấm ra ngoài hoặc Esc thì đóng.
 */
function StatusPicker({
  status,
  onChange,
}: {
  readonly status: ProjectStatus;
  readonly onChange: (status: ProjectStatus) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const tone = PROJECT_STATUS_TONE[status];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = async (next: ProjectStatus) => {
    setOpen(false);
    if (next === status) return;
    setSaving(true);
    try {
      await onChange(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <span ref={box} className={styles.statusPicker}>
      <button
        type="button"
        className={`${styles.pill} ${styles.pillCaps} ${styles.statusPickerButton}`}
        style={{ background: tone.bg, color: tone.fg }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Đổi trạng thái dự án"
        disabled={saving}
        onClick={() => setOpen((current) => !current)}
      >
        {PROJECT_STATUS_LABELS[status]}
        <ChevronDown size={12} aria-hidden />
      </button>
      {open ? (
        <ul className={styles.statusPickerMenu} role="listbox" aria-label="Trạng thái dự án">
          {PICKABLE_STATUSES.map((option) => {
            const optionTone = PROJECT_STATUS_TONE[option];
            return (
              <li key={option}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option === status}
                  className={styles.contextItem}
                  onClick={() => void pick(option)}
                >
                  <span
                    className={`${styles.pill} ${styles.pillCaps}`}
                    style={{ background: optionTone.bg, color: optionTone.fg }}
                  >
                    {PROJECT_STATUS_LABELS[option]}
                  </span>
                  {option === status ? <Check size={14} aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </span>
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
