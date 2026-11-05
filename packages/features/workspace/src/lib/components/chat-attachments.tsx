'use client';

import { Paperclip } from 'lucide-react';
import styles from '../workspace.module.scss';
import { Tooltip } from './tooltip';

/** Tên hiện khi tài liệu đính kèm không còn trong danh sách của dự án (đã xoá hoặc chưa nạp). */
export const UNKNOWN_ATTACHMENT_NAME = 'Tài liệu đính kèm';

/**
 * Các tệp đính kèm của một tin: mỗi tệp một nhãn nhỏ, xuống dòng khi nhiều. Không vẽ gì khi tin không có tệp.
 */
export function ChatAttachments({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null;
  return (
    <div className={styles.chatAttachmentList}>
      {names.map((name, index) => (
        <Tooltip key={`${index}:${name}`} content={name}>
          <p className={styles.chatAttachment}>
            <Paperclip size={12} aria-hidden /> <span>{name}</span>
          </p>
        </Tooltip>
      ))}
    </div>
  );
}
