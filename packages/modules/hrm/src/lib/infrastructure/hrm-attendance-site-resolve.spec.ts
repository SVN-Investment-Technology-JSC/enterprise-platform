import { resolveAllowedAttendanceSites } from './hrm-attendance-site-resolve.js';

describe('resolveAllowedAttendanceSites', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const employeeId = '00000000-0000-0000-0000-000000000002';

  it('trả về toàn bộ active sites khi tenant chưa có bất kỳ dòng phân công nào (backward compatibility)', async () => {
    const mockDb = {
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('count(*)')) {
          return Promise.resolve({ rows: [{ count: '0' }] });
        }
        if (sql.includes('SELECT * FROM hrm_schema.attendance_sites')) {
          return Promise.resolve({
            rows: [
              { id: 'site-1', name: 'VP Đà Nẵng', active: true, radius_meters: 1000 },
              { id: 'site-2', name: 'VP Hà Nội', active: true, radius_meters: 500 },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const sites = await resolveAllowedAttendanceSites(mockDb as any, tenantId, employeeId);
    expect(sites).toHaveLength(2);
    expect(sites.map((s) => s.id)).toEqual(['site-1', 'site-2']);
  });

  it('chạy truy vấn đệ quy cây tổ chức khi tenant đã có cấu hình phân công', async () => {
    const mockDb = {
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('count(*)')) {
          return Promise.resolve({ rows: [{ count: '3' }] });
        }
        if (sql.includes('WITH RECURSIVE')) {
          return Promise.resolve({
            rows: [
              { id: 'site-1', name: 'VP Đà Nẵng', active: true, radius_meters: 1000 },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const sites = await resolveAllowedAttendanceSites(mockDb as any, tenantId, employeeId);
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBe('VP Đà Nẵng');
  });

  it('trả về mảng rỗng khi nhân viên không khớp với bất kỳ địa điểm nào được phân công', async () => {
    const mockDb = {
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('count(*)')) {
          return Promise.resolve({ rows: [{ count: '3' }] });
        }
        if (sql.includes('WITH RECURSIVE')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const sites = await resolveAllowedAttendanceSites(mockDb as any, tenantId, employeeId);
    expect(sites).toHaveLength(0);
  });
});
