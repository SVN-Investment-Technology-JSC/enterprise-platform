'use client';

import { forwardRef, type ComponentProps } from 'react';
import styles from '../workspace.module.scss';

/**
 * Ô nhập, vùng nhập và nhãn theo bộ khung của shadcn/ui (cao 36px, bo 6px, viền mảnh, vòng focus),
 * dựng bằng SCSS vì Workspace không chạy Tailwind. Ô chọn vẫn là `Choice` / `SearchableSelect`.
 */
function join(...names: Array<string | undefined>): string {
  return names.filter(Boolean).join(' ');
}

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} data-slot="input" className={join(styles.uiInput, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<'textarea'>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea ref={ref} data-slot="textarea" className={join(styles.uiTextarea, className)} {...props} />
  );
});

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label data-slot="label" className={join(styles.uiLabel, className)} {...props} />;
}
