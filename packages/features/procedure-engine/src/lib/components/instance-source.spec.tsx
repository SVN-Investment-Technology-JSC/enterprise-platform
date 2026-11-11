/** @jest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import type { ProcedureInstance, ProcedureSourceSummary } from '@enterprise-platform/contracts-procedure-engine';
import { InstanceSourceValue, SourceSummaryCard, sourceSummaryHref } from './instance-source';
import { WorkspaceBoard } from './workspace-board';

jest.mock('@enterprise-platform/shared-ui/date-picker', () => ({ DatePickerInput: () => null }));

const SUMMARY: ProcedureSourceSummary = {
  title: 'Báo giá BG2600401 v2',
  items: [
    { label: 'Khách hàng', value: 'Công ty <b>An Phát</b>' },
    { label: 'Tổng tiền', value: '120.000.000 đ' },
  ],
  url: '/modules/crm#quotes/q-1',
  urlLabel: 'Mở báo giá trong Bán hàng',
};

const instance = (extra: Partial<ProcedureInstance> = {}) =>
  ({
    id: 'inst-1',
    code: 'PR-1',
    title: 'Duyệt báo giá BG2600401',
    definitionId: 'def',
    definitionCode: 'BG',
    definitionName: 'Duyệt báo giá',
    definitionVersion: 1,
    status: 'running',
    initiatedBy: 'u-1',
    startedAt: '2026-11-09T01:15:00.000Z',
    currentStepId: 'step-1',
    activity: [],
    authorization: {
      myRoles: ['A'],
      currentRoleStage: 'A',
      availableActions: ['comment', 'approve', 'reject'],
      isOverride: false,
      editableAttributeKeys: [],
    },
    steps: [
      {
        id: 'step-1',
        definitionStepId: 'def-1',
        key: 'approve',
        order: 1,
        name: 'Giám đốc duyệt',
        status: 'active',
        currentRoleStage: 'A',
        assignments: [],
      },
    ],
    ...extra,
  }) as unknown as ProcedureInstance;

describe('Khối Thông tin cần duyệt', () => {
  it('TC-TSK-04: hiện tiêu đề, các dòng nhãn - giá trị và nút mở chứng từ cùng tab; chữ <b> hiện nguyên văn', () => {
    const { container } = render(<SourceSummaryCard summary={SUMMARY} />);
    const card = screen.getByRole('region', { name: 'Thông tin cần duyệt' });
    expect(within(card).getByRole('heading', { name: 'Báo giá BG2600401 v2' })).toBeTruthy();
    expect(within(card).getByText('Khách hàng')).toBeTruthy();
    expect(within(card).getByText('Công ty <b>An Phát</b>')).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
    expect(within(card).getByText('120.000.000 đ')).toBeTruthy();
    const open = within(card).getByRole('link', { name: 'Mở báo giá trong Bán hàng' });
    expect(open.getAttribute('href')).toBe('/modules/crm#quotes/q-1');
    expect(open.getAttribute('target')).toBeNull();
  });

  it('TC-TSK-04: nhãn nút mặc định "Mở chứng từ gốc"; link không phải đường dẫn nội bộ thì không có nút', () => {
    const { rerender } = render(<SourceSummaryCard summary={{ items: SUMMARY.items, url: '/modules/crm#quotes/q-2' }} />);
    expect(screen.getByRole('link', { name: 'Mở chứng từ gốc' }).getAttribute('href')).toBe('/modules/crm#quotes/q-2');
    // Scheme ghép từ hai phần để không bị coi là script URL trong code test.
    for (const url of [['javascript', 'alert(1)'].join(':'), '//evil.example', 'https://evil.example']) {
      rerender(<SourceSummaryCard summary={{ items: SUMMARY.items, url }} />);
      expect(screen.queryByRole('link')).toBeNull();
      expect(sourceSummaryHref({ items: [], url })).toBeUndefined();
    }
  });

  it('không có thông tin nguồn thì không hiện khối', () => {
    const { container, rerender } = render(<SourceSummaryCard summary={null} />);
    expect(container.innerHTML).toBe('');
    rerender(<SourceSummaryCard summary={{ items: [] }} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('Hàng Nguồn', () => {
  it.each([
    ['crm_quote', 'Bán hàng: Báo giá'],
    ['crm_business_plan', 'Bán hàng: Phương án kinh doanh'],
    ['crm_order_credit', 'Bán hàng: Đơn bán vượt hạn mức'],
    ['crm_tender_plan', 'Bán hàng: Phương án chào thầu'],
  ] as const)('TC-TSK-04: %s hiện "%s", có link về chứng từ khi có url', (sourceType, label) => {
    const { rerender } = render(<InstanceSourceValue instance={instance({ sourceType, sourceSummary: SUMMARY })} />);
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe('/modules/crm#quotes/q-1');
    rerender(<InstanceSourceValue instance={instance({ sourceType, sourceSummary: null })} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('giữ nguyên các nguồn cũ', () => {
    const { rerender } = render(<InstanceSourceValue instance={instance({ sourceType: 'hrm_request', sourceId: 'w 1' })} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/modules/hrm/approvals?workflow=w%201');
    rerender(<InstanceSourceValue instance={instance({ sourceType: 'maintenance_occurrence' })} />);
    expect(screen.getByText('Lịch bảo trì')).toBeTruthy();
    rerender(<InstanceSourceValue instance={instance({ sourceType: 'manual' })} />);
    expect(screen.getByText('Tạo thủ công')).toBeTruthy();
  });
});

describe('Màn hồ sơ', () => {
  const props = {
    definitions: [],
    initialInstanceId: 'inst-1',
    canCreateInstances: true,
    onAction: jest.fn(async () => undefined),
    onOpenDefinitions: jest.fn(),
    onStart: jest.fn(async () => undefined),
    embedded: true,
  };

  it('TC-TSK-04: hồ sơ báo giá có thông tin nguồn hiện khối Thông tin cần duyệt và hàng Nguồn "Bán hàng: Báo giá"', () => {
    render(<WorkspaceBoard {...props} instances={[instance({ sourceType: 'crm_quote', sourceSummary: SUMMARY })]} />);
    const detail = screen.getByLabelText('Chi tiết hồ sơ PR-1');
    const card = within(detail).getByRole('region', { name: 'Thông tin cần duyệt' });
    expect(within(card).getByText('Công ty <b>An Phát</b>')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Mở báo giá trong Bán hàng' })).toBeTruthy();
    expect(within(detail).getByRole('link', { name: 'Bán hàng: Báo giá' })).toBeTruthy();
  });

  it('hồ sơ không có thông tin nguồn không có khối', () => {
    render(<WorkspaceBoard {...props} instances={[instance({ sourceType: 'manual', sourceSummary: null })]} />);
    expect(screen.queryByRole('region', { name: 'Thông tin cần duyệt' })).toBeNull();
    expect(screen.getByText('Tạo thủ công')).toBeTruthy();
  });
});
