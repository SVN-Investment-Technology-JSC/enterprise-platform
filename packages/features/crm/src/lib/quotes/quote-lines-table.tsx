'use client';

/**
 * Bảng dòng hàng ở cột trái màn báo giá (phase 3, plan 9.4 theo BG.pdf trang 4; task P3C4-04): nút + mở
 * `MaterialPicker`; bấm đúp sửa dòng; chuột phải (hoặc `Shift+F10`, phím menu) mở menu Thêm / Hiệu chỉnh / Chèn / Xoá;
 * `Enter` sửa, `Delete` xoá (có hỏi), mũi tên lên xuống chọn dòng. Báo giá không còn Nháp: chỉ xem.
 * Bảng chỉ phát sự kiện; gọi API vẫn do `QuoteEditor` làm như trước.
 */
import { PRICE_SOURCE_LABELS, type QuoteLine } from '@enterprise-platform/contracts-crm';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Eye, ListPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CrmDialog, StatusPill } from '../components/crm-ui';
import { formatPercent } from '../pricing/pricing.model';
import local from '../pricing/pricing.module.scss';
import { formatMoney } from '../sales.model';
import salesStyles from '../sales.module.scss';
import styles from './quote-workspace.module.scss';

const quantityText = (value: number | null) => (value === null ? '' : value.toLocaleString('vi-VN', { maximumFractionDigits: 3 }));

export const LINES_LOCKED_TEXT = 'Lưu báo giá để thêm dòng hàng';

/** Thao tác trên một dòng; bảng chỉ báo, màn cha làm. */
export type QuoteLineCommand = 'add' | 'edit' | 'insert' | 'remove' | 'view';

/** Mục của menu chuột phải theo quyền sửa (plan 9.4: không còn Nháp thì chỉ còn mục xem). */
export function lineMenuItems(editable: boolean): QuoteLineCommand[] {
  return editable ? ['add', 'edit', 'insert', 'remove'] : ['view'];
}

const MENU_LABELS: Readonly<Record<QuoteLineCommand, string>> = {
  add: 'Thêm',
  edit: 'Hiệu chỉnh',
  insert: 'Chèn',
  remove: 'Xoá',
  view: 'Xem',
};

const MENU_ICONS: Readonly<Record<QuoteLineCommand, ReactNode>> = {
  add: <Plus size={14} />,
  edit: <Pencil size={14} />,
  insert: <ListPlus size={14} />,
  remove: <Trash2 size={14} />,
  view: <Eye size={14} />,
};

/** Cột chỉ hiện với người được xem giá vốn (`crm.quote.cost.read`); không có quyền thì API trả 0, không phải số thật. */
const COST_COLUMN_KEYS: ReadonlySet<string> = new Set(['cost', 'margin']);

