'use client';

import {
  SOCIAL_TOPIC_NAME_MAX,
  type SocialTopic,
} from '@enterprise-platform/contracts-social';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { createTopic, errorMessage, updateTopic } from '../social-api';
import styles from '../social.module.scss';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Dialog } from './ui';

function TopicRow({
  topic,
  onSaved,
  onError,
}: {
  readonly topic: SocialTopic;
  readonly onSaved: () => void;
  readonly onError: (message: string | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
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
    </li>
  );
}

/** Quản lý chuyên mục: thêm, đổi tên, bật hoặc tắt. Chỉ mở cho người có `social.manage`. */
export function TopicDialog({
  topics,
  onChanged,
  onClose,
}: {
  readonly topics: readonly SocialTopic[];
  readonly onChanged: () => void;
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
      {topics.length === 0 ? (
        <p className={styles.muted}>Chưa có chuyên mục nào.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {topics.map((topic) => (
            <TopicRow
              key={`${topic.id}-${topic.name}-${topic.isActive}`}
              topic={topic}
              onSaved={onChanged}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
