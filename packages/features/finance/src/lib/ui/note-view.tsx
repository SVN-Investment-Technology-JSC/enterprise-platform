'use client';

import { useEffect, useRef } from 'react';
import { financeNoteImageDownloadUrl } from '../attachment-upload';

const MARKER_PATTERN = /voucher-note-image:\/\/([0-9a-f-]{36})/gi;

/**
 * Hiển thị Ghi chú (HTML đã khử trùng phía server) ở trang chi tiết — chỉ đọc. Ảnh dán vào lưu bằng marker
 * ổn định (`voucher-note-image://<id>`) nên phải resolve thành URL tải xuống ký sẵn mới hiện được; làm sau khi
 * render bằng cách sửa trực tiếp `src` của từng `<img>` khớp marker, không đổi lại nội dung `html` gốc.
 */
export function NoteView({ voucherId, html }: { voucherId: string; html: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let cancelled = false;
    const images = [...container.querySelectorAll('img')].filter((img) => MARKER_PATTERN.test(img.getAttribute('src') ?? ''));
    MARKER_PATTERN.lastIndex = 0;
    void Promise.all(
      images.map(async (img) => {
        const id = MARKER_PATTERN.exec(img.getAttribute('src') ?? '')?.[1];
        MARKER_PATTERN.lastIndex = 0;
        if (!id) return;
        try {
          const url = await financeNoteImageDownloadUrl(voucherId, id);
          if (!cancelled) img.src = url;
        } catch {
          if (!cancelled) img.alt = 'Không tải được ảnh';
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [voucherId, html]);

  return (
    <div
      ref={ref}
      className="finance-note-prose text-sm text-slate-700 [&_img]:max-w-full [&_img]:rounded-md [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
      // Nội dung đã được khử trùng (allow-list thẻ/attribute) ở server trước khi lưu — xem note-sanitize.ts.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
