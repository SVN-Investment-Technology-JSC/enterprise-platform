'use client';

import { createDocument, createPresetDocuments, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import { useMemo, useSyncExternalStore } from 'react';
import { freshId, isPresetId, localStore } from './local-store';
import type { BrandSettings, IconLibrary } from './types';

export type { BrandSettings, IconLibrary } from './types';

/** Thư viện icon dùng chung giữa các trang (kho singleton, đồng bộ giữa các tab). */
export function useIconLibrary(): IconLibrary {
  const snap = useSyncExternalStore(localStore.subscribe, localStore.getSnapshot, localStore.getServerSnapshot);

  return useMemo<IconLibrary>(() => {
    const docs = snap.docs;
    return {
      ready: snap.ready,
      docs,
      error: snap.error,
      get: (id) => docs.find((doc) => doc.id === id),
      save: async (doc) => {
        const saved: IconDocument = { ...doc, updatedAt: new Date().toISOString() };
        const exists = docs.some((item) => item.id === saved.id);
        localStore.setDocs(exists ? docs.map((item) => (item.id === saved.id ? saved : item)) : [...docs, saved]);
        return saved;
      },
      remove: async (id) => {
        if (isPresetId(id)) return;
        localStore.setDocs(docs.filter((doc) => doc.id !== id));
      },
      duplicate: async (id) => {
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
        const taken = new Set(docs.map((doc) => doc.id));
        const added = incoming.map((doc) => (taken.has(doc.id) ? { ...doc, id: freshId() } : doc));
        if (added.length > 0) localStore.setDocs([...docs, ...added]);
        return added.length;
      },
      resetPreset: async (id) => {
        const preset = createPresetDocuments().find((item) => item.id === id);
        if (!preset) return;
        localStore.setDocs(docs.map((doc) => (doc.id === id ? preset : doc)));
      },
    };
  }, [snap]);
}

/** Bảng màu và quy chuẩn thương hiệu. */
export function useBrandSettings(): BrandSettings {
  const snap = useSyncExternalStore(localStore.subscribe, localStore.getSnapshot, localStore.getServerSnapshot);
  return useMemo<BrandSettings>(
    () => ({
      ready: snap.ready,
      palette: snap.palette,
      rules: snap.rules,
      setPalette: (palette) => localStore.setPalette(palette),
      setRules: (rules) => localStore.setRules(rules),
      reset: () => localStore.resetSettings(),
    }),
    [snap],
  );
}

/** Icon trống để bắt đầu vẽ; chưa nằm trong thư viện cho tới khi lưu. */
export function newBlankIcon(overrides: Partial<IconDocument> = {}): IconDocument {
  return createDocument({ id: freshId(), ...overrides });
}
