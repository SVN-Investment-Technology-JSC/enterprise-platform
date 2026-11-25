import {
  changeProcedureBlockedMessage,
  manualProgressBlockedMessage,
  startProcedureBlockedMessage,
} from './procedure-link.rules.js';

describe('procedure-link.rules', () => {
  it('chỉ chặn nhập tay khi đặt block và việc chạy theo quy trình', () => {
    expect(manualProgressBlockedMessage({ manualProgressWhenLinked: 'allow' }, 'procedure')).toBeNull();
    expect(manualProgressBlockedMessage({ manualProgressWhenLinked: 'block' }, 'manual')).toBeNull();
    expect(manualProgressBlockedMessage({ manualProgressWhenLinked: 'block' }, 'procedure')).toContain('hồ sơ quy trình');
  });

  it('cổng open_only chặn việc đã hoàn thành hoặc huỷ, cổng any thì không', () => {
    const open = { startProcedureStatusGate: 'open_only' as const };
    expect(startProcedureBlockedMessage(open, 'done')).not.toBeNull();
    expect(startProcedureBlockedMessage(open, 'cancelled')).not.toBeNull();
    expect(startProcedureBlockedMessage(open, 'in_progress')).toBeNull();
    expect(startProcedureBlockedMessage({ startProcedureStatusGate: 'any' }, 'done')).toBeNull();
    const change = { changeProcedureStatusGate: 'open_only' as const };
    expect(changeProcedureBlockedMessage(change, 'done')).not.toBeNull();
    expect(changeProcedureBlockedMessage(change, 'review')).toBeNull();
    expect(changeProcedureBlockedMessage({ changeProcedureStatusGate: 'any' }, 'done')).toBeNull();
  });
});
