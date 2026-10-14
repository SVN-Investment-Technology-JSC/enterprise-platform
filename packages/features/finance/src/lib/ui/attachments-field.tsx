'use client';

import { useRef, type ChangeEvent, type DragEvent } from 'react';
import { Paperclip, Trash2, Upload } from 'lucide-react';
import type { FinanceVoucherAttachment } from '@enterprise-platform/contracts-finance';
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS, attachmentProblem, formatBytes, openFinanceAttachment } from '../attachment-upload';
import { Button } from './button';

/**
 * Ô đính kèm của form phiếu: tệp đã lưu (tải xuống/gỡ được) và tệp vừa chọn đang chờ tải lên khi bấm Lưu.
 * Kiểm định dạng và dung lượng ngay lúc chọn; máy chủ kiểm lại ở bước xác nhận.
 */
export function AttachmentsField({
  voucherId,
  saved,
  pending,
  onAdd,
  onRemovePending,
  onRemoveSaved,
  onProblem,
  disabled,
}: {
  voucherId?: string;
  saved: readonly FinanceVoucherAttachment[];
  pending: readonly File[];
  onAdd: (files: File[]) => void;
  onRemovePending: (index: number) => void;
  onRemoveSaved: (attachment: FinanceVoucherAttachment) => void;
  onProblem: (message: string | null) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const room = MAX_ATTACHMENTS - saved.length - pending.length;

  function accept(list: FileList | File[]) {
    const files = [...list];
    const problems = files.map((file) => attachmentProblem(file)).filter((p): p is string => Boolean(p));
    const valid = files.filter((file) => !attachmentProblem(file));
    if (valid.length > room) problems.push(`Mỗi phiếu đính kèm tối đa ${MAX_ATTACHMENTS} tệp.`);
    onProblem(problems.length ? problems.join('\n') : null);
    if (valid.length) onAdd(valid.slice(0, Math.max(room, 0)));
  }

  return (
    <div
      onDragOver={(event: DragEvent) => event.preventDefault()}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        if (!disabled) accept(event.dataTransfer.files);
      }}
      className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Upload className="size-5 text-slate-400" aria-hidden />
        <span className="text-sm text-slate-600">Kéo thả tệp vào đây hoặc</span>
        <Button type="button" size="sm" disabled={disabled || room <= 0} onClick={() => input.current?.click()}>
          Chọn từ máy
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label="Chọn tệp đính kèm"
          accept={ATTACHMENT_ACCEPT}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            if (event.target.files) accept(event.target.files);
            event.target.value = '';
          }}
        />
        <span className="text-xs text-slate-500">PDF, ảnh, Word, Excel; tối đa 10 MB mỗi tệp, 20 tệp mỗi phiếu.</span>
      </div>
      {saved.length || pending.length ? (
        <ul className="mt-3 divide-y divide-slate-100 text-sm" aria-label="Tệp đính kèm">
          {saved.map((file) => (
            <li key={file.id} className="flex items-center gap-2 py-1.5">
              <Paperclip className="size-4 shrink-0 text-slate-400" aria-hidden />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-medium text-link hover:underline"
                onClick={() => voucherId && void openFinanceAttachment(voucherId, file.id)}
              >
                {file.fileName}
              </button>
              <span className="text-xs text-slate-500">{formatBytes(file.sizeBytes)}</span>
              <button
                type="button"
                aria-label={`Gỡ ${file.fileName}`}
                disabled={disabled}
                onClick={() => onRemoveSaved(file)}
                className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
          {pending.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-2 py-1.5">
              <Paperclip className="size-4 shrink-0 text-slate-400" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-xs text-amber-700">Sẽ tải lên khi lưu</span>
              <span className="text-xs text-slate-500">{formatBytes(file.size)}</span>
              <button
                type="button"
                aria-label={`Bỏ ${file.name}`}
                disabled={disabled}
                onClick={() => onRemovePending(index)}
                className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
