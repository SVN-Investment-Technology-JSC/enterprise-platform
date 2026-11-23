'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Thứ tự cột của một bảng: người dùng kéo tiêu đề cột để đổi chỗ, thứ tự lưu trong localStorage theo bảng và theo
 * người dùng (cùng máy lần sau vẫn giữ). Phần dưới là hàm thuần để kiểm thử; hook ở cuối file.
 */

/**
 * Ghép thứ tự đã lưu với danh sách cột mặc định: bỏ id lạ hoặc trùng, cột mới (chưa có trong bản lưu) nối vào cuối
 * theo thứ tự mặc định. Nhờ vậy thêm hoặc bớt cột trong mã không làm hỏng tuỳ chọn cũ.
 */
export function resolveColumnOrder(
  defaults: readonly string[],
  saved: readonly string[] | undefined,
): string[] {
  const known = new Set(defaults);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of saved ?? []) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of defaults) if (!seen.has(id)) order.push(id);
  return order;
}

/**
 * Đưa cột `fromId` tới trước hoặc sau cột `toId`. Cột ghim (`pinned`, luôn đứng đầu bảng và không kéo được) không bị
 * di chuyển và không nhận cột khác ở trước nó. Trả về cùng mảng khi không có gì đổi.
 */
export function moveColumn(
  order: readonly string[],
  fromId: string,
  toId: string,
  side: 'before' | 'after',
  pinned: readonly string[] = [],
): readonly string[] {
  if (fromId === toId) return order;
  if (pinned.includes(fromId)) return order;
  if (!order.includes(fromId) || !order.includes(toId)) return order;
  // Thả vào "trước" một cột ghim nghĩa là chen trước cột đầu bảng: không cho.
  if (pinned.includes(toId) && side === 'before') return order;
  // Nhiều cột ghim: thả "sau" một cột ghim nghĩa là ngay sau cột ghim cuối, không chen giữa các cột ghim.
  let anchor = toId;
  if (pinned.includes(toId)) {
    const lastPinned = order.filter((id) => pinned.includes(id)).pop();
    if (lastPinned !== undefined) anchor = lastPinned;
  }
  const without = order.filter((id) => id !== fromId);
  const at = without.indexOf(anchor) + (side === 'after' ? 1 : 0);
  const next = [...without.slice(0, at), fromId, ...without.slice(at)];
  return next.every((id, index) => id === order[index]) ? order : next;
}

/** Cột kế bên (`-1` trái, `1` phải) để di chuyển bằng bàn phím; `undefined` khi không còn chỗ hoặc gặp cột ghim. */
export function neighbourColumn(
  order: readonly string[],
  id: string,
  direction: -1 | 1,
  pinned: readonly string[] = [],
): string | undefined {
  const index = order.indexOf(id);
  if (index < 0) return undefined;
  const target = order[index + direction];
  if (target === undefined) return undefined;
  if (direction === -1 && pinned.includes(target)) return undefined;
  return target;
}

const storageKey = (tableKey: string, userId: string | undefined) =>
  `workspace:column-order:${tableKey}:${userId ?? 'anonymous'}`;

function readSaved(
  tableKey: string,
  userId: string | undefined,
): string[] | undefined {
  try {
    const raw = window.localStorage.getItem(storageKey(tableKey, userId));
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : undefined;
  } catch {
    return undefined;
  }
}

function writeSaved(
  tableKey: string,
  userId: string | undefined,
  order: readonly string[] | undefined,
): void {
  try {
    if (order === undefined)
      window.localStorage.removeItem(storageKey(tableKey, userId));
    else
      window.localStorage.setItem(
        storageKey(tableKey, userId),
        JSON.stringify(order),
      );
  } catch {
    // Trình duyệt chặn lưu trữ: thứ tự chỉ có hiệu lực trong phiên này.
  }
}

/**
 * Công tắc tạm tắt kéo thả ĐỔI CHỖ cột (độ rộng cột không bị ảnh hưởng). Tắt thì mọi bảng giữ thứ tự mặc định và bỏ qua
 * thứ tự người dùng đã lưu (bản lưu vẫn còn, bật lại là có ngay). Bật lại: đổi thành `true`.
 */
