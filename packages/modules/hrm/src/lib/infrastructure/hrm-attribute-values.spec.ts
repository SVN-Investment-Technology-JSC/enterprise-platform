import {
  collectUserReferences,
  describeSubmittedAttributes,
  normalizeAttributesForProcedure,
  type EmployeeUserMap,
  type ProcedureAttributeSpec,
} from './hrm-attribute-values';
import { initialProcedureValues } from './hrm-procedure-bridge.service';
jest.mock('./hrm-context.service.js', () => ({ HrmContextService: class {} }));

const EMP = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const FILE = '33333333-3333-4333-8333-333333333333';

const specs: ProcedureAttributeSpec[] = [
  { code: 'nguoi_thay_the', type: 'user', valueKey: 'process:nguoi_thay_the', name: 'Người thay thế', scope: 'process' },
  { code: 'chung_tu', type: 'file', valueKey: 'process:chung_tu', name: 'Chứng từ', scope: 'process' },
  { code: 'ghi_chu', type: 'text', valueKey: 'process:ghi_chu', name: 'Ghi chú', scope: 'process' },
];

const users: EmployeeUserMap = new Map([
  [EMP, { employeeId: EMP, userId: USER, name: 'Nguyễn Văn A' }],
  [USER, { employeeId: EMP, userId: USER, name: 'Nguyễn Văn A' }],
]);

describe('hrm-attribute-values', () => {
  it('file: chuỗi đơn thành mảng id; mảng giữ nguyên và khử trùng', () => {
    expect(normalizeAttributesForProcedure(specs, { chung_tu: FILE }).chung_tu).toEqual({
      type: 'file',
      value: [FILE],
    });
    expect(
      normalizeAttributesForProcedure(specs, { 'process:chung_tu': [FILE, FILE] })['process:chung_tu'],
    ).toEqual({ type: 'file', value: [FILE] });
  });

  it('user: đổi id nhân viên sang id người dùng Platform kèm tên', () => {
    expect(collectUserReferences(specs, { nguoi_thay_the: EMP })).toEqual([EMP]);
    expect(normalizeAttributesForProcedure(specs, { nguoi_thay_the: EMP }, users).nguoi_thay_the).toEqual({
      type: 'user',
      value: USER,
      label: 'Nguyễn Văn A',
    });
  });

  it('user: nhân viên chưa có tài khoản bị từ chối rõ ràng', () => {
    const map: EmployeeUserMap = new Map([[EMP, { employeeId: EMP, userId: null, name: 'B' }]]);
    expect(() => normalizeAttributesForProcedure(specs, { nguoi_thay_the: EMP }, map)).toThrow(/chưa có tài khoản/);
  });

  it('thuộc tính khác giữ nguyên', () => {
    expect(normalizeAttributesForProcedure(specs, { ghi_chu: 'abc' })).toEqual({ ghi_chu: 'abc' });
  });

  it('initialProcedureValues bọc id tệp chuỗi cũ thành mảng và giữ giá trị đã chuẩn hóa', () => {
    const definition = {
      attributes: [
        { id: 'a', code: 'chung_tu', name: 'Chứng từ', type: 'file' },
        { id: 'b', code: 'nguoi_thay_the', name: 'Người', type: 'user' },
      ],
      steps: [],
    } as never;
    expect(
      initialProcedureValues(definition, {
        chung_tu: FILE,
        nguoi_thay_the: { type: 'user', value: USER, label: 'A' },
      }),
    ).toEqual({
      'process:chung_tu': { type: 'file', value: [FILE] },
      'process:nguoi_thay_the': { type: 'user', value: USER, label: 'A' },
    });
  });

  it('describeSubmittedAttributes: tên người, tên tệp, bỏ giá trị rỗng', () => {
    const out = describeSubmittedAttributes(
      specs,
      {
        'process:nguoi_thay_the': { type: 'user', value: USER, label: 'Nguyễn Văn A' },
        'process:chung_tu': { type: 'file', value: [FILE] },
        ghi_chu: '',
      },
      users,
      new Map([[FILE, 'don.pdf']]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].display).toBe('Nguyễn Văn A');
    expect(out[1].files).toEqual([{ id: FILE, name: 'don.pdf' }]);
  });

  it('describeSubmittedAttributes: dữ liệu cũ (id nhân viên thô) vẫn ra tên', () => {
    const out = describeSubmittedAttributes(specs, { nguoi_thay_the: EMP }, users, new Map());
    expect(out[0].display).toBe('Nguyễn Văn A');
  });
});
