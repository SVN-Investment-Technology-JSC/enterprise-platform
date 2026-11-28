'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical, RotateCcw } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  COLUMN_REORDER_ENABLED,
  clampColumnWidth,
  neighbourColumn,
  type ColumnOrder,
  type ColumnWidths,
} from '../column-order';
import { cn } from '../utils';
import styles from '../workspace.module.scss';
import { Button } from '../ui/button';
import { Tip } from '../ui/tooltip';

/** Một tiêu đề cột kéo thả được để đổi thứ tự cột; dùng cùng `useColumnOrder` (../column-order). */
export interface ReorderableThProps {
  /** Khoá của bảng: chặn thả cột của bảng này vào bảng khác. */
  readonly tableKey: string;
  readonly id: string;
  /** Thứ tự hiện tại của mọi cột, để tính cột kế bên cho phím tắt. */
  readonly order: readonly string[];
  /** Cột ghim: không kéo được, và không nhận cột khác thả vào phía trước nó. */
  readonly pinned?: readonly string[];
  readonly onMove: (
    fromId: string,
    toId: string,
    side: 'before' | 'after',
  ) => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly colSpan?: number;
  readonly scope?: 'col';
  /** Nhãn đọc cho trình đọc màn hình khi nói về cột này, ví dụ "Ưu tiên". */
  readonly label: string;
  /**
   * Độ rộng cột (từ `useColumnWidths`): có thì mép phải tiêu đề có tay nắm để kéo nới/thu cột, bấm đúp để vừa chữ dài nhất,
   * và `th` nhận độ rộng đã lưu. Mọi `th` của cùng một bảng phải nhận CÙNG đối tượng này.
   */
  readonly sizing?: ColumnWidths;
  /**
   * Sắp xếp theo cột: có `onSort` thì cạnh tay nắm kéo độ rộng có nút nhỏ để bấm sắp xếp; `sortDirection` là chiều đang áp
   * (không có là chưa sắp theo cột này).
   */
  readonly sortDirection?: 'asc' | 'desc';
  readonly onSort?: () => void;
}

const MIME = 'application/x-workspace-column';

/**
 * `<th>` kéo thả được:
 * - Kéo tiêu đề rồi thả lên nửa trái hoặc nửa phải của cột khác: cột được chèn trước hoặc sau cột đó (vạch xanh báo vị trí).
 * - Bàn phím: đặt focus trong tiêu đề rồi nhấn Alt + mũi tên trái/phải.
 * - Cột ghim đứng yên và không có tay nắm.
 */