export const COLUMN_REORDER_ENABLED = false;

export interface ColumnOrder {
  /** Thứ tự hiện tại của MỌI id trong `defaults` (kể cả cột ghim). */
  readonly order: readonly string[];
  /** Đã khác thứ tự mặc định. */
  readonly customized: boolean;
  readonly move: (
    fromId: string,
    toId: string,
    side: 'before' | 'after',
  ) => void;
  readonly reset: () => void;
}

/**
 * Thứ tự cột của bảng `tableKey`. `defaults` phải là mảng ổn định (hằng module hoặc useMemo) vì nó là thứ tự khi chưa
 * tuỳ chỉnh. `pinned`: các cột luôn đứng đầu và không kéo được (thường là cột tên/cột chính). Lần vẽ đầu dùng thứ tự
 * mặc định rồi nạp tuỳ chọn đã lưu, nên không lệch giữa máy chủ và trình duyệt.
 */
export function useColumnOrder(
  tableKey: string,
  userId: string | undefined,
  defaults: readonly string[],
  pinned: readonly string[] = [],
): ColumnOrder {
  const [saved, setSaved] = useState<readonly string[] | undefined>(undefined);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  useEffect(() => {
    setSaved(readSaved(tableKey, userId));
  }, [tableKey, userId]);

  const order = resolveColumnOrder(
    defaults,
    COLUMN_REORDER_ENABLED ? saved : undefined,
  );
  const customized = order.some((id, index) => id !== defaults[index]);

  const move = useCallback(
    (fromId: string, toId: string, side: 'before' | 'after') => {
      setSaved((current) => {
        const base = resolveColumnOrder(defaults, current);
        const next = moveColumn(base, fromId, toId, side, pinnedRef.current);
        if (next === base) return current;
        writeSaved(tableKey, userId, next);
        return next;
      });
    },
    [tableKey, userId, defaults],
  );

  const reset = useCallback(() => {
    writeSaved(tableKey, userId, undefined);
    setSaved(undefined);
  }, [tableKey, userId]);

  return { order, customized, move, reset };
}

/* ---------------------------------------------------------------------------------------------------------------
   Độ rộng cột: kéo mép phải tiêu đề để nới hoặc thu; chữ bị khuất thì kéo ra xem hết.
   --------------------------------------------------------------------------------------------------------------- */

/** Độ rộng tối thiểu và tối đa của một cột (px). */
export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 900;

/** Kẹp độ rộng vào khoảng cho phép, làm tròn px. */
export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_COLUMN_WIDTH;
  return Math.min(
    MAX_COLUMN_WIDTH,
    Math.max(MIN_COLUMN_WIDTH, Math.round(width)),
  );
}

/**
 * Bản lưu hợp lệ: chỉ giữ id có trong `known` và độ rộng là số hữu hạn (đã kẹp). Rỗng thì `undefined`
 * (nghĩa là chưa tuỳ chỉnh).
 */
