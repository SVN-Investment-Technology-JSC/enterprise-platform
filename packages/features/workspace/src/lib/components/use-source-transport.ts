'use client';

import type {
  FleetAvailabilityView,
  TransportInput,
  TransportSourceType,
  TransportStatus,
} from '@enterprise-platform/contracts-workspace';
import {
  EMPTY_TRANSPORT,
  toTransportPayload,
  transportError,
  type TransportFieldValue,
  type TransportRange,
} from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useState } from 'react';
import { getFleetAvailability, getSourceTransport } from '../workspace-api';

/** Chờ người dùng gõ xong giờ rồi mới hỏi xe trống, tránh gọi API sau mỗi phím. */
const DEBOUNCE_MS = 300;

const validRange = (range: TransportRange | null): range is TransportRange =>
  Boolean(range && range.startAt && range.endAt && Date.parse(range.endAt) > Date.parse(range.startAt));

export interface SourceTransportState {
  readonly value: TransportFieldValue;
  readonly setValue: (next: TransportFieldValue) => void;
  /** Khung giờ dùng xe đang áp dụng (do người dùng nhập hoặc theo nguồn). */
  readonly range: TransportRange | null;
  readonly setRange: (next: TransportRange) => void;
  readonly destination: string;
  readonly setDestination: (next: string) => void;
  /** Trạng thái đặt xe HRM đã trả lời cho nguồn đang sửa; `null` nếu chưa có. */
  readonly bookingStatus: { status: TransportStatus; reason: string | null } | null;
  readonly availability: FleetAvailabilityView | null;
  readonly loading: boolean;
  readonly error: string | null;
  /** Lỗi cần sửa trước khi lưu; `null` nếu hợp lệ. */
  readonly problem: string | null;
  /**
   * Khối gửi lên API. `undefined`: không đụng tới phương tiện · `null`: bỏ phương tiện đã chọn trước đó ·
   * còn lại: lựa chọn mới.
   */
  readonly payload: () => TransportInput | null | undefined;
}

/**
 * Trạng thái khối "Phương tiện di chuyển" của form công việc hoặc lịch họp: nạp lựa chọn hiện có khi sửa, hỏi xe
 * và tài xế còn trống theo khung giờ, và dựng khối gửi lên API.
 *
 * `defaultRange` là khung giờ gợi ý (từ ngày dự kiến hoặc giờ của sự kiện); khi nguồn có sẵn khung giờ thì
 * `followsSource` để khung giờ luôn theo nguồn và không cho nhập riêng.
 */
export function useSourceTransport(options: {
  open: boolean;
  sourceType: TransportSourceType;
  /** Rỗng khi tạo mới. */
  sourceId?: string;
  defaultRange: TransportRange | null;
  followsSource: boolean;
}): SourceTransportState {
  const { open, sourceType, sourceId, defaultRange, followsSource } = options;
  const [value, setValue] = useState<TransportFieldValue>(EMPTY_TRANSPORT);
  const [ownRange, setOwnRange] = useState<TransportRange>({ startAt: '', endAt: '' });
  const [destination, setDestination] = useState('');
  const [existing, setExisting] = useState<'unknown' | 'none' | 'some'>(sourceId ? 'unknown' : 'none');
  const [bookingStatus, setBookingStatus] = useState<SourceTransportState['bookingStatus']>(null);
  const [availability, setAvailability] = useState<FleetAvailabilityView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range: TransportRange | null = followsSource
    ? defaultRange
    : ownRange.startAt || ownRange.endAt
      ? ownRange
      : defaultRange;

  // Mỗi lần mở form: bắt đầu lại; sửa thì nạp phương tiện hiện có.
  useEffect(() => {
    if (!open) return;
    setValue(EMPTY_TRANSPORT);
    setOwnRange({ startAt: '', endAt: '' });
    setDestination('');
    setBookingStatus(null);
    setAvailability(null);
    setError(null);
    setExisting(sourceId ? 'unknown' : 'none');
    if (!sourceId) return;
    let cancelled = false;
    getSourceTransport(sourceType, sourceId)
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) {
          setExisting('none');
          return;
        }
        setExisting('some');
        setValue({
          mode: data.mode,
          detail: data.detail ?? '',
          vehicleId: data.vehicleId ?? '',
          driverId: data.driverId ?? '',
        });
        setDestination(data.destination ?? '');
        if (data.startAt && data.endAt) setOwnRange({ startAt: data.startAt, endAt: data.endAt });
        if (data.mode === 'COMPANY_VEHICLE') setBookingStatus({ status: data.status, reason: data.statusReason });
      })
      .catch(() => {
        // Không đọc được thì để "không rõ": lưu form không đụng tới phương tiện đang có.
        if (!cancelled) setExisting('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [open, sourceType, sourceId]);

  const wantsVehicle = open && value.mode === 'COMPANY_VEHICLE';
  const ready = wantsVehicle && validRange(range);
  const startAt = range?.startAt ?? '';
  const endAt = range?.endAt ?? '';

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      getFleetAvailability({
        from: startAt,
        to: endAt,
        exclude: sourceId ? { sourceType, sourceId } : undefined,
      })
        .then(({ data }) => {
          if (cancelled) return;
          setAvailability(data);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError((cause as { message?: string })?.message ?? 'Không tải được danh sách xe.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, startAt, endAt, sourceType, sourceId]);

  const setRange = useCallback((next: TransportRange) => setOwnRange(next), []);

  const payload = useCallback((): TransportInput | null | undefined => {
    if (value.mode === '') {
      // Chỉ bỏ phương tiện khi chắc chắn nguồn đang có; chưa biết thì không đụng tới.
      return existing === 'some' ? null : undefined;
    }
    return toTransportPayload(value, range, destination.trim() || null) ?? undefined;
  }, [value, range, destination, existing]);

  return {
    value,
    setValue,
    range,
    setRange,
    destination,
    setDestination,
    bookingStatus,
    availability,
    loading: ready && loading,
    error: ready ? error : null,
    problem: transportError(value, range),
    payload,
  };
}
