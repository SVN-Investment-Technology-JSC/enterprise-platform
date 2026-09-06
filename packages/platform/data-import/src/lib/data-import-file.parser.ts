import {
  DATA_IMPORT_SHEETS,
  emptyDataImportDataset,
  type DataImportDataset,
  type DataImportIssue,
  type DataImportSheetName,
  type ImportAssetRow,
  type ImportAssetTaskItem,
  type ImportMaintenanceScheduleRow,
  type ImportMaterialRow,
  type ImportOrganizationAssignmentRow,
  type ImportOrganizationNodeRow,
  type ImportOrganizationNodeTypeRow,
  type ImportOrganizationTreeRow,
  type ImportOpeningStockRow,
  type ImportProcedureDefinitionRow,
  type ImportProcedureInstanceRow,
  type ImportProcedureStepRow,
  type ImportTenantUserRow,
  type ImportWarehouseRow,
} from '@enterprise-platform/contracts-data-import';
import { BadRequestException } from '@nestjs/common';
import { Workbook, type Worksheet } from 'exceljs';
import { extname, parse as parsePath } from 'node:path';

export interface UploadedDataImportFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
  readonly size: number;
}

export interface ParsedDataImportFiles {
  readonly dataset: DataImportDataset;
  readonly issues: readonly DataImportIssue[];
  readonly sourceFiles: readonly string[];
}

type MutableDataset = {
  -readonly [TKey in keyof DataImportDataset]: Array<
    DataImportDataset[TKey][number]
  >;
};

type CellRecord = Record<string, unknown>;

const DATASET_BY_SHEET = new Map<DataImportSheetName, keyof DataImportDataset>(
  Object.entries(DATA_IMPORT_SHEETS).map(([key, sheet]) => [
    sheet,
    key as keyof DataImportDataset,
  ]),
);

export async function parseDataImportFiles(
  files: readonly UploadedDataImportFile[],
): Promise<ParsedDataImportFiles> {
  if (!files.length) {
    throw new BadRequestException('Hãy chọn ít nhất một file XLSX hoặc CSV.');
  }
  const dataset = emptyDataImportDataset() as MutableDataset;
  const issues: DataImportIssue[] = [];
  const seenSheets = new Set<DataImportSheetName>();

  for (const file of files) {
    const extension = extname(file.originalname).toLowerCase();
    if (extension === '.xlsx') {
      if (files.length > 1) {
        issues.push({
          level: 'error',
          code: 'XLSX_MUST_BE_SINGLE_FILE',
          message: 'Khi dùng XLSX, chỉ được tải lên một workbook.',
          sheet: 'SYSTEM',
        });
        continue;
      }
      const workbook = new Workbook();
      await workbook.xlsx.load(file.buffer as never);
      for (const worksheet of workbook.worksheets) {
        const sheetName = normalizeSheetName(worksheet.name);
        if (!sheetName) continue;
        appendWorksheet(dataset, issues, seenSheets, sheetName, worksheet);
      }
      continue;
    }

    if (extension === '.csv') {
      const sheetName = normalizeSheetName(parsePath(file.originalname).name);
      if (!sheetName) {
        issues.push({
          level: 'error',
          code: 'UNKNOWN_CSV_NAME',
          message: `Tên file ${file.originalname} không khớp tên sheet được hỗ trợ.`,
          sheet: 'SYSTEM',
        });
        continue;
      }
      const workbook = new Workbook();
      const worksheet = workbook.addWorksheet(sheetName);
      const rows = parseCsv(file.buffer.toString('utf8'));
      for (const row of rows) worksheet.addRow(row);
      appendWorksheet(dataset, issues, seenSheets, sheetName, worksheet);
      continue;
    }

    issues.push({
      level: 'error',
      code: 'UNSUPPORTED_FILE',
      message: `File ${file.originalname} không phải XLSX hoặc CSV.`,
      sheet: 'SYSTEM',
    });
  }

  if (!seenSheets.size) {
    issues.push({
      level: 'error',
      code: 'NO_SUPPORTED_SHEETS',
      message: 'Không tìm thấy sheet dữ liệu được hỗ trợ.',
      sheet: 'SYSTEM',
    });
  }

  return {
    dataset,
    issues,
    sourceFiles: files.map((file) => file.originalname),
  };
}

function appendWorksheet(
  dataset: MutableDataset,
  issues: DataImportIssue[],
  seenSheets: Set<DataImportSheetName>,
  sheetName: DataImportSheetName,
  worksheet: Worksheet,
): void {
  if (seenSheets.has(sheetName)) {
    issues.push({
      level: 'error',
      code: 'DUPLICATE_SHEET',
      message: `Sheet ${sheetName} xuất hiện nhiều hơn một lần.`,
      sheet: sheetName,
    });
    return;
  }
  seenSheets.add(sheetName);
  const key = DATASET_BY_SHEET.get(sheetName);
  if (!key) return;
  const rows = worksheetRows(worksheet);
  for (const { row, rowNumber } of rows) {
    try {
      (dataset[key] as unknown[]).push(parseRow(sheetName, row));
    } catch (error) {
      issues.push({
        level: 'error',
        code: 'INVALID_CELL_VALUE',
        message: error instanceof Error ? error.message : String(error),
        sheet: sheetName,
        row: rowNumber,
      });
    }
  }
}

