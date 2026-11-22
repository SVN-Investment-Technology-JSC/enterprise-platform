'use client';

import {
  formatBytes,
  type SharedNasEntry,
  type SharedNasListing,
  type SharedNasOverview,
  type SharedNasShare,
} from '@enterprise-platform/contracts-shared';
import { Popconfirm, toast } from '@enterprise-platform/shared-ui';
import { Download, File, Folder, FolderUp, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { createPortal } from 'react-dom';
import { draggingFiles, guardWindowFileDrop, readDrop } from '../file-drop';
import { pickedFiles, type PickedEntry } from '../folder-upload.model';
import { planNasUpload } from '../nas-upload.model';
import * as api from '../shared-api';
import styles from '../shared.module.scss';
import { Dialog, Field } from './dialog';

const PREVIEWABLE = /\.(pdf|jpe?g|png|gif|webp)$/i;
/** Kiểu dữ liệu khi kéo một dòng trong Kho NAS (chuyển mục), phân biệt với kéo tệp từ máy. */
const ENTRY_TYPE = 'application/x-erp-nas-entry';
const UPLOAD_CONCURRENCY = 3;

type NameDialog = { readonly kind: 'folder' } | { readonly kind: 'rename'; readonly entry: SharedNasEntry };

const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');
const draggingEntry = (event: ReactDragEvent) => Array.from(event.dataTransfer.types).includes(ENTRY_TYPE);

/**
 * Kho NAS: các thư mục chia sẻ của NAS công ty hiện thẳng trong ERP, đọc ghi trực tiếp
 * trên NAS (không sao chép). Mỗi người chỉ thấy thư mục mà tài khoản NAS của họ được
 * vào; nút ghi chỉ hiện khi NAS cho ghi.
 *
 * Kéo tệp, thư mục từ máy thả vào bảng (thư mục đang mở), vào một dòng thư mục hay một
 * đoạn đường dẫn để tải lên đúng chỗ đó; kéo một dòng thả vào thư mục khác để chuyển.
 */
export function NasView() {
  const [overview, setOverview] = useState<SharedNasOverview>();
  const [error, setError] = useState<string>();
  const [share, setShare] = useState<SharedNasShare>();
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<SharedNasListing>();
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string>();
  const [progress, setProgress] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [dialog, setDialog] = useState<NameDialog>();
  const [dialogName, setDialogName] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string>();
  const [preview, setPreview] = useState<{ entry: SharedNasEntry; url: string; image: boolean }>();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => guardWindowFileDrop(), []);

  useEffect(() => {
    api
      .loadNasOverview()
      .then((next) => {
        setOverview(next);
        setShare((current) => current ?? next.shares[0]);
      })
      .catch((cause) => setError(api.errorMessage(cause, 'Không tải được Kho NAS.')));
  }, []);

  /** `offset` > 0 là tải thêm, nối vào danh sách đang có. */
  const load = useCallback(async (target: SharedNasShare, folder: string, offset = 0) => {
    setLoading(true);
    setListError(undefined);
    try {
      const next = await api.listNasEntries(target.name, folder, offset);
      setListing((current) => (offset > 0 && current ? { ...next, entries: [...current.entries, ...next.entries] } : next));
    } catch (cause) {
      setListError(api.errorMessage(cause, 'Không đọc được thư mục trên NAS.'));
      if (offset === 0) setListing(undefined);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (share) void load(share, path);
  }, [share, path, load]);

  // Ô chọn thư mục: `webkitdirectory` chưa có trong kiểu của React.
  const folderInputRef = useCallback((node: HTMLInputElement | null) => {
    folderInput.current = node;
    node?.setAttribute('webkitdirectory', '');
  }, []);

  if (error) return <p className={styles.alert}>{error}</p>;
  if (!overview) return <p className={styles.muted}>Đang tải…</p>;
  if (!overview.enabled) return <p className={styles.notice}>Kho NAS chưa được bật.</p>;
  if (!overview.account) {
    return <p className={styles.notice}>Tài khoản của bạn chưa được ghép với tài khoản NAS. Liên hệ quản trị.</p>;
  }
  if (overview.shares.length === 0) return <p className={styles.notice}>Bạn chưa được cấp quyền thư mục nào trên NAS.</p>;

  const canWrite = Boolean(listing?.canWrite);
  const segments = path ? path.split('/') : [];
  const entries = [...(listing?.entries ?? [])].sort((left, right) => Number(right.isDir) - Number(left.isDir));
  const refresh = () => share && void load(share, path);

  /* ---------------------------------------------------------- tải lên */

  const upload = async (picked: readonly PickedEntry[], target: string) => {
    if (!share || picked.length === 0) return;
    const plan = planNasUpload(picked, target);
    if (plan.jobs.length === 0 && plan.emptyFolders.length === 0) return;
    let done = 0;
    let existing = 0;
    const failures: string[] = [];
    for (const folder of plan.emptyFolders) {
      const name = folder.split('/').pop() ?? folder;
      await api.createNasFolder(share.name, parentOf(folder), name).catch((cause: api.SharedApiError) => {
        if (cause?.code !== 'NAS_CONFLICT') failures.push(`${folder}: ${api.errorMessage(cause, 'không tạo được')}`);
      });
    }
    const total = plan.jobs.length;
    const queue = [...plan.jobs];
    const report = () => setProgress(`Đang tải lên ${done}/${total} tệp (${formatBytes(plan.totalBytes)})…`);
    report();
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          await api.uploadToNas(share.name, job.folder, job.file, job.name);
        } catch (cause) {
          const failure = cause as api.SharedApiError;
          if (failure?.code === 'NAS_CONFLICT') existing += 1;
          else failures.push(`${job.name}: ${api.errorMessage(cause, 'không tải lên được')}`);
        }
        done += 1;
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, worker));
    setProgress(undefined);
    const uploaded = total - existing - failures.length;
    if (uploaded > 0) toast.success(`Đã tải lên ${uploaded} tệp.`);
    if (existing > 0) toast.info(`${existing} tệp đã có cùng tên trong thư mục, bỏ qua.`);
    if (failures.length > 0) toast.error(`${failures.length} mục lỗi. ${failures[0]}`);
    refresh();
  };

  const pick = (input: HTMLInputElement | null) => {
    const files = input?.files ? [...input.files] : [];
    if (input) input.value = '';
    void upload(pickedFiles(files), path);
  };

  /* ---------------------------------------------------------- kéo thả */

  /**
   * Một chỗ nhận thả: thư mục `target` (đường dẫn trong thư mục chia sẻ). `key` để tô
   * sáng đúng chỗ đang kéo ngang qua. Nhận tệp từ máy, hoặc một dòng của Kho NAS.
   */
  const dropZone = <T extends HTMLElement>(key: string, target: string) => ({
    'data-drop': dropTarget === key ? 'true' : undefined,
    onDragOver: (event: ReactDragEvent<T>) => {
      if (!canWrite || !(draggingFiles(event) || draggingEntry(event))) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = draggingEntry(event) ? 'move' : 'copy';
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: (event: ReactDragEvent<T>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setDropTarget((current) => (current === key ? undefined : current));
    },
    onDrop: (event: ReactDragEvent<T>) => {
      if (!canWrite) return;
      const moved = event.dataTransfer.getData(ENTRY_TYPE);
      if (!moved && !draggingFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(undefined);
      if (moved) {
        void move(JSON.parse(moved) as string[], target);
        return;
      }
      // Phải đọc ngay trong sự kiện thả, trước lần `await` đầu tiên.
      void readDrop(event.dataTransfer).then((picked) => upload(picked, target));
    },
  });

  const dragRow = (entry: SharedNasEntry) =>
    canWrite
      ? {
          draggable: true,
          onDragStart: (event: ReactDragEvent<HTMLTableRowElement>) => {
            event.dataTransfer.setData(ENTRY_TYPE, JSON.stringify([entry.path]));
            event.dataTransfer.effectAllowed = 'move';
          },
          onDragEnd: () => setDropTarget(undefined),
        }
      : {};

  const move = async (paths: readonly string[], target: string) => {
    if (!share) return;
    if (paths.some((item) => target === item || target.startsWith(`${item}/`))) return;
    if (paths.every((item) => parentOf(item) === target)) return;
    try {
      const result = await api.moveNasEntries(share.name, paths, target);
      if (result.moved > 0) toast.success(`Đã chuyển vào ${target ? target.split('/').pop() : share.label}.`);
      refresh();
    } catch (cause) {
      toast.error(api.errorMessage(cause, 'Không chuyển được.'));
    }
  };

  /* ---------------------------------------------------------- thao tác */

  const openEntry = async (entry: SharedNasEntry) => {
    if (!share) return;
    if (entry.isDir) {
      setPath(entry.path);
      return;
    }
    try {
      if (PREVIEWABLE.test(entry.name)) {
        const ticket = await api.nasDownloadTicket(share.name, entry.path, 'preview');
        setPreview({ entry, url: ticket.downloadUrl, image: ticket.contentType.startsWith('image/') });
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
            title={item.label}
            onClick={() => {
              setShare(item);
              setPath('');
            }}
          >
            <Folder size={15} />
            <span>{item.label}</span>
          </button>
        ))}
      </aside>

      <section className={`${styles.panel} ${styles.nasMain}`} aria-label="Nội dung thư mục" {...dropZone<HTMLElement>('panel', path)}>
        <div className={styles.nasToolbar}>
          <nav className={styles.nasCrumbs} aria-label="Đường dẫn">
            <button type="button" onClick={() => setPath('')} {...dropZone<HTMLButtonElement>('crumb:', '')}>
              {share?.label}
            </button>
            {segments.map((segment, index) => {
              const target = segments.slice(0, index + 1).join('/');
              return (
                <span key={target}>
                  <span aria-hidden="true">›</span>
                  <button type="button" onClick={() => setPath(target)} {...dropZone<HTMLButtonElement>(`crumb:${target}`, target)}>
                    {segment}
                  </button>
                </span>
              );
            })}
          </nav>
          <div className={styles.storageActions}>
            <button type="button" className={styles.buttonGhost} disabled={loading} onClick={refresh}>
              Làm mới
            </button>
            {canWrite ? (
              <>
                <button type="button" className={styles.buttonGhost} onClick={() => openDialog({ kind: 'folder' })}>
                  Thư mục mới
                </button>
                <button type="button" className={styles.buttonGhost} disabled={Boolean(progress)} onClick={() => folderInput.current?.click()}>
                  <FolderUp size={15} /> Tải thư mục
                </button>
                <button type="button" className={styles.buttonPrimary} disabled={Boolean(progress)} onClick={() => fileInput.current?.click()}>
                  <Upload size={15} /> Tải tệp
                </button>
                <input ref={fileInput} type="file" multiple hidden aria-label="Chọn tệp tải lên" onChange={(event) => pick(event.target)} />
                <input ref={folderInputRef} type="file" hidden aria-label="Chọn thư mục tải lên" onChange={(event) => pick(event.target)} />
              </>
            ) : null}
          </div>
        </div>

        {progress ? <p role="status">{progress}</p> : null}
        {listError ? <p className={styles.alert}>{listError}</p> : null}

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
                <tr
                  key={entry.path}
                  className={styles.nasRow}
                  {...dragRow(entry)}
                  {...(entry.isDir ? dropZone<HTMLTableRowElement>(`row:${entry.path}`, entry.path) : {})}
                >
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
                            title={`Xoá ${entry.isDir ? 'thư mục' : 'tệp'} ${entry.name}?`}
                            description="Thư mục chia sẻ bật Thùng rác thì vẫn khôi phục được trên NAS."
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
                  <td colSpan={4} className={styles.nasEmpty}>
                    {canWrite ? 'Thư mục trống. Kéo thả tệp hoặc thư mục vào đây để tải lên.' : 'Thư mục trống.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {loading ? <p className={styles.muted}>Đang tải…</p> : null}
        {listing && listing.offset + listing.entries.length < listing.total && share ? (
          <button type="button" className={styles.buttonGhost} disabled={loading} onClick={() => void load(share, path, listing.entries.length)}>
            Xem thêm ({listing.total - listing.entries.length} mục)
          </button>
        ) : null}
      </section>

      <Dialog
        open={Boolean(dialog)}
        title={dialog?.kind === 'rename' ? 'Đổi tên' : 'Thư mục mới'}
        submitLabel={dialog?.kind === 'rename' ? 'Đổi tên' : 'Tạo'}
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
                aria-label={preview.entry.name}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className={styles.previewHead}>
                  <h3 title={preview.entry.name}>{preview.entry.name}</h3>
                  <button type="button" className={styles.buttonGhost} onClick={() => void download(preview.entry)}>
                    <Download size={15} /> Tải xuống
                  </button>
                  <button type="button" className={styles.iconButton} aria-label="Đóng" onClick={() => setPreview(undefined)}>
                    <X size={15} />
                  </button>
                </header>
                <div className={styles.previewBody}>
                  {preview.image ? <img src={preview.url} alt={preview.entry.name} /> : <iframe src={preview.url} title={preview.entry.name} />}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
