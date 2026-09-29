import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([
    { name: 'ep_access', value: 'admin', domain: '127.0.0.1', path: '/' },
    { name: 'ep_csrf', value: 'test-csrf', domain: '127.0.0.1', path: '/' },
  ]);
  // Next's production rewrite is built for the normal API. Isolate browser
  // requests too, so this test never contacts or mutates the developer's API.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    url.port = '44331';
    const response = await route.fetch({ url: url.toString() });
    await route.fulfill({ response });
  });
});

test('creates permission and role, assigns the role, edits, unassigns and deletes', async ({
  page,
}, info) => {
  await page.goto('/authorization');
  await expect(
    page.getByRole('heading', { name: 'Vai trò & phân quyền' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: /Permission/ }).click();
  await page
    .getByRole('button', { name: 'Tạo permission', exact: true })
    .click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tên', { exact: true }).fill('Xem người dùng demo');
  await dialog.getByLabel('Xem người dùng', { exact: false }).check();
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('tab', { name: /Vai trò/ }).click();
  await page.getByRole('button', { name: 'Tạo vai trò', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tên', { exact: true }).fill('Điều phối demo');
  await dialog.getByLabel('Xem người dùng demo').check();
  await dialog.getByLabel('Quy trình').check();
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Điều phối demo', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('roles-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Sửa', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Mô tả')
    .fill('Vai trò dành cho bản demo');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Lưu', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.goto('/users');
  await page.getByRole('button', { name: 'Vai trò', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Điều phối demo').check();
  await expect(
    page.getByRole('dialog').getByText('Xem người dùng', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('assign-role-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Lưu vai trò' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(
    page.getByRole('cell', { name: 'Điều phối demo', exact: true }),
  ).toBeVisible();
  await page.goto('/authorization');
  await page.getByRole('button', { name: /Điều phối demo/ }).click();
  await expect(
    page.getByRole('button', { name: 'Xóa', exact: true }),
  ).toBeDisabled();
  await page.goto('/users');
  await page.getByRole('button', { name: 'Vai trò', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Điều phối demo').uncheck();
  await page.getByRole('button', { name: 'Lưu vai trò' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.goto('/authorization');
  await page.getByRole('button', { name: /Điều phối demo/ }).click();
  await page.getByRole('button', { name: 'Xóa', exact: true }).click();
  await page.getByRole('button', { name: 'Xóa', exact: true }).last().click();
  await expect(
    page.getByRole('heading', { name: 'Điều phối demo', exact: true }),
  ).toBeHidden();
  await page.getByRole('tab', { name: /Permission/ }).click();
  await page.getByRole('button', { name: 'Xóa', exact: true }).click();
  await page.getByRole('button', { name: 'Xóa', exact: true }).last().click();
  await expect(page.getByText('Chưa có dữ liệu phù hợp.')).toBeVisible();
});

test('read-only user cannot see management controls or access authorization page', async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: 'ep_access', value: 'viewer', domain: '127.0.0.1', path: '/' },
  ]);
  await page.goto('/users');
  await expect(
    page.getByRole('heading', { name: 'Người dùng', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Thêm người dùng' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Vai trò', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Sửa', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Vai trò & phân quyền' }),
  ).toHaveCount(0);
  await page.goto('/authorization');
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Bạn không có quyền quản trị phân quyền.' }),
  ).toBeVisible();
});

test('mobile layout has no horizontal page overflow', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/authorization');
  await expect(
    page.getByRole('heading', { name: 'Vai trò & phân quyền' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('roles-mobile.png'),
    fullPage: true,
  });
});
