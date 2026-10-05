import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import Page from '../src/app/page';

describe('Procedure permission-driven UI', () => {
  const originalFetch = global.fetch;
  const originalObserver = global.ResizeObserver;
  beforeAll(() => {
    global.ResizeObserver = class { observe() { /* jsdom */ } unobserve() { /* jsdom */ } disconnect() { /* jsdom */ } };
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    window.history.replaceState(null, '', '/');
  });
  afterAll(() => { global.ResizeObserver = originalObserver; });

  function setup(view: string, permissions: typeof noRights, published = false) {
    window.history.replaceState(null, '', '/#' + view);
    const workspace = {
      tenantId: 'tenant', actor: { id: 'user', name: 'Employee' }, permissions, instances: [],
      definitions: [{ id: 'draft', code: 'TEST', name: 'Quy trình kiểm tra quyền', kind: 'process', status: published ? 'published' : 'draft', versionNumber: 1, steps: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    };
    global.fetch = jest.fn(async (url) => {
      const path = String(url);
      const body = path.endsWith('/workspace') ? workspace
        : path.endsWith('/organization-context') ? { units: [], members: [], trees: [], unitTypes: [], positions: [], assignments: [], membershipSubjects: {} }
        : path.endsWith('/settings') ? {
          'dashboard.cards': { value: { cardIds: [] }, version: 0 },
          'catalog.group': { value: { groups: [] }, version: 0 },
        }
        : [];
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    render(<Page />);
  }

  const noRights = { canManageDefinitions: false, canPublishDefinitions: false, canCreateInstances: false, canOverrideActions: false };

  it('shows the matrix without design or publication controls for employees', async () => {
    setup('raci', noRights);
    await screen.findByText('Quy trình kiểm tra quyền');
    expect(screen.queryByRole('button', { name: /Thêm mới/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Công bố' })).toBeNull();
    expect(screen.queryByLabelText(/Lưu trữ bản nháp/)).toBeNull();
  });

  it('allows publication without granting design controls', async () => {
    setup('raci', { ...noRights, canPublishDefinitions: true });
    expect(await screen.findByRole('button', { name: 'Công bố' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Thêm mới/ })).toBeNull();
  });

  it.each([false, true])('shows instance creation only with the capability: %s', async (canCreateInstances) => {
    setup('workspace', { ...noRights, canCreateInstances }, true);
    await screen.findByRole('heading', { name: 'Workspace xử lý' });
    if (canCreateInstances) expect(await screen.findByRole('button', { name: /Tạo Đơn/ })).toBeTruthy();
    else expect(screen.queryByRole('button', { name: /Tạo Đơn/ })).toBeNull();
  });
});
