import {
  BRAND_ERROR_CODES,
  BRAND_ICON_ID_PATTERN,
  BRAND_ICON_STATUSES,
  BRAND_SVG_MODES,
} from './api-types.js';
import { createDocument } from './model.js';
import { normalizeDocument } from './validate.js';

describe('BRAND_ICON_ID_PATTERN', () => {
  it.each([
    'a',
    'icon-1',
    'Icon_A',
    '0abc',
    'a'.repeat(64),
    'a'.repeat(65),
    '',
    '-a',
    '_a',
    'a b',
    'a/b',
    '../x',
    'ă',
  ])('khớp với mẫu mã mà normalizeDocument chấp nhận cho %p', (id) => {
    const accepted =
      normalizeDocument({ ...createDocument({ name: 'Mẫu' }), id }) !== null;
    expect(BRAND_ICON_ID_PATTERN.test(id)).toBe(accepted);
  });
});

describe('hằng số API', () => {
  it('mã lỗi không trùng nhau và trạng thái, chế độ SVG đủ giá trị', () => {
    const codes = Object.values(BRAND_ERROR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    expect(BRAND_ICON_STATUSES).toEqual(['draft', 'published', 'archived']);
    expect(BRAND_SVG_MODES).toEqual(['brand', 'mono']);
  });
});
