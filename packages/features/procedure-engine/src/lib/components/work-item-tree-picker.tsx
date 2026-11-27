'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { ProjectWorkItemOption } from '../workspace-api';
import styles from './work-item-tree-picker.module.scss';

/** Giá trị của lựa chọn "Gốc dự án" (không có công việc cha). */
export const PROJECT_ROOT_VALUE = '';
const ROOT_LABEL = 'Gốc dự án';

export interface WorkItemTreeNode {
  readonly item: ProjectWorkItemOption;
  readonly children: readonly WorkItemTreeNode[];
  /** Chọn làm cha được: chưa đóng. Công việc đã đóng chỉ hiện khi còn việc con chọn được bên dưới. */
  readonly selectable: boolean;
}

/**
 * Dựng cây WBS từ danh sách phẳng có `parentId`. Thứ tự anh em giữ theo danh sách (Workspace trả theo thứ tự sắp xếp).
 * Công việc có cha không nằm trong danh sách (người dùng không xem được cha) đặt ở gốc. `excludeId` bỏ công việc đó cùng
 * cả nhánh con (vd công việc đang liên kết sẽ bị xoá). Công việc đã đóng không còn việc con chọn được thì bỏ.
 */
export function buildWorkItemTree(
  items: readonly ProjectWorkItemOption[],
  excludeId?: string,
): readonly WorkItemTreeNode[] {
  const ids = new Set(items.map((item) => item.id));
  const childrenOf = new Map<string, ProjectWorkItemOption[]>();
  const roots: ProjectWorkItemOption[] = [];
  for (const item of items) {
    if (item.parentId && ids.has(item.parentId) && item.parentId !== item.id) {
      const list = childrenOf.get(item.parentId) ?? [];
      list.push(item);
      childrenOf.set(item.parentId, list);
    } else {
      roots.push(item);
    }
  }
  const seen = new Set<string>();
  const build = (item: ProjectWorkItemOption): WorkItemTreeNode | undefined => {
    // Dữ liệu vòng (không nên có) không làm treo cây.
    if (item.id === excludeId || seen.has(item.id)) return undefined;
    seen.add(item.id);
    const children = (childrenOf.get(item.id) ?? [])
      .map(build)
      .filter((node): node is WorkItemTreeNode => !!node);
    const selectable = !item.closed;
    if (!selectable && children.length === 0) return undefined;
    return { item, children, selectable };
  };
  return roots.map(build).filter((node): node is WorkItemTreeNode => !!node);
}

/** Chữ thường, bỏ dấu tiếng Việt, để tìm "cap" vẫn ra "Cáp". */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

interface VisibleRow {
  readonly key: string;
  readonly label: string;
  readonly code?: string;
  readonly level: number;
  readonly parentKey?: string;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  readonly selectable: boolean;
  readonly setSize: number;
  readonly posInSet: number;
}

/** Id các công việc tổ tiên của `id` trong cây (từ gốc xuống). */
function ancestorIds(nodes: readonly WorkItemTreeNode[], id: string): string[] {
  const path: string[] = [];
  const walk = (list: readonly WorkItemTreeNode[]): boolean => {
    for (const node of list) {
      if (node.item.id === id) return true;
      path.push(node.item.id);
      if (walk(node.children)) return true;
      path.pop();
    }
    return false;
  };
  return walk(nodes) ? path : [];
}

export interface WorkItemTreePickerProps {
  /** Công việc của dự án (từ `loadProjectWorkItems`). */
  readonly items: readonly ProjectWorkItemOption[];
  /** Công việc cha đang chọn; chuỗi rỗng là "Gốc dự án". */
  readonly value: string;
  readonly onChange: (workItemId: string) => void;
  /** Nhãn cho trình đọc màn hình (thường trùng nhãn ô). */
  readonly label: string;
  readonly disabled?: boolean;
  /** Đang tải công việc của dự án. */
  readonly loading?: boolean;
  /** Ẩn công việc này và nhánh con của nó (không làm cha được). */
  readonly excludeId?: string;
  /** Dòng hiện khi bị tắt, vd "Chọn dự án trước". */
  readonly disabledText?: string;
}

/**
 * Ô chọn "Công việc cha" dạng cây WBS của dự án: mã + tên, mở / thu nhánh, ô tìm giữ lại các nhánh cha của kết quả,
 * "Gốc dự án" luôn đứng đầu, lựa chọn hiện tại được tô. Bàn phím theo mẫu tree của WAI-ARIA: lên / xuống đi giữa các
 * dòng, phải mở nhánh / xuống con, trái thu nhánh / lên cha, Home / End, Enter hoặc Space để chọn.
 */
