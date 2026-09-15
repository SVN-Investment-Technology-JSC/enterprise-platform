import { expect, test } from '@playwright/test';

test('shows tenant login directly at the site root', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Không gian làm việc', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Mật khẩu')).toBeVisible();
  await expect(page.getByRole('link', { name: /quản trị hệ thống/i })).toHaveAttribute('href', '/admin');
});

test('shows the superadmin login at /admin', async ({ page }) => {
  await page.goto('/admin');

  await expect(page.getByRole('heading', { name: 'Cổng quản trị hệ thống' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
  await expect(page.getByRole('link', { name: /đăng nhập doanh nghiệp/i })).toHaveAttribute('href', '/');
});

test('redirects an anonymous tenant request to the root login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Không gian làm việc', exact: true })).toBeVisible();
});

test('does not expose legacy login URLs', async ({ page }) => {
  const tenantResponse = await page.goto('/t/example-tenant/login');
  expect(tenantResponse?.status()).toBe(404);

  const platformResponse = await page.goto('/platform/login');
  expect(platformResponse?.status()).toBe(404);
});
