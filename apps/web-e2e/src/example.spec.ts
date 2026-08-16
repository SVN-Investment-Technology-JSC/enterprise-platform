import { test, expect } from '@playwright/test';

test('renders separate entry points for Platform and Tenant', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Chọn đúng cổng',
  );
  await expect(page.getByRole('link', { name: /Superadmin/ })).toHaveAttribute('href', '/platform/login');
  await expect(page.getByRole('link', { name: /Người dùng tenant/ })).toHaveAttribute('href', '/tenant/login');
});

test('renders the superadmin-only login', async ({ page }) => {
  await page.goto('/platform/login');

  await expect(page.getByRole('heading', { name: 'Platform Superadmin' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đăng nhập Platform Core' })).toBeVisible();
  await expect(page.getByText('Chỉ tài khoản platform-admin được chấp nhận.')).toBeVisible();
});

test('renders the tenant-only login', async ({ page }) => {
  await page.goto('/tenant/login');

  await expect(page.getByRole('heading', { name: 'Tenant Portal' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đăng nhập Tenant Portal' })).toBeVisible();
  await expect(page.getByText('Chỉ tài khoản thuộc tenant đang hoạt động được chấp nhận.')).toBeVisible();
});
