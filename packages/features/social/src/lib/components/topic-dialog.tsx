'use client';

import {
  SOCIAL_TOPIC_NAME_MAX,
  type SocialTopic,
} from '@enterprise-platform/contracts-social';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { createTopic, deleteTopic, errorMessage, updateTopic } from '../social-api';
import styles from '../social.module.scss';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { ConfirmDialog, Dialog } from './ui';

function TopicRow({
  topic,
  onSaved,
  onRemoved,
  onError,
}: {
  readonly topic: SocialTopic;
  readonly onSaved: () => void;
  readonly onRemoved: (topicId: string) => void;
  readonly onError: (message: string | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [name, setName] = useState(topic.name);
  const [busy, setBusy] = useState(false);

  const save = async (patch: { name?: string; isActive?: boolean }) => {
    setBusy(true);
    onError(undefined);
    try {
      await updateTopic(topic.id, patch);
      onSaved();
      return true;
    } catch (cause) {
      onError(errorMessage(cause, 'Không lưu được chuyên mục.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setDeleteError(undefined);
    try {
      await deleteTopic(topic.id);
      setConfirming(false);
      onRemoved(topic.id);
    } catch (cause) {
      setDeleteError(errorMessage(cause, 'Không xoá được chuyên mục.'));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    setName(topic.name);
    setEditing(true);
  };

  const cancelEdit = () => {
    setName(topic.name);
    setEditing(false);
  };

  const commitName = async () => {
    const next = name.trim();
    if (!next || next === topic.name) {
      cancelEdit();
      return;
    }
    if (await save({ name: next })) setEditing(false);
  };

  return (
    <li className="flex min-h-12 items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-slate-50">
      {editing ? (
        <>
          <Input
            className="h-10 text-base"
            autoFocus
            value={name}
            maxLength={SOCIAL_TOPIC_NAME_MAX}
            aria-label={`Tên chuyên mục ${topic.name}`}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void commitName();
              } else if (event.key === 'Escape') {
                event.stopPropagation();
                cancelEdit();
              }
            }}
          />
          <Button
            size="icon-lg"
            aria-label="Lưu tên chuyên mục"
            disabled={busy || name.trim().length === 0}
            onClick={() => void commitName()}
          >
            <Check className="size-5" />
          </Button>
          <Button
            size="icon-lg"
            variant="outline"
            aria-label="Huỷ sửa"
            disabled={busy}
            onClick={cancelEdit}
          >
            <X className="size-5" />
          </Button>
        </>
      ) : (
        <>
          <span
            className={
              topic.isActive
                ? 'min-w-0 flex-1 truncate text-base font-medium text-slate-900'
                : 'min-w-0 flex-1 truncate text-base font-medium text-slate-400'
            }
            title={topic.name}
          >
            {topic.name}
          </span>
          <span className="text-sm whitespace-nowrap text-slate-500 tabular-nums">
            {topic.postCount.toLocaleString('vi-VN')} bài
          </span>
          <Button
            size="icon-lg"
            variant="ghost"
            aria-label={`Sửa tên chuyên mục ${topic.name}`}
            title="Sửa tên"
            disabled={busy}
            onClick={startEdit}
          >
            <Pencil className="size-5" />
          </Button>
          <Button
            size="icon-lg"
            variant="ghost"
            className="text-slate-500 hover:bg-red-50 hover:text-red-600"
            aria-label={`Xoá chuyên mục ${topic.name}`}
            title="Xoá chuyên mục"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-5" />
          </Button>
          <Switch
            checked={topic.isActive}
            disabled={busy}
            aria-label={`${topic.isActive ? 'Tắt' : 'Bật'} chuyên mục ${topic.name}`}
            title={
              topic.isActive
                ? 'Đang dùng — bấm để tắt'
                : 'Đang tắt — bấm để bật'
            }
            onCheckedChange={(checked) => void save({ isActive: checked })}
          />
        </>
      )}
      <ConfirmDialog
        open={confirming}
        title="Xoá chuyên mục"
        message={[
          `Xoá chuyên mục "${topic.name}"?`,
          topic.postCount > 0
            ? `${topic.postCount.toLocaleString('vi-VN')} bài viết đang thuộc chuyên mục này vẫn được giữ nguyên, chỉ không còn gắn chuyên mục này (bài còn chuyên mục khác thì giữ các chuyên mục đó). Không thể khôi phục.`
            : 'Chưa có bài viết đã đăng nào thuộc chuyên mục này. Không thể khôi phục.',
          'Chỉ muốn ẩn khỏi danh sách chọn khi đăng bài? Hãy tắt công tắc thay vì xoá.',
        ]}
        confirmLabel="Xoá chuyên mục"
        busy={busy}
        error={deleteError}
        onConfirm={() => void remove()}
        onClose={() => setConfirming(false)}
      />
    </li>
  );
}

/** Quản lý chuyên mục: thêm, đổi tên, bật hoặc tắt, xoá. Chỉ mở cho người có `social.manage`. */
export function TopicDialog({
  topics,
  onChanged,
  onRemoved,
  onClose,
}: {
  readonly topics: readonly SocialTopic[];
  readonly onChanged: () => void;
  /** Sau khi xoá một chuyên mục (nơi cha bỏ lọc theo chuyên mục đó nếu đang mở). */
  readonly onRemoved: (topicId: string) => void;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();

  const add = async () => {
    const next = name.trim();
    if (!next) return;
    setAdding(true);
    setError(undefined);
    try {
      await createTopic({ name: next });
      setName('');
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause, 'Không thêm được chuyên mục.'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open title="Quản lý chuyên mục" error={error} onClose={onClose}>
      <p className={styles.muted} style={{ fontSize: 14 }}>
        Bật hoặc tắt bằng công tắc bên phải. Chuyên mục đang tắt không hiện khi
        đăng bài mới.
      </p>
      <div className="flex gap-3">
        <Input
          className="h-10 text-base"
          value={name}
          maxLength={SOCIAL_TOPIC_NAME_MAX}
          placeholder="Tên chuyên mục mới"
          aria-label="Tên chuyên mục mới"
          disabled={adding}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void add();
            }
          }}
        />
        <Button
          className="h-10 px-4 text-base"
          disabled={adding || name.trim().length === 0}
          onClick={() => void add()}
        >
          <Plus className="size-5" />
          Thêm
        </Button>
      </div>
      {/* Khung danh sách cao cố định theo chiều cao màn hình: thêm, xoá chuyên mục không làm hộp thoại co giãn;
          nhiều quá thì chỉ cuộn trong khung này. */}
      <div className="h-[clamp(180px,calc(100dvh-400px),460px)] overflow-y-auto overscroll-contain pr-1">
        {topics.length === 0 ? (
          <p className={styles.muted}>Chưa có chuyên mục nào.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {topics.map((topic) => (
              <TopicRow
                key={`${topic.id}-${topic.name}-${topic.isActive}`}
                topic={topic}
                onSaved={onChanged}
                onRemoved={(id) => {
                  onRemoved(id);
                  onChanged();
                }}
                onError={setError}
              />
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
