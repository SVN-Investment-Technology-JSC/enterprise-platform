import 'reflect-metadata';
import { Body, Controller, Param, Post, Put } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { configureCrmBodyParsers, isQuoteLayoutUpload } from './crm-body-parsers';

@Controller('v1')
class EchoController {
  @Put('quote-templates/:id/layout')
  layout(@Param('id') id: string, @Body() body: { text?: string }) {
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

  it('nhận diện đúng route lưu bố cục', () => {
    const request = (method: string, url: string) => ({ method, url }) as never;
    expect(isQuoteLayoutUpload(request('PUT', '/api/crm/v1/quote-templates/abc/layout'))).toBe(true);
    expect(isQuoteLayoutUpload(request('PUT', '/api/crm/v1/quote-templates/abc/layout?x=1'))).toBe(true);
    expect(isQuoteLayoutUpload(request('GET', '/api/crm/v1/quote-templates/abc/layout'))).toBe(false);
    expect(isQuoteLayoutUpload(request('PUT', '/api/crm/v1/quote-templates/abc'))).toBe(false);
    expect(isQuoteLayoutUpload(request('PUT', '/api/crm/v1/quote-templates/a/b/layout'))).toBe(false);
  });
});
