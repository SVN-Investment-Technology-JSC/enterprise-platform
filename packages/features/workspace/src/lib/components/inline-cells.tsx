'use client';

import type { WorkItemPriority } from '@enterprise-platform/contracts-workspace';
import { SearchableSelect, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import {
  ChevronDown,
  ChevronUp,
  ChevronsUp,
  Equal,
  Flag,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { priorityTone } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Tooltip } from './tooltip';
import { CreateOptionFooter, type CreateOption } from './create-option-footer';
import { ContextMenu } from './project-tree';

/** Cấu hình ô "thêm mục mới" ở cuối danh sách của `ChipSelect` (xem `CreateOption`). */
export type ChipCreate = CreateOption;

/** Chiều cao chip trong bảng và trên thanh lọc. */
export const CHIP_HEIGHT = 28;
/** Bề ngang ước lượng của một ký tự ở cỡ chữ chip, dùng trước khi đo được chữ thật (lần vẽ trên server). */
const CHAR_PX = 7.8;

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Bề ngang thật của chữ ở cỡ chữ chip; ô nhập không tự co theo chữ nên chip phải tự tính. */
function textWidth(text: string, weight: number, fallbackPerChar: number): number {
  if (typeof document === 'undefined') return text.length * fallbackPerChar;
  if (measureContext === undefined) {
    // jsdom chưa cài gói native 'canvas' sẽ ghi 'Not implemented' vào console khi gọi getContext('2d').
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
      measureContext = null;
    } else {
      try {
        measureContext = document.createElement('canvas').getContext('2d');
      } catch {
        measureContext = null;
      }
    }
  }
  if (!measureContext) return text.length * fallbackPerChar;
  measureContext.font = `${weight} 12.5px ${getComputedStyle(document.body).fontFamily}`;
  return measureContext.measureText(text).width;
}

/**
 * Bề ngang chữ dẫn và chữ giá trị của chip. Lần vẽ đầu (server và lần hydrate) dùng ước lượng để hai bên khớp nhau;
 * sau đó đo chữ thật.
 */
function useChipText(prefix: string | undefined, text: string, bold: boolean) {
  const estimate = {
    prefix: prefix ? prefix.length * 7.2 : 0,
    text: text.length * CHAR_PX,
  };
  const [size, setSize] = useState(estimate);
  useLayoutEffect(() => {
    setSize({
      prefix: prefix ? textWidth(prefix, 500, 7.2) : 0,
      text: textWidth(text, bold ? 700 : 600, CHAR_PX),
    });
  }, [prefix, text, bold]);
  return size;
}

export interface ToneOption {
  readonly value: string;
  readonly label: string;
  readonly tone?: { readonly bg: string; readonly fg: string };
  /** Dòng phụ trong danh sách (vd tên đầy đủ của khách hàng); vẫn gõ tìm được. */
  readonly description?: string;
}

/**
 * Ô chọn dạng chip: vẫn là `SearchableSelect` (kiểu chọn thuần tuý, tìm trong danh sách xổ ra), chỉ khoác thêm vỏ
 * chip. Đầu chip có thể có chấm màu, biểu tượng hay chữ dẫn ("Sắp xếp"); màu chip theo `tone` của giá trị đang chọn.
 */
/** Danh sách ChipSelect có tối đa chừng này mục thì bỏ ô tìm kiếm (chỉ bấm chọn). */
const CHIP_MAX_OPTIONS_WITHOUT_SEARCH = 8;
/** Độ rộng tối thiểu của danh sách ngắn: vừa nhãn dài nhất ("Hoàn thành", "Vướng mắc"), không rộng như danh sách có ô tìm. */
const SHORT_LIST_MIN_WIDTH = 140;

