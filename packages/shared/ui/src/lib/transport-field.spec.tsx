import { fireEvent, render, screen } from '@testing-library/react';
import {
  EMPTY_TRANSPORT,
  TransportField,
  overlappingSlot,
  toTransportPayload,
  transportError,
  type TransportAvailability,
  type TransportFieldValue,
} from './transport-field';

const RANGE = { startAt: '2026-11-10T01:00:00.000Z', endAt: '2026-11-10T09:00:00.000Z' };
const AVAILABILITY: TransportAvailability = {
  vehicles: [
    { id: 'v1', plateNo: '51A-111.11', name: 'Innova', seats: 7, busy: [] },
    {
      id: 'v2',
      plateNo: '51A-222.22',
      name: 'Transit',
      seats: 16,
      busy: [{ startAt: '2026-11-10T08:00:00.000Z', endAt: '2026-11-10T12:00:00.000Z', sourceLabel: 'Đơn công tác: Hà Nội' }],
    },
  ],
  drivers: [{ id: 'd1', employeeName: 'Nguyễn Văn A', busy: [] }],
};

describe('overlappingSlot', () => {
  const slot = { startAt: '2026-11-10T08:00:00.000Z', endAt: '2026-11-10T12:00:00.000Z', sourceLabel: null };
  it('trả về khoảng bận chồng lên khung giờ, sát biên thì không chồng', () => {
    expect(overlappingSlot([slot], RANGE)).toBe(slot);
    expect(overlappingSlot([slot], { startAt: '2026-11-10T00:00:00.000Z', endAt: '2026-11-10T08:00:00.000Z' })).toBeUndefined();
    expect(overlappingSlot([slot], { startAt: '2026-11-10T12:00:00.000Z', endAt: '2026-11-10T13:00:00.000Z' })).toBeUndefined();
  });
  it('khung giờ chưa hợp lệ thì không có khoảng bận nào', () => {
    expect(overlappingSlot([slot], null)).toBeUndefined();
    expect(overlappingSlot([slot], { startAt: RANGE.endAt, endAt: RANGE.startAt })).toBeUndefined();
  });
});

describe('transportError và toTransportPayload', () => {
  const company: TransportFieldValue = { mode: 'COMPANY_VEHICLE', detail: '', vehicleId: 'v1', driverId: 'd1' };
  it('chưa chọn phương tiện thì hợp lệ và không gửi gì', () => {
    expect(transportError(EMPTY_TRANSPORT, null)).toBeNull();
    expect(toTransportPayload(EMPTY_TRANSPORT, RANGE)).toBeNull();
  });
  it('xe công ty cần giờ, xe và tài xế', () => {
    expect(transportError(company, null)).toMatch(/giờ đi/);
    expect(transportError({ ...company, vehicleId: '' }, RANGE)).toMatch(/xe công ty/i);
    expect(transportError({ ...company, driverId: '' }, RANGE)).toMatch(/tài xế/i);
    expect(transportError(company, RANGE)).toBeNull();
    expect(toTransportPayload(company, RANGE, 'Hà Nội')).toEqual({
      mode: 'COMPANY_VEHICLE',
      vehicleId: 'v1',
      driverId: 'd1',
      startAt: RANGE.startAt,
      endAt: RANGE.endAt,
      destination: 'Hà Nội',
    });
  });
  it('phương tiện ngoài chỉ ghi loại phương tiện', () => {
    const external: TransportFieldValue = { mode: 'EXTERNAL', detail: ' Máy bay ', vehicleId: '', driverId: '' };
    expect(transportError({ ...external, detail: '' }, null)).toMatch(/loại phương tiện/);
    expect(toTransportPayload(external, RANGE)).toEqual({ mode: 'EXTERNAL', detail: 'Máy bay' });
  });
});

describe('TransportField', () => {
  it('xe bận trong khung giờ bị làm mờ kèm lý do, xe trống chọn được', () => {
    const onChange = jest.fn();
    render(
      <TransportField
        value={{ mode: 'COMPANY_VEHICLE', detail: '', vehicleId: '', driverId: '' }}
        onChange={onChange}
        range={RANGE}
        availability={AVAILABILITY}
      />,
    );
    fireEvent.click(screen.getAllByRole('textbox')[1]);
    const busy = screen.getByText(/51A-222\.22/).closest('[role="option"]') as HTMLElement;
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/Bận .*Đơn công tác: Hà Nội/)).toBeTruthy();
    fireEvent.click(screen.getByText(/51A-111\.11/));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ vehicleId: 'v1' }));
  });

  it('chưa có khung giờ thì chưa chọn được xe và tài xế', () => {
    render(
      <TransportField
        value={{ mode: 'COMPANY_VEHICLE', detail: '', vehicleId: '', driverId: '' }}
        onChange={jest.fn()}
        range={null}
        availability={AVAILABILITY}
      />,
    );
    expect((screen.getAllByRole('textbox')[1] as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/giờ đi/);
  });

  it('đổi phương thức thì xoá lựa chọn xe và tài xế cũ', () => {
    const onChange = jest.fn();
    render(
      <TransportField
        value={{ mode: 'COMPANY_VEHICLE', detail: '', vehicleId: 'v1', driverId: 'd1' }}
        onChange={onChange}
        range={RANGE}
        availability={AVAILABILITY}
      />,
    );
    fireEvent.click(screen.getAllByRole('textbox')[0]);
    fireEvent.click(screen.getByText(/Phương tiện ngoài/));
    expect(onChange).toHaveBeenCalledWith({ mode: 'EXTERNAL', detail: '', vehicleId: '', driverId: '' });
  });
});
