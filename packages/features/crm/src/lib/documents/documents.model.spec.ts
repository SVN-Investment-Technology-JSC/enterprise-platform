import { CRM_DOCUMENT_MAX_BYTES, type CrmDocumentFolder } from '@enterprise-platform/contracts-crm';
import {
  UPLOAD_IDLE,
  documentActions,
  folderOptions,
  formatBytes,
  isUploadBusy,
  resolveContentType,
  uploadPhaseLabel,
  uploadReducer,
  validateUploadFile,
} from './documents.model';

describe('validateUploadFile', () => {
  it('chấp nhận PDF trong giới hạn', () => {
    expect(validateUploadFile({ name: 'hd.pdf', size: 1000, type: 'application/pdf' })).toBeUndefined();
  });
  it('từ chối file rỗng, quá lớn, sai loại', () => {
    expect(validateUploadFile({ name: 'a.pdf', size: 0, type: 'application/pdf' })).toMatch(/rỗng/);
    expect(validateUploadFile({ name: 'a.pdf', size: CRM_DOCUMENT_MAX_BYTES + 1, type: 'application/pdf' })).toMatch(/vượt quá 50 MB/);
    expect(validateUploadFile({ name: 'a.exe', size: 10, type: 'application/x-msdownload' })).toMatch(/chưa được hỗ trợ/);
  });
  it('suy loại từ đuôi file khi trình duyệt không khai loại', () => {
    expect(resolveContentType({ name: 'bang.CSV', type: '' })).toBe('text/csv');
    expect(validateUploadFile({ name: 'bang.csv', size: 5, type: '' })).toBeUndefined();
    expect(validateUploadFile({ name: 'khong-duoi', size: 5, type: '' })).toMatch(/chưa được hỗ trợ/);
  });
});

describe('formatBytes', () => {
  it('định dạng đơn vị', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(null)).toBe('');
  });
});

describe('uploadReducer', () => {
  it('đi qua các pha và tính phần trăm', () => {
    let state = uploadReducer(UPLOAD_IDLE, { type: 'prepare' });
    expect(isUploadBusy(state)).toBe(true);
    state = uploadReducer(state, { type: 'progress', loaded: 25, total: 100 });
    expect(state).toEqual({ phase: 'uploading', percent: 25 });
    expect(uploadPhaseLabel(state)).toBe('Đang tải lên 25%');
    state = uploadReducer(state, { type: 'confirm' });
    expect(state.phase).toBe('confirming');
    state = uploadReducer(state, { type: 'done' });
    expect(isUploadBusy(state)).toBe(false);
  });
  it('bỏ qua tiến trình muộn sau khi lỗi và ghi lỗi', () => {
    const failed = uploadReducer({ phase: 'uploading', percent: 40 }, { type: 'fail', message: 'Mất kết nối' });
    expect(failed).toEqual({ phase: 'error', percent: 0, error: 'Mất kết nối' });
    expect(uploadReducer(failed, { type: 'progress', loaded: 1, total: 2 })).toBe(failed);
    expect(uploadReducer(failed, { type: 'reset' })).toBe(UPLOAD_IDLE);
  });
});

describe('documentActions', () => {
  const write = { canWriteDocument: true, canDeleteDocument: false };
  it('ẩn nút ghi khi thiếu quyền', () => {
    const actions = documentActions({ lockedByUserId: null }, { canWriteDocument: false, canDeleteDocument: false }, 'u1');
    expect(Object.values(actions).every((value) => value === false)).toBe(true);
  });
  it('xoá chỉ theo quyền xoá riêng', () => {
    expect(documentActions({ lockedByUserId: null }, write, 'u1').remove).toBe(false);
    expect(documentActions({ lockedByUserId: null }, { ...write, canDeleteDocument: true }, 'u1').remove).toBe(true);
  });
  it('khoá bởi người khác thì không sửa, không thêm bản, không xoá; người khoá thì mở khoá được', () => {
    const caps = { canWriteDocument: true, canDeleteDocument: true };
    const other = documentActions({ lockedByUserId: 'u2' }, caps, 'u1');
    expect(other).toMatchObject({ newVersion: false, edit: false, remove: false, lock: false, unlock: true });
    const mine = documentActions({ lockedByUserId: 'u1' }, caps, 'u1');
    expect(mine).toMatchObject({ newVersion: true, edit: true, unlock: true });
  });
});

describe('folderOptions', () => {
  const folder = (id: string, name: string, parentId: string | null): CrmDocumentFolder => ({
    id,
    name,
    parentId,
    entityType: 'customer',
    entityId: 'c1',
    depth: parentId ? 2 : 1,
    createdBy: 'u',
    createdAt: '2026-01-01T00:00:00Z',
  });
  it('xếp cha trước con với nhãn là đường dẫn', () => {
    const options = folderOptions([folder('b', 'Phụ lục', 'a'), folder('a', 'Hợp đồng', null), folder('c', 'Biên bản', null)]);
    expect(options.map((option) => option.label)).toEqual(['Biên bản', 'Hợp đồng', 'Hợp đồng / Phụ lục']);
  });
});
