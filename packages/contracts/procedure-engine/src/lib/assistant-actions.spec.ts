import { assistantActionProblems } from '@enterprise-platform/contracts-assistant';
import { PROCEDURE_ASSISTANT_ACTIONS } from './assistant-actions.js';

describe('PROCEDURE_ASSISTANT_ACTIONS', () => {
  it('passes the shared catalog checks', () => {
    expect(assistantActionProblems(PROCEDURE_ASSISTANT_ACTIONS)).toEqual([]);
  });

  it('opens the start form for people who can create instances, one variant per procedure they can start', () => {
    expect(PROCEDURE_ASSISTANT_ACTIONS.startInstance).toMatchObject({
      module: 'procedure-engine',
      key: 'procedure.instance.create',
      permission: 'procedure.instance.create',
      page: '/modules/procedure#workspace',
      variants: { lookup: '/api/procedure/v1/definitions/startable' },
    });
  });
});
