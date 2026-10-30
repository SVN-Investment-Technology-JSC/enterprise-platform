'use client';

import { MAX_PROJECT_TEMPLATE_TASKS, MAX_PROJECT_TEMPLATE_TITLE_LENGTH } from '@enterprise-platform/contracts-workspace';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useRef } from 'react';
import styles from '../workspace.module.scss';

export interface TaskTitleListEditorProps {
  readonly titles: readonly string[];
  readonly onChange: (next: string[]) => void;
  /** Tiền tố nhãn truy cập để nhiều danh sách trên cùng trang không trùng nhau. */
  readonly idPrefix: string;
  readonly disabled?: boolean;
  readonly max?: number;
  readonly emptyText?: string;
}

/**
 * Danh sách tên công việc theo thứ tự: thêm, bớt, đổi chỗ. Dùng cho mẫu công việc tạo sẵn ở Cấu hình chung và cho danh
 * sách của từng dự án lúc tạo. Dòng trống được giữ trong lúc gõ; nơi dùng bỏ chúng khi lưu hoặc gửi.
 */
export function TaskTitleListEditor({
  titles,
  onChange,
  idPrefix,
  disabled = false,
  max = MAX_PROJECT_TEMPLATE_TASKS,
  emptyText = 'Chưa có công việc nào.',
}: TaskTitleListEditorProps) {
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const atLimit = titles.length >= max;

  const setTitle = (index: number, title: string) => onChange(titles.map((entry, at) => (at === index ? title : entry)));
  const remove = (index: number) => onChange(titles.filter((_, at) => at !== index));
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= titles.length) return;
    const next = [...titles];
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    onChange(next);
  };
  /** Thêm một dòng ngay sau dòng `after` (hoặc cuối danh sách) rồi đưa con trỏ vào đó. */
  const add = (after = titles.length - 1) => {
    if (atLimit || disabled) return;
    const next = [...titles];
    next.splice(after + 1, 0, '');
    onChange(next);
    requestAnimationFrame(() => inputs.current.get(after + 1)?.focus());
  };

  return (
    <div className={styles.taskTitleList}>
      {titles.length === 0 ? <p className={styles.fieldHint}>{emptyText}</p> : null}
      {titles.length > 0 ? (
        <ol className={styles.taskTitleRows}>
          {titles.map((title, index) => (
            <li key={index} className={styles.taskTitleRow}>
              <span className={styles.completionIndex} aria-hidden="true">
                {index + 1}
              </span>
              <input
                ref={(element) => {
                  if (element) inputs.current.set(index, element);
                  else inputs.current.delete(index);
                }}
                aria-label={`${idPrefix} ${index + 1}`}
                placeholder="Tên công việc"
                maxLength={MAX_PROJECT_TEMPLATE_TITLE_LENGTH}
                value={title}
                disabled={disabled}
                onChange={(event) => setTitle(index, event.target.value)}
                onKeyDown={(event) => {
                  // Enter thêm dòng kế tiếp thay vì gửi cả form.
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  if (title.trim()) add(index);
                }}
              />
              {disabled ? null : (
                <span className={styles.taskTitleTools}>
                  <button
                    type="button"
                    aria-label={`Đưa ${idPrefix} ${index + 1} lên`}
                    title="Đưa lên"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Đưa ${idPrefix} ${index + 1} xuống`}
                    title="Đưa xuống"
                    disabled={index === titles.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className={styles.taskTitleRemove}
                    aria-label={`Bỏ ${idPrefix} ${index + 1}`}
                    title="Bỏ công việc này"
                    onClick={() => remove(index)}
                  >
                    <X size={15} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      {disabled ? null : (
        <button type="button" className={styles.completionAdd} disabled={atLimit} onClick={() => add()}>
          <Plus size={14} /> Thêm công việc
          {atLimit ? ` (tối đa ${max})` : ''}
        </button>
      )}
    </div>
  );
}
