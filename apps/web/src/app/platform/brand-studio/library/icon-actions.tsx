'use client';

import type { IconDocument } from '@enterprise-platform/shared-brand-icon';
import { Popconfirm, type PopconfirmPlacement } from '@enterprise-platform/shared-ui';
import { Copy, Download, PencilLine, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
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
      <Link
        aria-label={`Mở ${doc.name} trong trình thiết kế`}
        className="inline-flex size-7 items-center justify-center rounded text-blue-600 transition-colors outline-none hover:bg-blue-50 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-600/40"
        href={asRoute(editorPath(doc.id))}
        title="Mở trong trình thiết kế"
      >
        <PencilLine aria-hidden className="size-4" />
      </Link>
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
          description="Không thể hoàn tác."
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
