'use client';

import type { ProjectSummary, WorkItem } from '@enterprise-platform/contracts-workspace';
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Diamond,
  Folder,
  Search,
  Workflow,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { buildWorkItemTree, matchWorkItems } from '../project-tree.model';
import { WORK_ITEM_STATUS_LABELS, isOverdue } from '../workspace-labels';
import styles from '../workspace.module.scss';

/** Node đang chọn: hoặc chính dự án, hoặc một công việc trong dự án. */
export type SelectedNode = { kind: 'project' } | { kind: 'work-item'; id: string };

/** Một mục trong menu chuột phải. */
export interface ContextAction {
  readonly id: string;
  readonly label: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly separatorBefore?: boolean;
}

export interface ProjectTreeProps {
  readonly project: ProjectSummary;
  readonly items: readonly WorkItem[];
  readonly selected: SelectedNode;
  readonly onSelect: (node: SelectedNode) => void;
  /** Trả về các mục menu hợp lệ cho node được bấm chuột phải. */
  readonly actionsFor: (node: SelectedNode) => readonly ContextAction[];
  readonly onAction: (actionId: string, node: SelectedNode) => void;
  /**
   * Số tin chưa đọc theo id node, đã cộng dồn cả nhánh con.
   *
   * Cộng dồn chứ không phải số của riêng node: tin nhắn ở một node sâu vẫn
   * phải nhìn thấy được khi nhánh đang thu gọn.
   */
  readonly unread?: Readonly<Record<string, number>>;
  /**
   * Công việc chạy theo quy trình nhưng chưa mở được hồ sơ bên Quy trình.
   * Hiện badge cảnh báo để người dùng biết phải bấm Thử lại.
   */
  readonly pendingProcedure?: ReadonlySet<string>;
  /**
   * Cây nằm trong danh mục dự án: dòng dự án và ô tìm kiếm do danh mục lo,
   * cây chỉ vẽ phần công việc và nhận từ khoá tìm từ bên ngoài.
   */
  readonly embedded?: boolean;
  readonly searchTerm?: string;
}

const INDENT_REM = 0.95;

