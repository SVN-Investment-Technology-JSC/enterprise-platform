'use client';

import {
  createDocument,
  createPresetDocuments,
  normalizePalette,
  normalizeRules,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import { useMemo, useSyncExternalStore } from 'react';
import { freshId, isPresetId, localStore } from './local-store';
import type { BrandSettings, IconLibrary } from './types';

export { isPresetId } from './local-store';
export type { BrandSettings, IconLibrary } from './types';

/** Danh sách mới nhất trong kho. Các thao tác đọc ở đây thay vì danh sách lúc render để gọi liên tiếp không ghi đè nhau. */
const latestDocs = (): readonly IconDocument[] => localStore.getSnapshot().docs;

/** Thư viện icon dùng chung giữa các trang (kho singleton, đồng bộ giữa các tab). */
export function useIconLibrary(): IconLibrary {
  const snap = useSyncExternalStore(localStore.subscribe, localStore.getSnapshot, localStore.getServerSnapshot);

  return useMemo<IconLibrary>(() => {
    return {
      ready: snap.ready,
      docs: snap.docs,
      error: snap.error,
      get: (id) => snap.docs.find((doc) => doc.id === id),
      save: async (doc) => {
        const docs = latestDocs();
        const saved: IconDocument = { ...doc, updatedAt: new Date().toISOString() };
        const exists = docs.some((item) => item.id === saved.id);
        localStore.setDocs(exists ? docs.map((item) => (item.id === saved.id ? saved : item)) : [...docs, saved]);
        return saved;
      },
      saveMany: async (incoming) => {
        if (incoming.length === 0) return;
        const docs = latestDocs();
        const now = new Date().toISOString();
        const changes = new Map(incoming.map((doc) => [doc.id, { ...doc, updatedAt: now }]));
        const known = new Set(docs.map((doc) => doc.id));
        const added = [...changes.values()].filter((doc) => !known.has(doc.id));
        localStore.setDocs([...docs.map((doc) => changes.get(doc.id) ?? doc), ...added]);
      },
      remove: async (id) => {
        if (isPresetId(id)) return;
        localStore.setDocs(latestDocs().filter((doc) => doc.id !== id));
      },
      removeMany: async (ids) => {
        const doomed = new Set(ids.filter((id) => !isPresetId(id)));
        const docs = latestDocs();
        const kept = docs.filter((doc) => !doomed.has(doc.id));
        if (kept.length === docs.length) return 0;
        localStore.setDocs(kept);
        return docs.length - kept.length;
      },
      duplicate: async (id) => {
        const docs = latestDocs();
        const source = docs.find((doc) => doc.id === id);
        if (!source) return null;
        const now = new Date().toISOString();
        const copy: IconDocument = {
          ...source,
          id: freshId(),
          name: `${source.name} (bản sao)`.slice(0, 80),
          category: source.category === 'brand' || source.category === 'module' ? 'custom' : source.category,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        };
        localStore.setDocs([...docs, copy]);
        return copy;
      },
      importDocs: async (incoming) => {
        const docs = latestDocs();
        const taken = new Set(docs.map((doc) => doc.id));
        const added: IconDocument[] = [];
        for (const doc of incoming) {
          const next = taken.has(doc.id) ? { ...doc, id: freshId() } : doc;
          taken.add(next.id);
          added.push(next);
        }
        if (added.length > 0) localStore.setDocs([...docs, ...added]);
        return added.length;
      },
      resetPreset: async (id) => {
        const preset = createPresetDocuments().find((item) => item.id === id);
        if (!preset) return;
        localStore.setDocs(latestDocs().map((doc) => (doc.id === id ? preset : doc)));
      },
    };
  }, [snap]);
}

/** Bảng màu và quy chuẩn thương hiệu. Dữ liệu đưa vào luôn được chuẩn hoá trước khi lưu. */
export function useBrandSettings(): BrandSettings {
  const snap = useSyncExternalStore(localStore.subscribe, localStore.getSnapshot, localStore.getServerSnapshot);
  return useMemo<BrandSettings>(
    () => ({
      ready: snap.ready,
      palette: snap.palette,
      rules: snap.rules,
      setPalette: (palette) => localStore.setPalette(normalizePalette(palette)),
      setRules: (rules) => localStore.setRules(normalizeRules(rules)),
      reset: () => localStore.resetSettings(),
    }),
    [snap],
  );
}

/** Icon trống để bắt đầu vẽ; chưa nằm trong thư viện cho tới khi lưu. */
export function newBlankIcon(overrides: Partial<IconDocument> = {}): IconDocument {
  return createDocument({ id: freshId(), ...overrides });
}