export function ChipSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  lead,
  dot,
  prefix,
  emptyLabel,
  variant = 'cell',
  maxWidth = 180,
  title,
  toned = true,
  create,
}: {
  label: string;
  value: string;
  options: readonly ToneOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Biểu tượng ở đầu chip. */
  lead?: ReactNode;
  /** Chấm màu ở đầu chip (màu chữ của tone). */
  dot?: boolean;
  /** Chữ dẫn mờ ở đầu chip, cho thanh lọc: "Trạng thái Tất cả". */
  prefix?: string;
  /** Có thì thêm mục rỗng với nhãn này; đang rỗng thì chip viền đứt. */
  emptyLabel?: string;
  /** `cell`: chip trong bảng; `filter`: chip trên thanh lọc (nền trắng, giá trị đậm). */
  variant?: 'cell' | 'filter';
  maxWidth?: number;
  title?: string;
  /** `false`: chip giữ nền trắng, màu chỉ ở biểu tượng và trong danh sách (vd mức ưu tiên). */
  toned?: boolean;
  /**
   * Có thì cuối danh sách xổ ra có ô thêm mục mới: gõ tên (và mã nếu có) rồi bấm nút thêm. `onCreate` trả giá trị của
   * mục vừa tạo; chip chọn luôn mục đó. Thêm được thì chỉ cần mục đó có trong `options` ở lần vẽ kế tiếp.
   */
  create?: ChipCreate;
}) {
  const box = useRef<HTMLDivElement>(null);
  const all: readonly ToneOption[] =
    emptyLabel === undefined ? options : [{ value: '', label: emptyLabel }, ...options];
  const selected = all.find((option) => option.value === value);
  const tone = toned ? selected?.tone : undefined;
  const empty = !value && emptyLabel !== undefined && variant === 'cell';
  const text = selected?.label ?? '';
  const size = useChipText(prefix, text, variant === 'filter');
  const leadPx = (lead ? 19 : 0) + (dot ? 12 : 0) + (prefix ? size.prefix + 8 : 0);
  const width = Math.min(maxWidth, Math.round(10 + leadPx + size.text + 36));
  const byValue = new Map(all.map((option) => [option.value, option]));
  const shortList = !create && all.length <= CHIP_MAX_OPTIONS_WITHOUT_SEARCH;

  const tip = title ?? (selected ? `${prefix ? `${prefix}: ` : ''}${selected.label}` : label);

  const chip = (
    <div
      ref={box}
      role="group"
      aria-label={label}
      data-choice={label}
      className={[
        styles.inlineChip,
        variant === 'filter' ? styles.chipFilter : '',
        empty ? styles.chipEmpty : '',
        disabled ? styles.chipDisabled : '',
      ].join(' ')}
      style={
        {
          width,
          '--chip-bg': tone?.bg,
          '--chip-fg': tone?.fg,
        } as CSSProperties
      }
    >
      {lead || dot || prefix ? (
        <span className={styles.chipLead} aria-hidden>
          {lead}
          {dot ? <span className={styles.chipDot} /> : null}
          {prefix ? <span className={styles.chipPrefix}>{prefix}</span> : null}
        </span>
      ) : null}
      <SearchableSelect
        options={all.map(({ value: optionValue, label: optionLabel, description }) => ({
          value: optionValue,
          label: optionLabel,
          description,
        }))}
        value={value}
        disabled={disabled}
        height={CHIP_HEIGHT}
        searchInDropdown
        // Chip đã có Tooltip riêng (`tip`); tắt chú thích gốc của ô nhập để không hiện hai chú thích chồng nhau.
        nativeTitle={false}
        // Danh sách ngắn (trạng thái, ưu tiên...) chỉ cần bấm chọn: bỏ ô tìm. Danh sách dài hay có ô thêm mục mới giữ ô tìm.
        hideDropdownSearch={shortList}
        dropdownMinWidth={shortList ? SHORT_LIST_MIN_WIDTH : undefined}
        clearable={false}
        dropdownFooter={
          create
            ? ({ close }) => (
                <CreateOptionFooter
                  create={create}
                  onCreated={(created) => {
                    if (created !== value) onChange(created);
                    close();
                  }}
                />
              )
            : undefined
        }
        style={{ '--ss-pad-l': `${10 + leadPx}px`, '--ss-pad-r': '30px' } as CSSProperties}
        onChange={(next) => {
          if (next !== value) onChange(next);
          // Như `Choice`: chọn xong thì bỏ focus để danh sách không tự mở lại.
          requestAnimationFrame(() => box.current?.querySelector('input')?.blur());
        }}
        renderOption={(option: SearchableSelectOption) => {
          const entry = byValue.get(option.value);
          return (
            <span data-value={option.value} className={styles.chipOption}>
              {entry?.tone ? (
                <span className={styles.pill} style={{ background: entry.tone.bg, color: entry.tone.fg }}>
                  {option.label}
                </span>
              ) : (
                <span>{option.label}</span>
              )}
              {option.description ? <span className={styles.muted}>{option.description}</span> : null}
            </span>
          );
        }}
      />
    </div>
  );
  return <Tooltip content={tip}>{chip}</Tooltip>;
}

