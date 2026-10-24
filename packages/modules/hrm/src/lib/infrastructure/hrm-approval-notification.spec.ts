import {
  approvalRequestedEvent,
  HRM_APPROVAL_PERMISSIONS,
  isAwaitingApproval,
  notifyApproversOfDirectRequest,
} from './hrm-approval-notification.js';

const TENANT = '80000000-0000-4000-8000-000000000001';

describe('approvalRequestedEvent', () => {
  it('carries the approval permissions of the request kind and always includes hrm.manage', () => {
    const event = approvalRequestedEvent({
      tenantId: TENANT,
      requestId: 'request-1',
      requestKind: 'business_trip',
      employeeName: 'Nguyễn Văn A',
      actorUserId: 'user-a',
    });
    expect(event.type).toBe('hrm.approval.requested');
    expect(event.payload).toMatchObject({
      requestId: 'request-1',
      approvalPermissions: ['hrm.request.approve.all', 'hrm.manage'],
      scopePermissions: ['hrm.request.approve'],
      summary: 'Đơn công tác của Nguyễn Văn A đang chờ bạn phê duyệt.',
      actorUserId: 'user-a',
    });
  });

  it('maps every request kind to the permission its approve endpoint requires', () => {
    expect(HRM_APPROVAL_PERMISSIONS).toEqual({
      leave: 'hrm.request.approve',
      ot: 'hrm.request.approve',
      business_trip: 'hrm.request.approve',
      shift_change: 'hrm.request.approve',
      correction: 'hrm.request.approve',
      advance: 'hrm.request.approve',
      profile_correction: 'hrm.request.approve',
      custom: 'hrm.request.approve',
    });
  });
});

describe('isAwaitingApproval', () => {
  it.each([['PENDING', true], ['PEER_CONFIRMED', true], ['DRAFT', false], ['APPROVED', false], [undefined, false]])(
    '%s -> %s',
    (status, expected) => expect(isAwaitingApproval(status)).toBe(expected),
  );
});

describe('notifyApproversOfDirectRequest', () => {
  it('writes the event to the outbox in the caller transaction, using the employee name', async () => {
    const query = jest.fn(async (text: string) => ({
      rows: text.includes('core_schema.employees') ? [{ full_name: 'Trần Thị B' }] : [],
    }));

    await notifyApproversOfDirectRequest({ query }, {
      tenantId: TENANT,
      requestId: 'request-1',
      requestKind: 'leave',
      employeeId: 'employee-1',
      actorUserId: 'user-b',
    }, async () => ({ assigned: [], superiors: [] }));

    expect(query).toHaveBeenCalledTimes(2);
    const [insertSql, values] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(insertSql).toContain('INSERT INTO integration_schema.outbox_events');
    expect(values[1]).toBe('request-1');
    expect(values[2]).toBe('hrm.approval.requested');
    expect(JSON.parse(String(values[4])).payload.summary).toBe('Đơn nghỉ phép của Trần Thị B đang chờ bạn phê duyệt.');
  });

  it('still notifies when the employee row cannot be read', async () => {
    const query = jest.fn(async () => ({ rows: [] }));

    await notifyApproversOfDirectRequest({ query }, {
      tenantId: TENANT,
      requestId: 'request-2',
      requestKind: 'ot',
      employeeId: 'missing',
      actorUserId: 'user-c',
    }, async () => ({ assigned: [], superiors: [] }));

    expect(JSON.parse(String((query.mock.calls[1] as unknown as [string, unknown[]])[1][4])).payload.summary).toContain('một nhân viên');
  });

  it('sends the event straight to the assigned approvers, excluding the submitter', async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const resolve = jest.fn(async () => ({ assigned: ['manager-1', 'backup-1', 'user-d'], superiors: ['boss-1', 'user-d'] }));

    await notifyApproversOfDirectRequest({ query }, {
      tenantId: TENANT,
      requestId: 'request-3',
      requestKind: 'ot',
      employeeId: 'employee-3',
      actorUserId: 'user-d',
    }, resolve);

    expect(resolve).toHaveBeenCalledWith(expect.anything(), TENANT, 'ot', 'request-3', 'employee-3');
    const payload = JSON.parse(String((query.mock.calls[1] as unknown as [string, unknown[]])[1][4])).payload;
    expect(payload.recipientUserIds).toEqual(['manager-1', 'backup-1']);
    expect(payload.scopeUserIds).toEqual(['boss-1']);
    expect(payload.scopePermissions).toEqual(['hrm.request.approve']);
    expect(payload.approvalPermissions).toEqual(['hrm.request.approve.all', 'hrm.manage']);
  });
});