export function sanitizeColumnWidths(
  saved: unknown,
  known: readonly string[],
): Record<string, number> | undefined {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved))
    return undefined;
  const ids = new Set(known);
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(saved as Record<string, unknown>)) {
    if (ids.has(id) && typeof value === 'number' && Number.isFinite(value))
      out[id] = clampColumnWidth(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Kiểu của `<table>` khi mọi cột hiện đã có độ rộng tường minh: bố cục cố định, tổng bề ngang bằng tổng các cột (bảng
 * rộng hơn khung thì khung cuộn ngang). Trả `undefined` khi chưa tuỳ chỉnh hoặc còn cột chưa có số đo.
 */
export function explicitTableStyle(
  visibleIds: readonly string[],
  widths: Readonly<Record<string, number>> | undefined,
): { tableLayout: 'fixed'; width: number; minWidth: number } | undefined {
  if (!widths) return undefined;
  let total = 0;
  for (const id of visibleIds) {
    const width = widths[id];
    if (width === undefined) return undefined;
    total += width;
  }
  return { tableLayout: 'fixed', width: total, minWidth: total };
}

const widthKey = (tableKey: string, userId: string | undefined) =>
  `workspace:column-width:${tableKey}:${userId ?? 'anonymous'}`;

function readWidths(
  tableKey: string,
  userId: string | undefined,
  known: readonly string[],
) {
  try {
    const raw = window.localStorage.getItem(widthKey(tableKey, userId));
    return raw === null
      ? undefined
      : sanitizeColumnWidths(JSON.parse(raw) as unknown, known);
  } catch {
    return undefined;
  }
}

function writeWidths(
  tableKey: string,
  userId: string | undefined,
  widths: Record<string, number> | undefined,
): void {
  try {
    if (widths === undefined)
      window.localStorage.removeItem(widthKey(tableKey, userId));
    else
      window.localStorage.setItem(
        widthKey(tableKey, userId),
        JSON.stringify(widths),
      );
  } catch {
    // Trình duyệt chặn lưu trữ: độ rộng chỉ có hiệu lực trong phiên này.
  }
}

export interface ColumnWidths {
  /** Độ rộng tường minh của từng cột (px); `undefined` là chưa tuỳ chỉnh, bảng dùng độ rộng mặc định của CSS. */
  readonly widths: Readonly<Record<string, number>> | undefined;
  /** Đã có tuỳ chỉnh độ rộng. */
  readonly customized: boolean;
  /** Đặt độ rộng một cột (đã kẹp, lưu ngay); `undefined` là bỏ riêng cột đó khỏi bản lưu. */
  readonly setWidth: (id: string, width: number | undefined) => void;
  /**
   * Gọi lúc bắt đầu kéo: nếu bảng chưa có độ rộng tường minh thì chụp độ rộng hiện tại của MỌI cột (`measured`, đo từ
   * DOM) làm điểm xuất phát, để các cột khác không nhảy khi bảng chuyển sang bố cục cố định.
   */
  readonly freeze: (measured: Readonly<Record<string, number>>) => void;
  readonly reset: () => void;
}

/**
 * Độ rộng cột của bảng `tableKey`, lưu theo người dùng như `useColumnOrder`. `ids` là mọi id cột của bảng (mảng ổn định).
 */
export function useColumnWidths(
  tableKey: string,
  userId: string | undefined,
  ids: readonly string[],
): ColumnWidths {
  const [widths, setWidths] = useState<Record<string, number> | undefined>(
    undefined,
  );

  useEffect(() => {
    setWidths(readWidths(tableKey, userId, ids));
  }, [tableKey, userId, ids]);

  const setWidth = useCallback(
    (id: string, width: number | undefined) => {
      setWidths((current) => {
        const next = { ...(current ?? {}) };
        if (width === undefined) delete next[id];
        else next[id] = clampColumnWidth(width);
        const result = Object.keys(next).length > 0 ? next : undefined;
        writeWidths(tableKey, userId, result);
        return result;
      });
    },
    [tableKey, userId],
  );

  const freeze = useCallback(
    (measured: Readonly<Record<string, number>>) => {
      setWidths((current) => {
        // Bản lưu cũ có thể thiếu cột (cột ẩn nay hiện lại): bổ sung số đo cho các cột còn thiếu.
        const next: Record<string, number> = { ...(current ?? {}) };
        let changed = false;
        for (const id of ids) {
          const value = measured[id];
          if (next[id] === undefined && value !== undefined) {
            next[id] = clampColumnWidth(value);
            changed = true;
          }
        }
        if (current && !changed) return current;
        const result = Object.keys(next).length > 0 ? next : undefined;
        writeWidths(tableKey, userId, result);
        return result;
      });
    },
    [tableKey, userId, ids],
  );

  const reset = useCallback(() => {
    writeWidths(tableKey, userId, undefined);
    setWidths(undefined);
  }, [tableKey, userId]);

  return { widths, customized: widths !== undefined, setWidth, freeze, reset };
}
