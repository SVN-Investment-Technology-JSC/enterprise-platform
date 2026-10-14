import { expect, test } from '@playwright/test';

test('redirects the site root to the tenant login', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Không gian làm việc', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Mật khẩu')).toBeVisible();
  await expect(page.getByText('Quên mật khẩu')).toHaveCount(0);
});

test('shows the superadmin login at /login/admin', async ({ page }) => {
  await page.goto('/login/admin');

  await expect(page.getByRole('heading', { name: 'Cổng quản trị hệ thống' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
});

test('redirects an anonymous tenant request to the tenant login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Không gian làm việc', exact: true })).toBeVisible();
});

test('does not expose legacy login URLs', async ({ page }) => {
  for (const path of ['/t/example-tenant/login', '/platform/login', '/admin', '/tenant/login', '/reset-password']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});