export function WorkItemTreePicker({
  items,
  value,
  onChange,
  label,
  disabled,
  loading,
  excludeId,
  disabledText,
}: WorkItemTreePickerProps) {
  const baseId = useId();
  const tree = useMemo(
    () => buildWorkItemTree(items, excludeId),
    [items, excludeId],
  );
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [focusedKey, setFocusedKey] = useState<string>(value);
  const [pendingFocus, setPendingFocus] = useState<string>();
  const rowRefs = useRef(new Map<string, HTMLElement>());
  // Ô chọn thả xuống: bình thường chỉ hiện lựa chọn hiện tại (mặc định "Gốc dự án"); bấm mới mở cây để tìm và chọn.
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (focusTrigger: boolean) => {
    setOpen(false);
    setQuery('');
    if (focusTrigger) triggerRef.current?.focus();
  };

  // Mở sẵn các nhánh chứa lựa chọn hiện tại để thấy ngay nó nằm đâu.
  useEffect(() => {
    if (!value) return;
    const path = ancestorIds(tree, value);
    if (path.length === 0) return;
    setExpanded((current) =>
      path.every((id) => current.has(id))
        ? current
        : new Set([...current, ...path]),
    );
  }, [tree, value]);

  const folded = fold(query.trim());
  /** Khi tìm: công việc khớp cùng mọi tổ tiên của nó; `undefined` là không lọc. */
  const searchVisible = useMemo(() => {
    if (!folded) return undefined;
    const visible = new Set<string>();
    const walk = (
      list: readonly WorkItemTreeNode[],
      path: readonly string[],
    ) => {
      for (const node of list) {
        if (fold(`${node.item.code} ${node.item.title}`).includes(folded)) {
          visible.add(node.item.id);
          for (const id of path) visible.add(id);
        }
        walk(node.children, [...path, node.item.id]);
      }
    };
    walk(tree, []);
    return visible;
  }, [tree, folded]);

  const rows = useMemo(() => {
    const list: VisibleRow[] = [];
    const rootMatches = !folded || fold(ROOT_LABEL).includes(folded);
    const top = tree.filter(
      (node) => !searchVisible || searchVisible.has(node.item.id),
    );
    if (rootMatches) {
      list.push({
        key: PROJECT_ROOT_VALUE,
        label: ROOT_LABEL,
        level: 1,
        hasChildren: false,
        expanded: false,
        selectable: true,
        setSize: top.length + 1,
        posInSet: 1,
      });
    }
    const walk = (
      nodes: readonly WorkItemTreeNode[],
      level: number,
      parentKey: string | undefined,
      offset: number,
    ) => {
      const shown = nodes.filter(
        (node) => !searchVisible || searchVisible.has(node.item.id),
      );
      shown.forEach((node, index) => {
        const children = node.children.filter(
          (child) => !searchVisible || searchVisible.has(child.item.id),
        );
        // Đang tìm thì mở mọi nhánh còn kết quả; không tìm thì theo người dùng mở / thu.
        const isOpen =
          children.length > 0 &&
          (searchVisible ? true : expanded.has(node.item.id));
        list.push({
          key: node.item.id,
          code: node.item.code,
          label: node.item.title,
          level,
          parentKey,
          hasChildren: children.length > 0,
          expanded: isOpen,
          selectable: node.selectable,
          setSize: shown.length + offset,
          posInSet: index + 1 + offset,
        });
        if (isOpen) walk(node.children, level + 1, node.item.id, 0);
      });
    };
    // "Gốc dự án" đứng cùng cấp với các công việc gốc.
    walk(tree, 1, undefined, rootMatches ? 1 : 0);
    return list;
  }, [tree, searchVisible, expanded, folded]);

  // Dòng đang giữ tiêu điểm biến mất (thu nhánh, lọc) thì chuyển về dòng đầu.
  const activeKey = rows.some((row) => row.key === focusedKey)
    ? focusedKey
    : rows[0]?.key;

  useEffect(() => {
    if (pendingFocus === undefined) return;
    const element = rowRefs.current.get(pendingFocus);
    if (element) {
      element.focus();
      setPendingFocus(undefined);
    }
  }, [pendingFocus, rows]);

  const moveTo = (key: string | undefined) => {
    if (key === undefined) return;
    setFocusedKey(key);
    setPendingFocus(key);
  };
  const toggle = (key: string, open?: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });
  const choose = (row: VisibleRow) => {
    if (disabled || !row.selectable) return;
    setFocusedKey(row.key);
    onChange(row.key);
    close(true);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, row: VisibleRow) => {
    const index = rows.findIndex((candidate) => candidate.key === row.key);
    switch (event.key) {
      case 'ArrowDown':
        moveTo(rows[index + 1]?.key);
        break;
      case 'ArrowUp':
        moveTo(rows[index - 1]?.key);
        break;
      case 'Home':
        moveTo(rows[0]?.key);
        break;
      case 'End':
        moveTo(rows[rows.length - 1]?.key);
        break;
      case 'ArrowRight':
        if (row.hasChildren && !row.expanded) toggle(row.key, true);
        else if (row.hasChildren) moveTo(rows[index + 1]?.key);
        else return;
        break;
      case 'ArrowLeft':
        if (row.hasChildren && row.expanded && !searchVisible)
          toggle(row.key, false);
        else if (row.parentKey !== undefined) moveTo(row.parentKey);
        else return;
        break;
      case 'Enter':
      case ' ':
        choose(row);
        break;
      case 'Escape':
        close(true);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const selected = value ? items.find((item) => item.id === value) : undefined;
  const searchId = `${baseId}-search`;

  if (disabled) {
    return (
      <div className={styles.picker} aria-disabled="true">
        <p className={styles.note}>
          {disabledText ?? 'Chưa chọn được công việc cha.'}
        </p>
      </div>
    );
  }

  const selectedText = selected ? `${selected.code} · ${selected.title}` : ROOT_LABEL;

  return (
    <div className={styles.picker} ref={boxRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="tree"
        aria-expanded={open}
        aria-label={`${label}: ${selectedText}`}
        title={selectedText}
        disabled={loading}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={selected ? styles.triggerText : `${styles.triggerText} ${styles.rootLabel}`}>
          {loading ? 'Đang tải công việc của dự án…' : selectedText}
        </span>
        <ChevronDown size={15} aria-hidden="true" className={styles.triggerIcon} />
      </button>
      {open && !loading ? (
        <div className={styles.panel}>
          <div className={styles.toolbar}>
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              className={styles.search}
              placeholder="Tìm mã hoặc tên công việc…"
              aria-label={`Tìm trong ${label.toLowerCase()}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveTo(activeKey);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  close(true);
                }
              }}
            />
          </div>
          <div className={styles.tree} role="tree" aria-label={label}>
            {rows.map((row) => {
              const isSelected = row.key === value;
              return (
                <div
                  key={row.key || 'root'}
                  ref={(element) => {
                    if (element) rowRefs.current.set(row.key, element);
                    else rowRefs.current.delete(row.key);
                  }}
                  role="treeitem"
                  aria-label={
                    row.code
                      ? `${row.code} · ${row.label}${row.selectable ? '' : ' (đã đóng)'}`
                      : row.label
                  }
                  aria-level={row.level}
                  aria-setsize={row.setSize}
                  aria-posinset={row.posInSet}
                  aria-selected={isSelected}
                  aria-expanded={row.hasChildren ? row.expanded : undefined}
                  aria-disabled={row.selectable ? undefined : true}
                  tabIndex={row.key === activeKey ? 0 : -1}
                  className={[
                    styles.row,
                    isSelected ? styles.rowSelected : '',
                    row.selectable ? '' : styles.rowClosed,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ paddingLeft: 8 + (row.level - 1) * 18 }}
                  onClick={() => choose(row)}
                  onFocus={() => setFocusedKey(row.key)}
                  onKeyDown={(event) => onRowKeyDown(event, row)}
                >
                  {row.hasChildren ? (
                    <span
                      className={styles.toggle}
                      aria-hidden="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!searchVisible) toggle(row.key);
                        setFocusedKey(row.key);
                      }}
                    >
                      {row.expanded ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </span>
                  ) : (
                    <span className={styles.toggleSpacer} aria-hidden="true" />
                  )}
                  {row.code ? (
                    <span className={styles.code}>{row.code}</span>
                  ) : null}
                  <span className={row.code ? styles.title : styles.rootLabel}>
                    {row.label}
                  </span>
                  {row.selectable ? null : (
                    <span className={styles.closedTag}>đã đóng</span>
                  )}
                </div>
              );
            })}
          </div>
          {rows.length === 0 ? (
            <p className={styles.note} role="status">
              Không có công việc khớp “{query.trim()}”.
            </p>
          ) : null}
          {!folded && tree.length === 0 ? (
            <p className={styles.note}>Dự án chưa có công việc nào.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
