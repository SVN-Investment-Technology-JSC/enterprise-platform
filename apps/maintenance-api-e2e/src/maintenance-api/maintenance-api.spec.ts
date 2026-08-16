import axios from 'axios';

describe('Maintenance API health', () => {
  it('exposes independent liveness and readiness endpoints', async () => {
    const [live, ready] = await Promise.all([
      axios.get('/api/maintenance/health/live'),
      axios.get('/api/maintenance/health/ready'),
    ]);

    expect(live.status).toBe(200);
    expect(live.data).toEqual({ status: 'live', service: 'maintenance-api' });
    expect(ready.status).toBe(200);
    expect(ready.data).toEqual({ status: 'ready', service: 'maintenance-api' });
  });
});
