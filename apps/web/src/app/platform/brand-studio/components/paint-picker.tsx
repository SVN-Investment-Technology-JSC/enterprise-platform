'use client';

import { brandPaint, type BrandPalette, type Paint } from '@enterprise-platform/shared-brand-icon';
import { Ban, ChevronDown, Contrast } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { FOCUS_RING } from './controls';
import { colorInputValue, describePaint, parseHexInput, placePopover, type PopoverPlacement } from './paint-model';

const POPOVER_WIDTH = 232;
const POPOVER_HEIGHT_GUESS = 220;

const NONE_BACKGROUND =
  'linear-gradient(to top right, transparent calc(50% - 1px), #ef4444 calc(50% - 1px), #ef4444 calc(50% + 1px), transparent calc(50% + 1px)), #ffffff';
const CONTEXT_BACKGROUND = 'linear-gradient(135deg, #0f172a 50%, #ffffff 50%)';
const MIXED_BACKGROUND = 'repeating-linear-gradient(135deg, #cbd5e1 0 3px, #ffffff 3px 6px)';

/** Ô màu mẫu: gạch chéo đỏ cho "không", nửa đen nửa trắng cho "theo chữ", sọc cho nhiều màu. */
export function PaintSwatch({
  paint,
  palette,
  mixed = false,
  size = 16,
  className,
}: {
  paint: Paint;
  palette: BrandPalette;
  mixed?: boolean;
  size?: number;
  className?: string;
}) {
  const description = describePaint(paint, palette);
  let background: string;
  if (mixed) background = MIXED_BACKGROUND;
  else if (description.kind === 'none') background = NONE_BACKGROUND;
  else if (description.kind === 'context') background = CONTEXT_BACKGROUND;
  else background = description.hex ?? '#000000';
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0 rounded-sm ring-1 ring-inset ring-slate-300', className)}
      style={{ width: size, height: size, background }}
    />
  );
}

export interface PaintPickerProps {
  readonly value: Paint;
  readonly onChange: (paint: Paint) => void;
  readonly palette: BrandPalette;
  /** Cho chọn "không có màu" (không nét hoặc không tô). */
  readonly allowNone?: boolean;
  /** Tên ô màu, dùng cho gợi ý và trình đọc màn hình, ví dụ `Màu nét`. */
  readonly label?: string;
  readonly disabled?: boolean;
  /** Nhiều lớp đang chọn có màu khác nhau. */
  readonly mixed?: boolean;
  /** Kéo trong bảng màu hệ thống đổi màu liên tục; hai hàm này để gộp cả lượt kéo thành một bước hoàn tác. */
  readonly onScrubStart?: () => void;
  readonly onScrubEnd?: () => void;
  readonly className?: string;
}

/**
 * Chọn màu: không có, theo chữ xung quanh (`currentColor`), một màu của bảng màu thương hiệu, hoặc màu tuỳ chọn
 * (nhập hex hoặc bảng màu hệ thống). Hộp chọn nằm ngoài khung cuộn của bảng nên không bị cắt; đóng khi bấm ra ngoài hoặc Esc.
 */
