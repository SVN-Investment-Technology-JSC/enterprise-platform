/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from '../route.js';
import { POST } from './route.js';

describe('BFF Tasks Route Handlers', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('GET /api/tasks/[taskId]', () => {
    it('chuyển tiếp request GET đến đúng phân hệ HRM', async () => {
      const mockFetch = jest.fn(async (url: any) => ({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ data: { taskId: 'hrm:leave:123' } }),
      }));
      global.fetch = mockFetch as any;

      const req = new NextRequest('http://localhost:3000/api/tasks/hrm%3Aleave%3A123', {
        headers: { cookie: 'ep_session=abc' },
      });

      const res = await GET(req, {
        params: Promise.resolve({ taskId: 'hrm:leave:123' }),
      });

      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/hrm/v1/tasks/leave/123'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ cookie: 'ep_session=abc' }),
        }),
      );
    });
  });

  describe('POST /api/tasks/[taskId]/actions', () => {
    it('chuyển tiếp request POST action đến đúng phân hệ HRM với body và headers', async () => {
      const mockFetch = jest.fn(async (url: any) => ({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            data: { success: true, taskId: 'hrm:correction:50458af3-5149-42f0-ab6f-6bd263dbd939' },
          }),
      }));
      global.fetch = mockFetch as any;

      const payload = { action: 'APPROVE', reason: 'Hợp lệ' };
      const req = new NextRequest(
        'http://localhost:3000/api/tasks/hrm%3Acorrection%3A50458af3-5149-42f0-ab6f-6bd263dbd939/actions',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: 'ep_session=session_token',
          },
          body: JSON.stringify(payload),
        },
      );

      const res = await POST(req, {
        params: Promise.resolve({
          taskId: 'hrm:correction:50458af3-5149-42f0-ab6f-6bd263dbd939',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/hrm/v1/tasks/correction/50458af3-5149-42f0-ab6f-6bd263dbd939/actions'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            cookie: 'ep_session=session_token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify(payload),
        }),
      );
    });
  });
});
