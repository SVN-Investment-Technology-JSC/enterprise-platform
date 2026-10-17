/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { financeFetch } from '../finance-api';
import { NoteView } from './note-view';

jest.mock('../finance-api', () => ({ financeFetch: jest.fn() }));
const fetchMock = financeFetch as jest.MockedFunction<typeof financeFetch>;

describe('NoteView', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hiện HTML thuần không có ảnh mà không gọi API', () => {
    render(<NoteView voucherId="v1" html="<p>Ghi chú nội bộ</p>" />);
    expect(screen.getByText('Ghi chú nội bộ')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolve ảnh theo marker thành URL tải xuống ký sẵn', async () => {
    fetchMock.mockResolvedValue({ fileName: 'a.png', url: 'https://storage.test/a.png' } as never);
    const { container } = render(
      <NoteView voucherId="v1" html='<p>Xem ảnh</p><img src="voucher-note-image://aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee">' />,
    );
    await waitFor(() => expect(container.querySelector('img')?.src).toBe('https://storage.test/a.png'));
    expect(fetchMock).toHaveBeenCalledWith('/vouchers/v1/attachments/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/download');
  });
});
