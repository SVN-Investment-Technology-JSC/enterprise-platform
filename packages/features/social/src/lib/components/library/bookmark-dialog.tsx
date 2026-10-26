'use client';

import {
  SOCIAL_BOOKMARK_FOLDER_NAME_MAX,
  SOCIAL_BOOKMARK_FOLDERS_MAX,
  type SocialBookmarkFolder,
  type SocialPost,
} from '@enterprise-platform/contracts-social';
import { toast } from '@enterprise-platform/shared-ui';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { errorMessage } from '../../social-api';
import {
  createBookmarkFolder,
  loadBookmarkFolders,
  setBookmark,
} from '../../social-posts-api';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Popover, PopoverContent } from '../../ui/popover';
import { Dialog, SelectField } from '../ui';
import styles from './bookmark-dialog.module.scss';

export const UNFILED_LABEL = 'Chưa phân loại';

/** Cùng cỡ với ô trong hộp soạn bài. */
const CONTROL_CLASS = 'h-[38px] rounded-md px-3 text-[13.5px]!';

const norm = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

export interface FolderSelectProps {
  readonly folders: readonly SocialBookmarkFolder[];
  readonly unfiledCount: number;
  /** Mã thư mục đang chọn; `null` là chưa phân loại. */
  readonly value: string | null;
  readonly onChange: (folderId: string | null) => void;
  /** Tạo nhanh thư mục; trả thư mục mới (hoặc thư mục cũ nếu trùng tên). */
  readonly onCreate: (name: string) => Promise<SocialBookmarkFolder>;
  readonly disabled?: boolean;
  readonly 'aria-label'?: string;
}

interface Option {
  readonly id: string | null;
  readonly label: string;
  readonly count: number;
}

/**
 * Ô chọn thư mục kiểu Ant Design "custom dropdown menu": danh sách có ô tìm, mục "Chưa phân loại" ở đầu,
 * dưới danh sách là dòng thêm nhanh thư mục (Enter cũng thêm, thêm xong tự chọn).
 */