function worksheetRows(
  worksheet: Worksheet,
): Array<{ row: CellRecord; rowNumber: number }> {
  const headers = new Map<number, string>();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
    const header = cell.text.trim();
    if (header) headers.set(column, header);
  });
  const rows: Array<{ row: CellRecord; rowNumber: number }> = [];
  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    const excelRow = worksheet.getRow(rowNumber);
    const row: CellRecord = {};
    let populated = false;
    for (const [column, header] of headers) {
      const cell = excelRow.getCell(column);
      const value = cell.value instanceof Date ? cell.value : cell.text.trim();
      row[header] = value;
      if (value !== '') populated = true;
    }
    if (populated) rows.push({ row, rowNumber });
  }
  return rows;
}

function parseRow(sheet: DataImportSheetName, row: CellRecord): unknown {
  switch (sheet) {
    case DATA_IMPORT_SHEETS.users:
      return {
        fullName: text(row.fullName),
        email: text(row.email).toLowerCase(),
        temporaryPassword: text(row.temporaryPassword),
        systemRole: (text(row.systemRole) || 'tenant-user') as ImportTenantUserRow['systemRole'],
      } satisfies ImportTenantUserRow;
    case DATA_IMPORT_SHEETS.organizationNodeTypes:
      return {
        code: code(row.code),
        name: text(row.name),
        category: text(row.category) as ImportOrganizationNodeTypeRow['category'],
        description: optionalText(row.description),
        sortOrder: optionalNumber(row.sortOrder),
      } satisfies ImportOrganizationNodeTypeRow;
    case DATA_IMPORT_SHEETS.organizationTrees:
      return {
        code: code(row.code),
        name: text(row.name),
        description: optionalText(row.description),
        isPrimary: optionalBoolean(row.isPrimary),
      } satisfies ImportOrganizationTreeRow;
    case DATA_IMPORT_SHEETS.organizationNodes:
      return {
        treeCode: code(row.treeCode),
        parentCode: optionalCode(row.parentCode),
        nodeTypeCode: code(row.nodeTypeCode),
        code: code(row.code),
        name: text(row.name),
        description: optionalText(row.description),
        sortOrder: optionalNumber(row.sortOrder),
      } satisfies ImportOrganizationNodeRow;
    case DATA_IMPORT_SHEETS.organizationAssignments:
      return {
        nodeCode: code(row.nodeCode),
        userEmail: text(row.userEmail).toLowerCase(),
        isPrimary: optionalBoolean(row.isPrimary),
        startDate: optionalDate(row.startDate),
        note: optionalText(row.note),
      } satisfies ImportOrganizationAssignmentRow;
    case DATA_IMPORT_SHEETS.inventorySettings:
      return {
        types: stringArray(row.typesJson, 'typesJson'),
        enabledStatuses: stringArray(
          row.enabledStatusesJson,
          'enabledStatusesJson',
        ),
        usageStates: stringArray(row.usageStatesJson, 'usageStatesJson'),
      };
    case DATA_IMPORT_SHEETS.inventoryWarehouses:
      return {
        code: code(row.code),
        name: text(row.name),
        type: (optionalText(row.type) || 'PHYSICAL') as ImportWarehouseRow['type'],
        organizationNodeCode: optionalCode(row.organizationNodeCode),
        location: optionalText(row.location),
      } satisfies ImportWarehouseRow;
    case DATA_IMPORT_SHEETS.inventoryMaterials:
      return {
        code: code(row.code),
        name: text(row.name),
        category: text(row.category) as ImportMaterialRow['category'],
        unit: text(row.unit),
        minStock: optionalNumber(row.minStock),
        maxStock: optionalNumber(row.maxStock),
        isSerialized: optionalBoolean(row.isSerialized),
        barcode: optionalText(row.barcode),
        manufactureYear: optionalNumber(row.manufactureYear),
        supplier: optionalText(row.supplier),
        manufacturer: optionalText(row.manufacturer),
        purchasePrice: optionalNumber(row.purchasePrice),
        currency: optionalText(row.currency),
      } satisfies ImportMaterialRow;
    case DATA_IMPORT_SHEETS.inventoryAssets:
      return {
        code: code(row.code),
        name: text(row.name),
        type: text(row.type),
        parentCode: optionalCode(row.parentCode),
        organizationNodeCode: optionalCode(row.organizationNodeCode),
        status: optionalText(row.status),
        criticality: optionalText(row.criticality) as ImportAssetRow['criticality'],
        specs: optionalJsonObject(row.specsJson, 'specsJson'),
        taskTemplate: optionalJsonArray(
          row.taskTemplateJson,
          'taskTemplateJson',
        ) as ImportAssetTaskItem[] | undefined,
        unit: optionalText(row.unit),
        purchasePrice: optionalNumber(row.purchasePrice),
        currency: optionalText(row.currency),
        warrantyUntil: optionalDate(row.warrantyUntil),
        manufactureYear: optionalNumber(row.manufactureYear),
        supplier: optionalText(row.supplier),
        manufacturer: optionalText(row.manufacturer),
      } satisfies ImportAssetRow;
    case DATA_IMPORT_SHEETS.inventoryOpeningStock:
      return {
        warehouseCode: code(row.warehouseCode),
        materialCode: code(row.materialCode),
        quantity: requiredNumber(row.quantity, 'quantity'),
        unitCost: requiredNumber(row.unitCost, 'unitCost'),
        note: optionalText(row.note),
      } satisfies ImportOpeningStockRow;
    case DATA_IMPORT_SHEETS.procedureDefinitions:
      return {
        code: code(row.code),
        name: text(row.name),
        description: optionalText(row.description),
        kind: text(row.kind) as ImportProcedureDefinitionRow['kind'],
        category: optionalText(row.category),
        draft: optionalBoolean(row.draft),
        steps: jsonArray(
          row.stepsJson,
          'stepsJson',
        ) as ImportProcedureStepRow[],
      } satisfies ImportProcedureDefinitionRow;
    case DATA_IMPORT_SHEETS.procedureInstances:
      return {
        definitionCode: code(row.definitionCode),
        title: text(row.title),
        idempotencyKey: text(row.idempotencyKey),
        assetCode: optionalCode(row.assetCode),
      } satisfies ImportProcedureInstanceRow;
    case DATA_IMPORT_SHEETS.maintenanceSchedules:
      return {
        assetCode: code(row.assetCode),
        procedureCode: optionalCode(row.procedureCode),
        frequency: text(row.frequency) as ImportMaintenanceScheduleRow['frequency'],
        priority: optionalText(row.priority) as ImportMaintenanceScheduleRow['priority'],
        startDate: optionalDate(row.startDate),
        startOffsetDays: optionalNumber(row.startOffsetDays),
        timezone: optionalText(row.timezone),
        activate: optionalBoolean(row.activate),
      } satisfies ImportMaintenanceScheduleRow;
  }
}

