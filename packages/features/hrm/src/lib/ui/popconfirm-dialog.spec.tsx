/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { Popconfirm } from '@enterprise-platform/shared-ui';

it('keeps confirmation controls within their modal interaction boundary', () => {
  const confirm = jest.fn();
  render(
    <div role="dialog" aria-label="Edit calendar">
      <Popconfirm title="Remove mock day?" onConfirm={confirm}>
        <button type="button">Remove</button>
      </Popconfirm>
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  const popup = screen.getByText('Remove mock day?');
  expect(screen.getByRole('dialog').contains(popup)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect(confirm).toHaveBeenCalledTimes(1);
});
