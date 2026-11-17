'use client';

import {
  CHECKLIST_TITLE_MAX_LENGTH,
  MAX_CHECKLIST_ITEMS,
  type WorkItem,
  type WorkItemChecklistItem,
} from '@enterprise-platform/contracts-workspace';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { toast } from '@enterprise-platform/shared-ui';
import { Tooltip } from './tooltip';

const messageOf = (cause: unknown, fallback: string) => (cause as { message?: string })?.message || fallback;

/**
 * Đầu việc của công việc tính tiến độ theo đầu việc: tích để hoàn thành, thêm, xoá. Mỗi lần đổi, server tính lại tiến độ
 * (và trạng thái nếu đủ đầu việc) rồi `onChanged` để màn nạp lại công việc.
 */
export function ChecklistPanel({
  item,
  canEdit,
  onChanged,
}: {
  item: WorkItem;
  canEdit: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<readonly WorkItemChecklistItem[]>();
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    // Sang công việc khác: bỏ ngay danh sách và chữ đang gõ của việc trước, kẻo thao tác nhầm lên đầu việc của việc cũ.
    setItems(undefined);
    setTitle('');
    setFailed(false);
    api
      .listWorkItemChecklist(item.id)
      .then((result) => alive && setItems(result.items))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [item.id, item.updatedAt]);

  const closed = item.status === 'done' || item.status === 'cancelled';
  const editable = canEdit && !closed;

  /** Chạy một thao tác ghi: giữ nút khoá trong lúc chờ, báo lỗi bằng toast, và nạp lại màn sau khi lưu. */
  const run = async (
    operation: () => Promise<{ items: WorkItemChecklistItem[] }>,
    fallback: string,
  ): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await operation();
      setItems(result.items);
      await onChanged?.();
      return true;
    } catch (cause) {
      toast.error(messageOf(cause, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const text = title.trim();
    if (!text) return;
    // Chỉ xoá chữ đã gõ khi lưu được; lỗi thì giữ lại để người dùng thử lại.
    if (await run(() => api.addWorkItemChecklist(item.id, [text]), 'Không thêm được đầu việc.')) setTitle('');
  };

  const done = (items ?? []).filter((entry) => entry.done).length;

  return (
    <section className={styles.panel}>
      <h3>
        Đầu việc{items && items.length > 0 ? ` · ${done}/${items.length}` : ''}
      </h3>
      {failed ? (
        <p className={styles.muted}>Không tải được đầu việc lúc này.</p>
      ) : !items ? (
        <p className={styles.muted}>Đang tải…</p>
      ) : (
        <>
          {items.length === 0 ? (
            <p className={styles.muted}>
              Chưa có đầu việc nào.{editable ? ' Thêm đầu việc bên dưới; tiến độ tính theo số đầu việc đã tích.' : ''}
            </p>
          ) : (
            <ul className={styles.checklist}>
              {items.map((entry) => (
                <li key={entry.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={entry.done}
                      disabled={!editable || busy}
                      onChange={(event) =>
                        void run(
                          () => api.updateWorkItemChecklistItem(item.id, entry.id, { done: event.target.checked }),
                          'Không cập nhật được đầu việc.',
                        )
                      }
                    />
                    <span className={entry.done ? styles.checklistDone : undefined}>{entry.title}</span>
                  </label>
                  {editable ? (
                    <Tooltip content="Xoá đầu việc">
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`Xoá đầu việc ${entry.title}`}
                        disabled={busy}
                        onClick={() =>
                          void run(() => api.removeWorkItemChecklistItem(item.id, entry.id), 'Không xoá được đầu việc.')
                        }
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </Tooltip>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {editable && items.length < MAX_CHECKLIST_ITEMS ? (
            <div className={styles.checklistAdd}>
              <input
                value={title}
                maxLength={CHECKLIST_TITLE_MAX_LENGTH}
                placeholder="Tên đầu việc mới…"
                aria-label="Tên đầu việc mới"
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void add();
                }}
              />
              <button type="button" className={styles.buttonSmall} disabled={busy || !title.trim()} onClick={() => void add()}>
                Thêm
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
