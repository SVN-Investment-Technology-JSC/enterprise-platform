import { businessTripDetails } from './hrm-trip-details';

const row = {
  business_trip_type: 'DOMESTIC',
  destination: 'Kon Tum',
  from_date: '2026-11-17',
  to_date: '2026-11-19',
  from_at: '2026-11-17T00:30:00.000Z',
  to_at: '2026-11-19T10:00:00.000Z',
  days_count: '3.00',
  reason_name: 'Công tác theo kế hoạch',
  reason: 'Khảo sát hiện trường',
  allow_ot: false,
  transport_mode: null,
  transport_detail: null,
};

const valueOf = (details: ReturnType<typeof businessTripDetails>, label: string) =>
  details.find((entry) => entry.label === label)?.value;

describe('businessTripDetails', () => {
  it('dịch các cột của đơn thành nhãn tiếng Việt, giờ theo múi giờ Việt Nam', () => {
    const details = businessTripDetails(row);
    expect(valueOf(details, 'Hình thức công tác')).toBe('Công tác trong nước (Nội địa)');
    expect(valueOf(details, 'Địa điểm công tác')).toBe('Kon Tum');
    expect(valueOf(details, 'Từ')).toBe('17/11/2026 07:30');
    expect(valueOf(details, 'Đến')).toBe('19/11/2026 17:00');
    expect(valueOf(details, 'Số ngày công tác')).toBe('3 ngày');
    expect(valueOf(details, 'Lý do')).toBe('Công tác theo kế hoạch');
    expect(valueOf(details, 'Nội dung công việc')).toBe('Khảo sát hiện trường');
    expect(valueOf(details, 'Cho phép làm thêm giờ')).toBe('Không');
  });

  it('đơn gửi theo cách cũ (không có giờ) dùng ngày', () => {
    const details = businessTripDetails({ ...row, from_at: null, to_at: null });
    expect(valueOf(details, 'Từ')).toBe('17/11/2026');
    expect(valueOf(details, 'Đến')).toBe('19/11/2026');
  });

  it('bỏ trường trống, không có dòng rỗng', () => {
    const details = businessTripDetails({ ...row, reason_name: null, reason: '  ' });
    expect(details.some((entry) => entry.label === 'Lý do')).toBe(false);
    expect(details.some((entry) => entry.label === 'Nội dung công việc')).toBe(false);
    expect(details.every((entry) => entry.value.length > 0)).toBe(true);
  });

  it('phương tiện: xe công ty, hoặc phương tiện ngoài kèm chi tiết', () => {
    expect(valueOf(businessTripDetails({ ...row, transport_mode: 'COMPANY_VEHICLE' }), 'Phương tiện di chuyển')).toBe(
      'Xe công ty',
    );
    expect(
      valueOf(
        businessTripDetails({ ...row, transport_mode: 'EXTERNAL', transport_detail: 'Máy bay' }),
        'Phương tiện di chuyển',
      ),
    ).toBe('Máy bay');
  });

  it('phụ phí dự trù và các thuộc tính của form', () => {
    const details = businessTripDetails(row, {
      destinationAddress: '12 Phan Đình Phùng',
      workDepartment: 'Khối Kỹ thuật',
      requiredFinger: true,
      surcharges: [
        { name: 'Vé máy bay', amount: 1500000 },
        { name: 'Khách sạn', amount: 0 },
        { name: '', amount: 0 },
      ],
      totalSurcharges: 1500000,
    });
    expect(valueOf(details, 'Địa chỉ cụ thể')).toBe('12 Phan Đình Phùng');
    expect(valueOf(details, 'Phòng ban công tác / cử đi')).toBe('Khối Kỹ thuật');
    expect(valueOf(details, 'Yêu cầu chấm vân tay')).toBe('Có');
    expect(valueOf(details, 'Phụ phí dự trù')).toBe('Vé máy bay: 1.500.000 đ; Khách sạn');
    expect(valueOf(details, 'Tổng phụ phí dự trù')).toBe('1.500.000 đ');
  });

  it('đơn đặt hộ ghi rõ người đặt và lý do', () => {
    const details = businessTripDetails({
      ...row,
      created_on_behalf: true,
      on_behalf_by_name: 'Tài Búa',
      on_behalf_reason: 'Nhân viên đi công tác gấp',
    });
    expect(valueOf(details, 'Đặt hộ')).toBe('Tài Búa — Nhân viên đi công tác gấp');
  });
});
