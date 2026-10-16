import { INSTANCE_SOURCE_FILTER_OPTIONS, matchesInstanceSource } from './instance-source-filter';

describe('bộ lọc Nguồn của Hồ sơ xử lý', () => {
  it('có lựa chọn cho hồ sơ từ HRM và Tài chính, nhãn theo tên nguồn ở chi tiết hồ sơ', () => {
    expect(INSTANCE_SOURCE_FILTER_OPTIONS).toEqual(
      expect.arrayContaining([
        { value: 'hrm_request', label: 'Đơn HRM' },
        { value: 'finance_voucher', label: 'Phiếu tài chính' },
      ]),
    );
    expect(INSTANCE_SOURCE_FILTER_OPTIONS[0]).toEqual({ value: 'all', label: 'Nguồn: Tất cả' });
  });

  it('chọn Đơn HRM hoặc Phiếu tài chính chỉ giữ hồ sơ đúng nguồn đó', () => {
    expect(matchesInstanceSource('hrm_request', 'hrm_request')).toBe(true);
    expect(matchesInstanceSource('finance_voucher', 'hrm_request')).toBe(false);
    expect(matchesInstanceSource('finance_voucher', 'finance_voucher')).toBe(true);
    expect(matchesInstanceSource('manual', 'finance_voucher')).toBe(false);
    expect(matchesInstanceSource(undefined, 'hrm_request')).toBe(false);
  });

  it('Tất cả giữ mọi hồ sơ; hồ sơ không ghi nguồn tính là Thủ công', () => {
    expect(matchesInstanceSource('workspace_work_item', 'all')).toBe(true);
    expect(matchesInstanceSource(undefined, 'all')).toBe(true);
    expect(matchesInstanceSource(undefined, 'manual')).toBe(true);
    expect(matchesInstanceSource('maintenance_occurrence', 'manual')).toBe(false);
  });
});
