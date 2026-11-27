import React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import Page from '../src/app/page';

/**
 * "Hồ sơ xử lý" là màn làm việc duy nhất của Quy trình: không còn mục "Tổng quan", mở module là vào Hồ sơ xử lý / tab
 * "Đang xử lý", hash cũ của Tổng quan chuyển về Hồ sơ xử lý, `#workspace/<id>` vẫn mở cửa sổ hồ sơ.
 */
describe('Procedure navigation without the overview page', () => {
  const originalFetch = global.fetch;
  const originalObserver = global.ResizeObserver;
  beforeAll(() => {
    global.ResizeObserver = class { observe() { /* jsdom */ } unobserve() { /* jsdom */ } disconnect() { /* jsdom */ } };
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });
  afterAll(() => { global.ResizeObserver = originalObserver; });

  const now = '2026-11-20T08:00:00.000Z';
  const instance = {
    id: 'inst-1', code: 'QT-1', title: 'Mua vật tư tháng 11', definitionId: 'def-1', definitionCode: 'MUA', definitionName: 'Mua sắm',
    definitionVersion: 1, status: 'running', currentStepId: 's1', initiatedBy: 'u-other', startedAt: now,
    steps: [{ id: 's1', definitionStepId: 'd-s1', key: 'B1', order: 1, name: 'Duyệt đề nghị', status: 'active', currentRoleStage: 'A', assignments: [], startedAt: now }],
    activity: [{ id: 'a1', action: 'start', actorId: 'u-other', actorName: 'Nguyễn Văn A', summary: 'Mở', createdAt: now }],
    authorization: { myRoles: ['A'], currentRoleStage: 'A', availableActions: ['comment', 'approve'], canManageSubtasks: false, isOverride: false, currentStepPart: 'act' },
  };

  function setup(hash: string) {
    window.history.replaceState(null, '', hash ? `/${hash}` : '/');
    const workspace = {
      tenantId: 'tenant', actor: { id: 'user', name: 'Employee' },
      permissions: { canManageDefinitions: false, canPublishDefinitions: false, canCreateInstances: false, canOverrideActions: false },
      definitions: [], instances: [instance],
    };
    global.fetch = jest.fn(async (url) => {
      const path = String(url);
      const body = path.endsWith('/workspace') ? workspace
        : path.endsWith('/organization-context') ? { units: [], members: [], trees: [], unitTypes: [], positions: [], assignments: [], membershipSubjects: {} }
        : path.endsWith('/settings') ? {
          'dashboard.cards': { value: { cardIds: [] }, version: 0 },
          'catalog.group': { value: { options: [] }, version: 0 },
        }
        : [];
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    render(<Page />);
  }

  const statusTabs = () => screen.findByRole('tablist', { name: 'Lọc theo trạng thái' });

  it('sidebar has no "Tổng quan"; "Hồ sơ xử lý" is the first entry', async () => {
    setup('');
    await statusTabs();
    const nav = screen.getByRole('navigation', { name: 'Điều hướng Quy trình' });
    const labels = within(nav).getAllByRole('button').map((button) => button.textContent ?? '');
    expect(labels.some((label) => label.includes('Tổng quan'))).toBe(false);
    expect(labels.find((label) => /Hồ sơ xử lý|Ma trận RCSI|Cài đặt/.test(label))).toContain('Hồ sơ xử lý');
  });

  it('default landing is Hồ sơ xử lý with the "Đang xử lý" tab', async () => {
    setup('');
    const tabs = await statusTabs();
    expect(within(tabs).getByRole('tab', { selected: true }).textContent).toBe('Đang xử lý1');
    expect(await screen.findByRole('link', { name: 'Quy trình: Mua vật tư tháng 11' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Điều hướng Quy trình' });
    expect(within(nav).getByRole('button', { current: 'page' }).textContent).toContain('Hồ sơ xử lý');
  });

  it.each(['#dashboard', '#overview'])('old overview hash %s redirects to Hồ sơ xử lý (#workspace)', async (hash) => {
    setup(hash);
    const tabs = await statusTabs();
    expect(within(tabs).getByRole('tab', { selected: true }).textContent).toMatch(/^Đang xử lý/);
    expect(window.location.hash).toBe('#workspace');
  });

  it('an old overview link followed after load also lands on Hồ sơ xử lý', async () => {
    setup('#raci');
    await screen.findByRole('navigation', { name: 'Điều hướng Quy trình' });
    act(() => {
      window.history.replaceState(null, '', '/#dashboard');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await statusTabs();
    await waitFor(() => expect(window.location.hash).toBe('#workspace'));
  });

  it('deep link #workspace/<id> still opens the case window', async () => {
    setup('#workspace/inst-1');
    expect(await screen.findByRole('dialog', { name: 'Mua vật tư tháng 11' })).toBeTruthy();
    expect(window.location.hash).toBe('#workspace/inst-1');
  });
});
