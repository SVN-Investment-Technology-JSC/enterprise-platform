'use client';

import { MAX_GRADIENT_STOPS, brandPaint, type BrandPalette, type Paint } from '@enterprise-platform/shared-brand-icon';
import { Ban, Blend, ChevronDown, Contrast, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { FOCUS_RING } from './controls';
import { Hint } from './hint';
import {
  addGradientStop,
  colorInputValue,
  describePaint,
  gradientCss,
  gradientStripCss,
  parseHexInput,
  placePopover,
  removeGradientStop,
  setGradientAngle,
  setStopColor,
  setStopOffset,
  setStopOpacity,
  toGradient,
  type PopoverPlacement,
} from './paint-model';

const POPOVER_WIDTH = 256;
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
  else if (description.gradient) background = gradientCss(description.gradient, palette);
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
  /** Cho chọn màu chuyển sắc (mặc định có). */
  readonly allowGradient?: boolean;
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
  allowGradient = true,
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
  const [activeStop, setActiveStop] = useState(0);
  const angleId = useId();

  const description = describePaint(value, palette);
  const summary = mixed ? 'Nhiều màu' : description.label;
  // Với gradient, ô chọn màu thương hiệu, màu tuỳ ý và mã hex bên dưới sửa màu của điểm màu đang chọn.
  const gradient = !mixed && description.kind === 'gradient' ? (description.gradient ?? null) : null;
  const stopIndex = gradient ? Math.min(activeStop, gradient.stops.length - 1) : 0;
  const targetPaint: Paint = gradient ? gradient.stops[stopIndex].color : value;
  const targetDescription = gradient ? describePaint(targetPaint, palette) : description;

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

  const stopCount = gradient?.stops.length ?? 0;
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition, stopCount]);

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

  /** Màu mới cho cả ô (hoặc cho điểm màu đang chọn khi đang sửa gradient). */
  const applyColor = (paint: Paint) => onChange(gradient ? setStopColor(value, stopIndex, paint) : paint);

  const choose = (paint: Paint) => {
    if (gradient) {
      if (paint !== targetPaint) applyColor(paint);
      return;
    }
    if (paint !== value || mixed) onChange(paint);
    close();
  };

  /** Không màu hoặc theo chữ: thay cả giá trị (kể cả gradient), không phải một điểm màu. */
  const chooseWhole = (paint: Paint) => {
    if (paint !== value || mixed) onChange(paint);
    close();
  };

  const chooseGradient = () => {
    if (gradient) return;
    setActiveStop(0);
    onChange(toGradient(value, palette));
  };

  const beginScrub = () => {
    if (scrubbing.current) return;
    scrubbing.current = true;
    onScrubStart?.();
  };

  const commitHex = (andClose: boolean) => {
    if (hexDraft === null) return;
    const parsed = parseHexInput(hexDraft);
    setHexDraft(null);
    if (parsed && (parsed !== targetDescription.hex || mixed)) applyColor(parsed);
    if (parsed && andClose && !gradient) close();
  };

  const onHexKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitHex(true);
    }
  };

  const onColorInput = (hex: string) => {
    beginScrub();
    applyColor(hex.toLowerCase());
  };

  const hexShown = hexDraft ?? targetDescription.hex ?? '';
  const hexInvalid = hexDraft !== null && hexDraft.trim() !== '' && parseHexInput(hexDraft) === null;

  const optionClass = (selected: boolean) =>
    cn(
      'inline-flex h-7 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded border border-slate-200 bg-white text-[11px] text-slate-600 transition-colors',
      'hover:border-slate-300 hover:bg-slate-50 [&_svg]:size-3.5',
      selected && 'border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-50',
      FOCUS_RING,
    );

  return (
    <>
      <Hint label={`${label}: ${summary}`}>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
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
      </Hint>

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
                  <Hint label="Không có màu">
                    <button
                      type="button"
                      aria-label="Không có màu"
                      aria-pressed={!mixed && description.kind === 'none'}
                      onClick={() => chooseWhole('none')}
                      className={optionClass(!mixed && description.kind === 'none')}
                    >
                      <Ban aria-hidden="true" />
                      Không
                    </button>
                  </Hint>
                ) : null}
                <Hint label="Theo màu chữ xung quanh (currentColor)">
                  <button
                    type="button"
                    aria-label="Theo màu chữ xung quanh"
                    aria-pressed={!mixed && description.kind === 'context'}
                    onClick={() => chooseWhole('currentColor')}
                    className={optionClass(!mixed && description.kind === 'context')}
                  >
                    <Contrast aria-hidden="true" />
                    Theo chữ
                  </button>
                </Hint>
                {allowGradient ? (
                  <Hint label="Màu chuyển sắc">
                    <button
                      type="button"
                      aria-label="Màu chuyển sắc"
                      aria-pressed={gradient !== null}
                      onClick={chooseGradient}
                      className={optionClass(gradient !== null)}
                    >
                      <Blend aria-hidden="true" />
                      Chuyển sắc
                    </button>
                  </Hint>
                ) : null}
              </div>

              {gradient ? (
                <div className="space-y-2 rounded border border-slate-200 bg-slate-50/60 p-2" data-testid="gradient-editor">
                  <div
                    aria-hidden="true"
                    className="h-4 rounded ring-1 ring-inset ring-slate-300"
                    style={{ background: gradientStripCss(gradient, palette) }}
                  />
                  {gradient.kind === 'linear' ? (
                    <div className="flex items-center gap-2">
                      <label htmlFor={angleId} className="w-8 shrink-0 text-[10px] text-slate-500">
                        Góc
                      </label>
                      <input
                        id={angleId}
                        type="range"
                        min={0}
                        max={360}
                        step={1}
                        aria-label="Góc chuyển sắc"
                        value={Math.round(gradient.angle)}
                        onPointerDown={beginScrub}
                        onPointerUp={endScrub}
                        onBlur={endScrub}
                        onChange={(event) => onChange(setGradientAngle(value, Number(event.target.value)))}
                        className="min-w-0 flex-1 accent-blue-600"
                      />
                      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-slate-600">{Math.round(gradient.angle)}°</span>
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500" data-testid="radial-note">
                      Chuyển sắc hướng tâm: tâm, bán kính và hình dạng được giữ đúng như SVG gốc; ở đây chỉ sửa được các điểm màu.
                    </p>
                  )}
                  <div role="group" aria-label="Điểm màu" className="space-y-1">
                    {gradient.stops.map((stop, index) => {
                      const selected = index === stopIndex;
                      return (
                        <div key={index} className="flex items-center gap-1.5">
                          <Hint label={`Điểm màu ${index + 1}`}>
                            <button
                              type="button"
                              aria-label={`Chọn điểm màu ${index + 1}`}
                              aria-pressed={selected}
                              onClick={() => setActiveStop(index)}
                              className={cn(
                                'flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded border border-slate-200 bg-white px-1 text-left text-[11px] text-slate-600',
                                selected && 'border-blue-400 ring-2 ring-blue-500/20',
                                FOCUS_RING,
                              )}
                            >
                              <PaintSwatch paint={stop.color} palette={palette} size={14} />
                              <span className="truncate">{describePaint(stop.color, palette).label}</span>
                            </button>
                          </Hint>
                          <Hint label="Vị trí trên dải màu, từ 0 đến 100%">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              aria-label={`Vị trí điểm màu ${index + 1} (%)`}
                              value={Math.round(stop.offset * 100)}
                              onChange={(event) => {
                                const percent = event.target.valueAsNumber;
                                if (Number.isFinite(percent)) onChange(setStopOffset(value, index, percent / 100));
                              }}
                              className="h-6 w-12 shrink-0 rounded border border-slate-200 bg-white px-1 text-right text-[11px] tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                            />
                          </Hint>
                          <Hint label="Độ đặc của điểm màu, từ 0 đến 100%">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={5}
                              aria-label={`Độ đặc điểm màu ${index + 1} (%)`}
                              value={Math.round((stop.opacity ?? 1) * 100)}
                              onChange={(event) => {
                                const percent = event.target.valueAsNumber;
                                if (Number.isFinite(percent)) onChange(setStopOpacity(value, index, percent / 100));
                              }}
                              className="h-6 w-12 shrink-0 rounded border border-slate-200 bg-white px-1 text-right text-[11px] tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                            />
                          </Hint>
                          <Hint label="Xoá điểm màu">
                            <button
                              type="button"
                              aria-label={`Xoá điểm màu ${index + 1}`}
                              disabled={gradient.stops.length <= 2}
                              onClick={() => {
                                onChange(removeGradientStop(value, index));
                                setActiveStop(Math.max(0, Math.min(stopIndex, gradient.stops.length - 2)));
                              }}
                              className={cn(
                                'inline-flex size-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-30',
                                FOCUS_RING,
                              )}
                            >
                              <X className="size-3.5" aria-hidden="true" />
                            </button>
                          </Hint>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    aria-label="Thêm điểm màu"
                    disabled={gradient.stops.length >= MAX_GRADIENT_STOPS}
                    onClick={() => {
                      const added = addGradientStop(value, palette);
                      if (!added) return;
                      onChange(added.paint);
                      setActiveStop(added.index);
                    }}
                    className={cn(
                      'inline-flex h-6 w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 text-[11px] text-slate-600 hover:bg-white disabled:pointer-events-none disabled:opacity-40',
                      FOCUS_RING,
                    )}
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    Thêm điểm màu
                  </button>
                  <p className="text-[10px] text-slate-400">Màu bên dưới áp cho điểm màu đang chọn.</p>
                </div>
              ) : null}

              <div>
                <p className="mb-1.5 text-[10px] text-slate-400">Màu thương hiệu</p>
                <div role="group" aria-label="Màu thương hiệu" className="grid max-h-32 grid-cols-8 gap-1 overflow-y-auto p-1">
                  {palette.tokens.map((token) => {
                    const paint = brandPaint(token.key);
                    const selected = !mixed && targetPaint === paint;
                    return (
                      <Hint key={token.key} label={`${token.label} ${token.hex.toUpperCase()}`}>
                        <button
                            type="button"
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
                      </Hint>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <Hint label="Chọn màu tuỳ ý">
                  <input
                    ref={colorRef}
                    type="color"
                    aria-label="Chọn màu tuỳ ý"
                    value={colorInputValue(targetPaint, palette)}
                    onChange={(event) => onColorInput(event.target.value)}
                    onBlur={endScrub}
                    className="size-7 shrink-0 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
                  />
                </Hint>
                <Hint label="Nhập mã màu, ví dụ #2563eb, rồi Enter">
                  <input
                    type="text"
                    aria-label="Mã màu hex"
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
                </Hint>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
