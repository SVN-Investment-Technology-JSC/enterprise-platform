'use client';

import type { ChatPerson } from '@enterprise-platform/contracts-chat';
import { useEffect, useSyncExternalStore } from 'react';
import { chatApi } from './chat-api';

/**
 * Danh bạ người dùng của công ty, dùng chung cho cả trang (ảnh đại diện ở mọi nơi, khung chat, gợi ý nhắc tên).
 * Chỉ tải một lần mỗi trang và làm mới định kỳ; mọi component đọc cùng một bản, không ai tự gọi API riêng.
 */
interface DirectoryState {
  readonly people: readonly ChatPerson[];
  readonly byId: ReadonlyMap<string, ChatPerson>;
  readonly loaded: boolean;
}

const REFRESH_MS = 5 * 60_000;
const EMPTY: DirectoryState = { people: [], byId: new Map(), loaded: false };

let state: DirectoryState = EMPTY;
let loading: Promise<void> | undefined;
let loadedAt = 0;
const listeners = new Set<() => void>();

function publish(next: DirectoryState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

function index(people: readonly ChatPerson[]): DirectoryState {
  return { people, byId: new Map(people.map((person) => [person.id.toLowerCase(), person])), loaded: true };
}

/** Tải danh bạ nếu chưa có hoặc đã cũ; nhiều nơi gọi cùng lúc chỉ tạo một lời gọi. */
export function ensurePeople(force = false): Promise<void> {
  if (!force && state.loaded && Date.now() - loadedAt < REFRESH_MS) return Promise.resolve();
  loading ??= chatApi
    .people()
    .then((directory) => {
      loadedAt = Date.now();
      publish(index(directory.people));
    })
    .catch(() => {
      // Không tải được (mất mạng, phiên hết hạn): giữ bản cũ, ảnh đại diện hiện chữ viết tắt.
      if (!state.loaded) publish({ ...EMPTY, loaded: false });
    })
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

/** Cập nhật ngay phiên bản ảnh của một người (sau khi chính mình đổi ảnh), không chờ lần tải lại. */
export function setPersonAvatarVersion(userId: string, avatarVersion: number | null): void {
  const key = userId.toLowerCase();
  const current = state.byId.get(key);
  if (!current) return;
  publish(index(state.people.map((person) => (person.id.toLowerCase() === key ? { ...person, avatarVersion } : person))));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePeople(): DirectoryState {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(() => {
    void ensurePeople();
  }, []);
  return snapshot;
}

export function usePerson(userId: string | null | undefined): ChatPerson | undefined {
  const { byId } = usePeople();
  return userId ? byId.get(userId.toLowerCase()) : undefined;
}

/** Dùng trong test để bắt đầu từ danh bạ trống. */
export function resetPeopleForTest(people?: readonly ChatPerson[]): void {
  loading = undefined;
  loadedAt = people ? Date.now() : 0;
  publish(people ? index(people) : EMPTY);
}
