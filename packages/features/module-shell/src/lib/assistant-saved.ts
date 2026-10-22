'use client';

import type { AssistantActionResult } from '@enterprise-platform/contracts-assistant';
import { useEffect, useRef } from 'react';

/**
 * Báo trang phân hệ phía sau là card Trợ lý vừa lưu.
 *
 * Card lưu trong trang form nhúng (iframe lồng trong khung chat), nên màn hình của phân hệ ở cửa sổ ngoài cùng không
 * hay biết. Trang form nhúng phát bản ghi vừa lưu lên `BroadcastChannel` của tên miền ERP; màn hình nào hiện loại bản
 * ghi đó gọi `useAssistantSaved` với các thao tác liên quan rồi tải lại bằng chính hàm nó dùng sau khi tự lưu. Tab ERP
 * khác đang mở cũng nhận được. Khung chat không tham gia.
 */
const CHANNEL = 'enterprise-platform:assistant-saved';

export interface AssistantSavedRecord {
  /** `key` của thao tác vừa lưu. */
  readonly key: string;
  readonly id?: string;
  readonly label?: string;
  readonly href?: string;
}

let sender: BroadcastChannel | undefined;

function isSavedRecord(value: unknown): value is AssistantSavedRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['key'] === 'string' &&
    ['id', 'label', 'href'].every((field) => record[field] === undefined || typeof record[field] === 'string')
  );
}

/** Phát bản ghi vừa lưu trong card cho mọi trang ERP cùng tên miền. */
export function announceAssistantSaved(result: AssistantActionResult): void {
  if (typeof BroadcastChannel === 'undefined') return;
  sender ??= new BroadcastChannel(CHANNEL);
  const record: AssistantSavedRecord = {
    key: result.key,
    ...(result.id ? { id: result.id } : {}),
    ...(result.label ? { label: result.label } : {}),
    ...(result.href ? { href: result.href } : {}),
  };
  sender.postMessage(record);
}

/** Mọi `key` của một bộ thao tác (`defineAssistantActions`), cho màn hình hiện bản ghi của cả phân hệ. */
export function assistantActionKeys(catalog: Readonly<Record<string, { readonly key: string }>>): string[] {
  return Object.values(catalog).map((action) => action.key);
}

/**
 * Gọi `onSaved` mỗi khi card Trợ lý lưu xong một trong các thao tác `keys`, để màn hình tải lại dữ liệu của mình mà
 * vẫn giữ bộ lọc, mục đang mở.
 */
export function useAssistantSaved(
  keys: readonly string[],
  onSaved: (record: AssistantSavedRecord) => void,
): void {
  const ref = useRef(onSaved);
  ref.current = onSaved;
  const watched = keys.join('\n');
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const wanted = new Set(watched.split('\n'));
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      if (isSavedRecord(event.data) && wanted.has(event.data.key)) ref.current(event.data);
    };
    return () => channel.close();
  }, [watched]);
}
