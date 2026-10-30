'use client';

import { ChevronDown, X } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import styles from '../workspace.module.scss';

/** Một lựa chọn đã chọn, hiện thành chip trong ô. */
export interface MultiSelectChip {
  readonly id: string;
  readonly label: string;
  /** Gợi ý khi rê chuột; vắng thì dùng `label`. */
  readonly title?: string;
  /** Viền đứt, ví dụ người ngoài dự án. */
  readonly dashed?: boolean;
  /** Màu viền và chữ của chip, ví dụ màu nhãn. */
  readonly color?: string;
}

export interface MultiSelectBoxProps {
  readonly chips: readonly MultiSelectChip[];
  readonly onRemove: (id: string) => void;
  readonly term: string;
  readonly onTermChange: (term: string) => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly placeholder: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly disabled?: boolean;
  /** Nội dung danh sách xổ ra. Danh sách nổi lên trên form, không đẩy các ô bên dưới. */
  readonly children: ReactNode;
}

/** Chừa chỗ cho chip "+n" khi đo số chip vừa ô (px). */
const MORE_WIDTH = 40;
/** Danh sách thấp hơn mức này mà phía trên rộng hơn thì lật lên trên. */
const FLIP_BELOW = 200;

/**
 * Ô chọn nhiều kiểu Select nhiều lựa chọn: các mục đã chọn hiện thành chip ngay trong ô, gõ tiếp ở cuối để tìm. Chip
 * không vừa thì gộp thành "+n" nhưng vẫn nằm trong ô; danh sách xổ ra có mục "Đã chọn" để bỏ từng mục kể cả khi đã
 * gộp. Danh sách định vị nổi (không chiếm chỗ trong luồng) và tự lật lên trên khi dưới không đủ chỗ.
 */
