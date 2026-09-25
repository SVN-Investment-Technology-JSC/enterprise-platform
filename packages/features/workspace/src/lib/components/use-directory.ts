'use client';

import type { DirectoryPerson, DirectoryResponse } from '@enterprise-platform/contracts-workspace';
import { useEffect, useMemo, useState } from 'react';
import * as api from '../workspace-api';

/**
 * Một lần tải danh bạ cho cả trang.
 *
 * Nhiều thành phần cùng cần tên người (cây, hộp thoại, chat, báo cáo); mỗi
 * cái tự gọi API là vài lượt thừa cho cùng một dữ liệu đổi rất chậm. Lời hứa
 * được giữ ở cấp module; lỗi thì xoá đi để lần mở sau thử lại.
 */
let pending: Promise<DirectoryResponse> | undefined;

function loadOnce(): Promise<DirectoryResponse> {
  pending ??= api.loadDirectory().catch(() => {
    pending = undefined;
    return { people: [], degraded: true };
  });
  return pending;
}

export interface DirectoryView {
  readonly people: readonly DirectoryPerson[];
  readonly degraded: boolean;
  /** Đã có kết quả từ server (kể cả rỗng); trước đó danh sách rỗng chưa có nghĩa gì. */
  readonly loaded: boolean;
  /** Tên hiển thị; không có trong danh bạ thì rơi về chính userId. */
  readonly nameOf: (userId: string | undefined) => string;
  readonly find: (userId: string) => DirectoryPerson | undefined;
}

export function useDirectory(): DirectoryView {
  const [snapshot, setSnapshot] = useState<DirectoryResponse>();

  useEffect(() => {
    let alive = true;
    void loadOnce().then((value) => {
      if (alive) setSnapshot(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(() => {
    const people = snapshot?.people ?? [];
    const byId = new Map(people.map((person) => [person.userId, person]));
    return {
      people,
      degraded: snapshot?.degraded ?? false,
      loaded: snapshot !== undefined,
      nameOf: (userId) => (userId ? (byId.get(userId)?.displayName ?? userId) : '—'),
      find: (userId) => byId.get(userId),
    };
  }, [snapshot]);
}
