import { BadRequestException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { HrmPersonProfileFact } from '@enterprise-platform/contracts-hrm';
import { requireUuid } from './hrm-validation.js';

export const PROFILE_FACTS_MAX_USER_IDS = 500;

export interface ProfileFactsFilter {
  readonly userIds?: readonly string[];
  readonly month?: number;
}

/** `?userIds=a,b` và `?month=1..12`; sai định dạng là 400 để bên gọi biết sửa. */
export function parseProfileFactsFilter(userIds?: string, month?: string): ProfileFactsFilter {
  const ids = (userIds ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (ids.length > PROFILE_FACTS_MAX_USER_IDS) {
    throw new BadRequestException({
      code: 'TOO_MANY_USER_IDS',
      message: `Chỉ lọc tối đa ${PROFILE_FACTS_MAX_USER_IDS} người dùng mỗi lần.`,
    });
  }
  let parsedMonth: number | undefined;
  if (month !== undefined && month !== '') {
    parsedMonth = Number(month);
    if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
      throw new BadRequestException({ code: 'INVALID_MONTH', message: 'Tháng phải từ 1 đến 12.' });
    }
  }
  return {
    ...(ids.length ? { userIds: ids.map((id) => requireUuid(id, 'userIds')) } : {}),
    ...(parsedMonth ? { month: parsedMonth } : {}),
  };
}

/**
 * Ngày sinh và ngày vào công ty của nhân sự đang làm việc có tài khoản người dùng. Chỉ đọc; nhân sự đã
 * nghỉ việc, đã xoá hoặc chưa gắn người dùng bị loại. Không trả dòng nếu cả ngày sinh lẫn ngày vào đều trống.
 */
export async function listProfileFacts(
  pool: Pool,
  tenantId: string,
  filter: ProfileFactsFilter = {},
): Promise<HrmPersonProfileFact[]> {
  const params: unknown[] = [tenantId];
  const where = [
    'ep.tenant_id = $1',
    'ep.deleted_at IS NULL',
    'e.deleted_at IS NULL',
    'e.user_id IS NOT NULL',
    "ep.employment_status NOT IN ('RESIGNED','TERMINATED')",
  ];
  if (filter.userIds?.length) {
    params.push([...filter.userIds]);
    where.push(`e.user_id = ANY($${params.length}::uuid[])`);
  }
  if (filter.month) {
    params.push(filter.month);
    where.push(`EXTRACT(MONTH FROM ep.date_of_birth) = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT e.user_id::text AS user_id,
            to_char(ep.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
            to_char(ep.join_date, 'YYYY-MM-DD') AS join_date
       FROM hrm_schema.employee_profiles ep
       JOIN core_schema.employees e ON e.id = ep.employee_id AND e.tenant_id = ep.tenant_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.user_id`,
    params,
  );
  const facts: HrmPersonProfileFact[] = [];
  for (const row of rows as Array<{ user_id: string; date_of_birth: string | null; join_date: string | null }>) {
    const birth = row.date_of_birth ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.date_of_birth) : null;
    if (!birth && !row.join_date) continue;
    facts.push({
      userId: row.user_id,
      ...(birth ? { birthYear: Number(birth[1]), birthMonth: Number(birth[2]), birthDay: Number(birth[3]) } : {}),
      ...(row.join_date ? { joinDate: row.join_date } : {}),
    });
  }
  return facts;
}
