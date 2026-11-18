'use client';

import type { PriceListSummary, PricingStatus } from '@enterprise-platform/contracts-crm';
import { SearchableSelect, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import { useEffect, useState } from 'react';
import { listPriceLists } from '../crm-api';
import { isPriceListEffective, priceListDisplayName } from './pricing.model';

/** Chưa có bảng giá nào chọn được. */
export const NO_PRICE_LISTS_TEXT = 'Chưa có bảng giá. Liên hệ quản trị CRM.';
/** Lời nhắc khi chưa chọn bảng giá (khoá thêm dòng hàng). */
export const PICK_PRICE_LIST_FIRST = 'Chọn bảng giá trước';
/** Hỏi lại khi đổi bảng giá lúc đã có dòng. */
export const CHANGE_PRICE_LIST_CONFIRM = 'Đổi bảng giá sẽ tính lại đơn giá gốc của mọi dòng; dòng đã ghi đè đơn giá giữ nguyên.';

/** Bảng giá đang gắn với báo giá hoặc đơn (đọc kèm để hiện cả khi bảng đã tắt, hết hạn). */
export interface ChosenPriceList {
  readonly id: string;
  readonly code: string | null;
  readonly name: string | null;
  readonly status: PricingStatus | null;
}

/** Hôm nay `YYYY-MM-DD` theo giờ Việt Nam (ngày tính giá mặc định). */
export function todayInVietnam(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Lựa chọn của ô "Bảng giá": chỉ bảng đang bật, còn hiệu lực tại ngày tính giá; mã ở phần mô tả để gõ mã cũng tìm ra
 * (ô chọn tìm không dấu theo tên, mô tả). Bảng đang gắn mà không còn chọn được vẫn có mặt để ô hiện đúng tên.
 */
export function priceListOptions(
  lists: readonly PriceListSummary[],
  date: string,
  current?: ChosenPriceList | null,
): SearchableSelectOption[] {
  const options = lists
    .filter((list) => isPriceListEffective(list, date))
    .map((list) => ({ value: list.id, label: list.name, description: list.code }));
  if (current?.id && !options.some((option) => option.value === current.id)) {
    const known = lists.find((list) => list.id === current.id);
    const name = current.name ?? known?.name ?? current.id;
    const status = current.status ?? known?.status ?? null;
    options.push({ value: current.id, label: priceListDisplayName(name, status) || name, description: current.code ?? known?.code ?? '' });
  }
  return options;
}

/** Danh sách bảng giá (đọc một lần khi mở màn); lỗi thì rỗng. */
export function usePriceLists(): { readonly lists: readonly PriceListSummary[]; readonly loaded: boolean } {
  const [lists, setLists] = useState<readonly PriceListSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    listPriceLists()
      .then((next) => alive && setLists(next))
      .catch(() => alive && setLists([]))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);
  return { lists, loaded };
}

/** Ô chọn "Bảng giá" (bắt buộc, mặc định trống) của báo giá, đơn bán, thử tính giá. Bọc trong `Field` để có nhãn. */
export function PriceListSelect({
  lists,
  date,
  value,
  current,
  disabled,
  onChange,
}: {
  lists: readonly PriceListSummary[];
  /** Ngày tính giá `YYYY-MM-DD`. */
  date: string;
  value: string;
  current?: ChosenPriceList | null;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const options = priceListOptions(lists, date, current);
  return (
    <SearchableSelect
      options={options}
      value={value}
      required
      disabled={disabled}
      placeholder={options.length ? 'Chọn bảng giá (tìm theo mã, tên)' : NO_PRICE_LISTS_TEXT}
      emptyText={options.length ? 'Không có bảng giá phù hợp' : NO_PRICE_LISTS_TEXT}
      onChange={onChange}
    />
  );
}
