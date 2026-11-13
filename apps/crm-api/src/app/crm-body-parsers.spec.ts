import 'reflect-metadata';
import { Body, Controller, Param, Patch, Post, Put } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { configureCrmBodyParsers, isQuoteLayoutUpload, isSalesOrganizationUpload } from './crm-body-parsers';

@Controller('v1')
class EchoController {
  @Put('quote-templates/:id/layout')
  layout(@Param('id') id: string, @Body() body: { text?: string }) {
    return { id, length: body?.text?.length ?? 0 };
  }

  @Post('sales-organizations')
  createOrganization(@Body() body: { text?: string }) {
    return { length: body?.text?.length ?? 0 };
  }

  @Patch('sales-organizations/:id')
  updateOrganization(@Param('id') id: string, @Body() body: { text?: string }) {
    return { id, length: body?.text?.length ?? 0 };
  }

  @Put('sales-organizations/:id')
  putOrganization(@Param('id') id: string, @Body() body: { text?: string }) {
    return { id, length: body?.text?.length ?? 0 };
  }

  @Post('quotes')
  other(@Body() body: { text?: string }) {
    return { length: body?.text?.length ?? 0 };
  }
}

describe('configureCrmBodyParsers', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [EchoController] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureCrmBodyParsers(app);
    app.setGlobalPrefix('api/crm');
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}/api/crm/v1`;
  });

  afterAll(async () => {
    await app?.close();
  });

  const send = (method: string, path: string, size: number) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text: 'x'.repeat(size) }),
    });

  it('route lưu bố cục nhận thân ~1,5 MB', async () => {
    const response = await send('PUT', '/quote-templates/abc/layout', 1_500_000);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'abc', length: 1_500_000 });
  });

  it('route lưu bố cục: thân trên 2 MB trả 413 với câu tiếng Việt', async () => {
    const response = await send('PUT', '/quote-templates/abc/layout', 3_000_000);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      statusCode: 413,
      code: 'LAYOUT_TOO_LARGE',
      message: 'Bố cục quá lớn (tối đa 2 MB). Hãy giảm kích thước ảnh hoặc bớt khối rồi lưu lại.',
    });
  });

  it('route khác giữ giới hạn 100 KB như trước', async () => {
    expect((await send('POST', '/quotes', 90_000)).status).toBe(201);
    expect((await send('POST', '/quotes', 150_000)).status).toBe(413);
    // Cùng đường dẫn bố cục nhưng không phải PUT: không được nới.
    expect((await send('POST', '/quote-templates/abc/layout', 150_000)).status).toBe(413);
  });

  it('TC-ORG-04: tạo, sửa tổ chức báo giá nhận thân ~1,5 MB (logo); vượt 2 MB trả 413 tiếng Việt', async () => {
    const created = await send('POST', '/sales-organizations', 1_500_000);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ length: 1_500_000 });
    const updated = await send('PATCH', '/sales-organizations/abc', 1_500_000);
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ id: 'abc', length: 1_500_000 });
    const tooLarge = await send('PATCH', '/sales-organizations/abc', 3_000_000);
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({
      statusCode: 413,
      code: 'SALES_ORGANIZATION_INVALID',
      message: 'Dữ liệu tổ chức quá lớn (tối đa 2 MB). Hãy dùng logo nhỏ hơn 300 KB rồi lưu lại.',
    });
    // Phương thức khác trên cùng đường dẫn giữ 100 KB.
    expect((await send('PUT', '/sales-organizations/abc', 150_000)).status).toBe(413);
  });

  it('nhận diện đúng route tạo, sửa tổ chức báo giá', () => {
    const request = (method: string, url: string) => ({ method, url }) as never;
    expect(isSalesOrganizationUpload(request('POST', '/api/crm/v1/sales-organizations'))).toBe(true);
    expect(isSalesOrganizationUpload(request('POST', '/api/crm/v1/sales-organizations?x=1'))).toBe(true);
    expect(isSalesOrganizationUpload(request('PATCH', '/api/crm/v1/sales-organizations/abc'))).toBe(true);
    expect(isSalesOrganizationUpload(request('POST', '/api/crm/v1/sales-organizations/abc'))).toBe(false);
    expect(isSalesOrganizationUpload(request('PATCH', '/api/crm/v1/sales-organizations'))).toBe(false);
    expect(isSalesOrganizationUpload(request('DELETE', '/api/crm/v1/sales-organizations/abc'))).toBe(false);
    expect(isSalesOrganizationUpload(request('PATCH', '/api/crm/v1/sales-organizations/a/b'))).toBe(false);
  });

  it('nhận diện đúng route lưu bố cục', () => {
    const request = (method: string, url: string) => ({ method, url }) as never;
    expect(isQuoteLayoutUpload(request('PUT', '/api/crm/v1/quote-templates/abc/layout'))).toBe(true);
    expect(isQuoteLayoutUpload(request('PUT', '/api/crm/v1/quote-templates/abc/layout?x=1'))).toBe(true);
    expect(isQuoteLayoutUpload(request('GET', '/api/crm/v1/quote-templates/abc/layout'))).toBe(false);
    expect(isQuoteLayoutUpload(request('PUT', '/api/crm/v1/quote-templates/abc'))).toBe(false);
    expect(isQuoteLayoutUpload(request('PUT', '/api/crm/v1/quote-templates/a/b/layout'))).toBe(false);
  });
});
