'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

/** Hộp thoại của Studio dùng z-index tới 10000 (bộ chọn màu), tooltip phải nằm trên chúng. */
const ABOVE_POPOVERS = 'z-[10050]';

export interface HintProps {
  /** Nội dung gợi ý. Rỗng thì không có tooltip và `children` được trả nguyên. */
  readonly label: ReactNode;
  /** Đúng một phần tử (nút, liên kết, ô nhập...) làm mốc hiện tooltip; nó giữ nguyên mọi thuộc tính. */
  readonly children: ReactElement;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  /**
   * Bọc `children` trong một thẻ `span` làm mốc hiện tooltip (giá trị là lớp CSS của thẻ bọc). Chỉ dùng cho nút có lúc bị
   * khoá: nút khoá không nhận chuột nên tooltip trên chính nó không hiện. Thẻ bọc luôn có mặt (kể cả khi nút đang bật)
   * để nút không bị dựng lại, mất focus, mỗi lần chuyển giữa khoá và bật.
   */
  readonly wrapperClassName?: string;
  /**
   * Thuộc tính khác (như `ref`, `onClick`) được chuyển xuống phần tử con. Cần khi `Hint` nằm trong một thành phần dùng
   * `cloneElement` để gắn sự kiện vào nút mở (ví dụ `Popconfirm`).
   */
  readonly [forwarded: string]: unknown;
}

/**
 * Tooltip shadcn/ui thay cho thuộc tính `title` của trình duyệt: cùng kiểu với phần còn lại của ứng dụng, hiện khi rê chuột
 * hoặc khi focus bàn phím. Không thay tên truy cập: phần tử vẫn cần `aria-label` nếu không có chữ.
 */
export function Hint({ label, children, side, wrapperClassName, ...forwarded }: HintProps) {
  const element = Object.keys(forwarded).length > 0 && isValidElement(children) ? cloneElement(children, forwarded) : children;
  if (label === null || label === undefined || label === false || label === '') return element;

  return (
    <Tooltip>
      {wrapperClassName === undefined ? (
        <TooltipTrigger render={element} />
      ) : (
        <TooltipTrigger render={<span className={cn('inline-flex', wrapperClassName)} />}>{element}</TooltipTrigger>
      )}
      <TooltipContent positionerClassName={ABOVE_POPOVERS} side={side}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