export function ProjectTree({
  project,
  items,
  selected,
  onSelect,
  actionsFor,
  onAction,
  unread = {},
  pendingProcedure,
  embedded = false,
  searchTerm = '',
}: ProjectTreeProps) {
  const [ownSearch, setOwnSearch] = useState('');
  const search = embedded ? searchTerm : ownSearch;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; node: SelectedNode }>();

  const visible = useMemo(() => matchWorkItems(items, search), [items, search]);
  // Đang tìm kiếm thì bỏ qua trạng thái thu gọn: người dùng muốn thấy kết quả,
  // không muốn phải bung tay từng nhánh một.
  const rows = useMemo(
    () => buildWorkItemTree(items, visible, search.trim() ? new Set() : collapsed),
    [items, visible, collapsed, search],
  );

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const openMenu = (event: ReactMouseEvent, node: SelectedNode) => {
    event.preventDefault();
    onSelect(node);
    setMenu({ x: event.clientX, y: event.clientY, node });
  };

  return (
    <div className={styles.tree}>
      {embedded ? null : (
        <label className={styles.treeSearch}>
          <Search size={14} aria-hidden />
          <input
            type="search"
            value={ownSearch}
            placeholder="Tìm công việc theo mã hoặc tên"
            onChange={(event) => setOwnSearch(event.target.value)}
          />
        </label>
      )}

      <ul className={styles.treeList}>
        {embedded ? null : (
          <li>
            <button
              type="button"
              className={selected.kind === 'project' ? styles.treeNodeActive : styles.treeNode}
              style={{ paddingLeft: '0.5rem' }}
              onClick={() => onSelect({ kind: 'project' })}
              onContextMenu={(event) => openMenu(event, { kind: 'project' })}
            >
              <Folder size={15} aria-hidden />
              <span className={styles.treeCode}>{project.code}</span>
              <span className={styles.treeTitle}>{project.name}</span>
              <UnreadDot count={unread[project.id]} />
              <span className={styles.treePercent}>{project.progressPercent}%</span>
            </button>
          </li>
        )}

        {rows.map((row) => {
          const node: SelectedNode = { kind: 'work-item', id: row.item.id };
          const active = selected.kind === 'work-item' && selected.id === row.item.id;
          return (
            <li key={row.item.id}>
              <div
                className={styles.treeRow}
                // Cấp 0 của công việc vẫn thụt vào một bậc so với dự án, để
                // quan hệ "việc thuộc dự án" nhìn thấy được ngay.
                style={{ paddingLeft: `${(row.depth + 1) * INDENT_REM + 0.5}rem` }}
              >
                {row.hasChildren ? (
                  <button
                    type="button"
                    className={styles.treeToggle}
                    aria-label={row.expanded ? 'Thu gọn nhánh' : 'Mở nhánh'}
                    aria-expanded={row.expanded}
                    onClick={() => toggle(row.item.id)}
                  >
                    {row.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                ) : (
                  <span className={styles.treeToggleSpacer} aria-hidden />
                )}

                <button
                  type="button"
                  className={active ? styles.treeNodeActive : styles.treeNode}
                  onClick={() => onSelect(node)}
                  onContextMenu={(event) => openMenu(event, node)}
                >
                  {row.item.itemType === 'milestone' ? (
                    <Diamond size={13} aria-hidden />
                  ) : row.item.itemType === 'phase' ? (
                    <Folder size={13} aria-hidden />
                  ) : (
                    <CircleDot size={13} aria-hidden />
                  )}
                  <span className={styles.treeCode}>{row.item.code}</span>
                  <span className={styles.treeTitle}>{row.item.title}</span>
                  {unread[row.item.id] ? (
                    <span
                      className={styles.treeUnread}
                      title={`${unread[row.item.id]} tin chưa đọc`}
                    >
                      {unread[row.item.id]}
                    </span>
                  ) : null}
                  {row.item.executionType === 'procedure' ? (
                    <Workflow size={12} aria-label="Chạy theo quy trình" />
                  ) : null}
                  {pendingProcedure?.has(row.item.id) ? (
                    <span
                      className={styles.treePending}
                      title="Công việc đã tạo nhưng chưa mở được hồ sơ bên Quy trình. Bấm chuột phải để thử lại."
                    >
                      Chưa mở được quy trình
                    </span>
                  ) : null}
                  {isOverdue(row.item) ? (
                    <span className={styles.treeOverdue} title="Quá hạn">
                      Quá hạn
                    </span>
                  ) : null}
                  {/*
                    Cây hiện phần trăm thay cho nhãn trạng thái: nhãn chữ chiếm
                    gần nửa dòng nên tên công việc bị cắt cụt. Trạng thái đầy đủ
                    nằm ở thẻ chi tiết bên phải và ở tab Công việc.
                  */}
                  <span
                    className={styles.treePercent}
                    title={WORK_ITEM_STATUS_LABELS[row.item.status]}
                  >
                    {row.item.progressPercent}%
                  </span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 ? (
        <p className={styles.treeEmpty}>
          {search.trim()
            ? 'Không có công việc nào khớp từ khoá.'
            : 'Dự án chưa có công việc nào. Bấm chuột phải vào tên dự án để thêm.'}
        </p>
      ) : null}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={actionsFor(menu.node)}
          onClose={() => setMenu(undefined)}
          onPick={(actionId) => {
            setMenu(undefined);
            onAction(actionId, menu.node);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Menu chuột phải.
 *
 * Định vị tuyệt đối theo toạ độ con trỏ và kẹp vào trong khung nhìn — mở ở
 * mép dưới màn hình mà không kẹp thì nửa menu nằm ngoài, không bấm tới.
 */
function ContextMenu({
  x,
  y,
  actions,
  onClose,
  onPick,
}: {
  x: number;
  y: number;
  actions: readonly ContextAction[];
  onClose: () => void;
  onPick: (actionId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    setPosition({
      left: Math.min(x, window.innerWidth - box.width - 8),
      top: Math.min(y, window.innerHeight - box.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // `capture` để menu đóng trước khi cú bấm rơi vào phần tử bên dưới.
    document.addEventListener('mousedown', dismiss, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', dismiss, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  if (actions.length === 0) return null;

  return (
    <div
      ref={ref}
      role="menu"
      className={styles.contextMenu}
      style={{ left: position.left, top: position.top }}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          className={[
            styles.contextItem,
            action.danger ? styles.contextItemDanger : '',
            action.separatorBefore ? styles.contextItemSeparated : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onPick(action.id)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Chấm đỏ báo tin chưa đọc.
 *
 * Hiện số khi còn ít, đổi thành `9+` khi nhiều — một con số ba chữ số làm vỡ
 * hàng trên cột cây vốn đã hẹp.
 */
function UnreadDot({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span
      className={styles.unreadDot}
      title={`${count} tin nhắn chưa đọc`}
      aria-label={`${count} tin nhắn chưa đọc`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