export function PaintPicker({
  value,
  onChange,
  palette,
  allowNone = false,
  label = 'Màu',
  disabled = false,
  mixed = false,
  onScrubStart,
  onScrubEnd,
  className,
}: PaintPickerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPlacement | null>(null);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const scrubbing = useRef(false);

  const description = describePaint(value, palette);
  const summary = mixed ? 'Nhiều màu' : description.label;

  const endScrub = useCallback(() => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    onScrubEnd?.();
  }, [onScrubEnd]);

  const close = useCallback(() => {
    endScrub();
    setHexDraft(null);
    setOpen(false);
  }, [endScrub]);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const popover = popoverRef.current;
    setPosition(
      placePopover(
        trigger.getBoundingClientRect(),
        { width: POPOVER_WIDTH, height: popover?.offsetHeight || POPOVER_HEIGHT_GUESS },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, close, reposition]);

  // Bảng màu hệ thống báo `change` khi người dùng đóng nó: kết thúc lượt kéo màu.
  useEffect(() => {
    const input = colorRef.current;
    if (!open || !input) return undefined;
    input.addEventListener('change', endScrub);
    return () => input.removeEventListener('change', endScrub);
  }, [open, endScrub]);

  const choose = (paint: Paint) => {
    if (paint !== value || mixed) onChange(paint);
    close();
  };

  const commitHex = (andClose: boolean) => {
    if (hexDraft === null) return;
    const parsed = parseHexInput(hexDraft);
    setHexDraft(null);
    if (parsed && (parsed !== description.hex || mixed)) onChange(parsed);
    if (parsed && andClose) close();
  };

  const onHexKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitHex(true);
    }
  };

  const onColorInput = (hex: string) => {
    if (!scrubbing.current) {
      scrubbing.current = true;
      onScrubStart?.();
    }
    onChange(hex.toLowerCase());
  };

  const hexShown = hexDraft ?? description.hex ?? '';
  const hexInvalid = hexDraft !== null && hexDraft.trim() !== '' && parseHexInput(hexDraft) === null;

  const optionClass = (selected: boolean) =>
    cn(
      'inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded border border-slate-200 bg-white text-[11px] text-slate-600 transition-colors',
      'hover:border-slate-300 hover:bg-slate-50 [&_svg]:size-3.5',
      selected && 'border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-50',
      FOCUS_RING,
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={`${label}: ${summary}`}
        aria-label={`${label}: ${summary}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            close();
          } else {
            setPosition(null);
            setOpen(true);
          }
        }}
        className={cn(
          'flex h-7 min-w-0 flex-1 items-center gap-2 rounded border border-slate-200 bg-white px-1.5 text-left text-xs text-slate-700 transition-colors',
          'hover:border-slate-300 disabled:pointer-events-none disabled:opacity-40',
          open && 'border-blue-500 ring-2 ring-blue-500/20',
          FOCUS_RING,
          className,
        )}
      >
        <PaintSwatch paint={value} palette={palette} mixed={mixed} />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronDown className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
      </button>

      {open
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={label}
              onKeyDown={(event) => event.stopPropagation()}
              style={{
                position: 'fixed',
                left: position?.left ?? 0,
                top: position?.top ?? 0,
                width: POPOVER_WIDTH,
                visibility: position ? 'visible' : 'hidden',
                zIndex: 10000,
              }}
              className="space-y-2.5 rounded-md border border-slate-200 bg-white p-2.5 shadow-lg"
            >
              <div className="flex gap-1.5">
                {allowNone ? (
                  <button
                    type="button"
                    title="Không có màu"
                    aria-label="Không có màu"
                    aria-pressed={!mixed && description.kind === 'none'}
                    onClick={() => choose('none')}
                    className={optionClass(!mixed && description.kind === 'none')}
                  >
                    <Ban aria-hidden="true" />
                    Không
                  </button>
                ) : null}
                <button
                  type="button"
                  title="Theo màu chữ xung quanh (currentColor)"
                  aria-label="Theo màu chữ xung quanh"
                  aria-pressed={!mixed && description.kind === 'context'}
                  onClick={() => choose('currentColor')}
                  className={optionClass(!mixed && description.kind === 'context')}
                >
                  <Contrast aria-hidden="true" />
                  Theo chữ
                </button>
              </div>

              <div>
                <p className="mb-1.5 text-[10px] text-slate-400">Màu thương hiệu</p>
                <div role="group" aria-label="Màu thương hiệu" className="grid max-h-32 grid-cols-8 gap-1.5 overflow-y-auto p-0.5">
                  {palette.tokens.map((token) => {
                    const paint = brandPaint(token.key);
                    const selected = !mixed && value === paint;
                    return (
                      <button
                        key={token.key}
                        type="button"
                        title={`${token.label} ${token.hex.toUpperCase()}`}
                        aria-label={token.label}
                        aria-pressed={selected}
                        onClick={() => choose(paint)}
                        style={{ background: token.hex }}
                        className={cn(
                          'size-6 rounded ring-1 ring-inset ring-slate-300 transition-transform hover:scale-110',
                          selected && 'outline-2 outline-offset-2 outline-blue-600',
                          FOCUS_RING,
                        )}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  ref={colorRef}
                  type="color"
                  title="Chọn màu tuỳ ý"
                  aria-label="Chọn màu tuỳ ý"
                  value={colorInputValue(value, palette)}
                  onChange={(event) => onColorInput(event.target.value)}
                  onBlur={endScrub}
                  className="size-7 shrink-0 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
                />
                <input
                  type="text"
                  aria-label="Mã màu hex"
                  title="Nhập mã màu, ví dụ #2563eb, rồi Enter"
                  placeholder="#2563eb"
                  spellCheck={false}
                  maxLength={7}
                  value={hexShown}
                  aria-invalid={hexInvalid}
                  onFocus={(event) => {
                    setHexDraft(hexShown);
                    event.currentTarget.select();
                  }}
                  onChange={(event) => setHexDraft(event.target.value)}
                  onBlur={() => commitHex(false)}
                  onKeyDown={onHexKeyDown}
                  className={cn(
                    'h-7 min-w-0 flex-1 rounded border bg-white px-2 text-xs uppercase tabular-nums outline-none placeholder:normal-case placeholder:text-slate-400',
                    hexInvalid ? 'border-red-400 focus:ring-2 focus:ring-red-400/20' : 'border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20',
                  )}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
