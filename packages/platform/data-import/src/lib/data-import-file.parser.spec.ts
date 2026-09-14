import { Workbook } from 'exceljs';
import { parseDataImportFiles } from './data-import-file.parser.js';

describe('parseDataImportFiles', () => {
  it('parses a quoted USERS csv', async () => {
    const result = await parseDataImportFiles([
      {
        originalname: 'USERS.csv',
        mimetype: 'text/csv',
        size: 128,
        buffer: Buffer.from(
          'fullName,email,temporaryPassword,systemRole\r\n"Nguyễn, Văn An",an@example.com,Temporary-Password-2026,tenant-user\r\n',
        ),
      },
    ]);

    expect(result.issues).toEqual([]);
    expect(result.dataset.users).toEqual([
      {
        fullName: 'Nguyễn, Văn An',
        email: 'an@example.com',
        temporaryPassword: 'Temporary-Password-2026',
        systemRole: 'tenant-user',
      },
    ]);
  });

  it('parses the structured JSON columns in an xlsx workbook', async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('PROCEDURES');
    worksheet.addRow([
      'code',
      'name',
      'description',
      'kind',
      'category',
      'draft',
      'stepsJson',
    ]);
    worksheet.addRow([
      'QT-01',
      'Quy trình thử',
      '',
      'process',
      'demo',
      false,
      JSON.stringify([
        {
          key: 'S1',
          name: 'Bước 1',
          assignments: [
            { role: 'S', subjectNodeCode: 'POS-DIRECTOR' },
          ],
        },
      ]),
    ]);
    const bytes = await workbook.xlsx.writeBuffer();

    const result = await parseDataImportFiles([
      {
        originalname: 'sample.xlsx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: bytes.byteLength,
        buffer: Buffer.from(bytes),
      },
    ]);

    expect(result.issues).toEqual([]);
    expect(result.dataset.procedureDefinitions[0]?.steps[0]?.key).toBe('S1');
  });
});
