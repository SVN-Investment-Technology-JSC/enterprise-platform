'use client';

import {
  formatBytes,
  SHARED_NAS_ACCESS_LABELS,
  SHARED_NAS_RULE_LABELS,
  type SharedNasEntry,
  type SharedNasListing,
  type SharedNasOverview,
  type SharedNasPermission,
  type SharedNasShare,
} from '@enterprise-platform/contracts-shared';
import { Popconfirm, toast } from '@enterprise-platform/shared-ui';
import { Download, File, Folder, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '../shared-api';
import styles from '../shared.module.scss';
import { Dialog, Field } from './dialog';

const PREVIEWABLE = /\.(pdf|jpe?g|png|gif|webp)$/i;

type NameDialog = { readonly kind: 'folder' } | { readonly kind: 'rename'; readonly entry: SharedNasEntry };

/**
 * Kho NAS: các thư mục chia sẻ của NAS công ty hiện thẳng trong ERP, đọc ghi trực tiếp
 * trên NAS (không sao chép). Chỉ thấy thư mục mà tài khoản NAS ghép với mình được vào;
 * quyền Đọc/Ghi hay Chỉ đọc theo đúng NAS.
 */
export function NasView({ canManage }: { readonly canManage: boolean }) {
  const [overview, setOverview] = useState<SharedNasOverview>();
  const [error, setError] = useState<string>();
  const [share, setShare] = useState<SharedNasShare>();
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<SharedNasListing>();
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string>();
  const [uploading, setUploading] = useState<string>();
  const [dialog, setDialog] = useState<NameDialog>();
  const [dialogName, setDialogName] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string>();
  const [preview, setPreview] = useState<{ title: string; url: string; image: boolean }>();
  const [permissions, setPermissions] = useState<readonly SharedNasPermission[]>();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .loadNasOverview()
      .then((next) => {
        setOverview(next);
        setShare((current) => current ?? next.shares[0]);
      })
      .catch((cause) => setError(api.errorMessage(cause, 'Không tải được Kho NAS.')));
  }, []);

  const load = useCallback(
    async (target: SharedNasShare, folder: string, append = false) => {
      setLoading(true);
      setListError(undefined);
      try {
        const next = await api.listNasEntries(target.name, folder, append ? (listing?.entries.length ?? 0) : 0);
        setListing((current) => (append && current ? { ...next, entries: [...current.entries, ...next.entries] } : next));
      } catch (cause) {
        setListError(api.errorMessage(cause, 'Không đọc được thư mục trên NAS.'));
        if (!append) setListing(undefined);
      } finally {
        setLoading(false);
      }
    },
    [listing?.entries.length],
  );

  useEffect(() => {
    if (share) void load(share, path);
    setPermissions(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share, path]);

  if (error) return <p className={styles.alert}>{error}</p>;
  if (!overview) return <p className={styles.muted}>Đang tải…</p>;
  if (!overview.enabled) return <p className={styles.notice}>Kho NAS chưa được bật.</p>;
  if (!overview.account) {
    return (
      <p className={styles.notice}>
        Tài khoản ERP của bạn chưa được ghép với tài khoản NAS nên chưa xem được Kho NAS. Nhờ quản trị ghép trong Dung
        lượng → Kết nối NAS.
      </p>
    );
  }
  if (overview.shares.length === 0) {
    return <p className={styles.notice}>Tài khoản NAS {overview.account} chưa được cấp quyền thư mục chia sẻ nào được ánh xạ.</p>;
  }

  const canWrite = Boolean(listing?.canWrite);
  const segments = path ? path.split('/') : [];
  const entries = [...(listing?.entries ?? [])].sort((left, right) => Number(right.isDir) - Number(left.isDir));

  const refresh = () => share && void load(share, path);

  const upload = async (files: FileList | null) => {
    if (!share || !files || files.length === 0) return;
    const list = [...files];
    let failed = 0;
    for (const [index, file] of list.entries()) {
      setUploading(`Đang tải lên ${index + 1}/${list.length}: ${file.name}`);
      try {
        await api.uploadToNas(share.name, path, file);
      } catch (cause) {
        failed += 1;
        toast.error(api.errorMessage(cause, `Không tải lên được ${file.name}.`));
      }
    }
    setUploading(undefined);
    if (fileInput.current) fileInput.current.value = '';
    if (failed < list.length) toast.success(`Đã tải lên ${list.length - failed} tệp vào NAS.`);
    refresh();
  };

  const openEntry = async (entry: SharedNasEntry) => {
    if (!share) return;
    if (entry.isDir) {
      setPath(entry.path);
      return;
    }
    try {
      if (PREVIEWABLE.test(entry.name)) {
        const ticket = await api.nasDownloadTicket(share.name, entry.path, 'preview');
        setPreview({ title: entry.name, url: ticket.downloadUrl, image: ticket.contentType.startsWith('image/') });
      } else {
        await api.openNasFile(share.name, entry.path);
      }
    } catch (cause) {
      toast.error(api.errorMessage(cause, 'Không mở được tệp.'));
    }
  };

  const download = async (entry: SharedNasEntry) => {
    if (!share) return;
    try {
      await api.openNasFile(share.name, entry.path);
    } catch (cause) {
      toast.error(api.errorMessage(cause, 'Không tải được tệp.'));
    }
  };

  const remove = async (entry: SharedNasEntry) => {
    if (!share) return;
    try {
      await api.deleteNasEntry(share.name, entry.path);
      toast.success(`Đã xoá ${entry.name}.`);
      refresh();
    } catch (cause) {
      toast.error(api.errorMessage(cause, 'Không xoá được.'));
    }
  };

  const openDialog = (next: NameDialog) => {
    setDialog(next);
    setDialogName(next.kind === 'rename' ? next.entry.name : '');
    setDialogError(undefined);
  };

  const submitDialog = async () => {
    if (!share || !dialog) return;
    setDialogBusy(true);
    setDialogError(undefined);
    try {
      if (dialog.kind === 'folder') await api.createNasFolder(share.name, path, dialogName);
      else await api.renameNasEntry(share.name, dialog.entry.path, dialogName);
      setDialog(undefined);
      refresh();
    } catch (cause) {
      setDialogError(api.errorMessage(cause, 'Không lưu được.'));
    } finally {
      setDialogBusy(false);
    }
  };

  const togglePermissions = async () => {
    if (!share) return;
    if (permissions) {
      setPermissions(undefined);
      return;
    }
    try {
      setPermissions(await api.loadNasPermissions(share.name));
    } catch (cause) {
      toast.error(api.errorMessage(cause, 'Không tải được bảng quyền.'));
    }
  };

  return (
    <div className={styles.nasView}>
      <aside className={`${styles.panel} ${styles.nasShares}`} aria-label="Thư mục chia sẻ">
        <div className={styles.sectionTitle}>
          <h3>{overview.label}</h3>
        </div>
        {overview.shares.map((item) => (
          <button
            key={item.name}
            type="button"
            className={styles.nasShare}
            data-active={item.name === share?.name}
            onClick={() => {
              setShare(item);
              setPath('');
            }}
          >
            <Folder size={15} />
            <span>{item.label}</span>
            <span className={`${styles.badge} ${item.access === 'write' ? styles.badgeSuccess : styles.badgeInfo}`}>
              {SHARED_NAS_ACCESS_LABELS[item.access]}
            </span>
          </button>
        ))}
        <p className={styles.muted}>Tài khoản NAS: {overview.account}</p>
      </aside>

      <section className={`${styles.panel} ${styles.nasMain}`} aria-label="Nội dung thư mục">
        <div className={styles.nasToolbar}>
          <nav className={styles.nasCrumbs} aria-label="Đường dẫn">
            <button type="button" onClick={() => setPath('')}>
              {share?.label}
            </button>
            {segments.map((segment, index) => (
              <span key={`${index}-${segment}`}>
                <span aria-hidden="true">›</span>
                <button type="button" onClick={() => setPath(segments.slice(0, index + 1).join('/'))}>
                  {segment}
                </button>
              </span>
            ))}
          </nav>
          <div className={styles.storageActions}>
            {canManage ? (
              <button type="button" className={styles.buttonGhost} onClick={() => void togglePermissions()}>
                {permissions ? 'Ẩn bảng quyền' : 'Bảng quyền'}
              </button>
            ) : null}
            <button type="button" className={styles.buttonGhost} disabled={loading} onClick={refresh}>
              Làm mới
            </button>
            {canWrite ? (
              <>
                <button type="button" className={styles.buttonGhost} onClick={() => openDialog({ kind: 'folder' })}>
                  Thư mục mới
                </button>
                <button
                  type="button"
                  className={styles.buttonPrimary}
                  disabled={Boolean(uploading)}
                  onClick={() => fileInput.current?.click()}
                >
                  Tải lên
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  aria-label="Chọn tệp tải lên NAS"
                  onChange={(event) => void upload(event.target.files)}
                />
              </>
            ) : null}
          </div>
        </div>

        {share ? (
          <p className={styles.muted}>
            Quyền của bạn: {SHARED_NAS_ACCESS_LABELS[share.access]} ({share.via.join(', ')})
            {share.writeCappedByErp ? '. NAS cho ghi nhưng tài khoản ERP của bạn chỉ có quyền xem tài liệu công ty.' : '.'}
          </p>
        ) : null}
        {uploading ? <p role="status">{uploading}</p> : null}
        {listError ? <p className={styles.alert}>{listError}</p> : null}

        {permissions ? (
          <table className={styles.storageTable} aria-label="Bảng quyền thư mục trên NAS">
            <thead>
              <tr>
                <th>Đối tượng</th>
                <th>Quyền</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((row) => (
                <tr key={`${row.principalType}-${row.principalName}`}>
                  <td>
                    {row.principalType === 'group' ? `Nhóm ${row.principalName}` : `Tài khoản ${row.principalName}`}
                    {row.members !== undefined ? <span className={styles.muted}> · {row.members} người</span> : null}
                  </td>
                  <td>
                    <span className={`${styles.badge} ${row.rule === 'deny' ? styles.badgeDanger : row.rule === 'write' ? styles.badgeSuccess : styles.badgeInfo}`}>
                      {SHARED_NAS_RULE_LABELS[row.rule]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <div className={styles.tableScroll}>
          <table className={styles.storageTable}>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Sửa đổi</th>
                <th className={styles.number}>Dung lượng</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.path}>
                  <td>
                    <button type="button" className={styles.nasEntry} onClick={() => void openEntry(entry)} title={entry.name}>
                      {entry.isDir ? <Folder size={15} /> : <File size={15} />}
                      <span>{entry.name}</span>
                    </button>
                  </td>
                  <td>{entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString('vi-VN') : ''}</td>
                  <td className={styles.number}>{entry.isDir || entry.sizeBytes === undefined ? '' : formatBytes(entry.sizeBytes)}</td>
                  <td>
                    <div className={styles.nasRowActions}>
                      {entry.isDir ? null : (
                        <button type="button" className={styles.buttonSmall} onClick={() => void download(entry)}>
                          Tải về
                        </button>
                      )}
                      {canWrite ? (
                        <>
                          <button type="button" className={styles.buttonSmall} onClick={() => openDialog({ kind: 'rename', entry })}>
                            Đổi tên
                          </button>
                          <Popconfirm
                            title={`Xoá ${entry.isDir ? 'thư mục' : 'tệp'} ${entry.name} trên NAS?`}
                            description="Nếu thư mục chia sẻ bật Thùng rác thì vẫn khôi phục được trên NAS."
                            okText="Xoá"
                            onConfirm={() => void remove(entry)}
                          >
                            <button type="button" className={styles.buttonSmall}>
                              Xoá
                            </button>
                          </Popconfirm>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && entries.length === 0 && !listError ? (
                <tr>
                  <td colSpan={4} className={styles.muted}>
                    Thư mục trống.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {loading ? <p className={styles.muted}>Đang đọc thư mục trên NAS…</p> : null}
        {listing && listing.offset + listing.entries.length < listing.total && share ? (
          <button type="button" className={styles.buttonGhost} disabled={loading} onClick={() => void load(share, path, true)}>
            Xem thêm ({listing.total - listing.entries.length} mục)
          </button>
        ) : null}
      </section>

      <Dialog
        open={Boolean(dialog)}
        title={dialog?.kind === 'rename' ? `Đổi tên ${dialog.entry.name}` : 'Thư mục mới trên NAS'}
        submitLabel={dialog?.kind === 'rename' ? 'Đổi tên' : 'Tạo thư mục'}
        submitting={dialogBusy}
        error={dialogError}
        onClose={() => setDialog(undefined)}
        onSubmit={() => void submitDialog()}
      >
        <Field label="Tên" required>
          <input value={dialogName} maxLength={255} autoFocus onChange={(event) => setDialogName(event.target.value)} />
        </Field>
      </Dialog>

      {preview
        ? createPortal(
            <div className={styles.overlay} role="presentation" onMouseDown={() => setPreview(undefined)}>
              <div
                className={styles.preview}
                role="dialog"
                aria-modal="true"
                aria-label={preview.title}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className={styles.previewHead}>
                  <h3 title={preview.title}>{preview.title}</h3>
                  <button
                    type="button"
                    className={styles.buttonGhost}
                    onClick={() => {
                      const entry = entries.find((item) => item.name === preview.title);
                      if (entry) void download(entry);
                    }}
                  >
                    <Download size={15} /> Tải xuống
                  </button>
                  <button type="button" className={styles.iconButton} aria-label="Đóng" onClick={() => setPreview(undefined)}>
                    <X size={15} />
                  </button>
                </header>
                <div className={styles.previewBody}>
                  {preview.image ? <img src={preview.url} alt={preview.title} /> : <iframe src={preview.url} title={preview.title} />}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
