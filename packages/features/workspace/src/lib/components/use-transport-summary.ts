'use client';

import type { SourceTransport, TransportSourceType } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { getFleetAvailability, getSourceTransport } from '../workspace-api';

export interface TransportSummary {
  readonly transport: SourceTransport;
  /** Biển số và tên xe; rỗng nếu không đọc được lịch xe của HRM (HRM tắt, xe đã ngừng sử dụng). */
  readonly vehicleLabel: string | null;
  readonly driverLabel: string | null;
}

/**
 * Phương tiện của một công việc hoặc lịch họp để hiện ở phần chi tiết. Workspace chỉ lưu mã xe và mã tài xế, nên tên
 * lấy từ danh sách xe của HRM (chỉ đọc); không đọc được thì vẫn hiện "Xe công ty" mà không có tên.
 * Đọc lại khi `version` đổi (vd công việc vừa được sửa).
 */
export function useTransportSummary(
  sourceType: TransportSourceType,
  sourceId: string | undefined,
  version?: string,
): TransportSummary | null {
  const [summary, setSummary] = useState<TransportSummary | null>(null);

  useEffect(() => {
    setSummary(null);
    if (!sourceId) return;
    let cancelled = false;
    (async () => {
      const { data } = await getSourceTransport(sourceType, sourceId);
      if (cancelled || !data) return;
      let vehicleLabel: string | null = null;
      let driverLabel: string | null = null;
      if (data.mode === 'COMPANY_VEHICLE' && data.startAt && data.endAt) {
        try {
          const { data: fleet } = await getFleetAvailability({
            from: data.startAt,
            to: data.endAt,
            exclude: { sourceType, sourceId },
          });
          const vehicle = fleet.vehicles.find((v) => v.id === data.vehicleId);
          const driver = fleet.drivers.find((d) => d.id === data.driverId);
          vehicleLabel = vehicle ? `${vehicle.plateNo} · ${vehicle.name}` : null;
          driverLabel = driver?.employeeName ?? null;
        } catch {
          // HRM không trả lời: bỏ qua, chỉ thiếu tên xe và tài xế.
        }
      }
      if (!cancelled) setSummary({ transport: data, vehicleLabel, driverLabel });
    })().catch(() => {
      if (!cancelled) setSummary(null);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceType, sourceId, version]);

  return summary;
}
