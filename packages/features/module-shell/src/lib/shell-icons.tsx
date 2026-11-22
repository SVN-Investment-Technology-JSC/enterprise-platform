import type { ComponentType, ReactNode, SVGProps } from 'react';
import type { AppIconFallbackProps } from '@enterprise-platform/shared-ui';

type FallbackIcon = ComponentType<AppIconFallbackProps>;

/**
 * Tạo component fallback cho `AppIcon` từ một svg tự vẽ của khung: giữ nguyên
 * hình và thuộc tính trình bày cũ, chỉ nhận thêm `className` và `size` từ
 * `AppIcon` để khi chưa gán icon thương hiệu thì giao diện không đổi.
 */
function svgFallback(base: SVGProps<SVGSVGElement>, shapes: ReactNode): FallbackIcon {
  function ShellFallbackIcon({ className, size, 'aria-label': ariaLabel }: AppIconFallbackProps) {
    const dimension = size === undefined ? {} : { width: size, height: size };
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden={ariaLabel ? undefined : true}
        aria-label={ariaLabel}
        {...base}
        {...dimension}
        className={className ?? base.className}
      >
        {shapes}
      </svg>
    );
  }
  return ShellFallbackIcon;
}

/** Khung sáng: svg không có thuộc tính trình bày, kiểu nét lấy từ class `icon` của scss. */
const PLAIN: SVGProps<SVGSVGElement> = {};

/** Khung tối: thuộc tính trình bày nằm ngay trên svg. */
const STROKE: SVGProps<SVGSVGElement> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const SearchFallback = svgFallback(
  PLAIN,
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>,
);

export const HomeFallback = svgFallback(
  PLAIN,
  <>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 22V12h6v10" />
  </>,
);

export const PanelLeftFallback = svgFallback(
  PLAIN,
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
  </>,
);

export const LogoutFallback = svgFallback(
  PLAIN,
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </>,
);

export const SettingsFallback = svgFallback(
  PLAIN,
  <>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);

export const AssistantFallback = svgFallback(
  PLAIN,
  <>
    <path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6-4.6-1.9 4.6-1.9z" />
    <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
  </>,
);

export const ModuleGridFallback = svgFallback(
  PLAIN,
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
  </>,
);

/** Biểu tượng rỗng cho dòng chưa có icon cũ (ví dụ "Tất cả ứng dụng"): chưa gán thì không hiện gì. */
export function EmptyFallback() {
  return null;
}

/* Khung tối (ClassicShell) */

export const ClassicSearchFallback = svgFallback(
  STROKE,
  <>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </>,
);

export const ClassicFullscreenFallback = svgFallback(
  { ...STROKE, width: 15, height: 15 },
  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />,
);

export const ClassicHomeFallback = svgFallback(
  { ...STROKE, width: 14, height: 14 },
  <>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </>,
);

export const ClassicLogoutFallback = svgFallback(
  { ...STROKE, width: 14, height: 14 },
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </>,
);

export const ClassicLogoutDangerFallback = svgFallback(
  { ...STROKE, width: 14, height: 14, stroke: '#ef4444' },
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </>,
);

export const ClassicAccountFallback = svgFallback(
  { fill: 'none', stroke: '#64748b', strokeWidth: 2, width: 14, height: 14 },
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>,
);

export const ClassicSettingsFallback = svgFallback(
  { fill: 'none', stroke: '#64748b', strokeWidth: 2, width: 14, height: 14 },
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
);
