'use client';

import { useEffect, useState } from 'react';

/**
 * Người dùng này có dùng được phân hệ Tài chính không, để thẻ phiếu trên bước Tài chính chỉ hiện nút "Mở nhanh" và
 * "Mở phiếu" cho người mở được.
 *
 * - `checking`: chưa biết (đang hỏi) — chưa hiện nút, để người không có quyền không thấy nút nháy lên rồi biến mất.
 * - `allowed`: Tài chính trả quyền hạn cho người dùng.
 * - `denied`: Tài chính từ chối (không có quyền Tài chính nào, hoặc doanh nghiệp chưa được cấp phân hệ) hoặc không có.
 *
 * Chỉ là gợi ý giao diện: quyền thật vẫn do Tài chính kiểm ở server mỗi lần mở phiếu hay thao tác. Quy trình không chép
 * luật quyền của Tài chính, chỉ dùng kết quả "có dùng được hay không" của chính API quyền hạn của Tài chính.
 */
export type FinanceAccess = 'checking' | 'allowed' | 'denied';

const CAPABILITIES_URL = '/api/finance/v1/capabilities';
/** Giữ kết quả rõ ràng ngần này lâu để mọi thẻ trong trang dùng chung một lần hỏi. */
const CACHE_MS = 60_000;

let cached: { readonly value: 'allowed' | 'denied'; readonly at: number } | undefined;
let inflight: Promise<FinanceAccess> | undefined;

/**
 * 2xx → có quyền; 401/403/404 → không dùng được (module chưa cấp hoặc không có quyền nào). Các mã khác (5xx, mạng) là
 * lỗi tạm thời, chưa kết luận gì: vẫn hiện nút và không nhớ kết quả, để Tài chính tự báo lý do khi mở.
 */
export function financeAccessFromStatus(status: number): 'allowed' | 'denied' | 'unknown' {
  if (status >= 200 && status < 300) return 'allowed';
  if (status === 401 || status === 403 || status === 404) return 'denied';
  return 'unknown';
}

export function loadFinanceAccess(now: () => number = Date.now): Promise<FinanceAccess> {
  if (cached && now() - cached.at < CACHE_MS) return Promise.resolve(cached.value);
  inflight ??= fetch(CAPABILITIES_URL, { credentials: 'include', cache: 'no-store' })
    .then((response) => financeAccessFromStatus(response.status))
    .catch(() => 'unknown' as const)
    .then((result): FinanceAccess => {
      if (result === 'unknown') return 'allowed';
      cached = { value: result, at: now() };
      return result;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

/** Dùng cho test và khi đổi người dùng. */
export function resetFinanceAccessCache(): void {
  cached = undefined;
  inflight = undefined;
}

export function useFinanceAccess(enabled = true): FinanceAccess {
  const [access, setAccess] = useState<FinanceAccess>(() => (cached && Date.now() - cached.at < CACHE_MS ? cached.value : 'checking'));
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    void loadFinanceAccess().then((value) => {
      if (active) setAccess(value);
    });
    return () => {
      active = false;
    };
  }, [enabled]);
  return access;
}
