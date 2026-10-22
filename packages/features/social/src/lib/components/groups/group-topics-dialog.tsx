'use client';

import {
  SOCIAL_GROUP_TOPICS_MAX,
  SOCIAL_GROUP_TOPIC_NAME_MAX,
  type SocialGroupTopic,
} from '@enterprise-platform/contracts-social';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../../social-api';
import base from '../../social.module.scss';
import { ConfirmDialog, Dialog } from '../ui';
import s from './groups.module.scss';
import { createGroupTopic, deleteGroupTopic, listGroupTopics, updateGroupTopic } from './social-groups-api';

function TopicRow({
  topic,
  disabled,
  onRename,
  onDelete,
}: {
  readonly topic: SocialGroupTopic;
  readonly disabled: boolean;
  readonly onRename: (topic: SocialGroupTopic, name: string) => Promise<boolean>;
  readonly onDelete: (topic: SocialGroupTopic) => void;
}) {
  const [name, setName] = useState(topic.name);
  useEffect(() => setName(topic.name), [topic.name]);

  const commit = async () => {
    const next = name.trim();
    if (!next || next === topic.name) {
      setName(topic.name);
      return;
    }
    if (!(await onRename(topic, next))) setName(topic.name);
  };

  return (
    <li className={s.topicRow}>
      <Tag size={14} aria-hidden="true" />
      <input
        className={s.topicInput}
        value={name}
        maxLength={SOCIAL_GROUP_TOPIC_NAME_MAX}
        disabled={disabled}
        aria-label={`Tên chủ đề ${topic.name}`}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <span className={s.topicCount}>{topic.postCount} bài</span>
      <button
        type="button"
        className={base.iconButton}
        aria-label={`Xoá chủ đề ${topic.name}`}
        title="Xoá chủ đề"
        disabled={disabled}
        onClick={() => onDelete(topic)}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

/** Quản lý chủ đề của nhóm (quản trị nhóm): thêm, đổi tên (Enter hoặc rời ô), xoá. */
export function GroupTopicsDialog({
  open,
  groupId,
  onClose,
  onChanged,
}: {
  readonly open: boolean;
  readonly groupId: string;
  readonly onClose: () => void;
  /** Sau mỗi thay đổi để cha nạp lại danh sách chủ đề đang lọc. */
  readonly onChanged: () => void;
}) {
  const [topics, setTopics] = useState<readonly SocialGroupTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [text, setText] = useState('');
  const [removing, setRemoving] = useState<SocialGroupTopic>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setTopics((await listGroupTopics(groupId)).items);
    } catch (cause) {
      setError(errorMessage(cause, 'Không tải được chủ đề.'));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (!open) return;
    setText('');
    setRemoving(undefined);
    void load();
  }, [open, load]);

  const add = async () => {
    const name = text.trim();
    if (!name) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await createGroupTopic(groupId, name);
      setTopics((current) => [...current, created]);
      setText('');
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause, 'Không thêm được chủ đề.'));
    } finally {
      setBusy(false);
    }
  };

  const rename = async (topic: SocialGroupTopic, name: string) => {
    setError(undefined);
    try {
      const saved = await updateGroupTopic(groupId, topic.id, { name });
      setTopics((current) => current.map((item) => (item.id === topic.id ? { ...item, ...saved } : item)));
      onChanged();
      return true;
    } catch (cause) {
      setError(errorMessage(cause, 'Không đổi được tên chủ đề.'));
      return false;
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteGroupTopic(groupId, removing.id);
      setTopics((current) => current.filter((item) => item.id !== removing.id));
      setRemoving(undefined);
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause, 'Không xoá được chủ đề.'));
    } finally {
      setBusy(false);
    }
  };

  const full = topics.length >= SOCIAL_GROUP_TOPICS_MAX;

  return (
    <>
      <Dialog open={open && !removing} title="Quản lý chủ đề" error={error} onClose={onClose}>
        <div className={s.topicAdd}>
          <input
            className={base.input}
            value={text}
            maxLength={SOCIAL_GROUP_TOPIC_NAME_MAX}
            placeholder={full ? `Tối đa ${SOCIAL_GROUP_TOPICS_MAX} chủ đề` : 'Tên chủ đề mới'}
            aria-label="Tên chủ đề mới"
            disabled={full || busy}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void add();
              }
            }}
          />
          <button type="button" onClick={() => void add()} className={base.buttonPrimary} disabled={!text.trim() || full || busy}>
            <Plus size={14} />
            Thêm mới
          </button>
        </div>
        {loading ? (
          <p className={base.muted} aria-busy="true">
            Đang tải…
          </p>
        ) : topics.length === 0 ? (
          <p className={s.emptyLine}>Nhóm chưa có chủ đề nào.</p>
        ) : (
          <ul className={s.topicList}>
            {topics.map((topic) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                disabled={busy}
                onRename={rename}
                onDelete={(item) => setRemoving(item)}
              />
            ))}
          </ul>
        )}
      </Dialog>
      <ConfirmDialog
        open={open && Boolean(removing)}
        title="Xoá chủ đề"
        message={`Xoá chủ đề "${removing?.name ?? ''}"? Thao tác này không thể hoàn tác.`}
        confirmLabel="Xoá chủ đề"
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
        onClose={() => setRemoving(undefined)}
      />
    </>
  );
}
