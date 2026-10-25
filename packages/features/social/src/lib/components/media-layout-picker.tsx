'use client';

import { SOCIAL_MEDIA_LAYOUT_LABELS, type SocialMediaLayout } from '@enterprise-platform/contracts-social';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './media-layout.module.scss';

export interface MediaLayoutPickerProps {
  readonly value: SocialMediaLayout;
  readonly onChange: (layout: SocialMediaLayout) => void;
  readonly disabled?: boolean;
}

/**
 * Các bố cục cho người dùng chọn, theo thứ tự hiển thị. "Xếp dọc" (`stack`) tạm ẩn: bỏ dấu `//` ở dòng của nó để bật
 * lại. Phần hiển thị bài và server vẫn hỗ trợ `stack`, nên bài đã lưu bố cục này (nếu có) vẫn hiển thị đúng.
 */
const SELECTABLE_LAYOUTS: readonly SocialMediaLayout[] = [
  'auto',
  'grid',
  'featured',
  // 'stack',
  'carousel',
];

/** Mô tả ngắn từng bố cục, dùng làm gợi ý khi rê chuột và cho trình đọc màn hình. */
const LAYOUT_DESCRIPTIONS: Readonly<Record<SocialMediaLayout, string>> = {
  auto: 'ảnh dạng lưới, video xếp dọc bên dưới',
  grid: 'lưới 2 cột, các ô bằng nhau',
  featured: 'mục đầu lớn, các mục còn lại nhỏ bên dưới',
  stack: 'từng mục rộng hết khung theo thứ tự',
  carousel: 'dải cuộn ngang',
};

/** Sơ đồ nhỏ (SVG, 36x28) của từng bố cục; các khối dùng màu hiện tại của chữ. */
const DIAGRAMS: Readonly<Record<SocialMediaLayout, ReactNode>> = {
  auto: (
    <>
      <rect x="2" y="2" width="10" height="8" rx="1.5" />
      <rect x="13" y="2" width="10" height="8" rx="1.5" />
      <rect x="24" y="2" width="10" height="8" rx="1.5" />
      <rect x="2" y="13" width="32" height="6" rx="1.5" />
      <rect x="2" y="21" width="32" height="5" rx="1.5" />
    </>
  ),
  grid: (
    <>
      <rect x="2" y="2" width="15" height="11" rx="1.5" />
      <rect x="19" y="2" width="15" height="11" rx="1.5" />
      <rect x="2" y="15" width="15" height="11" rx="1.5" />
      <rect x="19" y="15" width="15" height="11" rx="1.5" />
    </>
  ),
  featured: (
    <>
      <rect x="2" y="2" width="32" height="14" rx="1.5" />
      <rect x="2" y="18" width="10" height="8" rx="1.5" />
      <rect x="13" y="18" width="10" height="8" rx="1.5" />
      <rect x="24" y="18" width="10" height="8" rx="1.5" />
    </>
  ),
  stack: (
    <>
      <rect x="2" y="2" width="32" height="7" rx="1.5" />
      <rect x="2" y="10.5" width="32" height="7" rx="1.5" />
      <rect x="2" y="19" width="32" height="7" rx="1.5" />
    </>
  ),
  carousel: (
    <>
      <rect x="-4" y="5" width="9" height="18" rx="1.5" />
      <rect x="7" y="5" width="22" height="18" rx="1.5" />
      <rect x="31" y="5" width="9" height="18" rx="1.5" />
    </>
  ),
};

/**
 * Chọn bố cục hiển thị ảnh và video của bài viết: nhóm nút radio có sơ đồ nhỏ và nhãn. Mũi tên chuyển và chọn
 * ngay (vòng tròn), Home/End về đầu/cuối; chỉ nút đang chọn nằm trong thứ tự Tab.
 */
export function MediaLayoutPicker({ value, onChange, disabled }: MediaLayoutPickerProps) {
  const buttons = useRef(new Map<SocialMediaLayout, HTMLButtonElement>());
  // Giá trị hiện tại không có trong danh sách chọn được (bố cục đang ẩn) thì nút đầu vẫn vào được bằng Tab.
  const focusable = SELECTABLE_LAYOUTS.includes(value) ? value : SELECTABLE_LAYOUTS[0];

  const select = (layout: SocialMediaLayout) => {
    onChange(layout);
    buttons.current.get(layout)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const index = SELECTABLE_LAYOUTS.indexOf(value);
    let next: number | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % SELECTABLE_LAYOUTS.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + SELECTABLE_LAYOUTS.length) % SELECTABLE_LAYOUTS.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = SELECTABLE_LAYOUTS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(SELECTABLE_LAYOUTS[next]);
  };

  return (
    <div
      className={styles.picker}
      role="radiogroup"
      aria-label="Bố cục hiển thị ảnh và video"
      onKeyDown={onKeyDown}
    >
      {SELECTABLE_LAYOUTS.map((layout) => {
        const selected = layout === value;
        const label = SOCIAL_MEDIA_LAYOUT_LABELS[layout];
        return (
          <button
            key={layout}
            ref={(node) => {
              if (node) buttons.current.set(layout, node);
              else buttons.current.delete(layout);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${label}: ${LAYOUT_DESCRIPTIONS[layout]}`}
            title={`${label}: ${LAYOUT_DESCRIPTIONS[layout]}`}
            tabIndex={layout === focusable ? 0 : -1}
            disabled={disabled}
            className={styles.option}
            data-selected={selected ? 'true' : undefined}
            onClick={() => onChange(layout)}
          >
            <svg className={styles.diagram} viewBox="0 0 36 28" aria-hidden="true" focusable="false">
              {DIAGRAMS[layout]}
            </svg>
            <span className={styles.optionLabel}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface MediaMoveButtonsProps {
  /** Tên tệp, đưa vào nhãn aria để phân biệt các ô. */
  readonly fileName: string;
  readonly canEarlier: boolean;
  readonly canLater: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onMove: (direction: 'earlier' | 'later') => void;
}

/** Cặp nút "Chuyển lên trước" / "Chuyển ra sau" cho một ảnh hoặc video trong ô soạn. */
export function MediaMoveButtons({ fileName, canEarlier, canLater, disabled, className, onMove }: MediaMoveButtonsProps) {
  const earlier = `Chuyển ${fileName} lên trước`;
  const later = `Chuyển ${fileName} ra sau`;
  return (
    <span className={`${styles.moveGroup} ${className ?? ''}`.trim()}>
      <button
        type="button"
        className={styles.moveButton}
        aria-label={earlier}
        title="Chuyển lên trước"
        disabled={disabled || !canEarlier}
        onClick={() => onMove('earlier')}
      >
        <ArrowLeft size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.moveButton}
        aria-label={later}
        title="Chuyển ra sau"
        disabled={disabled || !canLater}
        onClick={() => onMove('later')}
      >
        <ArrowRight size={13} aria-hidden="true" />
      </button>
    </span>
  );
}
