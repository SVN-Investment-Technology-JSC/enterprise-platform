'use client';

import {
  Eye,
  History,
  MessageSquareOff,
  MessageSquare,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import extras from '../post-extras.module.scss';
import type { PostMenuAction, PostMenuItem } from '../post-visibility.model';
import { SocialLink } from '../social-navigation';
import styles from '../social.module.scss';

const ICONS: Readonly<Record<PostMenuAction, LucideIcon>> = {
  detail: Eye,
  pin: Pin,
  history: History,
  toggleComments: MessageSquareOff,
  edit: Pencil,
  delete: Trash2,
};

export interface PostMenuProps {
  readonly postId: string;
  readonly items: readonly PostMenuItem[];
  /** Bài đang ghim, bật tính năng bình luận: đổi biểu tượng của mục tương ứng. */
  readonly pinned: boolean;
  readonly commentsDisabled: boolean;
  readonly onAction: (action: Exclude<PostMenuAction, 'detail'>) => void;
}

/** Menu "⋮" của thẻ bài. "Xem chi tiết" là liên kết thật tới trang bài; các mục còn lại gọi `onAction`. */
export function PostMenu({
  postId,
  items,
  pinned,
  commentsDisabled,
  onAction,
}: PostMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className={styles.menuWrap} ref={wrap}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Tuỳ chọn bài viết"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreVertical size={16} />
      </button>
      {open ? (
        <div className={extras.postMenu} role="menu">
          {items.map((item) => {
            let Icon = ICONS[item.action];
            if (item.action === 'pin' && pinned) Icon = PinOff;
            if (item.action === 'toggleComments' && commentsDisabled) {
              Icon = MessageSquare;
            }
            const className = item.danger
              ? `${extras.postMenuItem} ${extras.postMenuDanger}`
              : extras.postMenuItem;
            if (item.action === 'detail') {
              return (
                <SocialLink
                  key={item.action}
                  to={{ name: 'post', postId }}
                  role="menuitem"
                  className={className}
                  onClick={() => setOpen(false)}
                >
                  <Icon size={15} />
                  {item.label}
                </SocialLink>
              );
            }
            const action = item.action;
            return (
              <button
                key={item.action}
                type="button"
                role="menuitem"
                className={className}
                onClick={() => {
                  setOpen(false);
                  onAction(action);
                }}
              >
                <Icon size={15} />
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
