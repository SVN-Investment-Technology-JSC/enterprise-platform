'use client';

import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  createDocument,
  normalizePalette,
  normalizeRules,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import { useMemo, useSyncExternalStore } from 'react';
import { findLocalOnly } from './doc-utils';
import { localLibraryOps } from './local-library';
import { freshId, localStore, type LocalSnapshot } from './local-store';
import {
  duplicateOnServer,
  importToServer,
  publishOnServer,
  removeFromServer,
  removeManyFromServer,
  resetPresetOnServer,
  saveManyToServer,
  saveToServer,
  serverInfoOf,
  syncLocalToServer,
} from './remote-library';
import { remoteStore, type RemoteSnapshot } from './remote-store';
import type { BrandSettings, IconLibrary } from './types';

export { isPresetId } from './local-store';
export type { BrandSettings, IconLibrary, ServerIconInfo, StoreMode, SyncResult } from './types';

function buildLibrary(local: LocalSnapshot, remote: RemoteSnapshot): IconLibrary {
  if (remote.mode === 'server') {
    return {
      ready: remote.ready,
      docs: remote.docs,
      error: remote.error,
      mode: 'server',
      modeReason: null,
      localOnlyCount: findLocalOnly(local.docs, remote.summaries).length,
      loading: remote.loading,
      get: (id) => remote.docsById.get(id),
      serverInfo: (id) => serverInfoOf(remote.summaries, id),
      save: saveToServer,
      saveMany: saveManyToServer,
      remove: removeFromServer,
      removeMany: removeManyFromServer,
      duplicate: duplicateOnServer,
      importDocs: importToServer,
      resetPreset: resetPresetOnServer,
      publish: publishOnServer,
      syncLocalToServer,
      reloadFromServer: (id) => (id === undefined ? remoteStore.reload() : remoteStore.reloadIcon(id)),
    };
  }

  // Đang kiểm tra kết nối: chưa biết nên hiện bản nào, giữ khung chờ thay vì hiện bản cục bộ rồi đổi sang bản máy chủ.
  const checking = remote.mode === 'checking';
  return {
    ready: !checking && local.ready,
    docs: checking ? [] : local.docs,
    error: checking ? null : local.error,
    mode: remote.mode,
    modeReason: remote.localReason,
    localOnlyCount: 0,
    loading: remote.loading,
    get: (id) => (checking ? undefined : local.docs.find((doc) => doc.id === id)),
    serverInfo: () => null,
    ...localLibraryOps,
    syncLocalToServer: async () => ({ pushed: 0, failed: 0 }),
    reloadFromServer: () => remoteStore.reload(),
  };
}

function buildSettings(local: LocalSnapshot, remote: RemoteSnapshot): BrandSettings {
  if (remote.mode === 'local') {
    return {
      ready: local.ready,
      palette: local.palette,
      rules: local.rules,
      mode: 'local',
      saving: false,
      error: null,
      setPalette: (palette) => localStore.setPalette(normalizePalette(palette)),
      setRules: (rules) => localStore.setRules(normalizeRules(rules)),
      reset: () => localStore.resetSettings(),
    };
  }
  const { standards } = remote;
  return {
    ready: standards !== null,
    palette: standards?.palette ?? DEFAULT_PALETTE,
    rules: standards?.rules ?? DEFAULT_RULES,
    mode: remote.mode,
    saving: remote.standardsSaving,
    error: remote.standardsError,
    setPalette: (palette) => remoteStore.setStandards({ palette: normalizePalette(palette) }),
    setRules: (rules) => remoteStore.setStandards({ rules: normalizeRules(rules) }),
    reset: () => remoteStore.setStandards({ palette: DEFAULT_PALETTE, rules: DEFAULT_RULES }, true),
  };
}

/**
 * Thư viện icon dùng chung giữa các trang (kho singleton). Máy chủ là nguồn sự thật khi gọi được API; chưa gọi được
 * (chưa có API, mất mạng, không có quyền) thì lưu tạm trong trình duyệt (localStorage, đồng bộ giữa các tab).
 */
export function useIconLibrary(): IconLibrary {
  const local = useSyncExternalStore(localStore.subscribe, localStore.getSnapshot, localStore.getServerSnapshot);
  const remote = useSyncExternalStore(remoteStore.subscribe, remoteStore.getSnapshot, remoteStore.getServerSnapshot);
  return useMemo(() => buildLibrary(local, remote), [local, remote]);
}

/** Bảng màu và quy chuẩn thương hiệu. Dữ liệu đưa vào luôn được chuẩn hoá trước khi lưu. */
export function useBrandSettings(): BrandSettings {
  const local = useSyncExternalStore(localStore.subscribe, localStore.getSnapshot, localStore.getServerSnapshot);
  const remote = useSyncExternalStore(remoteStore.subscribe, remoteStore.getSnapshot, remoteStore.getServerSnapshot);
  return useMemo(() => buildSettings(local, remote), [local, remote]);
}

/** Icon trống để bắt đầu vẽ; chưa nằm trong thư viện cho tới khi lưu. */
export function newBlankIcon(overrides: Partial<IconDocument> = {}): IconDocument {
  return createDocument({ id: freshId(), ...overrides });
}
