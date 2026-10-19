import { incidentDraftToFormValues } from './assistant-incident-draft';

const options = {
  assetCodes: ['WTG-01', 'TBA-110'],
  procedureDefinitionIds: ['def-1'],
  memberIds: ['u-1', 'u-2'],
};

describe('incidentDraftToFormValues', () => {
  it('maps every valid field, matching asset code and priority case-insensitively', () => {
    expect(
      incidentDraftToFormValues(
        {
          assetCode: 'wtg-01',
          title: '  Tua bin dừng đột ngột ',
          description: 'Báo lỗi hộp số lúc 9 giờ',
          priority: 'high',
          procedureDefinitionId: 'def-1',
          assigneeId: 'u-2',
        },
        options,
      ),
    ).toEqual({
      assetCode: 'WTG-01',
      title: 'Tua bin dừng đột ngột',
      description: 'Báo lỗi hộp số lúc 9 giờ',
      priority: 'High',
      procedureDefinitionId: 'def-1',
      assigneeId: 'u-2',
    });
  });

  it('drops unknown codes, wrong types and blanks without failing', () => {
    expect(
      incidentDraftToFormValues(
        {
          assetCode: 'KHONG-CO',
          title: '   ',
          description: 42,
          priority: 'Urgent',
          procedureDefinitionId: 'def-x',
          assigneeId: 'u-9',
          transport: { mode: 'EXTERNAL' },
        },
        options,
      ),
    ).toEqual({});
  });

  it('keeps the only provided fields so a follow-up draft merges into the open form', () => {
    expect(incidentDraftToFormValues({ priority: 'Low' }, options)).toEqual({ priority: 'Low' });
  });

  it('keeps the assignee when the member list has not loaded yet', () => {
    expect(
      incidentDraftToFormValues({ assigneeId: 'u-9' }, { ...options, memberIds: [] }),
    ).toEqual({ assigneeId: 'u-9' });
  });
});
