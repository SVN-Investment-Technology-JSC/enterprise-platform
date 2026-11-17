'use client';

import type { IconDocument } from '@enterprise-platform/shared-brand-icon';
import { Popconfirm, type PopconfirmPlacement } from '@enterprise-platform/shared-ui';
import { Copy, Download, MoreHorizontal, PencilLine, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Hint } from '../components/hint';
import { IconButton } from './library-ui';
import { asRoute, editorPath } from './routes';

export interface IconActionHandlers {
  readonly onDuplicate: (doc: IconDocument) => void;
  readonly onExport: (doc: IconDocument) => void;
  readonly onRemove: (doc: IconDocument) => void;
  readonly onReset: (doc: IconDocument) => void;
}

/**
 * Thao tác nhanh trên một icon: Mở, Nhân bản, Xuất, rồi Xoá (icon tự tạo) hoặc Đặt lại (icon mẫu, không xoá được).
 * Dùng chung cho ô lưới và dòng danh sách.
 */
export function IconActions({
  doc,
  preset,
  placement = 'top-end',
  className,
  onDuplicate,
  onExport,
  onRemove,
  onReset,
}: IconActionHandlers & {
  doc: IconDocument;
  preset: boolean;
  placement?: PopconfirmPlacement;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <Hint label="Mở trong trình thiết kế">
        <Link
          aria-label={`Mở ${doc.name} trong trình thiết kế`}
          className="inline-flex size-7 items-center justify-center rounded text-blue-600 transition-colors outline-none hover:bg-blue-50 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-600/40"
          href={asRoute(editorPath(doc.id))}
        >
          <PencilLine aria-hidden className="size-4" />
        </Link>
      </Hint>
      <IconButton label="Nhân bản" onClick={() => onDuplicate(doc)}>
        <Copy aria-hidden className="size-4" />
      </IconButton>
      <IconButton label="Xuất" onClick={() => onExport(doc)}>
        <Download aria-hidden className="size-4" />
      </IconButton>
      {preset ? (
        <Popconfirm
          cancelText="Hủy"
          description="Mọi chỉnh sửa trên icon mẫu này sẽ mất."
          okText="Đặt lại"
          okType="warning"
          onConfirm={() => onReset(doc)}
          placement={placement}
          title="Đặt lại về bản gốc?"
        >
          <IconButton label="Đặt lại về bản gốc">
            <RotateCcw aria-hidden className="size-4" />
          </IconButton>
        </Popconfirm>
      ) : (
        <Popconfirm
          cancelText="Hủy"
          description="Icon sẽ được gỡ khỏi thư viện."
          okText="Xoá"
          onConfirm={() => onRemove(doc)}
          placement={placement}
          title={`Xoá "${doc.name}"?`}
        >
          <IconButton label="Xoá" tone="danger">
            <Trash2 aria-hidden className="size-4" />
          </IconButton>
        </Popconfirm>
      )}
    </div>
  );
}

/**
 * Thao tác nhanh dạng gọn cho ô lưới: chỉ một nút nhỏ "⋯" ở góc, bấm mới mở danh sách (Mở, Nhân bản, Xuất, rồi Xoá hoặc Đặt lại).
 * Một nút nhỏ không che ô tick bên cạnh như cả thanh nút. Xoá và Đặt lại hỏi xác nhận bằng hộp thoại vì mục trong menu đóng
 * ngay khi chọn, không giữ được hộp xác nhận gắn vào nó.
 */
export function IconActionsMenu({
  doc,
  preset,
  className,
  onDuplicate,
  onExport,
  onRemove,
  onReset,
}: IconActionHandlers & { doc: IconDocument; preset: boolean; className?: string }) {
  const [confirm, setConfirm] = useState<'remove' | 'reset' | null>(null);
  const resetting = confirm === 'reset';
  return (
    <>
      <DropdownMenu>
        <Hint label="Thao tác">
          <DropdownMenuTrigger
            aria-label={`Thao tác với ${doc.name}`}
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-500 shadow-sm outline-none transition-colors',
              'hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-600/40 aria-expanded:bg-slate-100 aria-expanded:text-slate-900',
              className,
            )}
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end" className="w-52" sideOffset={4}>
          <DropdownMenuItem render={<Link href={asRoute(editorPath(doc.id))} />}>
            <PencilLine aria-hidden />
            Mở trong trình thiết kế
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDuplicate(doc)}>
            <Copy aria-hidden />
            Nhân bản
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExport(doc)}>
            <Download aria-hidden />
            Xuất
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {preset ? (
            <DropdownMenuItem onClick={() => setConfirm('reset')}>
              <RotateCcw aria-hidden />
              Đặt lại về bản gốc
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setConfirm('remove')} variant="destructive">
              <Trash2 aria-hidden />
              Xoá
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog onOpenChange={(open) => (open ? undefined : setConfirm(null))} open={confirm !== null}>
        <DialogContent className="max-w-md gap-0 overflow-hidden border border-slate-200 bg-white p-0 text-slate-900" showCloseButton={false}>
          <DialogHeader className="flex-row items-start gap-3 px-5 pb-4 pt-5">
            <span
              className={cn(
                'grid size-10 shrink-0 place-items-center rounded-full ring-1 ring-inset',
                resetting ? 'bg-amber-50 text-amber-600 ring-amber-100' : 'bg-red-50 text-red-600 ring-red-100',
              )}
            >
              {resetting ? <RotateCcw aria-hidden className="size-5" /> : <Trash2 aria-hidden className="size-5" />}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle className="break-words text-base">{resetting ? 'Đặt lại về bản gốc?' : `Xoá "${doc.name}"?`}</DialogTitle>
              <DialogDescription className="text-slate-600">
                {resetting ? 'Mọi chỉnh sửa trên icon mẫu này sẽ mất.' : 'Icon sẽ được gỡ khỏi thư viện.'}
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogFooter className="flex-row justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <Button onClick={() => setConfirm(null)} variant="outline">
              Hủy
            </Button>
            <Button
              onClick={() => {
                setConfirm(null);
                if (resetting) onReset(doc);
                else onRemove(doc);
              }}
              className={resetting ? undefined : 'bg-red-600 text-white hover:bg-red-700'}
              variant={resetting ? 'default' : 'destructive'}
            >
              {resetting ? 'Đặt lại' : 'Xoá'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
