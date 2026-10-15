'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Clock } from 'lucide-react';
import type { HrmScheduleAuditEntry, HrmShiftDefinition } from '@enterprise-platform/contracts-hrm';
import {
  auditActionLabel,
  auditActionTone,
  auditDateText,
  classifyScheduleError,
  groupScheduleAudit,
} from '../../hrm-work-schedule-model';
import { fetchScheduleAudit } from '../../hrm-work-schedule-api';
import { Button } from '../button';
import { SettingsSection, StatusPill } from '../settings-kit';
import { formatDateTime } from './audit-drawer';
import { EmptyState, Notice, Spinner } from './common';
import { RCell, RRow, ResponsiveTable } from './responsive-table';

/** Số bản ghi nhật ký tải về để gom theo đợt (mỗi nhân viên một dòng nhật ký). */
const WINDOW = 100;
const SHOWN = 5;
const COLUMNS = ['Ngày hiệu lực', 'Phạm vi', 'Ca', 'Người thực hiện', 'Thao tác'] as const;

/**
 * Thẻ "Lịch sử phân ca gần đây": các đợt phân ca/nhả ca gần nhất, chỉ gồm trường có thật của nhật ký phân ca
 * (ngày hiệu lực, phạm vi, ca, người thực hiện, thời điểm, hành động). Chi tiết đầy đủ ở "Xem tất cả" (ngăn kéo lịch sử).
 */
export function RecentScheduleHistory({
  shifts,
  refreshKey,
  onViewAll,
  onNotMigrated,
}: {
  shifts: readonly HrmShiftDefinition[];
  /** Đổi giá trị này để tải lại (sau khi lưu phân ca, nhả ca). */
  refreshKey: number;
  onViewAll: () => void;
  onNotMigrated?: () => void;
}) {
  const [rows, setRows] = useState<HrmScheduleAuditEntry[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    fetchScheduleAudit({ limit: WINDOW })
      .then((res) => alive && setRows(res.data))
      .catch((e) => {
        if (!alive) return;
        const info = classifyScheduleError(e);
        if (info.kind === 'NOT_MIGRATED') onNotMigrated?.();
        else setError(info.message);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // onNotMigrated chỉ là callback báo lên màn hình.
  }, [refreshKey]);

  const batches = useMemo(
    () => groupScheduleAudit(rows ?? [], shifts, { limit: SHOWN, windowFull: (rows?.length ?? 0) >= WINDOW }),
    [rows, shifts],
  );

  return (
    <SettingsSection
      icon={Clock}
      tone="blue"
      title="Lịch sử phân ca gần đây"
      description="Hiển thị các lần phân ca gần nhất."
      actions={
        <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-700" onClick={onViewAll}>
          Xem tất cả
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      }
    >
      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : loading && !rows ? (
        <EmptyState>
          <Spinner label="Đang tải lịch sử phân ca…" />
        </EmptyState>
      ) : batches.length === 0 ? (
        <EmptyState>Chưa có thay đổi phân ca nào được ghi nhận.</EmptyState>
      ) : (
        <ResponsiveTable columns={COLUMNS} loading={loading} label="Lịch sử phân ca gần đây">
          {batches.map((batch) => (
            <RRow key={batch.key}>
              <RCell label="Ngày hiệu lực" className="font-medium text-slate-900">
                <span>{auditDateText(batch.fromDate, batch.toDate) || '-'}</span>
              </RCell>
              <RCell label="Phạm vi">
                <span className="min-w-0 truncate text-right @2xl:text-left" title={batch.scopeText}>
                  {batch.scopeText || '-'}
                </span>
              </RCell>
              <RCell label="Ca">
                <span className="min-w-0 truncate text-right @2xl:text-left" title={batch.shiftText}>
                  {batch.shiftText || '-'}
                </span>
              </RCell>
              <RCell label="Người thực hiện">
                <span className="min-w-0 text-right @2xl:text-left">
                  <span className="block truncate">{batch.actorName ?? 'Không xác định'}</span>
                  <span className="block text-[12px] text-slate-500">{formatDateTime(batch.createdAt)}</span>
                </span>
              </RCell>
              <RCell label="Thao tác">
                <StatusPill tone={auditActionTone(batch.action)}>{auditActionLabel(batch.action)}</StatusPill>
              </RCell>
            </RRow>
          ))}
        </ResponsiveTable>
      )}
    </SettingsSection>
  );
}
