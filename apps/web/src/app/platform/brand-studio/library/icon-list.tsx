'use client';

import type { BrandPalette, IconDocument } from '@enterprise-platform/shared-brand-icon';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { IconSvg } from '../icon-svg';
import { IconActions, type IconActionHandlers } from './icon-actions';
import { formatShortDate } from './library-filters';
import { SelectBox, StatusChip, categoryLabel } from './library-ui';
import { asRoute, editorPath } from './routes';

/** Chế độ danh sách: bảng gọn, mỗi icon một dòng; ô tick đầu bảng chọn tất cả icon đang hiện. */
export function IconList({
  docs,
  palette,
  selected,
  isPreset,
  onSelect,
  onSelectAll,
  ...handlers
}: IconActionHandlers & {
  docs: readonly IconDocument[];
  palette: BrandPalette;
  selected: ReadonlySet<string>;
  isPreset: (id: string) => boolean;
  onSelect: (id: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
}) {
  const selectedCount = docs.filter((doc) => selected.has(doc.id)).length;
  const headCell = 'px-3 py-2 text-left text-xs font-semibold text-slate-500';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="w-10 py-2 pl-3 pr-0 text-left">
              <SelectBox
                checked={docs.length > 0 && selectedCount === docs.length}
                indeterminate={selectedCount > 0}
                label="Chọn tất cả"
                onChange={onSelectAll}
              />
            </th>
            <th className={headCell}>Tên</th>
            <th className={cn(headCell, 'hidden sm:table-cell')}>Danh mục</th>
            <th className={headCell}>Trạng thái</th>
            <th className={cn(headCell, 'hidden text-right md:table-cell')}>Lớp</th>
            <th className={cn(headCell, 'hidden md:table-cell')}>Cập nhật</th>
            <th className="w-32 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => {
            const isSelected = selected.has(doc.id);
            return (
              <tr
                className={cn('group border-b border-slate-100 transition-colors', isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50')}
                data-testid="icon-row"
                key={doc.id}
              >
                <td className="py-2 pl-3 pr-0">
                  <SelectBox checked={isSelected} label={`Chọn ${doc.name}`} onChange={(checked) => onSelect(doc.id, checked)} />
                </td>
                <td className="px-3 py-2">
                  <Link
                    className="flex min-w-0 items-center gap-3 rounded outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
                    href={asRoute(editorPath(doc.id))}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded bg-slate-50 text-slate-700">
                      <IconSvg className="size-6" doc={doc} palette={palette} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{doc.name}</span>
                      {doc.description ? (
                        <span className="block max-w-[28rem] truncate text-xs text-slate-500">{doc.description}</span>
                      ) : null}
                    </span>
                  </Link>
                </td>
                <td className="hidden px-3 py-2 text-slate-600 sm:table-cell">{categoryLabel(doc.category)}</td>
                <td className="px-3 py-2">
                  <StatusChip status={doc.status} />
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums text-slate-600 md:table-cell">{doc.shapes.length}</td>
                <td className="hidden px-3 py-2 tabular-nums text-slate-500 md:table-cell">{formatShortDate(doc.updatedAt)}</td>
                <td className="px-3 py-2">
                  <IconActions {...handlers} className="justify-end" doc={doc} placement="left" preset={isPreset(doc.id)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
