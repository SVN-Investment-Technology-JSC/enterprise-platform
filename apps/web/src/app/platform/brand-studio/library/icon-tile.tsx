'use client';

import type { BrandPalette, IconDocument } from '@enterprise-platform/shared-brand-icon';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { IconSvg } from '../icon-svg';
import { IconActions, type IconActionHandlers } from './icon-actions';
import { SelectBox, StatusChip, categoryLabel } from './library-ui';
import { asRoute, editorPath } from './routes';

/**
 * Ô vuông của chế độ lưới: icon lớn, tên, trạng thái và danh mục. Bấm vào ô để mở trình thiết kế;
 * ô tick và thao tác nhanh nằm ngoài liên kết (không lồng nút trong thẻ a) và chỉ hiện khi rê chuột hoặc đang chọn.
 */
export function IconTile({
  doc,
  palette,
  selected,
  preset,
  onSelect,
  ...handlers
}: IconActionHandlers & {
  doc: IconDocument;
  palette: BrandPalette;
  selected: boolean;
  preset: boolean;
  onSelect: (checked: boolean) => void;
}) {
  return (
    <li
      className={cn(
        'group relative rounded-md border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all hover:-translate-y-px hover:shadow-md',
        selected ? 'border-blue-500 bg-blue-50/40 ring-1 ring-blue-500' : 'border-slate-200 hover:border-blue-300',
      )}
      data-testid="icon-tile"
    >
      <Link
        aria-label={`Mở ${doc.name}`}
        className="flex flex-col gap-2 rounded-md p-2 outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
        href={asRoute(editorPath(doc.id))}
      >
        <span className="grid aspect-square w-full place-items-center rounded bg-slate-50 text-slate-700">
          <IconSvg className="size-16" doc={doc} palette={palette} />
        </span>
        <span className="block min-w-0 px-0.5">
          <span className="block truncate text-sm font-medium text-slate-900" title={doc.name}>
            {doc.name}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusChip status={doc.status} />
            <span className="text-[11px] text-slate-500">{categoryLabel(doc.category)}</span>
          </span>
        </span>
      </Link>

      <span
        className={cn(
          'absolute left-3.5 top-3.5 rounded bg-white/90 p-0.5 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      >
        <SelectBox checked={selected} label={`Chọn ${doc.name}`} onChange={onSelect} />
      </span>

      <IconActions
        {...handlers}
        className="absolute right-3 top-3 rounded-md border border-slate-200 bg-white p-0.5 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
        doc={doc}
        preset={preset}
      />
    </li>
  );
}