/** Chip không phải ô chọn: hiện giá trị chỉ đọc, hoặc là nút mở hộp (vd "Gắn nhãn"). */
export function ChipButton({
  children,
  onClick,
  dashed,
  tone,
  title,
  label,
}: {
  children: ReactNode;
  onClick?: () => void;
  dashed?: boolean;
  tone?: { readonly bg: string; readonly fg: string };
  title?: string;
  label?: string;
}) {
  const className = [styles.chipStatic, dashed ? styles.chipEmpty : '', onClick ? styles.chipClickable : ''].join(
    ' ',
  );
  const style = { '--chip-bg': tone?.bg, '--chip-fg': tone?.fg } as CSSProperties;
  return onClick ? (
    <Tooltip content={title}>
      <button type="button" className={className} style={style} aria-label={label} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  ) : (
    <Tooltip content={title}>
      <span className={className} style={style}>
        {children}
      </span>
    </Tooltip>
  );
}

/** Ô hạn dạng chip: lịch của ô chọn ngày sẵn có; rỗng thì viền đứt "Đặt hạn", quá hạn thì nền đỏ. */
export function DateChip({
  label,
  value,
  min,
  overdue,
  disabled,
  onChange,
}: {
  label: string;
  value?: string;
  min?: string;
  overdue?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <span
      className={[
        styles.dateChip,
        value ? '' : styles.dateChipEmpty,
        overdue ? styles.dateChipDanger : '',
      ].join(' ')}
    >
      <DatePickerInput
        aria-label={label}
        value={value ?? ''}
        min={min}
        placeholder="Đặt hạn"
        height={CHIP_HEIGHT}
        disabled={disabled}
        onChange={onChange}
      />
    </span>
  );
}

const PROGRESS_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

/**
 * Bảng chọn nhanh tiến độ (bám 1Office): hàng nút 0, 10 … 100, ô gõ số bất kỳ, và nút quay về tiến độ tự động khi đang
 * nhập tay. Nổi ngay dưới ô tiến độ, đóng khi bấm ra ngoài hoặc nhấn Esc.
 */
