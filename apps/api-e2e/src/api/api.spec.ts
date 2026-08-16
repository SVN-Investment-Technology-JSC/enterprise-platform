import axios from 'axios';

describe('GET /api', () => {
  it('reports that the Platform API is ready', async () => {
    const res = await axios.get(`/api`);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ message: 'Platform API is ready' });
  });
});
