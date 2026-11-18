import type {
  AdjustHrmCompOffRequest,
  ConfirmHrmCompOffConversionRequest,
  DecideHrmTripDayLinesRequest,
  HrmCompOffAdjustmentRow,
  HrmCompOffAvailability,
  HrmCompOffBalanceDetail,
  HrmCompOffBalanceRow,
  HrmCompOffConversionPreview,
  HrmCompOffConversionResult,
  HrmCompOffStatus,
  HrmNextDayRest,
  HrmOvertimeBlock,
  HrmOvertimeClassifyPreview,
  HrmOvertimeCompSettings,
  HrmOvertimeMonthSummary,
  HrmTripDayLines,
  ImportHrmCompOffRequest,
  ImportHrmCompOffResult,
  OverrideHrmOvertimeBlockRequest,
  RemoveHrmOvertimeCompVersionRequest,
  SaveHrmOvertimeCompSettingsRequest,
  SaveHrmTripDayLinesRequest,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from './hrm-api';

/** Lời gọi API quỹ nghỉ bù và phân loại làm thêm; mọi phản hồi dạng `{ data }`. */
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const get = async <T>(path: string): Promise<T> => (await hrmFetch<{ data: T }>(path)).data;
const send = async <T>(path: string, method: string, body: unknown): Promise<T> =>
  (await hrmFetch<{ data: T }>(path, json(method, body))).data;

export const compOffApi = {
  settings: (asOf?: string) => get<HrmOvertimeCompSettings>(`/overtime-comp/settings${asOf ? `?asOf=${asOf}` : ''}`),
  saveSettings: (body: SaveHrmOvertimeCompSettingsRequest) => send<HrmOvertimeCompSettings>('/overtime-comp/settings', 'PUT', body),
  removeVersion: (id: string, body: RemoveHrmOvertimeCompVersionRequest) =>
    send<HrmOvertimeCompSettings>(`/overtime-comp/settings/versions/${id}`, 'DELETE', body),
  tripDayLines: (tripId: string) => get<HrmTripDayLines>(`/business-trip-requests/${tripId}/day-lines`),
  saveTripDayLines: (tripId: string, body: SaveHrmTripDayLinesRequest) =>
    send<HrmTripDayLines>(`/business-trip-requests/${tripId}/day-lines`, 'PUT', body),
  decideTripDayLines: (tripId: string, body: DecideHrmTripDayLinesRequest) =>
    send<HrmTripDayLines>(`/business-trip-requests/${tripId}/day-lines/decision`, 'POST', body),
  classifyPreview: (body: { employeeId: string; fromAt: string; toAt: string; nextDayRest?: HrmNextDayRest }) =>
    send<HrmOvertimeClassifyPreview>('/overtime-comp/classify-preview', 'POST', body),
  blocks: (month: string) => get<HrmOvertimeBlock[]>(`/overtime-comp/blocks?month=${month}`),
  overrideBlock: (id: string, body: OverrideHrmOvertimeBlockRequest) =>
    send<HrmOvertimeBlock>(`/overtime-comp/blocks/${id}`, 'PATCH', body),
  monthSummary: (month: string) =>
    get<{ month: string; enabled: boolean; rows: HrmOvertimeMonthSummary[] }>(`/overtime-comp/month-summary?month=${month}`),
  status: () => get<HrmCompOffStatus>('/comp-off/status'),
  balances: () => get<HrmCompOffBalanceRow[]>('/comp-off/balances'),
  detail: (employeeId: string) => get<HrmCompOffBalanceDetail>(`/comp-off/balances/${employeeId}`),
  conversionPreview: (month: string) => get<HrmCompOffConversionPreview>(`/comp-off/conversion-preview?month=${month}`),
  convert: (body: ConfirmHrmCompOffConversionRequest) => send<HrmCompOffConversionResult>('/comp-off/conversions', 'POST', body),
  adjustmentHistory: () => get<HrmCompOffAdjustmentRow[]>('/comp-off/adjustments'),
  adjust: (body: AdjustHrmCompOffRequest) => send<{ available: number }>('/comp-off/adjustments', 'POST', body),
  reverseAdjustment: (entryId: string, reason: string) =>
    send<{ available: number; reversalId: string }>(`/comp-off/ledger/${entryId}/reverse`, 'POST', { reason }),
  importAdjustments: (body: ImportHrmCompOffRequest) =>
    send<ImportHrmCompOffResult>('/comp-off/adjustments/import', 'POST', body),
  expire: () => send<{ expired: number }>('/comp-off/expire', 'POST', {}),
  availability: (employeeId: string, date?: string) => {
    const query = new URLSearchParams({ employeeId });
    if (date) query.set('date', date);
    return get<HrmCompOffAvailability>(`/comp-off/availability?${query}`);
  },
};