export function FolderSelect({
  folders,
  unfiledCount,
  value,
  onChange,
  onCreate,
  disabled = false,
  'aria-label': ariaLabel = 'Thư mục',
}: FolderSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const options = useMemo<readonly Option[]>(
    () => [
      { id: null, label: UNFILED_LABEL, count: unfiledCount },
      ...folders.map((folder) => ({
        id: folder.id,
        label: folder.name,
        count: folder.count,
      })),
    ],
    [folders, unfiledCount],
  );
  const filtered = useMemo(() => {
    const needle = norm(query.trim());
    return needle
      ? options.filter((option) => norm(option.label).includes(needle))
      : options;
  }, [options, query]);
  const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0));
  const current = options.find((option) => option.id === value) ?? options[0];
  const atLimit = folders.length >= SOCIAL_BOOKMARK_FOLDERS_MAX;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Pha bắt: chỉ đóng danh sách, không đóng hộp thoại bên ngoài.
      event.stopImmediatePropagation();
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setAddError(undefined);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed || adding || atLimit) return;
    setAdding(true);
    setAddError(undefined);
    try {
      const folder = await onCreate(trimmed);
      setName('');
      pick(folder.id);
    } catch (cause) {
      setAddError(errorMessage(cause, 'Không tạo được thư mục.'));
    } finally {
      setAdding(false);
    }
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(
        (index) =>
          (Math.min(index, filtered.length - 1) + step + filtered.length) %
          filtered.length,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) pick(option.id);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        if (details.reason === 'focus-out') return;
        if (
          details.reason === 'outside-press' &&
          triggerRef.current?.contains(details.event.target as Node)
        )
          return;
        setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        data-open={open || undefined}
        disabled={disabled}
        onClick={() => setOpen((state) => !state)}
      >
        <span className={styles.value}>{current.label}</span>
        <ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
      </button>
      <PopoverContent
        anchor={triggerRef}
        side="bottom"
        align="start"
        sideOffset={4}
        finalFocus={false}
        className={styles.dropdown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.search}>
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            placeholder="Tìm thư mục…"
            aria-label="Tìm thư mục"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKey}
          />
        </div>
        {filtered.length === 0 ? (
          <p className={styles.hint}>Không có thư mục nào khớp.</p>
        ) : (
          <ul id={listId} className={styles.list} role="listbox">
            {filtered.map((option, index) => {
              const selected = option.id === (current.id ?? null);
              return (
                <li
                  key={option.id ?? 'none'}
                  role="option"
                  aria-selected={selected}
                >
                  <button
                    type="button"
                    className={styles.option}
                    data-selected={selected || undefined}
                    data-active={index === activeIndex || undefined}
                    tabIndex={-1}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(option.id)}
                  >
                    <span className={styles.optionLabel}>{option.label}</span>
                    <span className={styles.optionCount}>{option.count}</span>
                    {selected ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {folders.length === 0 ? (
          <p className={styles.hint}>Chưa có thư mục. Nhập tên để tạo nhanh.</p>
        ) : null}
        <hr className={styles.divider} />
        <div className={styles.add}>
          <Input
            className={`${CONTROL_CLASS} ${styles.addInput}`}
            value={name}
            maxLength={SOCIAL_BOOKMARK_FOLDER_NAME_MAX}
            placeholder="Tên thư mục mới"
            aria-label="Tên thư mục mới"
            disabled={adding || atLimit}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void add();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            className={`${CONTROL_CLASS} font-semibold`}
            disabled={!name.trim() || adding || atLimit}
            onClick={() => void add()}
          >
            <Plus size={14} aria-hidden="true" />
            Thêm thư mục
          </Button>
        </div>
        {atLimit ? (
          <p className={styles.addError}>
            Đã đạt tối đa {SOCIAL_BOOKMARK_FOLDERS_MAX} thư mục.
          </p>
        ) : null}
        {addError ? (
          <p role="alert" className={styles.addError}>
            {addError}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export interface BookmarkDialogProps {
  readonly post: SocialPost;
  readonly onClose: () => void;
  /** Đã lưu hoặc bỏ lưu xong; nhận bài với trạng thái mới. */
  readonly onDone: (post: SocialPost) => void;
}

/** Hộp thoại "Lưu bài viết": chọn thư mục rồi Lưu, hoặc Bỏ lưu khi bài đang được lưu. */
export function BookmarkDialog({ post, onClose, onDone }: BookmarkDialogProps) {
  const [folders, setFolders] = useState<readonly SocialBookmarkFolder[]>([]);
  const [unfiledCount, setUnfiledCount] = useState(0);
  const [folderId, setFolderId] = useState<string | null>(
    post.bookmarkFolderId ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    loadBookmarkFolders()
      .then((list) => {
        if (!alive) return;
        setFolders(list.items);
        setUnfiledCount(list.unfiledCount);
      })
      .catch((cause) => {
        if (alive)
          setError(errorMessage(cause, 'Không tải được danh sách thư mục.'));
      });
    return () => {
      alive = false;
    };
  }, []);

  const create = async (name: string) => {
    const folder = await createBookmarkFolder(name);
    setFolders((list) =>
      list.some((item) => item.id === folder.id) ? list : [...list, folder],
    );
    return folder;
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const state = await setBookmark(post.id, true, folderId);
      const folder = folders.find((item) => item.id === folderId);
      toast.success(
        folder
          ? `Đã lưu vào thư mục "${folder.name}"`
          : 'Đã lưu bài viết',
      );
      onDone({
        ...post,
        bookmarked: state.bookmarked,
        bookmarkFolderId: state.folderId,
      });
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được bài.'));
      setBusy(false);
    }
  };

  const unsave = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const state = await setBookmark(post.id, false);
      toast('Đã bỏ lưu bài viết');
      onDone({
        ...post,
        bookmarked: state.bookmarked,
        bookmarkFolderId: undefined,
      });
    } catch (cause) {
      setError(errorMessage(cause, 'Không bỏ lưu được bài.'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Lưu bài viết"
      submitLabel="Lưu"
      submittingLabel="Đang lưu…"
      submitting={busy}
      error={error}
      onSubmit={() => void save()}
      onClose={onClose}
    >
      <SelectField label="Thư mục">
        <FolderSelect
          folders={folders}
          unfiledCount={unfiledCount}
          value={folderId}
          onChange={setFolderId}
          onCreate={create}
          disabled={busy}
        />
      </SelectField>
      {post.bookmarked ? (
        <div className={styles.unsave}>
          <Button
            type="button"
            variant="destructive"
            className="h-[38px] rounded-md px-4 text-[13.5px]! font-semibold"
            disabled={busy}
            onClick={() => void unsave()}
          >
            Bỏ lưu
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
