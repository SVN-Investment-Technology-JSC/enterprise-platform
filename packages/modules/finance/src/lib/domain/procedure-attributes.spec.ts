import type { ProcedureDefinition } from '@enterprise-platform/contracts-procedure-engine';
import {
  initialProcedureAttributes,
  planProcedureAttributes,
  procedureTitle,
  procedureValueFor,
  startStepWarnings,
  unsupportedRequiredAttributes,
  type VoucherProcedureFacts,
} from './procedure-attributes.js';

const facts: VoucherProcedureFacts = {
  kind: 'PAYMENT',
  code: 'PC_12_10_2026',
  content: 'Chi văn phòng phẩm',
  totalAmount: 1_500_000,
  postingDate: '2026-10-14',
  voucherDate: '2026-10-13',
  reasonName: 'Văn phòng phẩm',
  accountName: 'Vietcombank',
  destAccountName: null,
  counterpartyGroupName: 'Nhà cung cấp',
  counterpartyName: null,
  allocationLabel: 'CV-12 - Lắp đặt tủ điện (DA001)',
  projectLabel: 'DA001 - Trạm biến áp Đà Nẵng',
};

const attr = (code: string, type: string, required = false, options?: { code: string; label: string }[]) => ({ id: code, code, name: code, type, required, options });
const definition = (attributes: unknown[], stepAttributes: unknown[] = [], roles: string[] = ['S']): ProcedureDefinition =>
  ({
    id: 'd1',
    attributes,
    gateways: [],
    steps: [
      { id: 'first', name: 'Lập phiếu', assignments: roles.map((role) => ({ role })), attributes: stepAttributes },
      { id: 'second', name: 'Duyệt', assignments: [{ role: 'A' }], attributes: [] },
    ],
  }) as unknown as ProcedureDefinition;

describe('thuộc tính quy trình lấy từ phiếu', () => {
  it('khớp mã không phân biệt hoa thường và đúng kiểu dữ liệu', () => {
    expect(procedureValueFor(attr('SO_TIEN', 'money') as never, facts)).toEqual({ type: 'money', value: 1_500_000 });
    expect(procedureValueFor(attr('amount', 'number') as never, facts)).toEqual({ type: 'number', value: 1_500_000 });
    expect(procedureValueFor(attr('noi_dung', 'text') as never, facts)).toEqual({ type: 'text', value: 'Chi văn phòng phẩm' });
    expect(procedureValueFor(attr('ngay_hach_toan', 'date') as never, facts)).toEqual({ type: 'date', value: '2026-10-14' });
    expect(procedureValueFor(attr('loai_phieu', 'text') as never, facts)).toEqual({ type: 'text', value: 'Phiếu chi' });
  });

  it('hạch toán nội bộ và dự án điền theo nhãn dự án/công việc', () => {
    expect(procedureValueFor(attr('hach_toan_noi_bo', 'text') as never, facts)).toEqual({ type: 'text', value: 'CV-12 - Lắp đặt tủ điện (DA001)' });
    expect(procedureValueFor(attr('DU_AN', 'text') as never, facts)).toEqual({ type: 'text', value: 'DA001 - Trạm biến áp Đà Nẵng' });
    // Phiếu chưa hạch toán: không có giá trị để điền.
    expect(procedureValueFor(attr('du_an', 'text') as never, { ...facts, allocationLabel: null, projectLabel: null })).toBeNull();
  });

  it('sai kiểu hoặc mã lạ hoặc phiếu không có giá trị thì không điền', () => {
    expect(procedureValueFor(attr('so_tien', 'text') as never, facts)).toBeNull();
    expect(procedureValueFor(attr('noi_dung', 'number') as never, facts)).toBeNull();
    expect(procedureValueFor(attr('so_hop_dong', 'text') as never, facts)).toBeNull();
    expect(procedureValueFor(attr('tai_khoan_dich', 'text') as never, facts)).toBeNull();
  });

  it('danh sách chọn chỉ điền khi có đúng lựa chọn (theo mã hoặc nhãn)', () => {
    const options = [{ code: 'CHI', label: 'Phiếu chi' }, { code: 'THU', label: 'Phiếu thu' }];
    expect(procedureValueFor(attr('loai_phieu', 'select', false, options) as never, facts)).toEqual({ type: 'select', value: 'CHI' });
    expect(procedureValueFor(attr('loai_phieu', 'select', false, [{ code: 'KHAC', label: 'Khác' }]) as never, facts)).toBeNull();
  });

  it('gom thuộc tính cấp quy trình và của bước đầu; báo thuộc tính bắt buộc còn thiếu', () => {
    const def = definition([attr('so_tien', 'money', true), attr('so_hop_dong', 'text', true)], [attr('ly_do', 'text', true), attr('ghi_chu_rieng', 'text', false)]);
    expect(initialProcedureAttributes(def).map((s) => s.valueKey)).toEqual(['process:so_tien', 'process:so_hop_dong', 'step:first:ly_do', 'step:first:ghi_chu_rieng']);
    const plan = planProcedureAttributes(def, facts);
    expect(plan.values).toEqual({
      'process:so_tien': { type: 'money', value: 1_500_000 },
      'step:first:ly_do': { type: 'text', value: 'Văn phòng phẩm' },
    });
    expect(plan.missingRequired.map((s) => s.code)).toEqual(['so_hop_dong']);
    expect(unsupportedRequiredAttributes(def).map((s) => s.code)).toEqual(['so_hop_dong']);
  });

  it('thuộc tính không bắt buộc mà Tài chính không điền được thì bỏ qua, không chặn', () => {
    const def = definition([attr('so_hop_dong', 'text', false)]);
    expect(planProcedureAttributes(def, facts)).toEqual({ values: {}, missingRequired: [] });
    expect(unsupportedRequiredAttributes(def)).toEqual([]);
  });

  it('tiêu đề hồ sơ gồm loại phiếu, mã và nội dung, cắt ở 255 ký tự', () => {
    expect(procedureTitle(facts)).toBe('Phiếu chi PC_12_10_2026 - Chi văn phòng phẩm');
    expect(procedureTitle({ ...facts, content: 'x'.repeat(400) })).toHaveLength(255);
  });

  it('cảnh báo khi bước đầu không chỉ có vai S của người lập', () => {
    expect(startStepWarnings(definition([]))).toEqual([]);
    expect(startStepWarnings(definition([], [], ['S', 'R']))[0]).toContain('không chỉ có vai S');
    expect(startStepWarnings({ id: 'x', steps: [], attributes: [], gateways: [] } as unknown as ProcedureDefinition)[0]).toContain('chưa có bước nào');
  });
});
