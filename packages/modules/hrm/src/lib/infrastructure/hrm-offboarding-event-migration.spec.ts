import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(__dirname, '../../../../../../migrations/tenant/hrm');
const read = (name: string) => readFileSync(resolve(MIGRATIONS, `${name}.sql`), 'utf8');

/** Thân hàm trigger ghi `hrm.employee.offboarded` của bản migration số lớn nhất (bản đang có hiệu lực). */
function latestOffboardedTrigger(): { version: string; sql: string } {
  const versions = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => file.slice(0, -4))
    .sort();
  const defining = versions.filter((version) =>
    /CREATE OR REPLACE FUNCTION hrm_schema\.record_employee_offboarded_event/.test(read(version)),
  );
  const version = defining.at(-1) as string;
  return { version, sql: read(version) };
}

describe('hrm.employee.offboarded gửi ngày nghỉ việc thật', () => {
  it('bản trigger đang có hiệu lực là 0083 và lấy effectiveDate từ inactive_from', () => {
    const { version, sql } = latestOffboardedTrigger();
    expect(version).toBe('0083-hrm-offboarding-effective-date');
    expect(sql).toMatch(/'effectiveDate',\s*to_char\(COALESCE\(NEW\.inactive_from, CURRENT_DATE\), 'YYYY-MM-DD'\)/);
    expect(sql).not.toMatch(/'effectiveDate',\s*CURRENT_DATE/);
  });

  it('giữ nguyên tên loại sự kiện, envelope và điều kiện chuyển sang nghỉ việc', () => {
    const { sql } = latestOffboardedTrigger();
    expect(sql).toContain("'hrm.employee.offboarded'");
    expect(sql).toContain("'tenantId', NEW.tenant_id");
    expect(sql).toContain("'occurredAt', now()");
    expect(sql).toMatch(/NEW\.employment_status IN \('RESIGNED', 'TERMINATED'\)\s+AND OLD\.employment_status NOT IN/);
    expect(sql).not.toMatch(/core_schema/);
  });

  it('không sửa migration cũ: 0034 vẫn là bản ghi CURRENT_DATE', () => {
    expect(read('0034-hrm-offboarding-event-envelope')).toMatch(/'effectiveDate', CURRENT_DATE/);
  });
});
