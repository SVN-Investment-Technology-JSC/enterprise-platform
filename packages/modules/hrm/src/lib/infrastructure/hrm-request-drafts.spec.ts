import { BadRequestException } from '@nestjs/common';
import { draftPayload, mapDraft } from './hrm-request-drafts';

const draftRow = (kind: string, payload: Record<string, unknown>) => ({
  id: 'd1',
  employee_id: 'e1',
  request_kind: kind,
  status: 'DRAFT',
  revision: 1,
  payload,
  submitted_request_id: null,
  created_at: '2026-10-09T00:00:00Z',
  updated_at: '2026-10-09T00:00:00Z',
});

describe('bản nháp đơn: lý do (danh mục) và mô tả', () => {
  it('payload nháp giữ reasonId và description, bỏ các khóa do server cấp', () => {
    expect(
      draftPayload({
        reasonId: 'r1',
        description: 'Mô tả',
        employeeId: 'x',
        status: 'SUBMITTED',
      }),
    ).toEqual({ reasonId: 'r1', description: 'Mô tả' });
  });

  it('reasonId, description và reason (bí danh cũ) phải là văn bản', () => {
    for (const key of ['reasonId', 'description', 'reason'])
      expect(() => draftPayload({ [key]: 5 })).toThrow(BadRequestException);
    expect(() => draftPayload({ description: null })).not.toThrow();
  });

  it('nháp cũ chỉ có reason: đọc ra thêm description cùng nội dung (loại đơn có lý do)', () => {
    for (const kind of ['leave', 'ot', 'business_trip', 'shift_change', 'correction'])
      expect(
        mapDraft(draftRow(kind, { reason: 'Nội dung cũ' })).payload,
      ).toEqual({ reason: 'Nội dung cũ', description: 'Nội dung cũ' });
  });

  it('description đã có thì giữ nguyên; loại đơn không có lý do danh mục không bị thêm description', () => {
    expect(
      mapDraft(
        draftRow('ot', { reasonId: 'r1', reason: 'Cũ', description: 'Mới' }),
      ).payload,
    ).toEqual({ reasonId: 'r1', reason: 'Cũ', description: 'Mới' });
    expect(
      mapDraft(draftRow('advance', { reason: 'Việc nhà' })).payload,
    ).toEqual({ reason: 'Việc nhà' });
  });
});
