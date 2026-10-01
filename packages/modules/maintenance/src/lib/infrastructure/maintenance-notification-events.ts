export type MaintenanceNotificationKind =
  | 'assigned'
  | 'completed'
  | 'dispatch-failed';

export interface MaintenanceOccurrenceNotificationInput {
  readonly occurrenceId: string;
  readonly code?: string;
  readonly title: string;
  readonly assigneeUserId?: string;
  readonly actorUserId?: string;
  readonly recipientUserIds?: readonly string[];
  readonly summary?: string;
}

export interface MaintenanceNotificationEvent {
  readonly type: string;
  readonly aggregateType: 'maintenance-occurrence';
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export function maintenanceOccurrenceEvent(
  kind: MaintenanceNotificationKind,
  input: MaintenanceOccurrenceNotificationInput,
): MaintenanceNotificationEvent {
  const eventType = {
    assigned: 'maintenance.occurrence.assigned',
    completed: 'maintenance.occurrence.completed',
    'dispatch-failed': 'maintenance.dispatch.failed',
  }[kind];
  return {
    type: eventType,
    aggregateType: 'maintenance-occurrence',
    aggregateId: input.occurrenceId,
    payload: {
      occurrenceId: input.occurrenceId,
      code: input.code,
      title: input.title,
      assigneeUserId: input.assigneeUserId,
      actorUserId: input.actorUserId,
      recipientUserIds: input.recipientUserIds ?? [],
      summary: input.summary,
    },
  };
}
