'use client';

import { ICON_SIZES, type BrandPalette, type ColorMode, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import { Moon, Palette, Sun, Type, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Section, ToggleGroup, type ToggleOption } from '../../components/controls';
import { IconSvg } from '../../icon-svg';

type Backdrop = 'light' | 'dark';

const MODE_OPTIONS: readonly ToggleOption<ColorMode>[] = [
  { value: 'brand', label: 'Màu thương hiệu', icon: <Palette /> },
  { value: 'currentColor', label: 'Theo màu chữ (currentColor)', icon: <Type /> },
];

const BACKDROP_OPTIONS: readonly ToggleOption<Backdrop>[] = [
  { value: 'light', label: 'Nền sáng', icon: <Sun /> },
  { value: 'dark', label: 'Nền tối', icon: <Moon /> },
];

/** Màu mặt nền và chữ cho từng nền; màu chữ cũng là màu `currentColor` của icon. */
const THEME: Record<Backdrop, { surface: string; ink: string; muted: string; tile: string; chrome: string }> = {
  light: {
    surface: 'bg-white ring-1 ring-slate-200',
    ink: '#334155',
    muted: 'text-slate-400',
    tile: 'bg-blue-50',
    chrome: 'bg-slate-200',
  },
  dark: {
    surface: 'bg-slate-900 ring-1 ring-slate-800',
    ink: '#e2e8f0',
    muted: 'text-slate-500',
    tile: 'bg-slate-800',
    chrome: 'bg-slate-800',
  },
};

/** Thanh ngang hiển thị một mô phỏng, chú thích nhỏ phía trên. */
function Sample({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] text-slate-400">{caption}</p>
      {children}
    </div>
  );
}

/**
 * Xem trước icon ở các cỡ 16, 20, 24, 32, 48 và trong giao diện thật (tab trình duyệt, thanh bên, thẻ phân hệ, nút).
 * Icon luôn vẽ đúng cỡ điểm ảnh, không phóng thu bằng bộ lọc, để kiểm tra độ nét ở 16px.
 */
export function PreviewPanel({ doc, palette }: { doc: IconDocument; palette: BrandPalette }) {
  const [mode, setMode] = useState<ColorMode>('brand');
  const [backdrop, setBackdrop] = useState<Backdrop>('light');
  const theme = THEME[backdrop];
  const name = doc.name.trim() || 'Icon';

  const icon = (size: number, color: string = theme.ink, colorMode: ColorMode = mode) => (
    <IconSvg
      doc={doc}
      palette={palette}
      colorMode={colorMode}
      color={color}
      className="block shrink-0"
      style={{ width: size, height: size }}
    />
  );

  return (
    <div className="text-xs text-slate-700">
      <Section>
        <div className="flex items-center justify-between gap-2">
          <ToggleGroup ariaLabel="Chế độ màu" value={mode} options={MODE_OPTIONS} onChange={setMode} />
          <ToggleGroup ariaLabel="Nền xem trước" value={backdrop} options={BACKDROP_OPTIONS} onChange={setBackdrop} />
        </div>
      </Section>

      <Section title="Cỡ">
        <div className={cn('flex items-end justify-between rounded-md px-4 py-3.5', theme.surface)}>
          {ICON_SIZES.map((size) => (
            <figure key={size} className="flex flex-col items-center gap-2">
              {icon(size)}
              <figcaption className={cn('text-[10px] tabular-nums', theme.muted)}>{size}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section title="Trong giao diện">
        <Sample caption="Tab trình duyệt">
          <div className={cn('rounded-t-md px-2 pt-1.5', theme.chrome)}>
            <div className={cn('flex w-44 items-center gap-2 rounded-t-md px-2.5 py-1.5', theme.surface)}>
              {icon(16)}
              <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: theme.ink }}>
                {name}
              </span>
              <X className={cn('size-3 shrink-0', theme.muted)} aria-hidden="true" />
            </div>
          </div>
        </Sample>

        <Sample caption="Thanh bên">
          <div className="w-48 space-y-0.5 rounded-md bg-white p-1 ring-1 ring-slate-200">
            <div className="flex items-center gap-2 rounded bg-slate-100 px-2 py-1.5 text-xs font-medium text-slate-900">
              {icon(20, '#0f172a')}
              <span className="truncate">{name}</span>
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-500">
              {icon(20, '#64748b')}
              <span className="truncate">{name}</span>
            </div>
          </div>
        </Sample>

        <Sample caption="Thẻ phân hệ">
          <div className={cn('flex items-center gap-3 rounded-lg p-3', theme.surface)}>
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', theme.tile)}>{icon(24)}</span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium" style={{ color: theme.ink }}>
                {name}
              </p>
              <p className={cn('truncate text-[11px]', theme.muted)}>{doc.description.trim() || 'Mô tả phân hệ'}</p>
            </div>
          </div>
        </Sample>

        <Sample caption="Nút">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white">
              {icon(16, '#ffffff', 'currentColor')}
              Lưu
            </span>
            <span className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium', theme.surface)} style={{ color: theme.ink }}>
              {icon(16)}
              Mở
            </span>
          </div>
        </Sample>
      </Section>
    </div>
  );
}
