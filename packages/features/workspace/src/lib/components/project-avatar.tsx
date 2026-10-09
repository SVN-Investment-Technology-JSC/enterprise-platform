'use client';

import styles from '../workspace.module.scss';

/** Màu ô viết tắt của dự án, cố định theo id để lần nào mở cũng cùng màu. */
const PROJECT_COLORS = ['#2563eb', '#db2777', '#b45309', '#047857', '#7c3aed', '#0e7490'];

export function projectColor(projectId: string): string {
  let hash = 0;
  for (const char of projectId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

/** Hai chữ đầu của tên dự án: "SCADA nhà máy Tân Ân" → "SÂ". */
export function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : words[0].charAt(1);
  return `${first}${last}`.toUpperCase();
}

/**
 * Ô tròn viết tắt màu của một dự án: cỡ nhỏ trên thanh bên, cỡ lớn ở khối đầu
 * của trang dự án.
 */
export function ProjectAvatar({
  id,
  name,
  size = 'small',
}: {
  id: string;
  name: string;
  size?: 'small' | 'large';
}) {
  return (
    <span
      className={size === 'large' ? styles.projectAvatarLarge : styles.projectAvatar}
      style={{ background: projectColor(id) }}
      aria-hidden
    >
      {projectInitials(name)}
    </span>
  );
}
