'use client';

import {
  DEFAULT_PROCEDURE_LINK_SETTINGS,
  type ProcedureLinkSettings,
} from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { loadProjectArchiveSettings } from './workspace-api';

/** Cài đặt đổi hiếm khi; giữ lâu hơn một lần mở công việc nhưng vẫn tự làm mới. */
const CACHE_MS = 60_000;

let cached: { readonly at: number; readonly value: Promise<ProcedureLinkSettings> } | undefined;

/**
 * Cài đặt "Công việc gắn quy trình" của tenant, dùng chung cho mọi chỗ trên giao diện (nút Tạo / Đổi quy trình,
 * kéo tiến độ). Tải một lần rồi giữ trong bộ nhớ; lỗi mạng hay thiếu quyền đọc thì trả về mặc định (đúng hành vi
 * cũ) và không nhớ kết quả lỗi, lần sau thử lại. Giao diện chỉ để mờ nút — server vẫn kiểm.
 */
export function loadProcedureLinkSettings(): Promise<ProcedureLinkSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const entry = {
    at: Date.now(),
    value: loadProjectArchiveSettings()
      .then((loaded) => ({ ...DEFAULT_PROCEDURE_LINK_SETTINGS, ...loaded.procedureLink }))
      .catch(() => {
        if (cached === entry) cached = undefined;
        return DEFAULT_PROCEDURE_LINK_SETTINGS;
      }),
  };
  cached = entry;
  return entry.value;
}

/** Bỏ bản nhớ (sau khi lưu cài đặt, hoặc trong kiểm thử). */
export function resetProcedureLinkSettingsCache(): void {
  cached = undefined;
}

/** Cài đặt hiện tại; trong lúc tải dùng mặc định. */
export function useProcedureLinkSettings(): ProcedureLinkSettings {
  const [settings, setSettings] = useState<ProcedureLinkSettings>(DEFAULT_PROCEDURE_LINK_SETTINGS);
  useEffect(() => {
    let alive = true;
    void loadProcedureLinkSettings().then((loaded) => {
      if (alive) setSettings(loaded);
    });
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}
