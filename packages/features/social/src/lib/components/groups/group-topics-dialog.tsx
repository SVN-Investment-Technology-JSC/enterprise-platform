'use client';

import {
  SOCIAL_GROUP_TOPICS_MAX,
  SOCIAL_GROUP_TOPIC_NAME_MAX,
  type SocialGroupTopic,
} from '@enterprise-platform/contracts-social';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../../social-api';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { ConfirmDialog, Dialog } from '../ui';
import { CONTROL, EMPTY_LINE } from './group-ui';
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
    <li className="flex items-center gap-2 py-1 text-slate-500 not-first:border-t not-first:border-slate-100">
      <Tag size={14} className="flex-none" aria-hidden="true" />
      <Input
        className="h-[30px] flex-1 border-transparent bg-transparent px-2 text-[13px] font-semibold text-slate-900 hover:border-slate-300 focus-visible:bg-white"

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
      <span className="text-xs whitespace-nowrap">{topic.postCount} bài</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-slate-500 hover:bg-red-50 hover:text-red-600"
              aria-label={`Xoá chủ đề ${topic.name}`}
              disabled={disabled}
              onClick={() => onDelete(topic)}
            />
          }
        >
          <Trash2 size={14} aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="top">Xoá chủ đề</TooltipContent>
      </Tooltip>
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
        <div className="flex gap-2">
          <Input
            className={CONTROL}
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
          <Button
            type="button"
            className="h-[38px] gap-1.5 rounded-md px-4 text-[13.5px] font-semibold"
            onClick={() => void add()}
            disabled={!text.trim() || full || busy}
          >
            <Plus size={14} aria-hidden="true" />
            Thêm mới
          </Button>
        </div>
        {loading ? (
          <p className={EMPTY_LINE} aria-busy="true">
            Đang tải…
          </p>
        ) : topics.length === 0 ? (
          <p className={EMPTY_LINE}>Nhóm chưa có chủ đề nào.</p>
        ) : (
          <ul className="m-0 flex max-h-80 list-none flex-col overflow-y-auto p-0">
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
