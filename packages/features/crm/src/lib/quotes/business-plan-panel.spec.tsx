/**
 * @jest-environment jsdom
 */
import type { BusinessPlanDetail } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { fixtureDetail, fixtureVersion } from '../quote-layout/quote-layout.fixtures';
import { BusinessPlanPanel } from './business-plan-panel';
import { PLAN_IN_PROCEDURE_MESSAGE, isPlanConflict, isPlanInProcedure, planConflictMessage } from './business-plan.model';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('../pricing/pricing.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('@enterprise-platform/shared-ui', () => ({
  SearchableSelect: () => <div />,
  // Hộp xác nhận: bấm nút con là xác nhận luôn.
  Popconfirm: ({ children, onConfirm }: { children: ReactNode; onConfirm: () => void }) => <span onClickCapture={onConfirm}>{children}</span>,
  formatDateTime: (value: string) => value,
  toast: { success: (...args: unknown[]) => mockToast.success(...args), error: (...args: unknown[]) => mockToast.error(...args) },
}));

const mockApi = { businessPlanAction: jest.fn(), getBusinessPlan: jest.fn(), saveBusinessPlan: jest.fn() };
jest.mock('../crm-api', () => ({
  businessPlanAction: (...args: unknown[]) => mockApi.businessPlanAction(...args),
  getBusinessPlan: (...args: unknown[]) => mockApi.getBusinessPlan(...args),
  saveBusinessPlan: (...args: unknown[]) => mockApi.saveBusinessPlan(...args),
}));

jest.mock('../crm-context', () => ({
  ...jest.requireActual('../crm-context'),
  useCrm: () => ({
    capabilities: { ...jest.requireActual('@enterprise-platform/contracts-crm').CRM_NO_CAPABILITIES, canRead: true, canApproveQuote: true, canViewQuoteCost: true },
    people: [],
    currentUserId: 'tn',
  }),
}));

function pendingPlan(): BusinessPlanDetail {
  return {
    id: 'bp1',
    quoteId: 'q1',
    quoteVersionId: 'v1',
    quoteVersionNo: 1,
    status: 'PENDING',
    version: 4,
    note: null,
    costVisible: true,
    figures: { grossAmount: 100, revenue: 100, goodsCost: 60, discountAmount: 0, extraCostTotal: 10, totalCost: 70, profit: 30, marginPercent: 30, discountPercent: 0 },
    visibleFigures: { grossAmount: 100, revenue: 100, discountAmount: 0, discountPercent: 0 },
    lines: [],
    currentRoundNo: 1,
    submittedAt: '2026-11-09T01:00:00.000Z',
    submittedBy: 'nv1',
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    rounds: [],
    editable: false,
    deviation: null,
    createdAt: '2026-11-09T01:00:00.000Z',
    updatedAt: '2026-11-09T01:00:00.000Z',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.location.hash = '#quotes/q1';
});

describe('PAKD trình riêng qua Quy trình (P3C7-06, D3-30)', () => {
  it('chờ người xem duyệt trên Quy trình: nút Duyệt trên Quy trình thay cho Duyệt, Từ chối trực tiếp', () => {
    const detail = fixtureDetail(fixtureVersion(), {
      businessPlan: pendingPlan(),
      awaitingMyApproval: { subject: 'BUSINESS_PLAN', mode: 'PROCEDURE', procedureInstanceId: 'inst-9', procedureInstanceCode: 'HS-0009' },
    });
    render(<BusinessPlanPanel detail={detail} />);
    const link = screen.getByRole('link', { name: 'Duyệt trên Quy trình' });
    expect(link.getAttribute('href')).toBe(`/modules/procedure?returnTo=${encodeURIComponent('/modules/crm#quotes/q1')}#workspace/inst-9`);
    expect(screen.getByText('Hồ sơ HS-0009')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Duyệt phương án' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Từ chối phương án' })).toBeNull();
  });

  it('duyệt trực tiếp: vẫn có Duyệt, Từ chối; đích là báo giá thì không đổi gì ở khối PAKD', () => {
    const detail = fixtureDetail(fixtureVersion(), {
      businessPlan: pendingPlan(),
      awaitingMyApproval: { subject: 'QUOTE', mode: 'PROCEDURE', procedureInstanceId: 'inst-1', procedureInstanceCode: null },
    });
    render(<BusinessPlanPanel detail={detail} />);
    expect(screen.getByRole('button', { name: 'Duyệt phương án' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Duyệt trên Quy trình' })).toBeNull();
  });

  it('server trả 409 PLAN_IN_PROCEDURE khi Duyệt phương án: báo câu của server, tải lại báo giá', async () => {
    const message = 'Phương án đang được duyệt qua Quy trình; vui lòng thao tác trên hồ sơ Quy trình.';
    mockApi.businessPlanAction.mockRejectedValue({ statusCode: 409, code: 'PLAN_IN_PROCEDURE', message });
    const changed = jest.fn();
    render(<BusinessPlanPanel detail={fixtureDetail(fixtureVersion(), { businessPlan: pendingPlan() })} onChanged={changed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt phương án' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(mockToast.error).toHaveBeenCalledWith(message);
    await waitFor(() => expect(changed).toHaveBeenCalled());
    // Không phải xung đột phiên bản: không tải lại PAKD theo kiểu "người khác vừa sửa".
    expect(mockApi.getBusinessPlan).not.toHaveBeenCalled();
  });
});

describe('planConflictMessage với PLAN_IN_PROCEDURE', () => {
  it('phân biệt đang duyệt qua Quy trình với xung đột phiên bản', () => {
    expect(isPlanInProcedure({ statusCode: 409, code: 'PLAN_IN_PROCEDURE' })).toBe(true);
    expect(isPlanConflict({ statusCode: 409, code: 'PLAN_IN_PROCEDURE' })).toBe(false);
    expect(isPlanConflict({ statusCode: 409, code: 'STALE_VERSION' })).toBe(true);
    expect(planConflictMessage({ statusCode: 409, code: 'PLAN_IN_PROCEDURE' }, 'x')).toBe(PLAN_IN_PROCEDURE_MESSAGE);
    expect(planConflictMessage({ statusCode: 409, code: 'STALE_VERSION' }, 'x')).toContain('vừa được người khác thay đổi');
  });
});
