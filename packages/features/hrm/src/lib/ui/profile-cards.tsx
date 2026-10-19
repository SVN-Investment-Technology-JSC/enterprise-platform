'use client';

import type { ReactNode } from 'react';
import { Lock, PencilLine, type LucideIcon } from 'lucide-react';
import { Input } from './input';

/** Thẻ của màn Hồ sơ của tôi: icon, tiêu đề, nhãn bên phải và nội dung. */
export function ProfileCard({
  icon: Icon,
  title,
  badge,
  action,
  children,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
          <Icon className="size-4.5 text-blue-600" aria-hidden="true" />
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {badge}
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}

const LABEL = 'block text-[14px] font-semibold text-slate-600';

/** Ô chỉ đọc có icon bên trái (dữ liệu do Core hoặc nhân sự quản lý). */
export function ReadonlyField({
  id,
  label,
  value,
  icon: Icon,
  mono = false,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  icon?: LucideIcon;
  mono?: boolean;
  /** Lý do ô không sửa được hoặc cách đổi, hiện dưới ô. */
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <Icon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
        )}
        <Input
          id={id}
          type="text"
          readOnly
          value={value}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={`h-9 cursor-not-allowed border-slate-200 bg-slate-100 pr-9 text-[14px] text-slate-600 ${Icon ? 'pl-9' : ''} ${mono ? 'font-mono' : ''}`}
        />
        <Lock
          className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Chú giải ô nhập được và ô chỉ xem, đặt ở đầu thẻ có cả hai loại ô. */
export function FieldLegend() {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600" aria-label="Chú giải ô thông tin">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex size-5 items-center justify-center rounded border border-slate-300 bg-white">
          <PencilLine className="size-3 text-blue-600" aria-hidden="true" />
        </span>
        Ô nền trắng: bạn tự nhập
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex size-5 items-center justify-center rounded border border-slate-200 bg-slate-100">
          <Lock className="size-3 text-slate-400" aria-hidden="true" />
        </span>
        Ô nền xám có khóa: chỉ xem, không nhập
      </span>
    </div>
  );
}

/** Ô nhập có icon bên trái. */
export function IconInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  icon: Icon,
  type = 'text',
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: LucideIcon;
  type?: 'text' | 'email' | 'tel';
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={LABEL}>
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </label>
      <div className="relative">
        {Icon && (
          <Icon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
        )}
        <Input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`h-9 text-[14px] ${Icon ? 'pl-9' : ''}`}
        />
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className={LABEL}>{children}</span>;
}

/** Một ô thông tin của thẻ "Công tác hiện tại": nhãn nhỏ bên trên, giá trị đậm bên dưới. */
export function InfoCell({ label, children, icon: Icon }: { label: string; children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="min-w-0">
      <p className="text-[14px] text-slate-500">{label}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold text-slate-900">
        {Icon && <Icon className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />}
        <span className="min-w-0 truncate">{children}</span>
      </p>
    </div>
  );
}

/** Tuổi nghề: "Dưới 1 tháng", "5 tháng", "2 năm 3 tháng" tính từ ngày vào làm; thiếu ngày thì "----". */
export function seniorityText(joinDate?: string | null, now: Date = new Date()): string {
  if (!joinDate) return '----';
  const join = new Date(joinDate);
  if (Number.isNaN(join.getTime())) return '----';
  const totalMonths = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth());
  if (totalMonths <= 0) return 'Dưới 1 tháng';
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years === 0) return `${months} tháng`;
  return months > 0 ? `${years} năm ${months} tháng` : `${years} năm`;
}

/** Chữ cái đầu của hai từ cuối của họ tên, dùng làm ảnh đại diện. */
export function initialsOf(name?: string | null): string {
  const text = (name ?? '').trim();
  if (!text) return 'NA';
  return (
    text
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((n) => n[0])
      .join('')
      .toUpperCase() || 'NA'
  );
}

/** Các mối quan hệ chọn nhanh cho người liên hệ khẩn cấp; giá trị đã lưu ngoài danh sách vẫn được giữ. */
export const RELATIONSHIP_OPTIONS = [
  'Vợ',
  'Chồng',
  'Bố',
  'Mẹ',
  'Anh',
  'Chị',
  'Em',
  'Con',
  'Bạn bè',
  'Khác',
] as const;

export function relationshipOptions(current: string): { value: string; label: string }[] {
  const list = RELATIONSHIP_OPTIONS.map((value) => ({ value, label: value })) as {
    value: string;
    label: string;
  }[];
  if (current && !RELATIONSHIP_OPTIONS.includes(current as (typeof RELATIONSHIP_OPTIONS)[number]))
    list.unshift({ value: current, label: current });
  return list;
}
