'use client';

import type { Tag } from '@enterprise-platform/contracts-workspace';
import { useEffect, useMemo, useState } from 'react';
import * as api from '../workspace-api';

/**
 * Nhãn của cả tenant, tải một lần cho cả trang như danh bạ. Tạo nhãn mới thì
 * mọi nơi đang dùng hook cùng thấy ngay.
 */
let cache: readonly Tag[] | undefined;
let pending: Promise<readonly Tag[]> | undefined;
const listeners = new Set<(tags: readonly Tag[]) => void>();

function publish(tags: readonly Tag[]) {
  cache = tags;
  for (const listener of listeners) listener(tags);
}

function loadOnce(): Promise<readonly Tag[]> {
  if (cache) return Promise.resolve(cache);
  pending ??= api
    .listTags()
    .then((result) => {
      publish(result.items);
      return result.items;
    })
    .catch(() => {
      pending = undefined;
      return [];
    });
  return pending;
}

/** Màu nhãn chưa đặt màu: chọn theo tên để cùng một nhãn luôn cùng một màu. */
const PALETTE = ['#2563eb', '#0d9488', '#7c3aed', '#db2777', '#d97706', '#16a34a', '#475569'];

export function tagColor(tag: Pick<Tag, 'name' | 'color'>): string {
  if (tag.color) return tag.color;
  let hash = 0;
  for (const char of tag.name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length] as string;
}

export interface TagsView {
  readonly tags: readonly Tag[];
  readonly loaded: boolean;
  readonly find: (tagId: string) => Tag | undefined;
  readonly create: (name: string) => Promise<Tag>;
}

export function useTags(): TagsView {
  const [tags, setTags] = useState<readonly Tag[] | undefined>(cache);

  useEffect(() => {
    listeners.add(setTags);
    void loadOnce().then(setTags);
    return () => {
      listeners.delete(setTags);
    };
  }, []);

  return useMemo(() => {
    const list = tags ?? [];
    const byId = new Map(list.map((tag) => [tag.id, tag]));
    return {
      tags: list,
      loaded: tags !== undefined,
      find: (tagId) => byId.get(tagId),
      create: async (name) => {
        const tag = await api.createTag({ name });
        publish([...(cache ?? []).filter((entry) => entry.id !== tag.id), tag]);
        return tag;
      },
    };
  }, [tags]);
}
