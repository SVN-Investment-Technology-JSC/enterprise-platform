import { startDraftToPrefill } from './assistant-start-draft';

describe('startDraftToPrefill', () => {
  it('maps the draft and takes the procedure from the variant', () => {
    expect(
      startDraftToPrefill(
        {
          title: ' Đề nghị mua vật tư ',
          startDueAt: '2026-10-20T08:00:00+07:00',
          endDueAt: '2026-10-20T17:00:00+07:00',
          projectId: 'p-1',
          description: 'Mua 20 bulong M16',
        },
        'def-1',
        ['def-1', 'def-2'],
      ),
    ).toEqual({
      title: 'Đề nghị mua vật tư',
      definitionId: 'def-1',
      startDueAt: '2026-10-20T08:00:00+07:00',
      endDueAt: '2026-10-20T17:00:00+07:00',
      projectId: 'p-1',
      description: 'Mua 20 bulong M16',
    });
  });

  it('ignores unpublished procedures, unreadable dates and wrong types', () => {
    expect(
      startDraftToPrefill(
        { title: 12, startDueAt: 'chiều mai', endDueAt: '', projectId: '  ', processAttributeValues: { a: 1 } },
        'def-archived',
        ['def-1'],
      ),
    ).toEqual({});
  });

  it('returns only the provided fields so a follow-up draft merges into the open form', () => {
    expect(startDraftToPrefill({ endDueAt: '2026-10-21T10:00:00Z' }, undefined, ['def-1'])).toEqual({
      endDueAt: '2026-10-21T10:00:00Z',
    });
  });
});
