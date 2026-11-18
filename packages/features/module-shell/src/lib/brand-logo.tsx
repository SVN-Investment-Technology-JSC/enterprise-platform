'use client';

import { useBrandSlot } from '@enterprise-platform/shared-ui';
import { useState, type ImgHTMLAttributes } from 'react';

export interface BrandLogoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** Đường dẫn ảnh mặc định khi tenant chưa cấu hình slot `brand.logo` hoặc tải SVG lỗi. */
  readonly fallbackSrc?: string;
}

const useBrandSlotSafe =
  typeof useBrandSlot === 'function'
    ? useBrandSlot
    : () => ({ item: undefined, hasCustom: false, loaded: false });

/**
 * Hiển thị logo thương hiệu từ slot `brand.logo` nếu có, tự rơi về `fallbackSrc`
 * khi chưa cấu hình hoặc khi tải ảnh SVG thất bại.
 */
export function BrandLogo({
  fallbackSrc = '/brand-logo.jpg',
  alt = '',
  onError,
  ...rest
}: BrandLogoProps) {
  const { item, hasCustom } = useBrandSlotSafe('brand.logo');
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const itemKey = item ? `${item.iconId}@${item.version}` : null;

  const customSrc =
    hasCustom && item && itemKey && failedKey !== itemKey
      ? `/api/platform/v1/brand/slots/brand.logo/svg?icon=${encodeURIComponent(item.iconId)}&v=${item.version}`
      : null;

  return (
    <img
      {...rest}
      src={customSrc ?? fallbackSrc}
      alt={alt}
      onError={(event) => {
        if (customSrc && itemKey) {
          setFailedKey(itemKey);
        }
        onError?.(event);
      }}
    />
  );
}
