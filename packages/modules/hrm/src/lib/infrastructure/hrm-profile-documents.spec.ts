import { BadRequestException } from '@nestjs/common';
import { parseDocumentChanges } from './hrm-profile-documents.js';

const id = '11111111-1111-4111-8111-111111111111';

describe('parseDocumentChanges', () => {
  it('accepts an empty or missing list', () => {
    expect(parseDocumentChanges(undefined)).toEqual([]);
    expect(parseDocumentChanges([])).toEqual([]);
  });

  it('accepts a document replacement and a passport as a qualification', () => {
    const parsed = parseDocumentChanges([
      { op: 'SET_DOCUMENT', documentType: 'ID_CARD_FRONT', attachmentId: id },
      {
        op: 'ADD_QUALIFICATION',
        qualification: {
          type: 'PASSPORT',
          name: 'Hộ chiếu phổ thông',
          effectiveFrom: '2024-01-01',
          expiryDate: '2034-01-01',
        },
      },
    ]);
    expect(parsed).toHaveLength(2);
  });

  it('rejects unknown document types, operations and qualification types', () => {
    expect(() =>
      parseDocumentChanges([
        { op: 'SET_DOCUMENT', documentType: 'PASSPORT', attachmentId: id },
      ]),
    ).toThrow(BadRequestException);
    expect(() => parseDocumentChanges([{ op: 'DROP' }])).toThrow(
      BadRequestException,
    );
    expect(() =>
      parseDocumentChanges([
        {
          op: 'ADD_QUALIFICATION',
          qualification: { type: 'BOGUS', name: 'x' },
        },
      ]),
    ).toThrow(BadRequestException);
  });

  it('rejects an expiry date before the effective date', () => {
    expect(() =>
      parseDocumentChanges([
        {
          op: 'ADD_QUALIFICATION',
          qualification: {
            type: 'DEGREE',
            name: 'Cử nhân',
            effectiveFrom: '2024-05-01',
            expiryDate: '2024-01-01',
          },
        },
      ]),
    ).toThrow(BadRequestException);
  });
});
