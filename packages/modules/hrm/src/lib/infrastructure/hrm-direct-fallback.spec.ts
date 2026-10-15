import {
  assertCanDecide,
  resolveApprovalScope,
  APPROVAL_OUT_OF_SCOPE,
} from './hrm-approval-policy.js';
import { previewApprovalRoute, NO_DIRECT_MANAGER_NOTE } from './hrm-approval-route.js';
import { loadDirectManagerRef } from './hrm-personnel-decisions.js';

describe('Kiểm thử chức năng duyệt đơn dự phòng & loại bỏ chốt dự phòng Tổng Giám Đốc', () => {
  const TENANT = 'tenant-test';
  const STAFF_ID = 'emp-staff';
  const STAFF_USER_ID = 'user-staff';
  const CEO_USER_ID = 'user-ceo';
  const FALLBACK_USER_ID = 'user-fallback';
  const FALLBACK_POS_ID = 'pos-fallback';

  describe('1. loadDirectManagerRef khi nhân viên không có quản lý trực tiếp theo Core', () => {
    it('trả về null, KHÔNG còn tự động fallback về Tổng Giám Đốc', async () => {
      const db = {
        query: async (sql: string) => {
          // Bảng organization_node_assignments: nhân viên có phân công chức danh không có reports_to_position_id
          if (sql.includes('organization_node_assignments')) {
            return {
              rows: [
                {
                  node_id: 'pos-staff',
                  is_primary: true,
                  override_id: null,
                  reports_to_id: null, // Không có cấp trên trực tiếp!
                },
              ],
              rowCount: 1,
            };
          }
          if (sql.includes('organization_nodes')) {
            return {
              rows: [{ id: 'pos-staff', reports_to_id: null }],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      } as never;

      const manager = await loadDirectManagerRef(db, TENANT, STAFF_ID);
      expect(manager).toBeNull();
    });
  });

  describe('2. previewApprovalRoute (Xem trước tuyến duyệt của nhân viên thiếu quản lý)', () => {
    it('khi loại đơn CHƯA cấu hình chức danh dự phòng: directManager null và kèm ghi chú NO_DIRECT_MANAGER_NOTE', async () => {
      const db = {
        query: async (sql: string) => {
          if (sql.includes('request_procedure_bindings')) {
            return {
              rows: [
                {
                  id: 'bind-1',
                  request_kind: 'leave',
                  sub_type_code: null,
                  mode: 'DIRECT',
                  procedure_definition_id: null,
                  fallback_position_id: null, // Chưa chọn dự phòng
                },
              ],
              rowCount: 1,
            };
          }
          if (sql.includes('to_regclass')) return { rows: [{ ready: true }] };
          if (sql.includes('approval_policy_settings')) return { rows: [{ allow_self_approval: false }] };
          return { rows: [], rowCount: 0 }; // managerFromCorePositions trả về null
        },
      } as never;

      const preview = await previewApprovalRoute(db, {
        tenantId: TENANT,
        kind: 'leave',
        employeeId: STAFF_ID,
      });

      expect(preview.mode).toBe('DIRECT');
      expect(preview.directManager).toBeNull();
      expect(preview.fallbackPosition).toBeNull();
      expect(preview.note).toBe(NO_DIRECT_MANAGER_NOTE);
    });

    it('khi loại đơn CÓ cấu hình chức danh dự phòng: directManager null và trả về fallbackPosition kèm ghi chú', async () => {
      const db = {
        query: async (sql: string) => {
          if (sql.includes('request_procedure_bindings')) {
            return {
              rows: [
                {
                  id: 'bind-1',
                  request_kind: 'leave',
                  sub_type_code: null,
                  mode: 'DIRECT',
                  procedure_definition_id: null,
                  fallback_position_id: FALLBACK_POS_ID, // Đã cấu hình chức danh dự phòng!
                },
              ],
              rowCount: 1,
            };
          }
          if (sql.includes('organization_nodes')) {
            return {
              rows: [{ id: FALLBACK_POS_ID, name: 'Trưởng phòng Hành chính' }],
              rowCount: 1,
            };
          }
          if (sql.includes('to_regclass')) return { rows: [{ ready: true }] };
          if (sql.includes('approval_policy_settings')) return { rows: [{ allow_self_approval: false }] };
          return { rows: [], rowCount: 0 };
        },
      } as never;

      const preview = await previewApprovalRoute(db, {
        tenantId: TENANT,
        kind: 'leave',
        employeeId: STAFF_ID,
      });

      expect(preview.mode).toBe('DIRECT');
      expect(preview.directManager).toBeNull();
      expect(preview.fallbackPosition).toEqual({
        positionId: FALLBACK_POS_ID,
        positionName: 'Trưởng phòng Hành chính',
      });
      expect(preview.note).toContain('Trưởng phòng Hành chính');
    });

    it('khi loại đơn CÓ CẢ quản lý trực tiếp và chức danh dự phòng: trả về cả hai và ghi chú hoặc 1 trong 2', async () => {
      const db = {
        query: async (sql: string) => {
          if (sql.includes('request_procedure_bindings')) {
            return {
              rows: [
                {
                  id: 'bind-1',
                  request_kind: 'leave',
                  sub_type_code: null,
                  mode: 'DIRECT',
                  procedure_definition_id: null,
                  fallback_position_id: FALLBACK_POS_ID,
                },
              ],
              rowCount: 1,
            };
          }
          if (sql.includes('core_schema.organization_nodes WHERE id=$1 AND category=\'position\'')) {
            return {
              rows: [{ id: FALLBACK_POS_ID, name: 'Trưởng phòng Hành chính' }],
              rowCount: 1,
            };
          }
          if (sql.includes('information_schema.columns')) {
            return { rows: [{ '?column?': 1 }], rowCount: 1 };
          }
          if (sql.includes('start_position_id')) {
            return { rows: [{ start_position_id: 'pos-mgr' }], rowCount: 1 };
          }
          if (sql.includes('WITH RECURSIVE chain')) {
            return {
              rows: [
                {
                  manager_employee_id: 'emp-mgr',
                  full_name: 'Nguyễn Quản Lý',
                  work_email: 'quanly@example.com',
                  position_name: 'Trưởng phòng Kỹ thuật',
                  employee_code: 'NV001',
                },
              ],
              rowCount: 1,
            };
          }
          if (sql.includes('to_regclass')) return { rows: [{ ready: true }] };
          if (sql.includes('approval_policy_settings')) return { rows: [{ allow_self_approval: false }] };
          return { rows: [], rowCount: 0 };
        },
      } as never;

      const preview = await previewApprovalRoute(db, {
        tenantId: TENANT,
        kind: 'leave',
        employeeId: STAFF_ID,
      });

      expect(preview.mode).toBe('DIRECT');
      expect(preview.directManager?.fullName).toBe('Nguyễn Quản Lý');
      expect(preview.fallbackPosition?.positionName).toBe('Trưởng phòng Hành chính');
      expect(preview.note).toContain('Quản lý trực tiếp (Nguyễn Quản Lý) hoặc người giữ chức danh Trưởng phòng Hành chính');
    });
  });

  describe('3. resolveApprovalScope (Phạm vi duyệt danh sách đơn)', () => {
    it('Tài khoản Tổng Giám Đốc không còn tự động nhận nhân viên thiếu quản lý vào danh sách chờ duyệt', async () => {
      const db = {
        query: async () => ({ rows: [], rowCount: 0 }),
      } as never;

      const orgScope = {
        subordinateUserIds: async () => new Set<string>(['user-subordinate-direct']),
      };

      const scope = await resolveApprovalScope(
        { userId: CEO_USER_ID, permissions: ['hrm.leave.approve'] },
        'leave',
        { db, tenantId: TENANT, orgScope },
      );

      // Chỉ có cấp dưới trực tiếp, tuyệt đối không có user-staff thiếu quản lý
      expect(scope.userIds).toEqual(['user-subordinate-direct']);
      expect(scope.userIds).not.toContain(STAFF_USER_ID);
    });

    it('Người giữ chức danh dự phòng nhận đơn duyệt dự phòng vào requestIds', async () => {
      const db = {
        query: async (sql: string) => {
          // Bổ nhiệm chức danh: người này giữ FALLBACK_POS_ID
          if (sql.includes('organization_node_assignments')) {
            return {
              rows: [{ node_id: FALLBACK_POS_ID }],
              rowCount: 1,
            };
          }
          // Binding DIRECT có fallback_position_id
          if (sql.includes('request_procedure_bindings')) {
            return {
              rows: [
                {
                  sub_type_code: null,
                  mode: 'DIRECT',
                  fallback_position_id: FALLBACK_POS_ID,
                },
              ],
              rowCount: 1,
            };
          }
          // Đơn leave đang chờ duyệt
          if (sql.includes('leave_requests')) {
            return {
              rows: [{ id: 'req-staff-1', sub_type_code: 'ANNUAL' }],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      } as never;

      const orgScope = {
        subordinateUserIds: async () => new Set<string>(), // Không có cấp dưới trực tiếp
      };

      const scope = await resolveApprovalScope(
        { userId: FALLBACK_USER_ID, permissions: ['hrm.leave.approve'] },
        'leave',
        { db, tenantId: TENANT, orgScope },
      );

      expect(scope.requestIds).toContain('req-staff-1');
    });
  });

  describe('4. assertCanDecide (Quyền bấm duyệt / từ chối đơn)', () => {
    it('Người giữ chức danh dự phòng được phép duyệt đơn', async () => {
      const db = {
        query: async (sql: string) => {
          if (sql.includes('leave_requests')) {
            return {
              rows: [{ employee_id: STAFF_ID, user_id: STAFF_USER_ID }],
              rowCount: 1,
            };
          }
          if (sql.includes('to_regclass')) return { rows: [{ ready: true }] };
          if (sql.includes('approval_policy_settings')) return { rows: [{ allow_self_approval: false }] };
          if (sql.includes('request_procedure_bindings')) {
            return {
              rows: [
                {
                  sub_type_code: null,
                  mode: 'DIRECT',
                  fallback_position_id: FALLBACK_POS_ID,
                },
              ],
              rowCount: 1,
            };
          }
          if (sql.includes('organization_node_assignments')) {
            // Người duyệt đang giữ chức danh dự phòng!
            return { rows: [{ '?column?': 1 }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      } as never;

      await expect(
        assertCanDecide(
          { userId: FALLBACK_USER_ID, permissions: ['hrm.leave.approve'] },
          { id: 'req-staff-1' },
          'leave',
          { db, tenantId: TENANT, orgScope: { subordinateUserIds: async () => new Set() } },
        ),
      ).resolves.toBeUndefined();
    });

    it('Tài khoản không phải cấp trên và không giữ chức danh dự phòng bị 403 (kể cả là Tổng Giám Đốc)', async () => {
      const db = {
        query: async (sql: string) => {
          if (sql.includes('leave_requests')) {
            return {
              rows: [{ employee_id: STAFF_ID, user_id: STAFF_USER_ID }],
              rowCount: 1,
            };
          }
          if (sql.includes('to_regclass')) return { rows: [{ ready: true }] };
          if (sql.includes('approval_policy_settings')) return { rows: [{ allow_self_approval: false }] };
          if (sql.includes('request_procedure_bindings')) {
            return {
              rows: [
                {
                  sub_type_code: null,
                  mode: 'DIRECT',
                  fallback_position_id: FALLBACK_POS_ID,
                },
              ],
              rowCount: 1,
            };
          }
          if (sql.includes('organization_node_assignments')) {
            // Không giữ chức danh dự phòng!
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        },
      } as never;

      await expect(
        assertCanDecide(
          { userId: CEO_USER_ID, permissions: ['hrm.leave.approve'] },
          { id: 'req-staff-1' },
          'leave',
          { db, tenantId: TENANT, orgScope: { subordinateUserIds: async () => new Set() } },
        ),
      ).rejects.toMatchObject({
        response: { code: APPROVAL_OUT_OF_SCOPE },
        status: 403,
      });
    });
  });
});
