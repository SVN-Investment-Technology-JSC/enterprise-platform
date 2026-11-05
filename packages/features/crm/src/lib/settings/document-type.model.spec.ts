import type { CrmDocumentType } from '@enterprise-platform/contracts-crm';
import { documentTypeFormError, normalizeDocumentTypeCode, sortDocumentTypes } from './document-type.model';

const type = (code: string, sortOrder: number, active = true): CrmDocumentType => ({ id: code, code, name: code, description: null, active, sortOrder });

describe('loại tài liệu', () => {
  it('chuẩn hoá mã', () => expect(normalizeDocumentTypeCode(' bien_ban ')).toBe('BIEN_BAN'));
  it('kiểm tra form', () => {
    expect(documentTypeFormError({ code: 'a', name: 'x', sortOrder: '' })).toMatch(/Mã/);
    expect(documentTypeFormError({ code: 'bb', name: ' ', sortOrder: '' })).toMatch(/tên/);
    expect(documentTypeFormError({ code: 'bb', name: 'x', sortOrder: '-1' })).toMatch(/Thứ tự/);
    expect(documentTypeFormError({ name: 'x', sortOrder: '10' })).toBeUndefined();
  });
  it('xếp loại đang dùng trước, theo thứ tự', () => {
    expect(sortDocumentTypes([type('C', 1, false), type('B', 2), type('A', 3)]).map((item) => item.code)).toEqual(['B', 'A', 'C']);
  });
});
