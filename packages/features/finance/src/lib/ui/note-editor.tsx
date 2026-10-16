'use client';

import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TiptapImage from '@tiptap/extension-image';
import { Bold, Italic, List, ListOrdered, Strikethrough } from 'lucide-react';
import { financeNoteImageMarker } from '@enterprise-platform/contracts-finance';
import { financeNoteImageDownloadUrl, uploadFinanceNoteImage } from '../attachment-upload';
import { cn } from '../utils';

const MARKER_PATTERN = /voucher-note-image:\/\/([0-9a-f-]{36})/gi;

function imageFilesOf(list: DataTransferItemList | FileList | null | undefined): File[] {
  if (!list) return [];
  return [...list]
    .map((item) => ('getAsFile' in item ? item.getAsFile() : (item as File)))
    .filter((file): file is File => Boolean(file?.type.startsWith('image/')));
}

export interface NoteEditorProps {
  /** HTML đã khử trùng, dùng marker `voucher-note-image://<id>` cho ảnh — không bao giờ chứa URL thật. */
  value: string;
  onChange: (html: string) => void;
  /** Phiếu đã lưu: cho dán/thả ảnh và resolve ảnh đã lưu để hiển thị. Chưa có (phiếu mới chưa lưu) thì chặn dán ảnh. */
  voucherId?: string;
  disabled?: boolean;
  onProblem?: (message: string) => void;
  /**
   * Có truyền thì ảnh dán/thả vào ghi chú được chuyển cho nơi gọi (form phiếu đưa sang mục Đính kèm) thay vì
   * nhúng vào nội dung ghi chú; ảnh nhúng sẵn trong ghi chú cũ vẫn hiện bình thường.
   */
  onPasteImages?: (files: File[]) => void;
}

/**
 * Ô "Ghi chú" dạng soạn thảo văn bản (Tiptap). Nội dung lưu và gửi lên server luôn ở dạng marker ổn định
 * (`voucher-note-image://<id>`), không bao giờ là URL ký sẵn (hết hạn) hay base64; `srcMap` giữ chiều
 * marker ⇄ URL hiển thị hiện tại để việc này trong suốt với người gọi (`value`/`onChange` luôn là HTML chuẩn).
 */
export function NoteEditor({ value, onChange, voucherId, disabled, onProblem, onPasteImages }: NoteEditorProps) {
  const srcMap = useRef(new Map<string, string>());
  const [uploading, setUploading] = useState(0);

  const editor = useEditor({
    extensions: [StarterKit, TiptapImage.configure({ inline: false })],
    content: value,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'finance-note-prose min-h-[96px] outline-none' },
      handlePaste: (_view, event) => {
        const files = imageFilesOf(event.clipboardData?.files);
        if (!files.length) return false;
        event.preventDefault();
        if (onPasteImages) onPasteImages(files);
        else void insertImages(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = imageFilesOf(event.dataTransfer?.files);
        if (!files.length) return false;
        event.preventDefault();
        if (onPasteImages) onPasteImages(files);
        else void insertImages(files);
        return true;
      },
    },
    onUpdate: ({ editor: instance }) => {
      let html = instance.getHTML();
      for (const [displayUrl, marker] of srcMap.current) html = html.split(displayUrl).join(marker);
      onChange(html);
    },
  });

  async function insertImages(files: File[]) {
    if (!voucherId) {
      onProblem?.('Lưu phiếu trước khi dán ảnh vào ghi chú.');
      return;
    }
    setUploading((n) => n + 1);
    try {
      const uploaded = await Promise.all(files.map((file) => uploadFinanceNoteImage(voucherId, file)));
      const nodes = await Promise.all(
        uploaded.map(async (attachment) => {
          const url = await financeNoteImageDownloadUrl(voucherId, attachment.id);
          srcMap.current.set(url, financeNoteImageMarker(attachment.id));
          return { type: 'image', attrs: { src: url } };
        }),
      );
      editor?.chain().focus().insertContent(nodes).run();
    } catch (error) {
      onProblem?.(error instanceof Error ? error.message : 'Không dán được ảnh vào ghi chú.');
    } finally {
      setUploading((n) => n - 1);
    }
  }

  // Nội dung tải từ phiếu đã lưu chỉ có marker; resolve một lần thành URL hiển thị khi mở trình soạn thảo.
  useEffect(() => {
    if (!editor || !voucherId) return;
    const html = editor.getHTML();
    const ids = [...new Set([...html.matchAll(MARKER_PATTERN)].map((match) => match[1]))];
    if (!ids.length) return;
    let cancelled = false;
    void (async () => {
      const resolved = await Promise.all(
        ids.map(async (id) => {
          try {
            return [id, await financeNoteImageDownloadUrl(voucherId, id)] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      );
      if (cancelled) return;
      let next = html;
      for (const [id, url] of resolved) {
        if (!url) continue;
        srcMap.current.set(url, financeNoteImageMarker(id));
        next = next.split(financeNoteImageMarker(id)).join(url);
      }
      if (next !== html) editor.commands.setContent(next, { emitUpdate: false });
    })();
    return () => {
      cancelled = true;
    };
    // Chỉ chạy lại khi đổi trình soạn thảo hoặc đổi phiếu; nội dung tự lấy từ editor tại thời điểm chạy.
  }, [editor, voucherId]);

  if (!editor) return null;

  const mark = (name: 'bold' | 'italic' | 'strike') => editor.isActive(name);
  const toolbarButton = (active: boolean, label: string, onClick: () => void, Icon: typeof Bold) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-40',
        active && 'bg-slate-200 text-slate-900',
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );

  return (
    <div className={cn('rounded-lg border border-slate-200 bg-white', disabled && 'opacity-60')}>
      <div className="flex items-center gap-1 border-b border-slate-100 px-1.5 py-1">
        {toolbarButton(mark('bold'), 'In đậm', () => editor.chain().focus().toggleBold().run(), Bold)}
        {toolbarButton(mark('italic'), 'In nghiêng', () => editor.chain().focus().toggleItalic().run(), Italic)}
        {toolbarButton(mark('strike'), 'Gạch ngang', () => editor.chain().focus().toggleStrike().run(), Strikethrough)}
        <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
        {toolbarButton(editor.isActive('bulletList'), 'Danh sách chấm', () => editor.chain().focus().toggleBulletList().run(), List)}
        {toolbarButton(editor.isActive('orderedList'), 'Danh sách số', () => editor.chain().focus().toggleOrderedList().run(), ListOrdered)}
        {uploading > 0 ? <span className="ml-auto pr-2 text-xs text-slate-500">Đang tải ảnh lên…</span> : null}
      </div>
      <EditorContent editor={editor} className="px-2.5 py-2 text-sm [&_.finance-note-prose]:min-h-24 [&_.finance-note-prose_img]:max-w-full [&_.finance-note-prose_img]:rounded-md [&_.finance-note-prose_ol]:list-decimal [&_.finance-note-prose_ol]:pl-5 [&_.finance-note-prose_ul]:list-disc [&_.finance-note-prose_ul]:pl-5" />
    </div>
  );
}
