'use client';

import type { BrandPalette, IconDocument } from '@enterprise-platform/shared-brand-icon';
import { cn } from '@/lib/utils';
import { IconSvg } from '../icon-svg';

const PREVIEW_COUNT = 12;

/** Icon dùng để xem thử: ưu tiên icon đã phát hành, đủ số lượng thì dừng. */
export function pickPreviewDocs(docs: readonly IconDocument[], count = PREVIEW_COUNT): IconDocument[] {
  const published = docs.filter((doc) => doc.status === 'published');
  const rest = docs.filter((doc) => doc.status !== 'published');
  return [...published, ...rest].slice(0, count);
}

/**
 * Xem trước icon mẫu theo bảng màu đang chỉnh, trên nền sáng và nền tối: đổi màu ở trên là thấy ngay ở đây.
 * Nền tối là mặt làm việc mô phỏng, nên giữ khung.
 */
export function PalettePreview({ palette, docs }: { palette: BrandPalette; docs: readonly IconDocument[] }) {
  const sample = pickPreviewDocs(docs);
  if (sample.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="palette-preview">
      {(['light', 'dark'] as const).map((tone) => (
        <ul
          aria-label={tone === 'light' ? 'Xem trước trên nền sáng' : 'Xem trước trên nền tối'}
          className={cn(
            'flex flex-wrap content-start gap-3 rounded-md border p-3',
            tone === 'light' ? 'border-slate-200 bg-white text-slate-800' : 'border-slate-800 bg-slate-900 text-slate-100',
          )}
          key={tone}
        >
          {sample.map((doc) => (
            <li key={doc.id} title={doc.name}>
              <IconSvg className="size-8" doc={doc} palette={palette} title={doc.name} />
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
