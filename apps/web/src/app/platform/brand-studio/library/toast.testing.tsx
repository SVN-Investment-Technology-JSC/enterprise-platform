import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

/** Giả `toast` của `@/components/ui/sonner` cho test: ghi lại từng lần gọi để kiểm nội dung thông báo. */
interface Call {
  readonly kind: 'success' | 'warning' | 'error' | 'info';
  readonly title: string;
  readonly description?: ReactNode;
}

const calls: Call[] = [];

function record(kind: Call['kind']) {
  return (input: string | { title: string; description?: ReactNode }) => {
    calls.push(typeof input === 'string' ? { kind, title: input } : { kind, title: input.title, description: input.description });
    return calls.length;
  };
}

export const toastMock = {
  toast: {
    success: record('success'),
    warning: record('warning'),
    error: record('error'),
    info: record('info'),
  },
};

export function resetToasts(): void {
  calls.length = 0;
}

export function toastCalls(): readonly Call[] {
  return calls;
}

/** Nội dung (tiêu đề và mô tả) của thông báo gần nhất, dạng chữ thuần. */
export function lastToastText(): string {
  const last = calls[calls.length - 1];
  if (!last) return '';
  const description = last.description ? renderToStaticMarkup(<>{last.description}</>).replace(/<[^>]+>/g, ' ') : '';
  return `${last.title} ${description}`.trim();
}

export function lastToastKind(): Call['kind'] | undefined {
  return calls[calls.length - 1]?.kind;
}
