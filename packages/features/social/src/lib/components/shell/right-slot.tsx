'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Cột phải của khung 3 cột. Mặc định cột phải là "bảng nhanh"; trang nào có cột phải riêng (chi tiết nhóm) lấy phần tử này
 * rồi dựng nội dung vào đó bằng `RightSlotPortal`.
 */
export const SocialRightSlotContext = createContext<HTMLElement | null>(null);

export function RightSlotPortal({ children }: { readonly children: ReactNode }) {
  const slot = useContext(SocialRightSlotContext);
  return slot ? createPortal(children, slot) : null;
}
