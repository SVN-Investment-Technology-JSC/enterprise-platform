/** @jest-environment node */
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

function run(path: string, cookie?: string) {
  const request = new NextRequest(`http://localhost${path}`, cookie ? { headers: { cookie } } : undefined);
  return proxy(request);
}

describe('proxy route guard', () => {
  it.each(['/platform', '/platform/brand-studio', '/platform/plans', '/platform/tenants/abc'])(
    'chuyển %s về trang đăng nhập admin khi không có phiên',
    (path) => {
      const response = run(path);
      expect(response.headers.get('location')).toBe('http://localhost/login/admin');
    },
  );

  it.each(['/dashboard', '/roles', '/users/1'])('chuyển %s về trang đăng nhập khi không có phiên', (path) => {
    expect(run(path).headers.get('location')).toBe('http://localhost/login');
  });

  it('cho qua khi có cookie phiên', () => {
    expect(run('/platform/brand-studio', 'ep_access=token').headers.get('location')).toBeNull();
  });
});
