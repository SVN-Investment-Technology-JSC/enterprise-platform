import { ReportService } from './report.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { ReportScopeFilter, WorkspaceStore } from './workspace-store.port.js';

interface Seen {
  scopeCalls: ReportScopeFilter[];
  financeCalls: number;
  workloadSelf: (string | undefined)[];
  overdueSelf: (string | undefined)[];
}

/**
 * Store giả ghi lại mọi tham số phạm vi.
 *
 * Điều đáng kiểm ở nhóm này không phải con số trả về mà là **phạm vi được
 * truyền xuống SQL** — đó là chỗ quyết định ai thấy số liệu của ai.
 */
function makeStore(options: { managedProjects?: string[]; scopedProjects?: string[] } = {}) {
  const seen: Seen = { scopeCalls: [], financeCalls: 0, workloadSelf: [], overdueSelf: [] };
  const store = {
    report: {
      scopedProjectIds: async (_tenant: string, scope: ReportScopeFilter) => {
        seen.scopeCalls.push(scope);
        if (scope.level === 'managed' && seen.scopeCalls.length === 1) {
          return options.managedProjects ?? [];
        }
        return options.scopedProjects ?? ['p1'];
      },
      myBlock: async () => ({ openItems: 4, overdueItems: 1, completedInPeriod: 2 }),
      projectProgress: async () => [],
      workload: async (
        _tenant: string,
        _ids: readonly string[],
        _today: string,
        _weekEnd: string,
        selfUserId?: string,
      ) => {
        seen.workloadSelf.push(selfUserId);
        return [];
      },
      overdue: async (
        _tenant: string,
        _ids: readonly string[],
        _today: string,
        selfUserId: string | undefined,
      ) => {
        seen.overdueSelf.push(selfUserId);
        return [];
      },
    },
    finance: {
      inputs: async () => {
        seen.financeCalls += 1;
        return new Map([
          [
            'p1',
            {
              contractValue: 25_500_000_000,
              budget: null,
              committedCost: 3_200_000_000,
              forecastCostOverride: null,
              actualCost: 14_800_000_000,
              remainingEstimate: 2_100_000_000,
            },
          ],
        ]);
      },
    },
  } as unknown as WorkspaceStore;
  return { store, seen };
}

const actor = (userId: string, isTenantAdmin = false): WorkspaceActor => ({
  tenantId: 't1',
  userId,
  displayName: userId,
  isTenantAdmin,
  canManage: isTenantAdmin,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
});

describe('ReportService — phạm vi theo vai trò', () => {
  it('tenant-admin nhận phạm vi toàn tenant, không hỏi vai trò dự án', async () => {
    const { store, seen } = makeStore();
    const bundle = await new ReportService(store).bundle(actor('u-admin', true), {});
    expect(bundle.scope.level).toBe('tenant');
    // Chỉ một lượt hỏi phạm vi: không cần dò xem họ quản lý dự án nào.
    expect(seen.scopeCalls).toHaveLength(1);
    expect(seen.scopeCalls[0]?.level).toBe('tenant');
  });

  it('người phụ trách ít nhất một dự án được mức managed', async () => {
    const { store } = makeStore({ managedProjects: ['p1'] });
    const bundle = await new ReportService(store).bundle(actor('u-mgr'), {});
    expect(bundle.scope.level).toBe('managed');
  });

  it('người không phụ trách dự án nào rơi về mức self', async () => {
    const { store } = makeStore({ managedProjects: [] });
    const bundle = await new ReportService(store).bundle(actor('u-member'), {});
    expect(bundle.scope.level).toBe('self');
  });
});

describe('ReportService — số liệu người khác', () => {
  it('mức self kẹp hai bảng chi tiết về chính người gọi', async () => {
    const { store, seen } = makeStore({ managedProjects: [] });
    await new ReportService(store).bundle(actor('u-member'), {});
    expect(seen.workloadSelf).toEqual(['u-member']);
    expect(seen.overdueSelf).toEqual(['u-member']);
  });

  it('mức managed thấy số liệu mọi thành viên trong phạm vi', async () => {
    const { store, seen } = makeStore({ managedProjects: ['p1'] });
    await new ReportService(store).bundle(actor('u-mgr'), {});
    expect(seen.workloadSelf).toEqual([undefined]);
    expect(seen.overdueSelf).toEqual([undefined]);
  });

  it('mức self không được xem khối tài chính', async () => {
    const { store } = makeStore({ managedProjects: [] });
    const bundle = await new ReportService(store).bundle(actor('u-member'), {});
    expect(bundle.scope.canSeeFinance).toBe(false);
  });
});

