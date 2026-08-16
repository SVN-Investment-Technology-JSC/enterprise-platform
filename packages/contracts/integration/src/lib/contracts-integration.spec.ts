import { createIntegrationEvent } from './contracts-integration.js';

describe('createIntegrationEvent', () => {
  it('defaults the contract version', () => {
    expect(createIntegrationEvent({ id: '1', type: 'test', tenantId: 'tenant', source: 'test', correlationId: '1', payload: {} }).version).toBe(1);
  });
});
