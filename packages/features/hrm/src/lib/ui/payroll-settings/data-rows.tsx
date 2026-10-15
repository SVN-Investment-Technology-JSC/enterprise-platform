'use client';
/**
 * Thành phần giao diện dùng chung cho màn cấu hình Lương & OT:
 *  - `DataList`: bảng dạng lưới (header slate-50, dòng ngăn bằng đường kẻ) tự chuyển thành DANH SÁCH THẺ khi khung chứa hẹp
 *    (< `@2xl`). Một DOM duy nhất, chuyển bố cục bằng container query nên không phụ thuộc bề rộng cửa sổ.
 *  - `ActionMenu`: nút "..." (RowMenu) có thêm mục cần xác nhận; xác nhận vẫn bằng Popconfirm neo tại nút "...".
 *  - `AutoTextarea`: ô nhập nhiều dòng tự giãn chiều cao, dùng cho công thức và tham số.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { RowMenu, type RowMenuItem } from '../row-menu';
import { Button } from '../button';

export interface DataColumn<T> {
  key: string;
  /** Tiêu đề cột (bảng rộng); dùng làm nhãn trong thẻ khi `cardLabel`. */
  header: string;
  /** Độ rộng cột trong lưới (ví dụ `minmax(0,1fr)`, `110px`). */
  width: string;
  align?: 'right';
  cell: (row: T, ctx: { expanded: boolean; toggle: () => void }) => ReactNode;
  /** Thẻ: hiện "Tiêu đề: giá trị". */
  cardLabel?: boolean;
  /** Thẻ: chiếm trọn một hàng. */
  cardFull?: boolean;
  /** Thẻ: chiếm phần rộng còn lại của hàng (tên bên trái, nút thao tác bên phải cùng hàng). */
  cardGrow?: boolean;
  /** Thẻ: đẩy sang mép phải (nút thao tác). */
  cardEnd?: boolean;
  /** Thẻ: thứ tự hiển thị (0 mặc định, 1 sau, -1 trước). */
  cardOrder?: -1 | 0 | 1 | 2;
  cardHidden?: boolean;
}

const CARD_ORDER: Record<number, string> = {
  [-1]: 'order-first @2xl:order-none',
  0: '',
  1: 'order-1 @2xl:order-none',
  2: 'order-2 @2xl:order-none',
};

