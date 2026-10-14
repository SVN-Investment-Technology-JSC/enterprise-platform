import { BadRequestException, Body, Controller, Get, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { parseAutoAttendanceInput } from '../domain/auto-attendance-settings.js';
import { autoAttendanceSettingsReady, loadAutoAttendanceSettings } from '../infrastructure/hrm-auto-attendance.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { lifecycleAudit } from '../infrastructure/hrm-lifecycle.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { todayInVietnam } from '../infrastructure/hrm-timesheet-month.js';

const PERMISSION = 'hrm.time.configure';

function present(
  settings: { enabled: boolean; weekdays: number[]; enabledFrom: string | null } | null,
  ready: boolean,
  updatedAt?: Date | string | null,
) {
  return {
    enabled: settings?.enabled ?? false,
    weekdays: settings?.weekdays ?? [],
    enabledFrom: settings?.enabledFrom ?? null,
    ready,
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : (updatedAt ?? null),
  };
}

/**
 * Cấu hình chấm công tự động của tenant: bật/tắt và chọn các thứ trong tuần, độc lập với phân ca (không cần phân ca lại).
 * Bật hoặc đổi thứ thì chỉ áp dụng từ hôm nay trở đi, không đổi dữ liệu chấm công đã qua.
 */
@Controller('v1/auto-attendance-settings')
export class HrmAutoAttendanceSettingsController {
  constructor(private readonly ctx: HrmContextService) {}

  @Get()
  async get(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, PERMISSION);
    const ready = await autoAttendanceSettingsReady(pool, tenantId);
    const settings = ready ? await loadAutoAttendanceSettings(pool, tenantId) : null;
    return { data: present(settings, ready) };
  }

  @Put()
  async save(@Req() req: Request, @Body() body: { enabled?: unknown; weekdays?: unknown }) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, PERMISSION);
    const parsed = parseAutoAttendanceInput(body);
    if ('error' in parsed) throw new BadRequestException(parsed.error);
    if (!(await autoAttendanceSettingsReady(pool, tenantId)))
      throw new BadRequestException(
        'Cơ sở dữ liệu HRM chưa được cập nhật (migration 0055); chạy migration trước khi bật chấm công tự động',
      );
    const { enabled, weekdays } = parsed.value;
    const saved = await hrmTransaction(pool, async (db) => {
      const previous = await loadAutoAttendanceSettings(db, tenantId);
      // Giữ ngày bật cũ khi chỉ lưu lại cùng cấu hình; bật lại hoặc đổi thứ thì tính từ hôm nay.
      const same = previous.enabled && enabled && previous.weekdays.join(',') === weekdays.join(',');
      const enabledFrom = enabled
        ? same && previous.enabledFrom
          ? previous.enabledFrom
          : todayInVietnam()
        : previous.enabledFrom;
      const res = await db.query(
        `INSERT INTO hrm_schema.auto_attendance_settings (tenant_id, enabled, weekdays, enabled_from, updated_by)
         VALUES ($1, $2, $3::smallint[], $4::date, $5)
         ON CONFLICT (tenant_id) DO UPDATE
           SET enabled = EXCLUDED.enabled, weekdays = EXCLUDED.weekdays, enabled_from = EXCLUDED.enabled_from,
               updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING enabled, weekdays, to_char(enabled_from, 'YYYY-MM-DD') AS enabled_from, updated_at`,
        [tenantId, enabled, weekdays, enabledFrom, principal.userId],
      );
      await lifecycleAudit(db, tenantId, principal.userId, 'AUTO_ATTENDANCE_SETTINGS_SAVED', tenantId, {
        enabled,
        weekdays,
        enabledFrom,
      });
      return res.rows[0];
    });
    return {
      data: present(
        { enabled: saved.enabled, weekdays: saved.weekdays.map(Number), enabledFrom: saved.enabled_from ?? null },
        true,
        saved.updated_at,
      ),
    };
  }
}
