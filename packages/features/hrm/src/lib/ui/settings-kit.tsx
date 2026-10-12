'use client';
/**
 * Bộ thành phần dùng chung cho các màn Cấu hình HRM: thẻ mục có biểu tượng, ghi chú, tab gạch chân, tab phân đoạn,
 * thẻ chọn (radio), nhãn trạng thái, khung trống. Chỉ lo giao diện; không chứa nghiệp vụ.
 *
 * Quy ước bố cục cho màn cấu hình (bắt buộc để các màn đồng bộ và co giãn theo KHUNG chứa, không theo cửa sổ):
 *  - Phần tử gốc của màn có class `@container`; đổi cột bằng biến thể container (`@2xl:`, `@4xl:`...) thay cho `md:`/`lg:`,
 *    vì bề rộng nội dung đổi theo thanh bên.
 *  - Màn hẹp (< `@2xl` ~ 672px): một cột, nút thao tác xuống hàng, bảng cuộn ngang trong khung riêng hoặc chuyển thành thẻ.
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import { LeaveField, LeaveSwitch } from './leave-form-controls';

/** Trường nhập có nhãn + gợi ý, và công tắc: dùng lại bộ điều khiển của màn phép năm. */
export { LeaveField as SettingsField, LeaveSwitch as SettingsSwitch };

export type KitTone = 'blue' | 'amber' | 'violet' | 'green' | 'orange' | 'red' | 'slate';

const TILE_TONE: Record<KitTone, string> = {
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  violet: 'bg-violet-50 text-violet-600',
  green: 'bg-emerald-50 text-emerald-600',
  orange: 'bg-orange-50 text-orange-600',
  red: 'bg-red-50 text-red-600',
  slate: 'bg-slate-100 text-slate-600',
};

/** Ô biểu tượng bo góc có nền nhạt (đầu thẻ, dòng mục). `sm` cho dòng danh sách. */
export function IconTile({
  icon: Icon,
  tone = 'blue',
  size = 'md',
  className = '',
}: {
  icon: LucideIcon;
  tone?: KitTone;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center ${
        size === 'md' ? 'size-10 rounded-xl' : 'size-8 rounded-lg'
      } ${TILE_TONE[tone]} ${className}`}
    >
      <Icon className={size === 'md' ? 'size-5' : 'size-4'} />
    </span>
  );
}

/**
 * Thẻ mục của màn cấu hình: đầu thẻ gồm ô biểu tượng, tiêu đề, mô tả và nút thao tác (xuống hàng khi hẹp), rồi nội dung.
 */
export function SettingsSection({
  icon,
  tone = 'blue',
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = '',
  id,
}: {
  icon?: LucideIcon;
  tone?: KitTone;
  title: ReactNode;
  description?: ReactNode;
  /** Nút thao tác nằm bên phải tiêu đề; màn hẹp tự xuống dưới. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`min-w-0 rounded-xl border border-slate-200 bg-white p-4 @xl:p-5 ${className}`}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {icon ? <IconTile icon={icon} tone={tone} /> : null}
        <div className="min-w-0 flex-1 basis-48">
          <h2 id={headingId} className="text-base font-bold tracking-tight text-slate-900">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-xs leading-snug text-slate-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className={`mt-4 min-w-0 ${bodyClassName}`}>{children}</div> : null}
    </section>
  );
}

const NOTE_TONE = {
  slate: 'border-slate-200 bg-slate-50 text-slate-600',
  blue: 'border-blue-100 bg-blue-50/60 text-slate-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  red: 'border-red-200 bg-red-50 text-red-700',
} as const;
export type NoteTone = keyof typeof NOTE_TONE;

/** Ghi chú một khối có biểu tượng (thông tin, cảnh báo, thành công, lỗi). */
export function InfoNote({
  tone = 'slate',
  icon,
  role = 'note',
  className = '',
  children,
}: {
  tone?: NoteTone;
  icon?: LucideIcon;
  role?: 'note' | 'status' | 'alert';
  className?: string;
  children: ReactNode;
}) {
  const Icon = icon ?? (tone === 'amber' || tone === 'red' ? AlertTriangle : tone === 'green' ? CheckCircle2 : Info);
  return (
    <div
      role={role}
      className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${NOTE_TONE[tone]} ${className}`}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export interface KitTab {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Số lượng hiện cạnh nhãn (ví dụ số lý do); null/undefined thì không hiện. */
  count?: number | null;
  disabled?: boolean;
}

/** Id của tab và vùng nội dung tương ứng, để `aria-controls`/`aria-labelledby` khớp nhau. */
export function kitTabIds(prefix: string, id: string) {
  return { tab: `${prefix}-tab-${id}`, panel: `${prefix}-panel-${id}` };
}

/** Thuộc tính của vùng nội dung ứng với một tab của `SectionTabs`/`SegmentedTabs`. */
export function kitPanelProps(prefix: string, id: string) {
  const ids = kitTabIds(prefix, id);
  return { id: ids.panel, role: 'tabpanel' as const, 'aria-labelledby': ids.tab };
}

function useTabKeys(tabs: readonly KitTab[], active: string, onChange: (id: string) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const enabled = tabs.filter((t) => !t.disabled);
    const index = enabled.findIndex((t) => t.id === active);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    if (next < 0 || !enabled[next]) return;
    event.preventDefault();
    onChange(enabled[next].id);
    const root = event.currentTarget;
    requestAnimationFrame(() => root.querySelector<HTMLElement>(`[data-tab-id="${enabled[next].id}"]`)?.focus());
  };
}

