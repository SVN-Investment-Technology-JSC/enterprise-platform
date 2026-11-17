import {
  CRM_TASKS_PATH,
  approvalModeText,
  awaitingNoticeText,
  crmReturnPath,
  hasMargin,
  parseQuoteSub,
  procedureHrefOf,
  quoteSub,
  taskActionLabel,
  taskQuoteLabel,
  taskTarget,
} from './tasks.model';
import { fixtureTask } from './tasks.fixtures';

const DIRECT = { subject: 'QUOTE', mode: 'DIRECT', procedureInstanceId: null, procedureInstanceCode: null } as const;

describe('đường dẫn báo giá trong hash (P3C7-06)', () => {
  it('quoteSub và parseQuoteSub đi một vòng; id trần vẫn đọc như trước', () => {
    expect(quoteSub('q1')).toBe('q1');
    expect(quoteSub('q1', { panel: 'business-plan', fromTasks: true })).toBe('q1?panel=business-plan&from=tasks');
    expect(parseQuoteSub('q1')).toEqual({ quoteId: 'q1', fromTasks: false });
    expect(parseQuoteSub('q1?panel=business-plan&from=tasks')).toEqual({ quoteId: 'q1', panel: 'business-plan', fromTasks: true });
    expect(parseQuoteSub('q1?panel=khac&from=x')).toEqual({ quoteId: 'q1', panel: undefined, fromTasks: false });
  });

  it('returnTo là đường dẫn CRM hiện tại kèm hash; hash rỗng thì dùng mặc định', () => {
    expect(crmReturnPath('#quotes/q1?from=tasks', '#quotes/q1')).toBe('/modules/crm#quotes/q1?from=tasks');
    expect(crmReturnPath('', '#quotes/q1')).toBe('/modules/crm#quotes/q1');
    expect(crmReturnPath('#', 'tasks')).toBe('/modules/crm#tasks');
  });
});

describe('mở việc (TC-TSK-14, TC-TSK-15)', () => {
  it('qua Quy trình có hồ sơ: sang Quy trình kèm returnTo mã hoá về trang Việc cần xử lý', () => {
    const target = taskTarget(fixtureTask());
    expect(target).toEqual({
      kind: 'procedure',
      href: `/modules/procedure?returnTo=${encodeURIComponent(CRM_TASKS_PATH)}#workspace/inst-1`,
    });
    expect(taskActionLabel(fixtureTask())).toBe('Duyệt trên Quy trình');
  });

  it('trực tiếp: mở báo giá có nút quay về; PAKD thì mở sẵn khối PAKD', () => {
    expect(taskTarget(fixtureTask({ approval: DIRECT }))).toEqual({ kind: 'quote', sub: 'q1?from=tasks' });
    expect(taskTarget(fixtureTask({ kind: 'BUSINESS_PLAN_APPROVAL', approval: { ...DIRECT, subject: 'BUSINESS_PLAN' } }))).toEqual({
      kind: 'quote',
      sub: 'q1?panel=business-plan&from=tasks',
    });
    expect(taskActionLabel(fixtureTask({ approval: DIRECT }))).toBe('Mở để duyệt');
  });

  it('việc của tôi (không có đích duyệt): mở báo giá; PAKD bị từ chối mở sẵn khối PAKD', () => {
    expect(taskTarget(fixtureTask({ kind: 'QUOTE_REJECTED', approval: null }))).toEqual({ kind: 'quote', sub: 'q1?from=tasks' });
    expect(taskTarget(fixtureTask({ kind: 'BUSINESS_PLAN_REJECTED', approval: null }))).toEqual({ kind: 'quote', sub: 'q1?panel=business-plan&from=tasks' });
    expect(taskActionLabel(fixtureTask({ kind: 'QUOTE_READY_TO_SEND', approval: null }))).toBe('Mở báo giá');
    expect(taskActionLabel(fixtureTask({ kind: 'BUSINESS_PLAN_REJECTED', approval: null }))).toBe('Mở phương án');
  });

  it('qua Quy trình mà hồ sơ chưa tạo: mở báo giá trong CRM', () => {
    const pending = fixtureTask({ approval: { subject: 'QUOTE', mode: 'PROCEDURE', procedureInstanceId: null, procedureInstanceCode: null } });
    expect(taskTarget(pending)).toEqual({ kind: 'quote', sub: 'q1?from=tasks' });
    expect(procedureHrefOf(pending.approval, CRM_TASKS_PATH)).toBeUndefined();
  });

  it('khối ở danh sách báo giá: quay về danh sách, không gắn from=tasks', () => {
    expect(taskTarget(fixtureTask(), { returnTo: '/modules/crm#quotes', fromTasks: false })).toEqual({
      kind: 'procedure',
      href: `/modules/procedure?returnTo=${encodeURIComponent('/modules/crm#quotes')}#workspace/inst-1`,
    });
    expect(taskTarget(fixtureTask({ approval: DIRECT }), { fromTasks: false })).toEqual({ kind: 'quote', sub: 'q1' });
  });
});

describe('chữ hiển thị (TC-TSK-13)', () => {
  it('Cách duyệt: Qua Quy trình kèm mã hồ sơ, hoặc Trực tiếp', () => {
    expect(approvalModeText(fixtureTask().approval)).toBe('Qua Quy trình HS-0007');
    expect(approvalModeText(DIRECT)).toBe('Trực tiếp');
    expect(approvalModeText({ ...DIRECT, mode: 'PROCEDURE' })).toBe('Qua Quy trình (đang tạo hồ sơ)');
    expect(approvalModeText(null)).toBe('');
  });

  it('cột Biên ẩn khi mọi dòng không có biên', () => {
    expect(hasMargin([fixtureTask({ marginPercent: null }), fixtureTask()])).toBe(true);
    expect(hasMargin([fixtureTask({ marginPercent: null })])).toBe(false);
    expect(hasMargin([])).toBe(false);
  });

  it('nhãn báo giá và câu thông báo', () => {
    expect(taskQuoteLabel(fixtureTask())).toBe('BG2600001 - Báo giá bơm (v2)');
    expect(taskQuoteLabel(fixtureTask({ quoteName: null }))).toBe('BG2600001 (v2)');
    expect(awaitingNoticeText(DIRECT)).toBe('Báo giá này đang chờ bạn duyệt.');
    expect(awaitingNoticeText({ ...DIRECT, subject: 'BUSINESS_PLAN' })).toBe('Phương án kinh doanh của báo giá này đang chờ bạn duyệt.');
  });
});
