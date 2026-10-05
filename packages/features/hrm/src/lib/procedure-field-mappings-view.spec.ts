import {
  buildMappingRows,
  fieldOptions,
  mappingWarnings,
  toSavePayload,
  typeWarning,
  unmappedRequired,
  type CatalogField,
  type DefinitionAttribute,
  type SavedMapping,
} from './procedure-field-mappings-view';
import {
  distinctCurrentSteps,
  matchesWorkflowFilter,
  procedureFieldsOf,
  workflowFilterQuery,
} from './procedure-progress-view';

const attribute = (over: Partial<DefinitionAttribute>): DefinitionAttribute => ({
  code: 'so_ngay',
  name: 'Số ngày nghỉ',
  type: 'number',
  required: true,
  scope: 'step',
  valueKey: 'step:S1:so_ngay',
  stepId: 'S1',
  stepName: 'Nộp đơn',
  ...over,
});

const catalog: CatalogField[] = [
  { key: 'form.duration', label: 'Số ngày nghỉ', group: 'form', valueType: 'number' },
  { key: 'form.reason', label: 'Lý do', group: 'form', valueType: 'text' },
  { key: 'employee.department_code', label: 'Phòng ban (mã)', group: 'employee', valueType: 'text' },
];

describe('ánh xạ trường HRM - logic màn cấu hình', () => {
  it('chọn sẵn ánh xạ mặc định phạm vi any và ánh xạ riêng theo bước', () => {
    const saved: SavedMapping[] = [
      { hrmField: 'form.duration', attributeCode: 'so_ngay', scope: 'any', stepId: '', transform: 'none', mode: 'OVERWRITE' },
      { hrmField: 'form.reason', attributeCode: 'ly_do', scope: 'step', stepId: 'S2', transform: 'none', mode: 'PREFILL' },
    ];
    const rows = buildMappingRows(
      [attribute({}), attribute({ code: 'ly_do', type: 'text', valueKey: 'step:S1:ly_do' })],
      saved,
    );
    expect(rows[0]).toMatchObject({ hrmField: 'form.duration', mode: 'OVERWRITE' });
    // Ánh xạ của bước S2 không áp cho thuộc tính bước S1.
    expect(rows[1].hrmField).toBe('');
  });

  it('payload lưu chỉ gồm dòng đã chọn, phạm vi tường minh theo thuộc tính', () => {
    const rows = buildMappingRows(
      [
        attribute({}),
        attribute({ code: 'phong_ban', type: 'select', scope: 'process', valueKey: 'process:phong_ban', stepId: '' }),
        attribute({ code: 'khac', valueKey: 'step:S1:khac' }),
      ],
      [],
    );
    rows[0].hrmField = 'form.duration';
    rows[1].hrmField = 'employee.department_code';
    rows[1].mode = 'PREFILL';
    expect(toSavePayload(rows)).toEqual([
      { hrmField: 'form.duration', attributeCode: 'so_ngay', scope: 'step', stepId: 'S1', transform: 'none', mode: 'OVERWRITE' },
      { hrmField: 'employee.department_code', attributeCode: 'phong_ban', scope: 'process', stepId: '', transform: 'none', mode: 'PREFILL' },
    ]);
  });

  it('cảnh báo thuộc tính bắt buộc chưa ánh xạ và kiểu không khớp / danh sách chọn', () => {
    const rows = buildMappingRows(
      [
        attribute({}),
        attribute({ code: 'phong_ban', name: 'Phòng ban', type: 'select', required: false, valueKey: 'step:S1:phong_ban' }),
        attribute({ code: 'co', name: 'Cờ', type: 'boolean', required: false, valueKey: 'step:S1:co' }),
      ],
      [],
    );
    expect(unmappedRequired(rows)).toEqual(['Số ngày nghỉ']);
    rows[1].hrmField = 'employee.department_code';
    rows[2].hrmField = 'form.reason';
    const warnings = mappingWarnings(rows, catalog);
    expect(warnings.some((w) => w.includes('bắt buộc chưa ánh xạ'))).toBe(true);
    expect(warnings.some((w) => w.includes('danh sách chọn'))).toBe(true);
    expect(warnings.some((w) => w.includes('không khớp kiểu'))).toBe(true);
    expect(
      typeWarning({ type: 'number', name: 'x' }, catalog[0]),
    ).toBeNull();
  });

  it('danh sách chọn trường nhóm theo nguồn dữ liệu', () => {
    expect(fieldOptions(catalog).map((o) => o.label)).toEqual([
      'Trường form - Số ngày nghỉ',
      'Trường form - Lý do',
      'Ngữ cảnh nhân viên - Phòng ban (mã)',
    ]);
  });
});

describe('lọc đơn theo người đang chờ duyệt và bước hiện tại', () => {
  const raw = (step: string, assignee: string) => ({
    currentStepName: step,
    currentAssigneeName: assignee,
  });

  it('khớp một phần không dấu với người duyệt, chính xác với bước', () => {
    const item = raw('Giám đốc duyệt', 'Giám đốc Bình');
    expect(matchesWorkflowFilter(item, { assignee: 'binh' })).toBe(true);
    expect(matchesWorkflowFilter(item, { assignee: 'lan' })).toBe(false);
    expect(matchesWorkflowFilter(item, { currentStep: 'giam doc duyet' })).toBe(true);
    expect(matchesWorkflowFilter(item, { currentStep: 'Trưởng phòng duyệt' })).toBe(false);
    expect(matchesWorkflowFilter({}, {})).toBe(true);
    expect(matchesWorkflowFilter({}, { assignee: 'a' })).toBe(false);
  });

  it('liệt kê bước khác nhau và dựng query cho API', () => {
    expect(
      distinctCurrentSteps([raw('B', 'x'), raw('A', 'y'), raw('B', 'z'), {}]),
    ).toEqual(['A', 'B']);
    expect(workflowFilterQuery({ assignee: ' Lan ', currentStep: '' })).toBe('assignee=Lan');
    expect(workflowFilterQuery({})).toBe('');
  });

  it('đọc revision thật của liên kết Procedure từ danh sách đơn', () => {
    expect(procedureFieldsOf({ procedureRevision: 3 }).revision).toBe(3);
    expect(procedureFieldsOf({ procedureRevision: null }).revision).toBeUndefined();
  });
});
