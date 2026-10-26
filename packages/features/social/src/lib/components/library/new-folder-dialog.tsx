'use client';

import {
  SOCIAL_BOOKMARK_FOLDER_NAME_MAX,
  SOCIAL_BOOKMARK_FOLDERS_MAX,
  type SocialBookmarkFolder,
} from '@enterprise-platform/contracts-social';
import { useState } from 'react';
import { errorMessage } from '../../social-api';
import { createBookmarkFolder, renameBookmarkFolder } from '../../social-posts-api';
import { Input } from '../../ui/input';
import { Dialog } from '../ui';

/**
 * Hộp nhỏ "Thư mục mới" hoặc "Đổi tên thư mục" ở màn "Bài đã lưu" (đổi tên khi có `folder`): nhập tên rồi lưu. Tạo mới mà tên
 * trùng (không phân biệt hoa thường) thì máy chủ trả lại thư mục cũ, nên bên gọi nhận về thư mục đó như một lần tạo thành công.
 */
export function NewFolderDialog({
  folderCount,
  folder,
  onCreated,
  onClose,
}: {
  /** Số thư mục hiện có, để báo khi đã chạm trần (chỉ khi tạo mới). */
  readonly folderCount: number;
  /** Có thì là đổi tên thư mục này. */
  readonly folder?: SocialBookmarkFolder;
  /** Gọi với thư mục vừa tạo hoặc vừa đổi tên. */
  readonly onCreated: (folder: SocialBookmarkFolder) => void;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(folder?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const trimmed = name.trim();
  const atLimit = !folder && folderCount >= SOCIAL_BOOKMARK_FOLDERS_MAX;

  const submit = async () => {
    if (!trimmed || busy || atLimit) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(folder ? await renameBookmarkFolder(folder.id, trimmed) : await createBookmarkFolder(trimmed));
    } catch (cause) {
      setError(errorMessage(cause, 'Không tạo được thư mục.'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={folder ? 'Đổi tên thư mục' : 'Thư mục mới'}
      submitLabel={folder ? 'Lưu' : 'Tạo thư mục'}
      submittingLabel={folder ? 'Đang lưu…' : 'Đang tạo…'}
      submitting={busy}
      submitDisabled={!trimmed || atLimit || trimmed === folder?.name}
      error={atLimit ? `Đã đạt tối đa ${SOCIAL_BOOKMARK_FOLDERS_MAX} thư mục.` : error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <label className="flex flex-col gap-1.5 text-[13.5px] font-medium text-slate-700">
        Tên thư mục
        <Input
          autoFocus
          className="h-[38px] rounded-md px-3 text-[13.5px]!"
          value={name}
          maxLength={SOCIAL_BOOKMARK_FOLDER_NAME_MAX}
          placeholder="Ví dụ: Công việc, Ghi nhớ…"
          disabled={busy || atLimit}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
    </Dialog>
  );
}
