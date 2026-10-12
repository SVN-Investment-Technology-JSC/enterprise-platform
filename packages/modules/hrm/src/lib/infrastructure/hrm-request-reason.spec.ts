import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_REQUEST_REASONS,
  REQUEST_REASON_CODE_PATTERN,
  REQUEST_REASON_KINDS,
  isRequestReasonKind,
  reasonCodeFromName,
  resolveRequestReason,
  uniqueReasonCode,
} from './hrm-request-reason';

describe('mã lý do tự sinh từ tên', () => {
  it.each([
    ['Lỗi thiết bị hoặc mạng', 'LOI_THIET_BI_HOAC_MANG'],
    ['Đổi ca vì việc cá nhân', 'DOI_CA_VI_VIEC_CA_NHAN'],
    ['  Theo yêu cầu / Ban Giám Đốc  ', 'THEO_YEU_CAU_BAN_GIAM_DOC'],
    ['Khác', 'KHAC'],
  ])('%s thành %s', (name, code) => {
    expect(reasonCodeFromName(name)).toBe(code);
    expect(REQUEST_REASON_CODE_PATTERN.test(code)).toBe(true);
  });
  it('bắt đầu bằng số thì thêm tiền tố để mã vẫn bắt đầu bằng chữ cái', () => {
    const code = reasonCodeFromName('24h liên tục');
    expect(code).toBe('R_24H_LIEN_TUC');
    expect(REQUEST_REASON_CODE_PATTERN.test(code)).toBe(true);
  });
  it('tên không có chữ hoặc số hợp lệ dùng mã REASON; tên dài bị cắt để còn chỗ cho hậu tố', () => {
    expect(reasonCodeFromName('!!! ???')).toBe('REASON');
    const long = reasonCodeFromName('Lý do rất dài '.repeat(10));
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('_')).toBe(false);
    expect(REQUEST_REASON_CODE_PATTERN.test(uniqueReasonCode(long, [long, `${long}_2`]))).toBe(true);
  });
  it('trùng mã thì thêm hậu tố _2, _3 (không phân biệt hoa thường)', () => {
    expect(uniqueReasonCode('KHAC', [])).toBe('KHAC');
    expect(uniqueReasonCode('KHAC', ['khac'])).toBe('KHAC_2');
    expect(uniqueReasonCode('KHAC', ['KHAC', 'KHAC_2'])).toBe('KHAC_3');
  });
});

describe('lý do mặc định', () => {
  it('đủ 4 loại đơn, mã hợp lệ và duy nhất trong từng loại', () => {
    for (const kind of REQUEST_REASON_KINDS) {
      const items = DEFAULT_REQUEST_REASONS.filter((d) => d.kind === kind);
      expect(items.length).toBeGreaterThan(0);
      expect(new Set(items.map((d) => d.code)).size).toBe(items.length);
      expect(new Set(items.map((d) => d.name.toLowerCase())).size).toBe(items.length);
      for (const item of items) expect(REQUEST_REASON_CODE_PATTERN.test(item.code)).toBe(true);
    }
    expect(DEFAULT_REQUEST_REASONS.every((d) => isRequestReasonKind(d.kind))).toBe(true);
  });
  it('lý do "Khác" bắt buộc mô tả, các lý do còn lại thì không', () => {
    for (const item of DEFAULT_REQUEST_REASONS)
      expect(item.requiresDescription).toBe(item.name === 'Khác');
  });
  it('cùng nội dung với phần seed trong migration 0045', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../../../../migrations/tenant/hrm/0045-hrm-request-reasons.sql'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const seed = [...sql.matchAll(/\('(\w+)',\s*'(\w+)',\s*'([^']+)',\s*'([^']+)',\s*(true|false),\s*(\d+)\)/g)].map(
      (m) => ({
        kind: m[1],
        code: m[2],
        name: m[3],
        description: m[4],
        requiresDescription: m[5] === 'true',
        sortOrder: Number(m[6]),
      }),
    );
    expect(seed).toHaveLength(DEFAULT_REQUEST_REASONS.length);
    expect(DEFAULT_REQUEST_REASONS.map((d) => ({ ...d }))).toEqual(seed);
  });
});

describe('isRequestReasonKind', () => {
  it('chỉ nhận 4 loại đơn cố định, không nhận loại động cũ', () => {
    for (const kind of REQUEST_REASON_KINDS) expect(isRequestReasonKind(kind)).toBe(true);
    for (const bad of ['OT_TYPE', 'TRIP_TYPE', 'TRIP_VEHICLE', 'LEAVE', 'overtime', '', undefined, null, 1])
      expect(isRequestReasonKind(bad)).toBe(false);
  });
});

describe('resolveRequestReason', () => {
  const reasonRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    code: 'OT_WORK',
    name: 'Theo yêu cầu công việc',
    paid: true,
    requires_description: false,
    active: true,
    ...over,
  });
  const db = (row?: unknown) => ({ query: jest.fn().mockResolvedValue({ rows: row ? [row] : [] }) });

  it('chọn lý do trong danh mục: trả mã, tên và có lương', async () => {
    await expect(
      resolveRequestReason(db(reasonRow({ paid: false })) as never, 't', 'OVERTIME', 'r1'),
    ).resolves.toMatchObject({ id: 'r1', code: 'OT_WORK', paid: false });
  });
  it('thiếu lý do, lý do ngoài danh mục hoặc đã ngừng dùng: 400', async () => {
    await expect(resolveRequestReason(db() as never, 't', 'OVERTIME', undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(resolveRequestReason(db() as never, 't', 'OVERTIME', 'r1')).rejects.toThrow(/không có trong danh mục/);
    await expect(
      resolveRequestReason(db(reasonRow({ active: false })) as never, 't', 'OVERTIME', 'r1'),
    ).rejects.toThrow(/ngừng sử dụng/);
  });
  it('lý do bắt buộc mô tả mà mô tả trống: 400', async () => {
    const row = reasonRow({ name: 'Khác', requires_description: true });
    await expect(resolveRequestReason(db(row) as never, 't', 'OVERTIME', 'r1', '  ')).rejects.toThrow(/cần nhập mô tả/);
    await expect(resolveRequestReason(db(row) as never, 't', 'OVERTIME', 'r1', 'Hỗ trợ sự cố')).resolves.toMatchObject({
      requiresDescription: true,
    });
  });
});
