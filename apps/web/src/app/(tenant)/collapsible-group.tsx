'use client';

import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

/**
 * Một nhóm dòng thu gọn được của Tenant Portal (việc cần chú ý trên Bảng điều
 * khiển, nhóm ứng dụng theo trạng thái…): đầu nhóm bấm để thu gọn hoặc mở ra.
 * Nhóm không có dòng nào thì đóng sẵn, để các nhóm còn dòng nằm gần nhau.
 */
export function CollapsibleGroup({
  title,
  count,
  icon,
  tone,
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  /** Lớp màu nền và chữ của ô biểu tượng. */
  tone: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(count > 0);
  const headingId = useId();
  const panelId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-3 bg-[#fafbfc] px-5 py-3.5 text-left text-[#18181b]"
      >
        <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-lg ${tone}`}>
          {icon}
        </span>
        <span id={headingId} className="flex-1 text-[14.5px] font-semibold">
          {title}
        </span>
        <span className="rounded-xl border border-[#eef0f3] bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-500">
          {count}
        </span>
        <ChevronDown
          aria-hidden
          className={`size-4 text-slate-500 transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      <div id={panelId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
