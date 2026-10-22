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

  it('từ chối không cần lý do nhưng vẫn qua popup xác nhận', async () => {
    const onAction = jest.fn().mockResolvedValue(undefined);
    render(<ProcedureActionBar onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Từ chối' }));
    expect(onAction).not.toHaveBeenCalled();
    const confirms = await screen.findAllByRole('button', { name: 'Từ chối' });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('REJECT', ''));
  });

  it('từ chối kèm lý do thì gửi lý do', async () => {
    const onAction = jest.fn().mockResolvedValue(undefined);
    render(<ProcedureActionBar onAction={onAction} />);
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
