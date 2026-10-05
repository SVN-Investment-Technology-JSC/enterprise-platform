/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProcedureActionBar } from './procedure-action-bar';

describe('ProcedureActionBar', () => {
  it('duyệt qua Popconfirm không cần lý do', async () => {
    const onAction = jest.fn().mockResolvedValue(undefined);
    render(<ProcedureActionBar onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: /Duyệt/ }));
    const confirms = await screen.findAllByRole('button', { name: /Duyệt/ });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('APPROVE', ''));
  });

  it('từ chối bị khóa đến khi nhập lý do, rồi gửi kèm lý do', async () => {
    const onAction = jest.fn().mockResolvedValue(undefined);
    render(<ProcedureActionBar onAction={onAction} />);
    expect(
      (screen.getByRole('button', { name: 'Từ chối' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Ý kiến / Lý do xử lý'), {
      target: { value: 'Thiếu chứng từ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Từ chối' }));
    const confirms = await screen.findAllByRole('button', { name: 'Từ chối' });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith('REJECT', 'Thiếu chứng từ'),
    );
  });
});