/** Cột bảng dòng hàng (giữ nguyên cột của màn báo giá phase 2; giá vốn, biên chỉ ở cột trái, không vào xem trước). */
function lineColumns(
  editable: boolean,
  costHidden: boolean,
  onEdit: (line: QuoteLine) => void,
  onRemove: (line: QuoteLine) => void,
): ColumnsType<QuoteLine> {
  const columns: ColumnsType<QuoteLine> = [
    // Đủ chỗ cho số dòng 3 chữ số (báo giá dài tới 200 dòng) mà không xuống dòng.
    { title: '#', dataIndex: 'lineNo', width: 56, align: 'right', onCell: () => ({ style: { whiteSpace: 'nowrap' } }) },
    {
      title: 'Mặt hàng',
      key: 'material',
      width: 240,
      render: (_: unknown, row) => (
        <span>
          <span className={salesStyles.mono}>{row.materialCode}</span> {row.materialName}
          {row.materialKind === 'SERVICE' ? (
            <>
              {' '}
              <StatusPill tone="neutral">Dịch vụ</StatusPill>
            </>
          ) : null}
        </span>
      ),
    },
    { title: 'SL', key: 'quantity', width: 100, align: 'right', render: (_: unknown, row) => `${quantityText(row.quantity)} ${row.unit}` },
    {
      title: 'Tồn khả dụng',
      key: 'stock',
      width: 110,
      align: 'right',
      render: (_: unknown, row) =>
        row.materialKind === 'SERVICE' ? (
          <span className={salesStyles.muted}>Không quản lý</span>
        ) : row.availableStock === null ? (
          <span className={salesStyles.muted}>Không rõ</span>
        ) : (
          <span className={row.availableStock < row.quantity ? salesStyles.overdue : undefined}>{quantityText(row.availableStock)}</span>
        ),
    },
    { title: 'Đơn giá gốc', dataIndex: 'listPrice', width: 120, align: 'right', render: (value: number) => formatMoney(value) },
    {
      title: 'Nguồn giá',
      key: 'source',
      width: 150,
      render: (_: unknown, row) => `${PRICE_SOURCE_LABELS[row.priceSource]}${row.priceReferenceCode ? ` ${row.priceReferenceCode}` : ''}`,
    },
    {
      title: 'Chính sách đã áp',
      key: 'policies',
      width: 200,
      render: (_: unknown, row) =>
        row.appliedPolicies.length ? (
          row.appliedPolicies.map((policy) => (
            <span key={policy.policyId} className={local.policyTag}>
              {policy.code}: {formatPercent(policy.percent)}
            </span>
          ))
        ) : (
          <span className={salesStyles.muted}>Không có</span>
        ),
    },
    {
      title: 'Chiết khấu',
      key: 'discount',
      width: 150,
      align: 'right',
      render: (_: unknown, row) => (
        <span className={salesStyles.cellWithPill}>
          {formatPercent(row.discountPercent)}
          {row.cappedAt !== null ? <StatusPill tone="warning">Chạm trần</StatusPill> : null}
          {row.overridden ? <StatusPill tone="warning">Ghi đè</StatusPill> : null}
        </span>
      ),
    },
    { title: 'Đơn giá sau CK', dataIndex: 'unitPrice', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
    { title: 'Thành tiền', dataIndex: 'lineAmount', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
    { title: 'VAT', key: 'vat', width: 120, align: 'right', render: (_: unknown, row) => `${formatMoney(row.vatAmount)} (${formatPercent(row.vatRate)})` },
    {
      title: 'Giá vốn ước tính',
      key: 'cost',
      width: 140,
      align: 'right',
      render: (_: unknown, row) =>
        row.estUnitCost === null && row.materialKind !== 'SERVICE' ? <span className={salesStyles.muted}>Chưa có</span> : formatMoney(row.estCost),
    },
    { title: 'Biên', key: 'margin', dataIndex: 'margin', width: 90, align: 'right', render: (value: number | null) => (value === null ? '' : formatPercent(value)) },
    {
      title: '',
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_: unknown, row) =>
        editable ? (
          <span className={salesStyles.rowActions}>
            <button type="button" className={salesStyles.rowAction} onClick={() => onEdit(row)}>
              Sửa
            </button>
            <button type="button" className={salesStyles.rowActionDanger} onClick={() => onRemove(row)}>
              Bỏ
            </button>
          </span>
        ) : null,
    },
  ];
  return costHidden ? columns.filter((column) => !COST_COLUMN_KEYS.has(String(column.key))) : columns;
}

interface MenuState {
  readonly line: QuoteLine;
  readonly x: number;
  readonly y: number;
}

/** Menu chuột phải: portal vào `body`, đóng bằng Esc hoặc bấm ra ngoài; mũi tên lên xuống đổi mục. */
function LineContextMenu({
  menu,
  items,
  onPick,
  onClose,
}: {
  menu: MenuState;
  items: readonly QuoteLineCommand[];
  onPick: (command: QuoteLineCommand) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLUListElement | null>(null);
  // Màn cha dựng lại (xem trước cập nhật) không được gắn lại sự kiện hay kéo focus về mục đầu.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = () => closeRef.current();
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, []);

  const moveFocus = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return createPortal(
    <ul
      ref={ref}
      role="menu"
      aria-label={`Dòng ${menu.line.lineNo}`}
      className={styles.contextMenu}
      style={{ left: menu.x, top: menu.y }}
      onKeyDown={moveFocus}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((command) => (
        <li key={command} role="none">
          <button
            type="button"
            role="menuitem"
            className={command === 'remove' ? `${styles.contextItem} ${styles.contextItemDanger}` : styles.contextItem}
            onClick={() => onPick(command)}
          >
            {MENU_ICONS[command]} {MENU_LABELS[command]}
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}

export function QuoteLinesTable({
  title,
  lines,
  editable,
  busy = false,
  lockedText,
  emptyText,
  costHidden = false,
  discount,
  onAdd,
  onInsert,
  onEdit,
  onView,
  onRemove,
  note,
  children,
}: {
  title: string;
  lines: readonly QuoteLine[];
  /** Báo giá còn Nháp và người xem được sửa. */
  editable: boolean;
  busy?: boolean;
  /** Báo giá chưa có bản ghi (màn lập mới): khoá bảng kèm câu này; nút + vẫn bấm được. */
  lockedText?: string;
  emptyText?: string;
  /** Người xem không có quyền xem giá vốn (`version.costHidden`): ẩn cột giá vốn, biên. */
  costHidden?: boolean;
  /** Nút Chiết khấu tổng đơn; chỉ có khi sửa được. `enabled` theo chế độ chiết khấu của mẫu. */
  discount?: { readonly enabled: boolean; readonly hint: string; readonly onOpen: () => void };
  /** Mở chọn mặt hàng, thêm cuối; `search` là chữ tìm sẵn (menu, nút + gửi chuỗi rỗng). */
  onAdd: (search: string) => void;
  /** Mở chọn mặt hàng, chèn ngay trên dòng này (`beforeLineNo`). */
  onInsert: (line: QuoteLine) => void;
  onEdit: (line: QuoteLine) => void;
  /** Mở dòng chỉ đọc (báo giá không còn Nháp). */
  onView: (line: QuoteLine) => void;
  /** Đã hỏi xác nhận xong; màn cha gọi API bỏ dòng. */
  onRemove: (line: QuoteLine) => Promise<unknown> | void;
  /** Dòng ghi chú ngay dưới tiêu đề, trên bảng (ví dụ cách tính chiết khấu, thuế của mẫu). */
  note?: ReactNode;
  /** Phần dưới bảng (tổng tiền). */
  children?: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [menu, setMenu] = useState<MenuState>();
  const [removing, setRemoving] = useState<QuoteLine>();
  const [removeBusy, setRemoveBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canAdd = editable || Boolean(lockedText);

  const focusRow = (id: string) =>
    Array.from(wrapRef.current?.querySelectorAll<HTMLElement>('tr[data-row-key]') ?? [])
      .find((row) => row.dataset.rowKey === id)
      ?.focus();
  const closeMenu = () => {
    const line = menu?.line;
    setMenu(undefined);
    if (line) focusRow(line.id);
  };
  // Tìm mặt hàng nằm trong hộp chọn mở bằng nút +.
  const add = () => {
    if (!canAdd || busy) return;
    onAdd('');
  };
  const open = (line: QuoteLine) => (editable ? onEdit(line) : onView(line));
  const run = (command: QuoteLineCommand, line: QuoteLine) => {
    setMenu(undefined);
    if (command === 'add') onAdd('');
    else if (command === 'insert') onInsert(line);
    else if (command === 'edit') onEdit(line);
    else if (command === 'view') onView(line);
    else setRemoving(line);
  };
  const openMenuAt = (line: QuoteLine, x: number, y: number) => {
    setSelectedId(line.id);
    setMenu({ line, x, y });
  };

  const onRowKey = (event: KeyboardEvent<HTMLElement>, line: QuoteLine, index: number) => {
    if (event.target !== event.currentTarget) return;
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openMenuAt(line, rect.left + 24, rect.top + rect.height);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      open(line);
    } else if (event.key === 'Delete' && editable && !busy) {
      event.preventDefault();
      setRemoving(line);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = lines[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        setSelectedId(next.id);
        focusRow(next.id);
      }
    }
  };

  /** Huỷ hộp xoá: trả focus về hàng để phím (Shift+F10, Delete, mũi tên) dùng tiếp được. */
  const cancelRemove = () => {
    const id = removing?.id;
    setRemoving(undefined);
    if (id) window.setTimeout(() => focusRow(id), 0);
  };

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await onRemove(removing);
      setRemoving(undefined);
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <section className={salesStyles.tableCard} aria-label="Dòng báo giá">
      <div className={styles.linesHead}>
        <h3 className={styles.linesTitle}>{title}</h3>
        {canAdd ? (
          <>
            <button type="button" className={salesStyles.buttonPrimary} aria-label="Thêm dòng hàng" title="Thêm dòng hàng" disabled={busy} onClick={add}>
              <Plus size={14} />
            </button>
          </>
        ) : null}
        {discount && editable ? (
          <button
            type="button"
            className={salesStyles.buttonGhost}
            disabled={busy || !discount.enabled}
            title={discount.hint}
            aria-describedby="quote-discount-hint"
            onClick={discount.onOpen}
          >
            Sửa % chiết khấu
          </button>
        ) : null}
      </div>
      {note}
      {discount && editable && !discount.enabled ? (
        <p id="quote-discount-hint" className={salesStyles.muted}>
          {discount.hint}
        </p>
      ) : null}
      {lockedText ? (
        <p className={styles.locked} role="note">
          {lockedText}
        </p>
      ) : (
        <div ref={wrapRef}>
          <Table<QuoteLine>
            size="small"
            rowKey="id"
            columns={lineColumns(editable, costHidden, onEdit, setRemoving)}
            dataSource={[...lines]}
            pagination={false}
            scroll={{ x: 1900 }}
            rowClassName={(row) => (row.id === selectedId ? styles.rowSelected : '')}
            locale={{ emptyText: emptyText ?? 'Không có dòng nào.' }}
            onRow={(row, index) => ({
              tabIndex: 0,
              'aria-selected': row.id === selectedId,
              'aria-label': `Dòng ${row.lineNo}: ${row.materialCode} ${row.materialName}`,
              onClick: () => setSelectedId(row.id),
              onFocus: () => setSelectedId(row.id),
              onDoubleClick: () => open(row),
              onContextMenu: (event) => {
                event.preventDefault();
                openMenuAt(row, event.clientX, event.clientY);
              },
              onKeyDown: (event) => onRowKey(event, row, index ?? 0),
            })}
          />
        </div>
      )}
      {children}
      {menu ? <LineContextMenu menu={menu} items={lineMenuItems(editable)} onPick={(command) => run(command, menu.line)} onClose={closeMenu} /> : null}
      {removing ? (
        <CrmDialog
          open
          danger
          title={`Xoá dòng ${removing.lineNo}?`}
          subtitle={`${removing.materialCode} ${removing.materialName}`}
          submitLabel="Xoá"
          submitting={removeBusy}
          onClose={cancelRemove}
          onSubmit={() => void confirmRemove()}
        >
          <p className={salesStyles.muted}>Dòng bị xoá khỏi phiên bản này; số thứ tự các dòng sau được đánh lại.</p>
        </CrmDialog>
      ) : null}
    </section>
  );
}