function ProgressPicker({
  anchor,
  value,
  manual,
  auto,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  value: number;
  manual: boolean;
  auto?: number;
  onPick: (next: number | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(String(value));
  const [position, setPosition] = useState({ left: anchor.left, top: anchor.bottom + 6 });

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const fitsBelow = anchor.bottom + 6 + box.height <= window.innerHeight - 8;
    setPosition({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8)),
      top: fitsBelow ? anchor.bottom + 6 : Math.max(8, anchor.top - box.height - 6),
    });
  }, [anchor]);

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', dismiss, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    // Cuộn bảng hay trang làm dòng chứa ô dời đi còn bảng chọn đứng yên: đóng để khỏi chọn nhầm sang dòng khác.
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', dismiss, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const submitText = () => {
    const next = Number(text.trim());
    if (!text.trim() || !Number.isInteger(next) || next < 0 || next > 100) {
      setText(String(value));
      return;
    }
    onPick(next);
  };

  return (
    <div ref={ref} role="dialog" aria-label="Chọn tiến độ" className={styles.progressPicker} style={position}>
      <div className={styles.progressPickerSteps}>
        {PROGRESS_STEPS.map((step) => (
          <button
            key={step}
            type="button"
            className={step === value ? styles.progressPickerStepActive : styles.progressPickerStep}
            aria-pressed={step === value}
            onClick={() => onPick(step)}
          >
            {step}
          </button>
        ))}
      </div>
      <div className={styles.progressPickerRow}>
        <input
          className={styles.progressInput}
          value={text}
          inputMode="numeric"
          aria-label="Nhập tiến độ (%)"
          onChange={(event) => setText(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitText();
          }}
        />
        <span>%</span>
        <button type="button" className={styles.buttonSmall} onClick={submitText}>
          Lưu
        </button>
        {manual ? (
          <button type="button" className={styles.buttonSmall} onClick={() => onPick(null)}>
            Về tự động{auto === undefined ? '' : ` (${auto}%)`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Ô tiến độ: thanh và số phần trăm. Bấm vào thanh hoặc số để mở bảng chọn nhanh 0–100 (hoặc gõ số bất kỳ). Chuột phải
 * để quay về tiến độ tự động. Số màu xanh là đang dùng tiến độ nhập tay.
 */
export function ProgressCell({
  label,
  value,
  manual,
  auto,
  expected,
  disabled,
  lockedReason,
  onOpen,
  onCommit,
}: {
  label: string;
  value: number;
  manual: boolean;
  /** Tiến độ tự tính, hiện trong bảng chọn và menu chuột phải. */
  auto?: number;
  /** Tiến độ dự kiến theo thời gian: vẽ thành lớp sáng phía sau thanh thực tế. */
  expected?: number;
  disabled?: boolean;
  /** Vì sao ô không sửa được (hiện ở tooltip khi `disabled`), vd tiến độ tự tính từ việc con. */
  lockedReason?: string;
  /** Có thì bấm vào ô mở hộp riêng (vd báo khối lượng) thay vì bảng chọn nhanh. */
  onOpen?: () => void;
  onCommit: (next: number | null) => Promise<void> | void;
}) {
  const [picker, setPicker] = useState<DOMRect>();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const anchorRef = useRef<HTMLSpanElement>(null);

  const open = () => {
    if (onOpen) {
      onOpen();
      return;
    }
    const box = anchorRef.current?.getBoundingClientRect();
    if (box) setPicker(box);
  };

  const percent = Math.min(100, Math.max(0, value));
  const tip = disabled
    ? lockedReason
    : onOpen
      ? 'Bấm để báo khối lượng đã hoàn thành.'
      : manual
      ? `Tiến độ nhập tay. Bấm để đổi, chuột phải để về tiến độ tự động${auto === undefined ? '' : ` (${auto}%)`}.`
      : 'Tiến độ tự động. Bấm để chọn hoặc nhập tay.';
  const cell = (
    <span
      ref={anchorRef}
      className={styles.progressEdit}
      onContextMenu={(event) => {
        if (disabled) return;
        event.preventDefault();
        // Không để dòng chứa ô (vd danh sách dự án) mở menu chuột phải của nó.
        event.stopPropagation();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      onClick={(event) => {
        // Bấm vào ô không được kéo theo thao tác "mở dòng" của bảng chứa nó.
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className={styles.progressBarButton}
        aria-label={`${label}: ${value}%${manual ? ', nhập tay' : ''}`}
        disabled={disabled}
        onClick={open}
      >
        <span className={styles.progressBar} aria-hidden>
          {expected === undefined ? null : <span className={styles.progressExpected} style={{ width: `${expected}%` }} />}
          <span
            style={{ width: `${percent}%`, background: percent >= 100 ? 'var(--ep-success, #16a34a)' : undefined }}
          />
        </span>
      </button>
      <button
        type="button"
        className={manual ? styles.progressValueManual : styles.progressValue}
        aria-label={`${label}: ${value}%${manual ? ', nhập tay' : ''}`}
        disabled={disabled}
        onClick={open}
      >
        {value}%
      </button>
      {picker ? (
        <ProgressPicker
          anchor={picker}
          value={value}
          manual={manual}
          auto={auto}
          onClose={() => setPicker(undefined)}
          onPick={(next) => {
            setPicker(undefined);
            if (next === value && manual) return;
            void onCommit(next);
          }}
        />
      ) : null}
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={[
            { id: 'edit', label: 'Chọn tiến độ…' },
            ...(manual
              ? [
                  {
                    id: 'auto',
                    label: `Về tiến độ tự động${auto === undefined ? '' : ` (${auto}%)`}`,
                  },
                ]
              : []),
          ]}
          onClose={() => setMenu(undefined)}
          onPick={(actionId) => {
            setMenu(undefined);
            if (actionId === 'edit') open();
            if (actionId === 'auto') void onCommit(null);
          }}
        />
      ) : null}
    </span>
  );
  return <Tooltip content={tip}>{cell}</Tooltip>;
}

const PRIORITY_ICONS: Record<string, LucideIcon> = {
  urgent: ChevronsUp,
  high: ChevronUp,
  normal: Equal,
  low: ChevronDown,
};

/** Biểu tượng của mức ưu tiên; mức tenant tự thêm dùng lá cờ. */
export function PriorityIcon({ priority }: { priority: WorkItemPriority }) {
  const Icon = PRIORITY_ICONS[priority] ?? Flag;
  return <Icon size={13} strokeWidth={2.4} color={priorityTone(priority).fg} />;
}

/** Số đếm của một nhóm theo từng loại; trễ hạn đếm thêm, không trừ vào các loại theo trạng thái. */
export interface GroupCountValues {
  readonly overdue: number;
  readonly notStarted: number;
  readonly active: number;
  readonly finished: number;
}

const GROUP_COUNT_KINDS: readonly {
  readonly key: keyof GroupCountValues;
  readonly label: string;
  readonly tone: { readonly bg: string; readonly fg: string };
}[] = [
  { key: 'overdue', label: 'trễ hạn', tone: { bg: '#fee2e2', fg: '#b91c1c' } },
  { key: 'notStarted', label: 'chưa làm', tone: { bg: '#f1f5f9', fg: '#475569' } },
  { key: 'active', label: 'đang làm', tone: { bg: '#fef3c7', fg: '#92400e' } },
  { key: 'finished', label: 'hoàn thành', tone: { bg: '#dcfce7', fg: '#15803d' } },
];

/**
 * Các số đếm ở đầu nhóm, mỗi loại một số có nền riêng: đỏ trễ hạn, xám chưa làm, vàng đang làm, xanh lá hoàn thành.
 * Số bằng 0 thì ẩn; rê chuột lên số để đọc chú thích.
 */
export function GroupCounts({ counts, unit }: { counts: GroupCountValues; unit: string }) {
  const shown = GROUP_COUNT_KINDS.filter((kind) => counts[kind.key] > 0);
  return (
    <span className={styles.groupCounts}>
      {shown.map((kind) => (
        <Tooltip key={kind.key} content={`${counts[kind.key]} ${unit} ${kind.label}`}>
          <span
            className={styles.countPill}
            style={{ background: kind.tone.bg, color: kind.tone.fg }}
            aria-label={`${counts[kind.key]} ${unit} ${kind.label}`}
          >
            {counts[kind.key]}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}
