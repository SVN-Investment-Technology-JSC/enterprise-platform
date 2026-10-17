import { assistantActionProblems } from '@enterprise-platform/contracts-assistant';
import { MAINTENANCE_ASSISTANT_ACTIONS } from './assistant-actions.js';

describe('MAINTENANCE_ASSISTANT_ACTIONS', () => {
  it('passes the shared catalog checks', () => {
    expect(assistantActionProblems(MAINTENANCE_ASSISTANT_ACTIONS)).toEqual([]);
  });

  it('opens the incident form for people who can handle occurrences', () => {
    expect(MAINTENANCE_ASSISTANT_ACTIONS.createIncident).toMatchObject({
      module: 'maintenance',
      key: 'maintenance.incident.create',
      permission: 'maintenance.occurrence.manage',
      page: '/modules/maintenance#occurrences',
    });
  });
});
