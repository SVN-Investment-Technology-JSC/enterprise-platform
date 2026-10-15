'use client';

import { Suspense, lazy, type ReactNode } from 'react';
import { SearchableSelect, type SearchableSelectOption } from './searchable-select';
import styles from './transport-field.module.css';

/**
 * Khối "Phương tiện di chuyển" dùng chung cho đơn công tác, công việc, lịch họp và phiếu sự cố.
 * Thuần trình bày: nơi dùng tự lấy danh sách xe và tài xế còn trống (kèm khoảng bận) từ API của module mình.
 * Xe công ty cần chọn cả xe và tài xế; xe hoặc tài xế bận trong khung giờ bị làm mờ và nói rõ lý do.
 * Phương tiện ngoài do nhân sự tự sắp xếp, chỉ ghi nhận loại phương tiện.
 */
export type TransportMode = 'COMPANY_VEHICLE' | 'EXTERNAL';

export interface TransportFieldValue {
  readonly mode: TransportMode | '';
  /** Phương tiện ngoài: taxi hoặc xe ngoài, máy bay, xe cá nhân... */
  readonly detail: string;
  readonly vehicleId: string;
  readonly driverId: string;
}

export const EMPTY_TRANSPORT: TransportFieldValue = { mode: '', detail: '', vehicleId: '', driverId: '' };

export interface TransportBusySlot {
  readonly startAt: string;
  readonly endAt: string;
  readonly sourceLabel: string | null;
}
export interface TransportVehicleOption {
  readonly id: string;
  readonly plateNo: string;
  readonly name: string;
  readonly seats: number;
  readonly busy: readonly TransportBusySlot[];
}
export interface TransportDriverOption {
  readonly id: string;
  readonly employeeName: string | null;
  readonly busy: readonly TransportBusySlot[];
}
export interface TransportAvailability {
  readonly vehicles: readonly TransportVehicleOption[];
  readonly drivers: readonly TransportDriverOption[];
}

export interface TransportRange {
  readonly startAt: string;
  readonly endAt: string;
}

export const DEFAULT_EXTERNAL_TRANSPORTS: readonly string[] = [
  'Taxi hoặc xe ngoài',
  'Máy bay',
  'Xe cá nhân',
  'Phương tiện khác',
];

/**
 * Ô chọn ngày giờ (Ant Design) tải theo nhu cầu: gói gốc của shared-ui không kéo Ant Design vào những nơi
 * không dùng khối phương tiện.
 */
const DateTimePicker = lazy(() =>
  import('./date-picker-input').then((module) => ({ default: module.DateTimePickerInput })),
);