export function DataList<T>({
  label,
  rows,
  columns,
  rowKey,
  renderExpanded,
  pageSize,
  empty,
  className = '',
}: {
  label: string;
  rows: readonly T[];
  columns: readonly DataColumn<T>[];
  rowKey: (row: T) => string;
  renderExpanded?: (row: T) => ReactNode;
  pageSize?: number;
  empty?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pages = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  const current = Math.min(page, pages);
  const shown = pageSize ? rows.slice((current - 1) * pageSize, current * pageSize) : rows;
  const template = columns.map((c) => c.width).join(' ');
  const gridStyle = { '--cols': template } as CSSProperties;

  if (rows.length === 0) return <div className={className}>{empty}</div>;
  return (
    <div className={`@container min-w-0 ${className}`}>
      <div role="table" aria-label={label} className="@2xl:overflow-hidden @2xl:rounded-lg @2xl:border @2xl:border-slate-200">
        <div
          role="row"
          style={gridStyle}
          className="hidden gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 @2xl:grid @2xl:[grid-template-columns:var(--cols)]"
        >
          {columns.map((c) => (
            <div key={c.key} role="columnheader" className={`min-w-0 ${c.align === 'right' ? 'text-right' : ''}`}>
              {c.header}
            </div>
          ))}
        </div>
        <div role="rowgroup" className="space-y-2 @2xl:space-y-0 @2xl:divide-y @2xl:divide-slate-100">
          {shown.map((row) => {
            const key = rowKey(row);
            const expanded = open === key;
            const ctx = { expanded, toggle: () => setOpen(expanded ? null : key) };
            return (
              <div key={key} className="min-w-0 rounded-lg border border-slate-200 bg-white @2xl:rounded-none @2xl:border-0">
                <div
                  role="row"
                  style={gridStyle}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3 @2xl:grid @2xl:gap-3 @2xl:px-3 @2xl:py-2.5 @2xl:[grid-template-columns:var(--cols)]"
                >
                  {columns.map((c) =>
                    c.cardHidden ? (
                      <div key={c.key} role="cell" className={`hidden min-w-0 @2xl:block ${c.align === 'right' ? 'text-right' : ''}`}>
                        {c.cell(row, ctx)}
                      </div>
                    ) : (
                      <div
                        key={c.key}
                        role="cell"
                        className={`min-w-0 text-xs ${c.cardFull ? 'basis-full @2xl:basis-auto' : ''} ${c.cardGrow ? 'grow basis-3/5 @2xl:grow-0 @2xl:basis-auto' : ''} ${
                          c.cardEnd ? 'ml-auto @2xl:ml-0' : ''
                        } ${CARD_ORDER[c.cardOrder ?? 0]} ${c.align === 'right' ? '@2xl:text-right' : ''}`}
                      >
                        {c.cardLabel ? <span className="mr-1 text-[12px] text-slate-500 @2xl:hidden">{c.header}:</span> : null}
                        {c.cell(row, ctx)}
                      </div>
                    ),
                  )}
                </div>
                {renderExpanded && expanded ? (
                  <div className="border-t border-slate-100 bg-slate-50/70 p-3">{renderExpanded(row)}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {pageSize && rows.length > pageSize ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-slate-500">
          <span>
            Hiển thị {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, rows.length)} / {rows.length}
          </span>
          <span className="inline-flex items-center gap-1">
            <Button type="button" variant="outline" size="icon-sm" aria-label="Trang trước" disabled={current <= 1} onClick={() => setPage(current - 1)}>
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="px-1">
              {current}/{pages}
            </span>
            <Button type="button" variant="outline" size="icon-sm" aria-label="Trang sau" disabled={current >= pages} onClick={() => setPage(current + 1)}>
              <ChevronRight className="size-3.5" />
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Nút mở/đóng phần chi tiết của một dòng. */
export function ExpandToggle({ expanded, onClick, label }: { expanded: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
    >
      <ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
  );
}

export interface ConfirmSpec {
  title: string;
  description?: string;
  okText?: string;
  cancelText?: string;
  okType?: 'danger' | 'primary' | 'warning';
  /** Có thì Popconfirm hiện ô nhập ghi chú; `required` bắt buộc nhập mới bấm xác nhận được. */
  reason?: { label: string; placeholder?: string; required?: boolean };
  /** `note` là ghi chú đã nhập (nếu có ô ghi chú). */
  onConfirm: (note?: string) => void | Promise<void>;
}

export interface ActionItem extends Omit<RowMenuItem, 'onSelect'> {
  onSelect?: () => void;
  /** Có thì chọn mục sẽ hiện Popconfirm tại nút "..." và chỉ chạy khi người dùng xác nhận. */
  confirm?: ConfirmSpec;
}

/**
 * Nút "..." của một dòng. Mục có `confirm` hiện Popconfirm neo tại nút "..." (RowMenu đóng ngay khi chọn nên neo bằng một
 * phần tử trong suốt phủ lên nút, mở bằng cách bấm giả vào phần tử đó).
 */
export function ActionMenu({
  items,
  label,
  trigger,
  buttonClassName,
}: {
  items: readonly ActionItem[];
  label?: string;
  /** Nội dung nút mở menu thay cho biểu tượng "..." (xem `RowMenu`). */
  trigger?: ReactNode;
  buttonClassName?: string;
}) {
  const [pending, setPending] = useState<ConfirmSpec | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (pending) anchor.current?.click();
  }, [pending]);
  const menuItems: RowMenuItem[] = items.map((item) => ({
    key: item.key,
    label: item.label,
    hidden: item.hidden,
    tone: item.tone,
    onSelect: () => {
      if (item.confirm) setPending(item.confirm);
      else item.onSelect?.();
    },
  }));
  if (items.every((i) => i.hidden)) return null;
  return (
    <span className="relative inline-flex">
      <RowMenu items={menuItems} label={label} trigger={trigger} buttonClassName={buttonClassName} />
      <Popconfirm
        title={pending?.title ?? ''}
        description={pending?.description}
        okText={pending?.okText ?? 'Xác nhận'}
        cancelText={pending?.cancelText ?? 'Quay lại'}
        okType={pending?.okType ?? 'danger'}
        placement="bottom-end"
        reasonRequired={pending?.reason ? (pending.reason.required ?? false) : undefined}
        reasonLabel={pending?.reason?.label}
        reasonPlaceholder={pending?.reason?.placeholder}
        onCancel={() => setPending(null)}
        onConfirm={async (note) => {
          try {
            await pending?.onConfirm(note);
          } finally {
            setPending(null);
          }
        }}
      >
        <span ref={anchor} aria-hidden="true" className="pointer-events-none absolute inset-0" />
      </Popconfirm>
    </span>
  );
}

/** Ô nhập nhiều dòng tự giãn chiều cao theo nội dung (tối đa ~10 dòng rồi cuộn). */
export function AutoTextarea({
  value,
  className = '',
  singleLine = false,
  onChange,
  onKeyDown,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & {
  value: string;
  onChange: (value: string) => void;
  /** Không cho xuống dòng (công thức một dòng): Enter bị chặn, ký tự xuống dòng dán vào được đổi thành khoảng trắng. */
  singleLine?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 220)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(singleLine ? e.target.value.replace(/[\r\n]+/g, ' ') : e.target.value)}
      onKeyDown={(e) => {
        if (singleLine && e.key === 'Enter') e.preventDefault();
        onKeyDown?.(e);
      }}
      {...rest}
      className={`block min-h-9 w-full min-w-0 resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs leading-snug outline-none transition-colors placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-50 ${className}`}
    />
  );
}