/**
 * Tab gạch chân xanh cho màn có nhiều mục con. Hẹp thì cuộn ngang trong chính thanh tab (không làm tràn trang).
 */
export function SectionTabs({
  tabs,
  active,
  onChange,
  ariaLabel,
  idPrefix,
  className = '',
}: {
  tabs: readonly KitTab[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  idPrefix: string;
  className?: string;
}) {
  const onKeyDown = useTabKeys(tabs, active, onChange);
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`flex max-w-full gap-1 overflow-x-auto border-b border-slate-200 [scrollbar-width:thin] ${className}`}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        const Icon = tab.icon;
        const ids = kitTabIds(idPrefix, tab.id);
        return (
          <button
            key={tab.id}
            id={ids.tab}
            data-tab-id={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={ids.panel}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={`-mb-px flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              selected ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
            {tab.label}
            {tab.count != null ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  selected ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Tab phân đoạn (các nút chia đều bề rộng, mục đang chọn tô xanh), dùng khi chỉ có 2 đến 4 chế độ lớn như "Phân ca | Nhả ca".
 */
export function SegmentedTabs({
  tabs,
  active,
  onChange,
  ariaLabel,
  idPrefix,
  className = '',
}: {
  tabs: readonly KitTab[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  idPrefix: string;
  className?: string;
}) {
  const onKeyDown = useTabKeys(tabs, active, onChange);
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`grid gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        const Icon = tab.icon;
        const ids = kitTabIds(idPrefix, tab.id);
        return (
          <button
            key={tab.id}
            id={ids.tab}
            data-tab-id={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={ids.panel}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={`flex min-w-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              selected ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
            <span className="truncate">{tab.label}</span>
            {tab.count != null ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  selected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export interface RadioCardOption<T extends string> {
  value: T;
  title: string;
  description?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

/**
 * Nhóm thẻ chọn một (radio) có biểu tượng, tiêu đề và mô tả, dùng cho lựa chọn phạm vi/kiểu áp dụng.
 * Hẹp thì xếp một cột; từ `@md` (448px) chia hai cột, từ `@4xl` ba cột khi có từ ba lựa chọn.
 */
export function RadioCards<T extends string>({
  label,
  value,
  onChange,
  options,
  className = '',
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: readonly RadioCardOption<T>[];
  className?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((o) => !o.disabled);
    const index = enabled.findIndex((o) => o.value === value);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + enabled.length) % enabled.length;
    if (next < 0) return;
    event.preventDefault();
    onChange(enabled[next].value);
    requestAnimationFrame(() => groupRef.current?.querySelector<HTMLElement>(`[data-value="${enabled[next].value}"]`)?.focus());
  };
  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`grid grid-cols-1 gap-3 ${options.length === 2 ? '@md:grid-cols-2' : options.length >= 3 ? '@md:grid-cols-2 @4xl:grid-cols-3' : ''} ${className}`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={option.value}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              selected ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-500' : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex size-4.5 shrink-0 items-center justify-center rounded-full border-2 ${
                selected ? 'border-blue-600' : 'border-slate-300'
              }`}
            >
              {selected ? <span className="size-2 rounded-full bg-blue-600" /> : null}
            </span>
            {Icon ? <IconTile icon={Icon} tone={selected ? 'blue' : 'slate'} size="sm" /> : null}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">{option.title}</span>
              {option.description ? (
                <span className="block text-xs leading-snug text-slate-500">{option.description}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const PILL_TONE = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  slate: 'border-slate-200 bg-slate-100 text-slate-600',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  red: 'border-red-200 bg-red-50 text-red-700',
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
  violet: 'border-violet-200 bg-violet-50 text-violet-700',
} as const;
export type PillTone = keyof typeof PILL_TONE;

/** Nhãn trạng thái dạng viên thuốc (Đang sử dụng, Ngừng sử dụng, Đã áp dụng...). */
export function StatusPill({ tone = 'slate', children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PILL_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/** Khung trống: biểu tượng, tiêu đề, mô tả và (tuỳ chọn) nút hành động. */
export function EmptyPanel({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center ${className}`}
    >
      {Icon ? <IconTile icon={Icon} tone="slate" /> : null}
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description ? <p className="max-w-[60ch] text-xs leading-relaxed text-slate-500">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
