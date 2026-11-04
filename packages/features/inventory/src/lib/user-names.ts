'use client';

import { authFetch } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useState } from 'react';

/** Bản ghi kho chỉ lưu id người dùng (`created_by`); tên thật lấy từ danh bạ của Workspace. */
type NameMap = ReadonlyMap<string, string>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONE: NameMap = new Map();

let pending: Promise<NameMap> | undefined;

/**
 * Danh bạ id người dùng → tên hiển thị, nạp một lần cho cả phiên. Lỗi (không có quyền, mạng) thì trả
 * danh bạ rỗng và lần sau thử lại; màn hình vẫn dùng được với id rút gọn.
 */
export function loadUserNames(): Promise<NameMap> {
  pending ??= (async () => {
    try {
      const response = await authFetch('/api/workspace/v1/directory');
      if (!response.ok) throw new Error(`directory ${response.status}`);
      const body = (await response.json()) as {
        people?: readonly { userId?: string; displayName?: string; name?: string }[];
      };
      const names = new Map<string, string>();
      for (const person of body.people ?? []) {
        const name = (person.displayName || person.name || '').trim();
        if (person.userId && name) names.set(person.userId, name);
      }
      return names as NameMap;
    } catch {
      pending = undefined;
      return NONE;
    }
  })();
  return pending;
}

/** Xoá bộ nhớ đệm; dùng cho test. */
export function resetUserNamesForTest(): void {
  pending = undefined;
}

/**
 * Tên để hiện cho một giá trị `created_by`: tên trong danh bạ nếu có; dữ liệu cũ lưu thẳng tên
 * thì giữ nguyên; id không tra được thì rút còn 8 ký tự đầu như các màn chứng từ và báo cáo.
 */
export function userLabel(names: NameMap, id: string | undefined, empty = '—'): string {
  const value = (id ?? '').trim();
  if (!value) return empty;
  const name = names.get(value);
  if (name) return name;
  return UUID.test(value) ? value.slice(0, 8) : value;
}

/** Hàm đổi id người dùng sang tên; trong lúc danh bạ chưa nạp xong hiện id rút gọn rồi tự cập nhật. */
export function useUserLabel(): (id: string | undefined, empty?: string) => string {
  const [names, setNames] = useState<NameMap>(NONE);
  useEffect(() => {
    let cancelled = false;
    void loadUserNames().then((loaded) => {
      if (!cancelled) setNames(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return useCallback((id, empty) => userLabel(names, id, empty), [names]);
}
