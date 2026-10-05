import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const summary = await workbook.inspect({
  kind: 'workbook,sheet,table,region',
  maxChars: 8000,
  tableMaxRows: 12,
  tableMaxCols: 8,
});
await fs.writeFile(outputPath, summary.ndjson, 'utf8');
const sheetName = workbook.worksheets.items[0]?.name;
if (sheetName) {
  const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
  await fs.writeFile(outputPath.replace(/\.ndjson$/, '.png'), new Uint8Array(await preview.arrayBuffer()));
}
