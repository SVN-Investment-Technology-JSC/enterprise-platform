'use client';

import { SOCIAL_TOPIC_NAME_MAX, type SocialTopic } from '@enterprise-platform/contracts-social';
import { useState } from 'react';
import { createTopic, errorMessage, updateTopic } from '../social-api';
import styles from '../social.module.scss';
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
  const [name, setName] = useState(topic.name);
  const [busy, setBusy] = useState(false);

  const save = async (patch: { name?: string; isActive?: boolean }) => {
    setBusy(true);
    onError(undefined);
    try {
      await updateTopic(topic.id, patch);
      onSaved();
    } catch (cause) {
      onError(errorMessage(cause, 'Không lưu được chuyên mục.'));
      setName(topic.name);
    } finally {
      setBusy(false);
    }
  };

  const commitName = () => {
    const next = name.trim();
    if (!next) {
      setName(topic.name);
      return;
    }
    if (next !== topic.name) void save({ name: next });
  };

  return (
    <li className={styles.topicRow}>
      <input
        className={styles.input}
        value={name}
        maxLength={SOCIAL_TOPIC_NAME_MAX}
        aria-label={`Tên chuyên mục ${topic.name}`}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitName();
          }
        }}
      />
      <span className={styles.topicCount}>{topic.postCount.toLocaleString('vi-VN')} bài</span>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={topic.isActive}
          disabled={busy}
          onChange={(event) => void save({ isActive: event.target.checked })}
        />
        <span>Đang dùng</span>
      </label>
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
      <div className={styles.topicAdd}>
        <input
          className={styles.input}
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
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={adding || name.trim().length === 0}
          onClick={() => void add()}
        >
          + Thêm
        </button>
      </div>
      {topics.length === 0 ? (
        <p className={styles.muted}>Chưa có chuyên mục nào.</p>
      ) : (
        <ul className={styles.topicRows}>
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
