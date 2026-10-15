/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { financeFetch } from '../finance-api';
import OpenLinkScreen from './open-link-screen';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: mockReplace, push: jest.fn() }) }));
jest.mock('../finance-api', () => {
  const actual = jest.requireActual('../finance-api');
  return { ...actual, financeFetch: jest.fn() };
});
const fetchMock = financeFetch as jest.MockedFunction<typeof financeFetch>;

beforeEach(() => jest.clearAllMocks());

describe('Mở phiếu từ hồ sơ quy trình', () => {
  it('đổi id lần gửi thành phiếu rồi chuyển tới trang chi tiết đúng loại', async () => {
    fetchMock.mockResolvedValue({ id: 'v9', kind: 'PAYMENT' } as never);
    render(<OpenLinkScreen linkId="link-1" />);
    expect(screen.getByRole('status').textContent).toContain('Đang mở phiếu');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/payments/v9'));
    expect(fetchMock).toHaveBeenCalledWith('/vouchers/by-link/link-1');
  });

  it('không tìm thấy hoặc không có quyền xem thì báo rõ và không chuyển trang', async () => {
    fetchMock.mockRejectedValue(new Error('Không tìm thấy phiếu.'));
    render(<OpenLinkScreen linkId="x" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Không tìm thấy phiếu.');
    expect(alert.textContent).toContain('không có quyền xem');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
