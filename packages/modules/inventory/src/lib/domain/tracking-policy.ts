import {
  MATERIAL_TRACKING_MODES,
  isMaterialTrackingMode,
  resolveTrackingMode,
  type MaterialKind,
  type MaterialTrackingMode,
} from '@enterprise-platform/contracts-inventory';
import { InventoryError } from './inventory.error.js';

/**
 * Cách theo dõi tồn (NONE, LOT, SERIAL) của mặt hàng: luật chọn và đổi.
 *
 * Hàm thuần, không đụng database: application gọi, rồi tự kiểm công tắc tenant và dấu vết tồn.
 */

/** Giá trị gửi lên phải thuộc ba giá trị; bỏ trống là không đổi. Sai thì 400, không lặng lẽ bỏ qua. */
export function requireTrackingMode(value: unknown): MaterialTrackingMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isMaterialTrackingMode(value)) {
    throw new InventoryError(
      'VALIDATION',
      `Cách theo dõi phải là một trong: ${MATERIAL_TRACKING_MODES.join(', ')}.`,
    );
  }
  return value;
}

const SERVICE_MESSAGE = 'Mặt hàng dịch vụ không theo dõi lô hoặc serial.';
const MISMATCH_MESSAGE = 'Cách theo dõi và cờ serial không khớp nhau.';

export interface TrackingResolution {
  readonly mode: MaterialTrackingMode;
  /**
   * `true` khi người gọi chọn `trackingMode` rõ ràng. Chỉ khi đó mới kiểm công tắc tenant: đường cũ chỉ gửi
   * cờ `isSerialized` (nhập từ hệ cũ, khai sê-ri) giữ nguyên hành vi, không bị công tắc chặn.
   */
  readonly explicit: boolean;
}

/** Cách theo dõi của mặt hàng khi tạo. */
export function resolveCreateTracking(
  input: { readonly trackingMode?: unknown; readonly isSerialized?: boolean },
  kind: MaterialKind,
): TrackingResolution {
  const requested = requireTrackingMode(input.trackingMode);
  if (kind === 'SERVICE') {
    if (requested && requested !== 'NONE') throw new InventoryError('VALIDATION', SERVICE_MESSAGE);
    return { mode: 'NONE', explicit: false };
  }
  if (requested !== undefined) {
    if (input.isSerialized !== undefined && input.isSerialized !== (requested === 'SERIAL')) {
      throw new InventoryError('VALIDATION', MISMATCH_MESSAGE);
    }
    return { mode: requested, explicit: true };
  }
  return { mode: input.isSerialized ? 'SERIAL' : 'NONE', explicit: false };
}

export interface TrackingChange extends TrackingResolution {
  readonly current: MaterialTrackingMode;
}

/**
 * Cách theo dõi sau một lần sửa. `trackingMode` thắng; chỉ có `isSerialized` (đường cũ) thì bật là SERIAL,
 * tắt chỉ đưa SERIAL về NONE chứ không đụng LOT. Đổi sang dịch vụ luôn đưa về NONE.
 */
export function resolveUpdateTracking(
  current: { readonly trackingMode?: MaterialTrackingMode; readonly isSerialized?: boolean },
  kind: MaterialKind,
  patch: { readonly trackingMode?: unknown; readonly isSerialized?: boolean },
): TrackingChange {
  const currentMode = resolveTrackingMode(current);
  const requested = requireTrackingMode(patch.trackingMode);
  let next = currentMode;
  let explicit = false;
  if (requested !== undefined) {
    if (patch.isSerialized !== undefined && patch.isSerialized !== (requested === 'SERIAL')) {
      throw new InventoryError('VALIDATION', MISMATCH_MESSAGE);
    }
    next = requested;
    explicit = true;
  } else if (patch.isSerialized !== undefined) {
    next = patch.isSerialized ? 'SERIAL' : currentMode === 'SERIAL' ? 'NONE' : currentMode;
  }
  if (kind === 'SERVICE') {
    if (requested && requested !== 'NONE') throw new InventoryError('VALIDATION', SERVICE_MESSAGE);
    next = 'NONE';
    explicit = false;
  }
  return { current: currentMode, mode: next, explicit };
}

const MODE_LABEL: Readonly<Record<MaterialTrackingMode, string>> = {
  NONE: 'số lượng',
  LOT: 'lô',
  SERIAL: 'serial',
};

/** Tên gọi tiếng Việt của cách theo dõi, dùng trong thông báo lỗi. */
export function trackingModeLabel(mode: MaterialTrackingMode): string {
  return MODE_LABEL[mode];
}

export function trackingChangeBlockedMessage(code: string): string {
  return `Mã ${code} đã có tồn, bút toán, chứng từ, giữ hàng, lô hoặc serial; không đổi được cách theo dõi.`;
}
