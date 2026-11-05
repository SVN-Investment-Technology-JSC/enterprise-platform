import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CRM_ALLOWED_DOCUMENT_CONTENT_TYPES,
  CRM_DOCUMENT_MAX_BYTES,
  CRM_DOCUMENT_MAX_FOLDER_DEPTH,
  CRM_DOCUMENT_URL_TTL_SECONDS,
} from '@enterprise-platform/contracts-crm';
import {
  buildObjectKey,
  nextFolderDepth,
  normalizeContentType,
  normalizeDocumentTypeCode,
  normalizeFileName,
  normalizeFolderName,
  sanitizeObjectName,
  validateUploadFile,
} from './document-rules.js';

const message = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('Không ném lỗi.');
};

describe('luật tài liệu CRM', () => {
  it('giới hạn đúng bằng giá trị đã chốt: 50 MB, TTL 300 giây, thư mục sâu 5 cấp', () => {
    expect(CRM_DOCUMENT_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(CRM_DOCUMENT_URL_TTL_SECONDS).toBe(300);
    expect(CRM_DOCUMENT_MAX_FOLDER_DEPTH).toBe(5);
    expect(CRM_ALLOWED_DOCUMENT_CONTENT_TYPES).toContain('application/pdf');
    expect(CRM_ALLOWED_DOCUMENT_CONTENT_TYPES).not.toContain('application/x-msdownload');
  });

  it('TC-DOC-02: loại file ngoài danh sách bị từ chối bằng tiếng Việt', () => {
    expect(message(() => validateUploadFile('virus.exe', 'application/x-msdownload', 10))).toBe(
      'Không hỗ trợ loại file "application/x-msdownload".',
    );
    expect(message(() => normalizeContentType(''))).toContain('(trống)');
    expect(normalizeContentType('Text/Plain; charset=utf-8')).toBe('text/plain');
  });

  it('TC-DOC-03: vượt 50 MB, 0 byte hoặc không phải số nguyên bị từ chối; đúng 50 MB thì qua', () => {
    expect(message(() => validateUploadFile('a.pdf', 'application/pdf', 51 * 1024 * 1024))).toBe(
      'File không được vượt quá 50 MB.',
    );
    expect(() => validateUploadFile('a.pdf', 'application/pdf', 0)).toThrow('số nguyên dương');
    expect(() => validateUploadFile('a.pdf', 'application/pdf', 1.5)).toThrow('số nguyên dương');
    expect(() => validateUploadFile('a.pdf', 'application/pdf', '10')).toThrow('số nguyên dương');
    expect(validateUploadFile('a.pdf', 'application/pdf', CRM_DOCUMENT_MAX_BYTES).sizeBytes).toBe(CRM_DOCUMENT_MAX_BYTES);
  });

  it('TC-DOC-20: tên file có dấu, "/" và tên rất dài; object_key không chứa tên thô', () => {
    expect(normalizeFileName('  Hồ sơ / pháp lý\\v2.pdf ')).toBe('Hồ sơ _ pháp lý_v2.pdf');
    expect(() => normalizeFileName('a'.repeat(256))).toThrow('không được dài quá 255');
    expect(() => normalizeFileName('   ')).toThrow('không được để trống');
    expect(() => normalizeFileName('..')).toThrow('không được để trống');
    expect(sanitizeObjectName('Hồ sơ mời thầu – Đà Nẵng.pdf')).toBe('Ho-so-moi-thau-Da-Nang.pdf');
    expect(sanitizeObjectName('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeObjectName('日本語')).toBe('file');
    expect(sanitizeObjectName(`${'x'.repeat(200)}.pdf`).length).toBeLessThanOrEqual(80);
    expect(sanitizeObjectName(`${'x'.repeat(200)}.pdf`).endsWith('.pdf')).toBe(true);

    const key = buildObjectKey({
      tenantId: 'tenant-1',
      entityType: 'opportunity',
      versionNo: 2,
      fileName: 'Báo cáo/../Đặc biệt.pdf',
      uuid: '11111111-1111-4111-8111-111111111111',
    });
    expect(key).toBe('tenants/tenant-1/crm/documents/opportunity/11111111-1111-4111-8111-111111111111/v2-Bao-cao-..-Dac-biet.pdf');
    expect(key.split('/')).toHaveLength(7);
    expect(key).not.toContain('Báo');
  });

  it('TC-DOC-10: độ sâu thư mục tối đa 5', () => {
    expect(nextFolderDepth(null)).toBe(1);
    expect(nextFolderDepth(4)).toBe(5);
    expect(message(() => nextFolderDepth(5))).toBe('Thư mục chỉ lồng tối đa 5 cấp.');
    expect(normalizeFolderName(' Hồ  sơ/thầu ')).toBe('Hồ sơ_thầu');
  });

  it('mã loại tài liệu: chuẩn hoá chữ hoa, từ chối ký tự lạ', () => {
    expect(normalizeDocumentTypeCode(' legal_dossier ')).toBe('LEGAL_DOSSIER');
    expect(() => normalizeDocumentTypeCode('1abc')).toThrow('Mã loại tài liệu');
    expect(() => normalizeDocumentTypeCode('a b')).toThrow('Mã loại tài liệu');
  });

  it('TC-DOC-17: giới hạn CRM bằng đúng giới hạn Workspace (đọc từ nguồn Workspace, không import)', () => {
    const source = readFileSync(resolve(process.cwd(), '../../contracts/workspace/src/lib/contracts-workspace.ts'), 'utf8');
    const number = (name: string): number => {
      const match = new RegExp(`export const ${name} = ([0-9 *]+);`).exec(source);
      if (!match) throw new Error(`Không thấy ${name} ở Workspace.`);
      return match[1].split('*').reduce((product, part) => product * Number(part.trim()), 1);
    };
    expect(CRM_DOCUMENT_MAX_BYTES).toBe(number('DOCUMENT_MAX_BYTES'));
    expect(CRM_DOCUMENT_URL_TTL_SECONDS).toBe(number('PRESIGNED_URL_TTL_SECONDS'));
    expect(CRM_DOCUMENT_MAX_FOLDER_DEPTH).toBe(number('MAX_FOLDER_DEPTH'));
    const list = /export const ALLOWED_DOCUMENT_CONTENT_TYPES: readonly string\[\] = \[([^\]]*)\];/.exec(source);
    if (!list) throw new Error('Không thấy ALLOWED_DOCUMENT_CONTENT_TYPES ở Workspace.');
    const workspaceTypes = [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect([...CRM_ALLOWED_DOCUMENT_CONTENT_TYPES].sort()).toEqual([...workspaceTypes].sort());
  });
});
