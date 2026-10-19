'use client';

import {
  formatBytes,
  type SharedCapabilities,
  type SharedFolder,
  type SharedTrashItem,
} from '@enterprise-platform/contracts-shared';
import { toast } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildMenu, rightsOf, type MenuActionId, type MenuEntry } from '../context-menu.model';
import { fileBadge, formatDateTime } from '../library.model';
import * as api from '../shared-api';
import styles from '../shared.module.scss';
import { ConfirmDialog, type ConfirmRequest } from './confirm-dialog';
import {
  anchorFromElement,
  anchorFromMouse,
  ContextMenu,
  isMenuKey,
  type MenuAnchor,
} from './context-menu';
import { MoveDialog, type MoveTarget } from './move-dialog';

const keyOf = (item: Pick<SharedTrashItem, 'kind' | 'id'>) => `${item.kind}:${item.id}`;

/** "3 thư mục con · 12 tài liệu" cho một thư mục trong Thùng rác; tài liệu thì để trống. */
function contentsOf(item: SharedTrashItem): string {
  if (item.kind !== 'folder') return '';
  return [
    item.folderCount ? `${item.folderCount.toLocaleString('vi-VN')} thư mục con` : '',
    `${item.documentCount.toLocaleString('vi-VN')} tài liệu`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface TrashPanelProps {
  readonly folders: readonly SharedFolder[];
  readonly capabilities: SharedCapabilities;
  /** Thư mục khôi phục vào được (quyền xoá ở đó), khi chỗ cũ không còn. */
  readonly restorable: (folder: SharedFolder) => boolean;
  /** Ô tìm trên thanh công cụ của kho. */
  readonly query: string;
  /** Gọi khi Thùng rác đổi: khôi phục đưa thư mục về cây, xoá vĩnh viễn trả dung lượng cho kho. */
  readonly onChanged: () => void;
}

/** Thùng rác của kho: tài liệu và thư mục đã xoá, khôi phục hay xoá vĩnh viễn. */
export function TrashPanel({ folders, capabilities, restorable, query, onChanged }: TrashPanelProps) {
  const [items, setItems] = useState<SharedTrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [menu, setMenu] = useState<{ id: number; anchor: MenuAnchor; entries: MenuEntry[]; item: SharedTrashItem }>();
  const [confirm, setConfirm] = useState<ConfirmRequest>();
  const [moveTarget, setMoveTarget] = useState<MoveTarget>();
  const menuId = useRef(0);

  const { purge } = rightsOf(capabilities);

  const reload = useCallback(async () => {
    try {
      const next = await api.listTrash();
      setItems(next);
      setError(undefined);
      // Mục đang chọn đã đi (khôi phục, xoá hẳn) thì bỏ chọn.
      setSelected((current) => (next.some((item) => keyOf(item) === current) ? current : undefined));
    } catch (cause) {
      setError(api.errorMessage(cause, 'Không tải được Thùng rác.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => [item.name, item.location, item.docNumber].some((text) => text?.toLowerCase().includes(needle)));
  }, [items, query]);

  const selectedItem = items.find((item) => keyOf(item) === selected);
  const totals = useMemo(
    () => ({
      folders: shown.filter((item) => item.kind === 'folder').length,
      documents: shown.filter((item) => item.kind === 'document').length,
      bytes: shown.reduce((sum, item) => sum + item.totalBytes, 0),
    }),
    [shown],
  );

  const changed = async () => {
    await reload();
    onChanged();
  };

  const restore = async (item: SharedTrashItem) => {
    // Chỗ cũ không còn thì hỏi chỗ khác ngay, khỏi chờ server từ chối.
    if (!item.locationAvailable) {
      setMoveTarget({ kind: 'restore', item });
      return;
    }
    try {
      const result = await api.restoreFromTrash(item);
      toast.success(result.name === item.name ? `Đã khôi phục “${item.name}”.` : `Đã khôi phục thành “${result.name}”.`);
      await changed();
    } catch (cause) {
      if ((cause as api.SharedApiError | undefined)?.code === 'FOLDER_UNAVAILABLE') {
        setMoveTarget({ kind: 'restore', item });
      } else {
        toast.error(api.errorMessage(cause, 'Không khôi phục được.'));
      }
    }
  };

  const askPurge = (item: SharedTrashItem) =>
    setConfirm({
      title: 'Xoá vĩnh viễn',
      message: `Xoá vĩnh viễn “${item.name}”? Không thể khôi phục.`,
      detail: [contentsOf(item), formatBytes(item.totalBytes)].filter(Boolean).join(' · '),
      confirmLabel: 'Xoá vĩnh viễn',
      pendingLabel: 'Đang xoá…',
      danger: true,
      onConfirm: async () => {
        await api.purgeFromTrash(item);
        toast.success('Đã xoá vĩnh viễn.');
        await changed();
      },
    });

  const askEmpty = () =>
    setConfirm({
      title: 'Dọn Thùng rác',
      message: `Xoá vĩnh viễn ${items.length.toLocaleString('vi-VN')} mục trong Thùng rác? Không thể khôi phục.`,
      detail: formatBytes(items.reduce((sum, item) => sum + item.totalBytes, 0)),
      confirmLabel: 'Dọn Thùng rác',
      pendingLabel: 'Đang xoá…',
      danger: true,
      onConfirm: async () => {
        const result = await api.emptyTrash();
        toast.success(`Đã xoá vĩnh viễn ${result.purged.toLocaleString('vi-VN')} mục.`);
        if (result.failed) toast.warning(`${result.failed.toLocaleString('vi-VN')} mục chưa xoá được.`);
        await changed();
      },
    });

  const openMenu = (item: SharedTrashItem, anchor: MenuAnchor) => {
    setSelected(keyOf(item));
    const entries = buildMenu(
      { kind: 'trash', item },
      { capabilities, currentUserId: '', flat: false, roleOf: () => undefined, canUploadSomewhere: false },
    );
    if (!entries.some((entry) => entry.kind === 'item')) return;
    menuId.current += 1;
    setMenu({ id: menuId.current, anchor, entries, item });
  };

  const pick = (id: MenuActionId, item: SharedTrashItem) => {
    setMenu(undefined);
    if (id === 'restore') void restore(item);
    else if (id === 'restore-to') setMoveTarget({ kind: 'restore', item });
    else if (id === 'purge') askPurge(item);
  };

  return (
    <section className={`${styles.panel} ${styles.contents}`} aria-label="Thùng rác">
      <div className={styles.panelHead}>
        <h2>Thùng rác</h2>
        <button
          type="button"
          className={styles.buttonSmall}
          disabled={!selectedItem}
          onClick={() => selectedItem && void restore(selectedItem)}
        >
          Khôi phục
        </button>
        {purge ? (
          <>
            <button
              type="button"
              className={styles.buttonSmall}
              disabled={!selectedItem}
              onClick={() => selectedItem && askPurge(selectedItem)}
            >
              Xoá vĩnh viễn
            </button>
            <button type="button" className={styles.buttonSmall} disabled={items.length === 0} onClick={askEmpty}>
              Dọn Thùng rác
            </button>
          </>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      <div className={styles.tableScroll}>
        <div className={styles.table} role="table">
          <div className={`${styles.tableHead} ${styles.trashGrid}`} role="row">
            <span aria-hidden />
            <span>Tên · Vị trí cũ</span>
            <span>Loại</span>
            <span>Dung lượng</span>
            <span>Ngày xoá</span>
            <span>Người xoá</span>
          </div>
          {shown.length === 0 ? (
            <div className={styles.empty}>{loading ? 'Đang tải…' : 'Thùng rác trống.'}</div>
          ) : (
            shown.map((item) => {
              const badge = item.kind === 'folder' ? 'TM' : fileBadge(item.contentType, item.fileName);
              const location = item.location || 'Gốc kho';
              const sub = [location, contentsOf(item)].filter(Boolean).join(' · ');
              return (
                <button
                  key={keyOf(item)}
                  type="button"
                  role="row"
                  aria-current={selected === keyOf(item) ? 'true' : 'false'}
                  className={`${styles.tableRow} ${styles.trashGrid}`}
                  onClick={() => setSelected(keyOf(item))}
                  onDoubleClick={() => void restore(item)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openMenu(item, anchorFromMouse(event));
                  }}
                  onKeyDown={(event) => {
                    if (!isMenuKey(event)) return;
                    event.preventDefault();
                    openMenu(item, anchorFromElement(event.currentTarget));
                  }}
                >
                  <span className={styles.fileIcon} data-kind={badge} aria-hidden>
                    {badge}
                  </span>
                  <span className={styles.cellName}>
                    <strong title={item.name}>{item.name}</strong>
                    <small
                      title={item.locationAvailable ? sub : `${sub} — thư mục này không còn dùng được`}
                      data-gone={!item.locationAvailable}
                    >
                      {sub}
                    </small>
                  </span>
                  <span className={styles.cellDate}>{item.kind === 'folder' ? 'Thư mục' : 'Tài liệu'}</span>
                  <span className={styles.cellCount}>{formatBytes(item.totalBytes)}</span>
                  <span className={styles.cellDate}>{formatDateTime(item.deletedAt)}</span>
                  <span className={styles.cellDate} title={item.deletedByName}>
                    {item.deletedByName ?? '—'}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
      <div className={styles.tableFoot}>
        <span>
          {[
            totals.folders ? `${totals.folders.toLocaleString('vi-VN')} thư mục` : '',
            `${totals.documents.toLocaleString('vi-VN')} tài liệu`,
            formatBytes(totals.bytes),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      {menu ? (
        <ContextMenu
          key={menu.id}
          anchor={menu.anchor}
          entries={menu.entries}
          label={`Thao tác với ${menu.item.name}`}
          onClose={() => setMenu(undefined)}
          onPick={(id) => pick(id, menu.item)}
        />
      ) : null}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(undefined)} />
      <MoveDialog
        target={moveTarget}
        folders={folders}
        canManage={capabilities.canManage}
        allowed={restorable}
        onClose={() => setMoveTarget(undefined)}
        onDone={(restored) => {
          if (restored) toast.success(`Đã khôi phục “${restored.name}”.`);
          void changed();
        }}
      />
    </section>
  );
}
