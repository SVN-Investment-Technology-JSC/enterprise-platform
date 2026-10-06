import { maintenanceOccurrenceEvent } from './maintenance-notification-events.js';

const occurrence = {
  occurrenceId: '70000000-0000-4000-8000-000000000001',
  code: 'INC-001',
  title: 'Máy bơm rung bất thường',
  assigneeUserId: '70000000-0000-4000-8000-000000000002',
  actorUserId: '70000000-0000-4000-8000-000000000003',
};

describe('maintenanceOccurrenceEvent', () => {
  it.each([
    ['assigned', 'maintenance.occurrence.assigned'],
    ['completed', 'maintenance.occurrence.completed'],
    ['dispatch-failed', 'maintenance.dispatch.failed'],
  ] as const)('maps %s to %s', (kind, eventType) => {
    expect(maintenanceOccurrenceEvent(kind, occurrence)).toEqual({
      type: eventType,
      aggregateType: 'maintenance-occurrence',
      aggregateId: occurrence.occurrenceId,
      payload: expect.objectContaining({
        occurrenceId: occurrence.occurrenceId,
        assigneeUserId: occurrence.assigneeUserId,
        actorUserId: occurrence.actorUserId,
      }),
    });
  });
});
