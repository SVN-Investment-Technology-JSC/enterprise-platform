import axios from 'axios';

describe('Procedure API health', () => {
  it('exposes independent liveness and readiness endpoints', async () => {
    const [live, ready] = await Promise.all([
      axios.get('/api/procedure/health/live'),
      axios.get('/api/procedure/health/ready'),
    ]);

    expect(live.status).toBe(200);
    expect(live.data).toEqual({ status: 'ok', service: 'procedure-api' });
    expect(ready.status).toBe(200);
    expect(ready.data).toEqual({ status: 'ready', service: 'procedure-api' });
  });
});