export function ReorderableTh({
  tableKey,
  id,
  order,
  pinned = [],
  onMove,
  children,
  className,
  style,
  colSpan,
  scope = 'col',
  label,
  sizing,
  sortDirection,
  onSort,
}: ReorderableThProps) {
  const [over, setOver] = useState<'before' | 'after' | undefined>();
  const [handleHot, setHandleHot] = useState(false);
  const [resizing, setResizing] = useState(false);
  const frame = useRef<number | undefined>(undefined);
  const stopDrag = useRef<(() => void) | undefined>(undefined);
  // Rời trang khi đang kéo: gỡ trình nghe trên document và huỷ khung hình chờ.
  useEffect(
    () => () => {
      stopDrag.current?.();
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );
  // Tạm tắt đổi chỗ cột (COLUMN_REORDER_ENABLED): coi mọi cột như cột ghim, tức không kéo được và không có tay nắm.
  const isPinned = !COLUMN_REORDER_ENABLED || pinned.includes(id);
  const sized = sizing?.widths?.[id];
  const mergedStyle: CSSProperties | undefined =
    sized === undefined
      ? style
      : { ...style, width: sized, minWidth: sized, maxWidth: sized };

  /** Đo độ rộng thực của mọi cột trong hàng tiêu đề này, để bảng chuyển sang bố cục cố định mà không nhảy. */
  const measureHeaderRow = (
    th: HTMLTableCellElement,
  ): Record<string, number> => {
    const measured: Record<string, number> = {};
    th.parentElement
      ?.querySelectorAll<HTMLTableCellElement>('th[data-column-id]')
      .forEach((cell) => {
        const columnId = cell.dataset.columnId;
        if (columnId) measured[columnId] = cell.getBoundingClientRect().width;
      });
    return measured;
  };

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!sizing || event.button !== 0) return;
    const th = event.currentTarget.closest('th');
    if (!th) return;
    event.preventDefault();
    event.stopPropagation();
    const measured = measureHeaderRow(th);
    sizing.freeze(measured);
    const startX = event.clientX;
    const startWidth =
      sizing.widths?.[id] ?? measured[id] ?? th.getBoundingClientRect().width;
    setResizing(true);
    const previousSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    let latest = startWidth;
    const move = (moveEvent: PointerEvent) => {
      latest = startWidth + (moveEvent.clientX - startX);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        sizing.setWidth(id, latest);
      });
    };
    const end = () => {
      // Thả chuột: áp ngay vị trí cuối, không đợi khung hình (khung đang chờ bị bỏ).
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      sizing.setWidth(id, latest);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      document.body.style.userSelect = previousSelect;
      document.body.style.cursor = previousCursor;
      stopDrag.current = undefined;
      setResizing(false);
    };
    stopDrag.current = end;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  };

  /** Bấm đúp: vừa chữ dài nhất của cột (tiêu đề và các dòng đang hiện). */
  const fitToContent = (event: ReactMouseEvent<HTMLSpanElement>) => {
    if (!sizing) return;
    const th = event.currentTarget.closest('th');
    const table = th?.closest('table');
    if (!th || !table) return;
    event.preventDefault();
    event.stopPropagation();
    sizing.freeze(measureHeaderRow(th));
    const headerRow = th.parentElement;
    const index = Array.from(headerRow?.children ?? []).indexOf(th);
    let widest = th.scrollWidth;
    table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
      const cell = row.children[index] as HTMLTableCellElement | undefined;
      if (
        cell &&
        cell.colSpan === 1 &&
        row.children.length === headerRow?.children.length
      ) {
        widest = Math.max(widest, cell.scrollWidth);
      }
    });
    sizing.setWidth(id, clampColumnWidth(widest + 4));
  };

  const onHandleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!sizing || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight'))
      return;
    const th = event.currentTarget.closest('th');
    if (!th) return;
    event.preventDefault();
    event.stopPropagation();
    const measured = measureHeaderRow(th);
    sizing.freeze(measured);
    const step =
      (event.shiftKey ? 40 : 10) * (event.key === 'ArrowLeft' ? -1 : 1);
    sizing.setWidth(
      id,
      (sizing.widths?.[id] ??
        measured[id] ??
        th.getBoundingClientRect().width) + step,
    );
  };

  const sideOf = (
    event: DragEvent<HTMLTableCellElement>,
  ): 'before' | 'after' => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX < box.left + box.width / 2 ? 'before' : 'after';
  };
  const ownDrag = (event: DragEvent<HTMLTableCellElement>) =>
    event.dataTransfer.types.includes(`${MIME}:${tableKey}`.toLowerCase());

  const onKeyDown = (event: KeyboardEvent<HTMLTableCellElement>) => {
    if (
      !event.altKey ||
      isPinned ||
      (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
    )
      return;
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const target = neighbourColumn(order, id, direction, pinned);
    if (!target) return;
    event.preventDefault();
    onMove(id, target, direction === -1 ? 'before' : 'after');
  };

  return (
    <th
      scope={scope}
      colSpan={colSpan}
      className={cn(
        'group/th relative',
        !isPinned && 'cursor-grab active:cursor-grabbing',
        onSort && styles.columnSortable,
        sized !== undefined &&
          'overflow-hidden text-ellipsis whitespace-nowrap',
        over === 'before' && 'shadow-[inset_3px_0_0_0_var(--primary)]',
        over === 'after' && 'shadow-[inset_-3px_0_0_0_var(--primary)]',
        className,
      )}
      style={mergedStyle}
      draggable={!isPinned && !handleHot && !resizing}
      title={label}
      data-column-id={id}
      aria-sort={onSort ? (sortDirection === 'asc' ? 'ascending' : sortDirection === 'desc' ? 'descending' : 'none') : undefined}
      onKeyDown={onKeyDown}
      onDragStart={(event) => {
        if (isPinned) return;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(MIME, id);
        // Kiểu dữ liệu riêng của bảng này: `ownDrag` dựa vào đó để từ chối thả từ bảng khác.
        event.dataTransfer.setData(`${MIME}:${tableKey}`.toLowerCase(), id);
      }}
      onDragOver={(event) => {
        if (!ownDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const side = sideOf(event);
        if (side === 'before' && isPinned) {
          setOver(undefined);
          return;
        }
        setOver(side);
      }}
      onDragLeave={() => setOver(undefined)}
      onDrop={(event) => {
        if (!ownDrag(event)) return;
        event.preventDefault();
        const from = event.dataTransfer.getData(MIME);
        const side = sideOf(event);
        setOver(undefined);
        if (from) onMove(from, id, side);
      }}
      onDragEnd={() => setOver(undefined)}
    >
      {children}
      {onSort ? (
        <button
          type="button"
          draggable={false}
          className={cn(styles.columnSortButton, sortDirection && styles.columnSortButtonOn)}
          aria-label={
            sortDirection === 'asc'
              ? `Đang sắp xếp ${label} tăng dần; bấm để giảm dần`
              : sortDirection === 'desc'
                ? `Đang sắp xếp ${label} giảm dần; bấm để bỏ sắp xếp`
                : `Sắp xếp theo ${label}`
          }
          title={sortDirection === 'asc' ? 'Tăng dần' : sortDirection === 'desc' ? 'Giảm dần' : 'Sắp xếp'}
          onClick={(event) => {
            event.stopPropagation();
            onSort();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onDragStart={(event) => event.preventDefault()}
        >
          {sortDirection === 'asc' ? <ArrowUp aria-hidden /> : sortDirection === 'desc' ? <ArrowDown aria-hidden /> : <ArrowUpDown aria-hidden />}
        </button>
      ) : null}
      {sizing ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`Độ rộng cột ${label}`}
          tabIndex={0}
          title="Kéo để chỉnh độ rộng cột; bấm đúp để vừa chữ"
          draggable={false}
          className={cn(styles.columnResizeHandle, resizing && styles.columnResizeHandleActive)}
          onPointerEnter={() => setHandleHot(true)}
          onPointerLeave={() => setHandleHot(false)}
          onPointerDown={startResize}
          onDoubleClick={fitToContent}
          onKeyDown={onHandleKeyDown}
          onDragStart={(event) => event.preventDefault()}
        />
      ) : null}
      {!isPinned ? (
        <span
          className="pointer-events-none absolute top-1/2 left-0 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/th:opacity-60"
          aria-hidden
        >
          <GripVertical className="size-3" />
        </span>
      ) : null}
    </th>
  );
}

/**
 * Nút "Đặt lại bố cục cột": đưa cả thứ tự lẫn độ rộng về mặc định; chỉ hiện khi một trong hai đã bị đổi.
 * Dùng thay `ResetColumnOrderButton` ở bảng có cả kéo đổi chỗ và kéo đổi độ rộng.
 */
export function ResetColumnLayoutButton({
  order,
  sizing,
}: {
  order: ColumnOrder;
  sizing: ColumnWidths;
}) {
  if (!order.customized && !sizing.customized) return null;
  return (
    <Tip content="Đặt lại thứ tự và độ rộng cột về mặc định">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Đặt lại bố cục cột"
        onClick={() => {
          order.reset();
          sizing.reset();
        }}
      >
        <RotateCcw aria-hidden />
        Bố cục cột
      </Button>
    </Tip>
  );
}

/** Nút "Đặt lại thứ tự cột", chỉ hiện khi người dùng đã đổi thứ tự. Đặt cạnh các nút công cụ của bảng. */
export function ResetColumnOrderButton({
  customized,
  onReset,
}: {
  customized: boolean;
  onReset: () => void;
}) {
  if (!customized) return null;
  return (
    <Tip content="Đặt lại thứ tự cột về mặc định">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onReset}
        aria-label="Đặt lại thứ tự cột"
      >
        <RotateCcw aria-hidden />
        Thứ tự cột
      </Button>
    </Tip>
  );
}
