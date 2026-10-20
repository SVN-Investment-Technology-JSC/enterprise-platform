'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_POLYGON_SIDES, clampPolygonSides } from './interactions';
import type { DisplayMode } from './tool';

/** Tuỳ chọn riêng của người dùng trong trình thiết kế, nhớ lại ở lần mở sau. */
export interface EditorPrefs {
  readonly showGrid: boolean;
  readonly snapGrid: boolean;
  readonly snapObjects: boolean;
  readonly displayMode: DisplayMode;
  readonly polygonSides: number;
  /** Các mục ở cột phải đã thu gọn, theo mã mục. */
  readonly collapsed: Readonly<Record<string, boolean>>;
}

export const DEFAULT_EDITOR_PREFS: EditorPrefs = {
  showGrid: true,
  snapGrid: true,
  snapObjects: true,
  displayMode: 'brand',
  polygonSides: DEFAULT_POLYGON_SIDES,
  collapsed: { compliance: true },
};

export const EDITOR_PREFS_KEY = 'svndts-brand-editor-prefs-v1';

/** Ép dữ liệu đọc từ localStorage về đúng kiểu; thiếu hoặc sai thì dùng giá trị mặc định. */
export function normalizeEditorPrefs(raw: unknown): EditorPrefs {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_EDITOR_PREFS;
  const item = raw as Record<string, unknown>;
  const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const collapsed: Record<string, boolean> = {};
  if (typeof item.collapsed === 'object' && item.collapsed !== null) {
    for (const [key, value] of Object.entries(item.collapsed as Record<string, unknown>)) {
      if (typeof value === 'boolean' && /^[a-z-]{1,24}$/.test(key)) collapsed[key] = value;
    }
  }
  return {
    showGrid: flag(item.showGrid, DEFAULT_EDITOR_PREFS.showGrid),
    snapGrid: flag(item.snapGrid, DEFAULT_EDITOR_PREFS.snapGrid),
    snapObjects: flag(item.snapObjects, DEFAULT_EDITOR_PREFS.snapObjects),
    displayMode: item.displayMode === 'currentColor' ? 'currentColor' : 'brand',
    polygonSides: typeof item.polygonSides === 'number' ? clampPolygonSides(item.polygonSides) : DEFAULT_EDITOR_PREFS.polygonSides,
    collapsed: Object.keys(collapsed).length > 0 || 'collapsed' in item ? collapsed : DEFAULT_EDITOR_PREFS.collapsed,
  };
}

function readPrefs(): EditorPrefs {
  try {
    const text = window.localStorage.getItem(EDITOR_PREFS_KEY);
    return text ? normalizeEditorPrefs(JSON.parse(text)) : DEFAULT_EDITOR_PREFS;
  } catch {
    return DEFAULT_EDITOR_PREFS;
  }
}

function writePrefs(prefs: EditorPrefs): void {
  try {
    window.localStorage.setItem(EDITOR_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Trình duyệt chặn hoặc hết bộ nhớ: bỏ qua, tuỳ chọn chỉ có hiệu lực trong phiên này.
  }
}

/**
 * Tuỳ chọn của trình thiết kế. Lần dựng đầu dùng mặc định (khớp với máy chủ), rồi nạp giá trị đã lưu ngay sau khi gắn vào trang;
 * chỉ ghi lại khi người dùng thật sự đổi một tuỳ chọn.
 */
export function useEditorPrefs(): readonly [EditorPrefs, (patch: Partial<EditorPrefs>) => void] {
  const [prefs, setPrefs] = useState<EditorPrefs>(DEFAULT_EDITOR_PREFS);
  const touched = useRef(false);

  useEffect(() => {
    setPrefs(readPrefs());
  }, []);

  useEffect(() => {
    if (touched.current) writePrefs(prefs);
  }, [prefs]);

  const update = useCallback((patch: Partial<EditorPrefs>) => {
    touched.current = true;
    setPrefs((current) => ({ ...current, ...patch }));
  }, []);

  return [prefs, update] as const;
}
