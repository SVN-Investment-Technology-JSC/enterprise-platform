import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Popconfirm } from './popconfirm';

describe('Popconfirm typed confirmation', () => {
  it('requires a matching value and passes the actual input to the destructive action', async () => {
    const confirm = jest.fn().mockResolvedValue(undefined);
    render(
      <Popconfirm
        title="Xóa tenant?"
        confirmInput={{ requiredText: 'tenant-a', label: 'Mã tenant' }}
        onConfirm={confirm}
        okText="Xác nhận xóa"
      >
        <button>Xóa</button>
      </Popconfirm>,
    );
    fireEvent.click(screen.getByText('Xóa'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('Xác nhận xóa'));
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'tenant-a' } });
    fireEvent.click(screen.getByText('Xác nhận xóa'));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('tenant-a'));
  });
});