function normalizeSheetName(value: string): DataImportSheetName | undefined {
  const normalized = value.trim().replaceAll('-', '_').replaceAll(' ', '_').toUpperCase();
  return [...DATASET_BY_SHEET.keys()].find((sheet) => sheet === normalized);
}

function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').trim();
}

function code(value: unknown): string {
  return text(value).toUpperCase();
}

function optionalText(value: unknown): string | undefined {
  return text(value) || undefined;
}

function optionalCode(value: unknown): string | undefined {
  return code(value) || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const result = Number(raw);
  if (!Number.isFinite(result)) throw new Error(`“${raw}” không phải là số hợp lệ.`);
  return result;
}

function requiredNumber(value: unknown, field: string): number {
  const result = optionalNumber(value);
  if (result === undefined) throw new Error(`${field} là bắt buộc.`);
  return result;
}

function optionalBoolean(value: unknown): boolean | undefined {
  const raw = text(value).toLowerCase();
  if (!raw) return undefined;
  if (['true', '1', 'yes', 'y', 'có'].includes(raw)) return true;
  if (['false', '0', 'no', 'n', 'không'].includes(raw)) return false;
  throw new Error(`“${raw}” không phải boolean hợp lệ.`);
}

function optionalDate(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = text(value);
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Ngày “${raw}” phải theo định dạng YYYY-MM-DD.`);
  }
  return raw;
}

function jsonArray(value: unknown, field: string): unknown[] {
  const parsed = parseJson(value, field);
  if (!Array.isArray(parsed)) throw new Error(`${field} phải là một JSON array.`);
  return parsed;
}

function optionalJsonArray(value: unknown, field: string): unknown[] | undefined {
  if (!text(value)) return undefined;
  return jsonArray(value, field);
}

function stringArray(value: unknown, field: string): string[] {
  const parsed = jsonArray(value, field);
  if (parsed.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${field} chỉ được chứa chuỗi không rỗng.`);
  }
  return parsed.map((item) => String(item).trim());
}

function optionalJsonObject(
  value: unknown,
  field: string,
): Record<string, unknown> | undefined {
  if (!text(value)) return undefined;
  const parsed = parseJson(value, field);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${field} phải là một JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseJson(value: unknown, field: string): unknown {
  try {
    return JSON.parse(text(value));
  } catch {
    throw new Error(`${field} chứa JSON không hợp lệ.`);
  }
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const textSource = source.replace(/^\uFEFF/, '');
  for (let index = 0; index < textSource.length; index += 1) {
    const character = textSource[index];
    if (character === '"') {
      if (quoted && textSource[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && textSource[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  if (quoted) throw new BadRequestException('CSV có dấu ngoặc kép chưa đóng.');
  return rows;
}
