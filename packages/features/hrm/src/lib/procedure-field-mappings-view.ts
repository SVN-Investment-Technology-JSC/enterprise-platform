/**
 * Logic thuần cho màn ánh xạ trường HRM -> thuộc tính Procedure (FIX-E-05):
 * ghép thuộc tính của định nghĩa với ánh xạ đã lưu, cảnh báo, và dựng payload lưu.
 */

export type MappingMode = 'OVERWRITE' | 'PREFILL';

export interface DefinitionAttribute {
  code: string;
  name: string;
  type: string;
  required: boolean;
  scope: 'process' | 'step';
  valueKey: string;
  stepId: string;
  stepName: string;
}

export interface CatalogField {
  key: string;
  label: string;
  group: 'form' | 'employee' | 'business';
  valueType: 'text' | 'number' | 'boolean' | 'date';
}

export interface SavedMapping {
  hrmField: string;
  attributeCode: string;
  scope: 'any' | 'process' | 'step';
  stepId: string;
  transform: string;
  mode: MappingMode;
}

export interface MappingRow {
  attribute: DefinitionAttribute;
  hrmField: string;
  mode: MappingMode;
  transform: string;
}

export const GROUP_LABELS: Record<CatalogField['group'], string> = {
  form: 'Trường form',
  employee: 'Ngữ cảnh nhân viên',
  business: 'Ngữ cảnh nghiệp vụ',
};

export const MODE_OPTIONS: { value: MappingMode; label: string }[] = [
  { value: 'OVERWRITE', label: 'Hệ thống ghi đè (ẩn khỏi form)' },
  { value: 'PREFILL', label: 'Điền sẵn (người nộp được sửa)' },
];

function savedFor(
  saved: readonly SavedMapping[],
  attribute: DefinitionAttribute,
): SavedMapping | undefined {
  const matches = saved.filter(
    (m) =>
      m.attributeCode === attribute.code &&
      (m.scope === 'any' ||
        (m.scope === attribute.scope &&
          (m.scope === 'process' || m.stepId === attribute.stepId))),
  );
  return matches.find((m) => m.mode === 'OVERWRITE') ?? matches[0];
}

/** Mỗi thuộc tính một dòng, chọn sẵn ánh xạ đang hiệu lực (kể cả ánh xạ mặc định phạm vi 'any'). */
export function buildMappingRows(
  attributes: readonly DefinitionAttribute[],
  saved: readonly SavedMapping[],
): MappingRow[] {
  return attributes.map((attribute) => {
    const current = savedFor(saved, attribute);
    return {
      attribute,
      hrmField: current?.hrmField ?? '',
      mode: current?.mode ?? 'OVERWRITE',
      transform: current?.transform ?? 'none',
    };
  });
}

/** Payload PUT: chỉ các dòng đã chọn trường, ghi phạm vi tường minh theo thuộc tính. */
export function toSavePayload(rows: readonly MappingRow[]): SavedMapping[] {
  return rows
    .filter((row) => row.hrmField)
    .map((row) => ({
      hrmField: row.hrmField,
      attributeCode: row.attribute.code,
      scope: row.attribute.scope,
      stepId: row.attribute.scope === 'step' ? row.attribute.stepId : '',
      transform: row.transform || 'none',
      mode: row.mode,
    }));
}

const NUMERIC = ['number', 'money', 'percent'];

/** Cảnh báo kiểu dữ liệu không khớp giữa trường HRM và thuộc tính PE (không chặn lưu). */
export function typeWarning(
  attribute: Pick<DefinitionAttribute, 'type' | 'name'>,
  field: Pick<CatalogField, 'valueType' | 'label'> | undefined,
): string | null {
  if (!field) return null;
  const type = attribute.type;
  const ok =
    (NUMERIC.includes(type) && field.valueType === 'number') ||
    (type === 'boolean' && field.valueType === 'boolean') ||
    (type === 'date' && field.valueType === 'date') ||
    (['text', 'select'].includes(type) &&
      ['text', 'number', 'date'].includes(field.valueType)) ||
    (type === 'user' && field.valueType === 'text');
  if (!ok)
    return `Thuộc tính "${attribute.name}" (${type}) không khớp kiểu của trường "${field.label}" (${field.valueType}).`;
  if (type === 'select')
    return `Thuộc tính "${attribute.name}" là danh sách chọn: giá trị "${field.label}" phải trùng mã một lựa chọn của thuộc tính, nếu không đơn sẽ không khởi tạo được quy trình.`;
  return null;
}

/** Thuộc tính bắt buộc chưa ánh xạ: người nộp phải tự nhập trên form. */
export function unmappedRequired(rows: readonly MappingRow[]): string[] {
  return rows
    .filter((row) => row.attribute.required && !row.hrmField)
    .map((row) => row.attribute.name);
}

export function mappingWarnings(
  rows: readonly MappingRow[],
  catalog: readonly CatalogField[],
): string[] {
  const byKey = new Map(catalog.map((f) => [f.key, f]));
  const warnings: string[] = [];
  const missing = unmappedRequired(rows);
  if (missing.length)
    warnings.push(
      `Thuộc tính bắt buộc chưa ánh xạ (người nộp phải tự nhập trên form): ${missing.join(', ')}.`,
    );
  for (const row of rows) {
    if (!row.hrmField) continue;
    const warning = typeWarning(row.attribute, byKey.get(row.hrmField));
    if (warning) warnings.push(warning);
  }
  return warnings;
}

/** Tùy chọn cho SearchableSelect, nhóm theo nguồn dữ liệu. */
export function fieldOptions(
  catalog: readonly CatalogField[],
): { value: string; label: string }[] {
  return (['form', 'employee', 'business'] as const).flatMap((group) =>
    catalog
      .filter((f) => f.group === group)
      .map((f) => ({
        value: f.key,
        label: `${GROUP_LABELS[group]} - ${f.label}`,
      })),
  );
}