export function MultiSelectBox({
  chips,
  onRemove,
  term,
  onTermChange,
  onKeyDown,
  placeholder,
  open,
  onOpenChange,
  disabled = false,
  children,
}: MultiSelectBoxProps) {
  const box = useRef<HTMLDivElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Bề rộng ô; đổi thì đo lại số chip vừa ô. */
  const [width, setWidth] = useState(0);
  /** Số chip hiện trong ô; phần còn lại gộp thành "+n". Rỗng là hiện đủ. */
  const [limit, setLimit] = useState<number>();
  const [measuredKey, setMeasuredKey] = useState('');
  /** Vị trí danh sách theo cửa sổ (`position: fixed`), nên không bị khung cuộn hay hộp thoại nhỏ cắt. */
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    width: number;
    up: boolean;
    maxHeight: number;
  }>({ left: 0, top: 0, width: 0, up: false, maxHeight: 320 });
  const measureKey = `${chips.map((chip) => `${chip.id}:${chip.label}`).join(',')}|${width}`;
  const measuring = measuredKey !== measureKey;

  useEffect(() => {
    const element = control.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Đo: vẽ đủ mọi chip, xem chip nào còn nằm gọn trong khung (chừa chỗ cho "+n"), rồi cắt phần dư trước khi trình
  // duyệt vẽ.
  useLayoutEffect(() => {
    if (!measuring) return;
    const list = chipsRef.current;
    const items = list ? ([...list.children] as HTMLElement[]) : [];
    if (!list || items.length === 0) {
      setLimit(undefined);
      setMeasuredKey(measureKey);
      return;
    }
    // Vừa khít thì hiện hết, không gộp "+n". So bằng scrollWidth (có phần lẻ) với dung sai 1px: offsetLeft, offsetWidth và
    // clientWidth đều làm tròn nên cộng lại có thể lệch 1px và chip cuối bị gộp oan dù còn chỗ.
    if (list.scrollWidth <= list.clientWidth + 1) {
      setLimit(undefined);
      setMeasuredKey(measureKey);
      return;
    }
    const room = list.clientWidth;
    let fit = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index] as HTMLElement;
      const reserve = index < items.length - 1 ? MORE_WIDTH : 0;
      if (item.offsetLeft + item.offsetWidth <= room - reserve) fit = index + 1;
      else break;
    }
    setLimit(fit >= items.length ? undefined : fit);
    setMeasuredKey(measureKey);
  }, [measuring, measureKey]);

  // Danh sách định vị theo cửa sổ, bám theo ô khi cuộn hay đổi cỡ. Dùng `fixed` thay vì `absolute` trong khung cuộn:
  // hộp thoại nhỏ (ví dụ "Gắn nhãn dự án") có vùng cuộn thấp hơn danh sách, nên `absolute` bị cắt hoặc lật vào chỗ không có.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const element = control.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < FLIP_BELOW && above > below;
      setPlacement({
        left: rect.left,
        top: up ? rect.top - 4 : rect.bottom + 4,
        width: rect.width,
        up,
        maxHeight: Math.max(140, Math.min(320, up ? above : below)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, chips.length, width]);

  // Bấm ra ngoài thì đóng danh sách.
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener('click', close, true);
    return () => document.removeEventListener('click', close, true);
  }, [open, onOpenChange]);

  const shown = measuring || limit === undefined ? chips : chips.slice(0, limit);
  const hidden = chips.length - shown.length;

  const chipView = (chip: MultiSelectChip, removable: boolean, full = false) => {
    const style: CSSProperties | undefined = chip.color
      ? { borderColor: chip.color, color: chip.color, background: 'var(--ep-surface)' }
      : undefined;
    return (
      <li
        key={chip.id}
        className={`${styles.multiChip} ${chip.dashed ? styles.multiChipOutside : ''} ${full ? styles.multiChipFull : ''}`}
        style={style}
        title={chip.title ?? chip.label}
      >
        <span className={styles.multiChipName}>{chip.label}</span>
        {removable ? (
          <button
            type="button"
            aria-label={`Bỏ ${chip.label}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(chip.id);
            }}
          >
            <X size={11} />
          </button>
        ) : null}
      </li>
    );
  };

  if (disabled) {
    return <ul className={styles.multiChips}>{chips.map((chip) => chipView(chip, false))}</ul>;
  }

  return (
    <div ref={box} className={styles.multiBox}>
      <div
        ref={control}
        className={`${styles.multiControl} ${open ? styles.multiControlOpen : ''}`}
        onClick={() => {
          inputRef.current?.focus();
          onOpenChange(true);
        }}
      >
        {chips.length > 0 ? (
          <ul ref={chipsRef} className={styles.multiChips}>
            {shown.map((chip) => chipView(chip, true))}
            {hidden > 0 ? (
              <li
                className={styles.multiMore}
                title={chips
                  .slice(shown.length)
                  .map((chip) => chip.label)
                  .join(', ')}
              >
                +{hidden}
              </li>
            ) : null}
          </ul>
        ) : null}
        <input
          ref={inputRef}
          value={term}
          placeholder={chips.length > 0 ? 'Thêm…' : placeholder}
          aria-label={placeholder}
          onFocus={() => onOpenChange(true)}
          onChange={(event) => {
            onTermChange(event.target.value);
            onOpenChange(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !term && chips.length > 0) {
              // Như Select nhiều lựa chọn: ô gõ đang trống thì Backspace bỏ mục cuối.
              onRemove((chips[chips.length - 1] as MultiSelectChip).id);
              return;
            }
            if (event.key === 'Tab') onOpenChange(false);
            onKeyDown?.(event);
          }}
        />
        <ChevronDown
          size={15}
          className={styles.multiChevron}
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
          aria-hidden="true"
        />
      </div>

      {open ? (
        <div
          className={styles.multiDropdown}
          style={{
            position: 'fixed',
            left: placement.left,
            top: placement.top,
            width: placement.width,
            right: 'auto',
            bottom: 'auto',
            maxHeight: placement.maxHeight,
            transform: placement.up ? 'translateY(-100%)' : undefined,
          }}
        >
          {hidden > 0 ? (
            <div className={styles.groupPickerSelected}>
              <span className={styles.groupPickerSelectedTitle}>Đã chọn ({chips.length})</span>
              <ul className={styles.chipList}>{chips.map((chip) => chipView(chip, true, true))}</ul>
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