describe('ReportService — lọc dự án', () => {
  it('lọc dự án không tham gia trả 403, KHÔNG trả mảng rỗng', async () => {
    // Mảng rỗng khiến người dùng tưởng dự án không có dữ liệu; 403 nói đúng
    // rằng họ không được xem.
    const { store } = makeStore({ managedProjects: [], scopedProjects: [] });
    await expect(
      new ReportService(store).bundle(actor('u1'), { projectIds: 'p-khong-tham-gia' }),
    ).rejects.toMatchObject({ code: 'PROJECT_FORBIDDEN', statusCode: 403 });
  });

  it('không lọc dự án nào thì phạm vi rỗng vẫn hợp lệ', async () => {
    const { store } = makeStore({ managedProjects: [], scopedProjects: [] });
    const bundle = await new ReportService(store).bundle(actor('u1'), {});
    expect(bundle.projectProgress).toEqual([]);
    expect(bundle.scope.projectCount).toBe(0);
  });

  it('danh sách dự án tách bằng dấu phẩy, bỏ trùng và khoảng trắng', async () => {
    const { store, seen } = makeStore({ managedProjects: ['p1'] });
    await new ReportService(store).bundle(actor('u1'), { projectIds: ' p1 , p2 ,p1, ' });
    expect(seen.scopeCalls[1]?.projectIds).toEqual(['p1', 'p2']);
  });
});

describe('ReportService — khoảng thời gian', () => {
  it('mặc định là tuần hiện tại', async () => {
    const { store } = makeStore({ managedProjects: [] });
    const bundle = await new ReportService(store).bundle(actor('u1'), {});
    const days = (new Date(bundle.to).getTime() - new Date(bundle.from).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(7);
  });

  it('mốc kết thúc trước mốc bắt đầu bị từ chối', async () => {
    const { store } = makeStore({ managedProjects: [] });
    await expect(
      new ReportService(store).bundle(actor('u1'), {
        from: '2026-09-30T00:00:00Z',
        to: '2026-09-01T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('khoảng rộng quá 366 ngày bị chặn', async () => {
    const { store } = makeStore({ managedProjects: [] });
    await expect(
      new ReportService(store).bundle(actor('u1'), {
        from: '2024-01-01T00:00:00Z',
        to: '2026-01-01T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'RANGE_TOO_WIDE' });
  });

  it('trả kèm múi giờ và thời điểm sinh số liệu', async () => {
    const { store } = makeStore({ managedProjects: [] });
    const bundle = await new ReportService(store).bundle(actor('u1'), {});
    expect(bundle.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(Number.isNaN(new Date(bundle.generatedAt).getTime())).toBe(false);
  });
});

describe('ReportService — khối tài chính', () => {
  it('mức self KHÔNG truy vấn tài chính chút nào, và payload không có khối đó', async () => {
    // Không phải truy vấn rồi bỏ đi: số tiền không được rời CSDL nếu không ai
    // được xem nó.
    const { store, seen } = makeStore({ managedProjects: [] });
    const bundle = await new ReportService(store).bundle(actor('u-member'), {});
    expect(seen.financeCalls).toBe(0);
    expect('finance' in bundle).toBe(false);
  });

  it('mức managed nhận tổng hợp tài chính khớp ví dụ của đặc tả', async () => {
    const { store } = makeStore({ managedProjects: ['p1'] });
    const bundle = await new ReportService(store).bundle(actor('u-mgr'), {});
    expect(bundle.finance).toMatchObject({
      projectCount: 1,
      contractValue: 25_500_000_000,
      profit: 5_400_000_000,
      profitMargin: 21.2,
    });
  });
});