const MODE_OPTIONS: SearchableSelectOption[] = [
  { value: 'COMPANY_VEHICLE', label: 'Xe công ty' },
  { value: 'EXTERNAL', label: 'Phương tiện ngoài (tự sắp xếp)' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const ddmm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};

/** ISO -> giá trị của `<input type="datetime-local">` theo giờ máy người dùng. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Giá trị `<input type="datetime-local">` -> ISO; rỗng khi chưa nhập đủ. */
export function fromLocalInput(value: string): string {
  const d = new Date(value);
  return value && Number.isFinite(d.getTime()) ? d.toISOString() : '';
}

/** Khoảng bận đầu tiên chồng lên khung giờ [startAt, endAt). */
export function overlappingSlot(
  busy: readonly TransportBusySlot[],
  range: TransportRange | null,
): TransportBusySlot | undefined {
  if (!range || !range.startAt || !range.endAt) return undefined;
  const start = Date.parse(range.startAt);
  const end = Date.parse(range.endAt);
  if (!(end > start)) return undefined;
  return busy.find((slot) => Date.parse(slot.startAt) < end && Date.parse(slot.endAt) > start);
}

function busyText(slot: TransportBusySlot): string {
  return `Bận ${ddmm(slot.startAt)} ${hhmm(slot.startAt)}-${hhmm(slot.endAt)}${slot.sourceLabel ? ` · ${slot.sourceLabel}` : ''}`;
}

/** Thông báo lỗi khi chưa đủ điều kiện gửi; null nếu hợp lệ (hoặc chưa chọn phương tiện). */
export function transportError(value: TransportFieldValue, range: TransportRange | null): string | null {
  if (value.mode === 'EXTERNAL' && !value.detail.trim()) return 'Chọn loại phương tiện ngoài.';
  if (value.mode !== 'COMPANY_VEHICLE') return null;
  if (!range || !range.startAt || !range.endAt || Date.parse(range.endAt) <= Date.parse(range.startAt)) {
    return 'Nhập giờ đi và giờ về (giờ về phải sau giờ đi) để chọn xe.';
  }
  if (!value.vehicleId) return 'Chọn xe công ty.';
  if (!value.driverId) return 'Chọn tài xế.';
  return null;
}

/** Khối gửi lên API; null khi chưa chọn phương tiện. */
export function toTransportPayload(
  value: TransportFieldValue,
  range: TransportRange | null,
  destination?: string | null,
):
  | {
      mode: TransportMode;
      detail?: string | null;
      vehicleId?: string;
      driverId?: string;
      startAt?: string;
      endAt?: string;
      destination?: string | null;
    }
  | null {
  if (value.mode === 'EXTERNAL') return { mode: 'EXTERNAL', detail: value.detail.trim() };
  if (value.mode !== 'COMPANY_VEHICLE' || !range) return null;
  return {
    mode: 'COMPANY_VEHICLE',
    vehicleId: value.vehicleId,
    driverId: value.driverId,
    startAt: range.startAt,
    endAt: range.endAt,
    destination: destination ?? null,
  };
}

export interface TransportFieldProps {
  readonly value: TransportFieldValue;
  readonly onChange: (next: TransportFieldValue) => void;
  /** Khung giờ dùng xe, tính khoảng bận. */
  readonly range: TransportRange | null;
  /** Có thì hiện hai ô nhập giờ đi, giờ về (nơi dùng chưa có giờ riêng cho chuyến). */
  readonly onRangeChange?: (next: TransportRange) => void;
  readonly availability: TransportAvailability | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly externalOptions?: readonly string[];
  readonly disabled?: boolean;
  readonly idPrefix?: string;
  /** Chiều cao các ô chọn và ô giờ (px), khớp với các ô khác trong form; mặc định 38 như SearchableSelect. */
  readonly selectHeight?: number;
  /** Dòng ghi chú dưới khối (ví dụ lịch xe sẽ được giữ chỗ tới khi đơn được duyệt). */
  readonly note?: ReactNode;
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function TransportField({
  value,
  onChange,
  range,
  onRangeChange,
  availability,
  loading = false,
  error = null,
  externalOptions = DEFAULT_EXTERNAL_TRANSPORTS,
  disabled = false,
  idPrefix = 'transport',
  selectHeight = 38,
  note,
}: TransportFieldProps) {
  const vehicleOptions: SearchableSelectOption[] = (availability?.vehicles ?? []).map((vehicle) => {
    const slot = overlappingSlot(vehicle.busy, range);
    return {
      value: vehicle.id,
      label: `${vehicle.plateNo} · ${vehicle.name} (${vehicle.seats} chỗ)`,
      description: slot ? busyText(slot) : undefined,
      disabled: Boolean(slot),
    };
  });
  const driverOptions: SearchableSelectOption[] = (availability?.drivers ?? []).map((driver) => {
    const slot = overlappingSlot(driver.busy, range);
    return {
      value: driver.id,
      label: driver.employeeName ?? 'Tài xế',
      description: slot ? busyText(slot) : undefined,
      disabled: Boolean(slot),
    };
  });
  const rangeReady = Boolean(range && range.startAt && range.endAt && Date.parse(range.endAt) > Date.parse(range.startAt));
  const problem = transportError(value, range);

  return (
    <div className={styles.root} data-testid="transport-field">
      <Field id={`${idPrefix}-mode`} label="Phương tiện di chuyển">
        <SearchableSelect
          height={selectHeight}
          options={MODE_OPTIONS}
          value={value.mode}
          placeholder="Không cần phương tiện"
          disabled={disabled}
          clearable
          onChange={(mode) => onChange({ ...EMPTY_TRANSPORT, mode: mode as TransportMode | '' })}
        />
      </Field>

      {value.mode === 'EXTERNAL' ? (
        <Field id={`${idPrefix}-detail`} label="Loại phương tiện">
          <SearchableSelect
            height={selectHeight}
            options={externalOptions.map((option) => ({ value: option, label: option }))}
            value={value.detail}
            placeholder="Chọn loại phương tiện"
            disabled={disabled}
            clearable={false}
            onChange={(detail) => onChange({ ...value, detail })}
          />
        </Field>
      ) : null}

      {value.mode === 'COMPANY_VEHICLE' ? (
        <>
          {onRangeChange ? (
            <div className={styles.row}>
              <Field id={`${idPrefix}-start`} label="Giờ đi">
                <Suspense fallback={<div className={styles.input} style={{ height: selectHeight }} aria-hidden />}>
                  <DateTimePicker
                    id={`${idPrefix}-start`}
                    height={selectHeight}
                    disabled={disabled}
                    value={range?.startAt ?? ''}
                    onChange={(startAt) => onRangeChange({ startAt, endAt: range?.endAt ?? '' })}
                  />
                </Suspense>
              </Field>
              <Field id={`${idPrefix}-end`} label="Giờ về">
                <Suspense fallback={<div className={styles.input} style={{ height: selectHeight }} aria-hidden />}>
                  <DateTimePicker
                    id={`${idPrefix}-end`}
                    height={selectHeight}
                    disabled={disabled}
                    value={range?.endAt ?? ''}
                    onChange={(endAt) => onRangeChange({ startAt: range?.startAt ?? '', endAt })}
                  />
                </Suspense>
              </Field>
            </div>
          ) : null}
          <div className={styles.row}>
            <Field id={`${idPrefix}-vehicle`} label="Xe công ty">
              <SearchableSelect
                height={selectHeight}
                options={vehicleOptions}
                value={value.vehicleId}
                placeholder={loading ? 'Đang tải xe…' : 'Chọn xe còn trống'}
                emptyText="Không có xe nào trong danh mục"
                disabled={disabled || !rangeReady}
                clearable={false}
                onChange={(vehicleId) => onChange({ ...value, vehicleId })}
              />
            </Field>
            <Field id={`${idPrefix}-driver`} label="Tài xế">
              <SearchableSelect
                height={selectHeight}
                options={driverOptions}
                value={value.driverId}
                placeholder={loading ? 'Đang tải tài xế…' : 'Chọn tài xế còn trống'}
                emptyText="Chưa có tài xế nào trong danh mục"
                disabled={disabled || !rangeReady}
                clearable={false}
                onChange={(driverId) => onChange({ ...value, driverId })}
              />
            </Field>
          </div>
        </>
      ) : null}

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : value.mode && problem ? (
        <p role="status" className={styles.hint}>
          {problem}
        </p>
      ) : null}
      {value.mode === 'COMPANY_VEHICLE' && note ? <p className={styles.hint}>{note}</p> : null}
    </div>
  );
}
