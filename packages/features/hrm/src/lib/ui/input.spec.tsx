/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { Input } from './input';

describe('HRM date and time inputs', () => {
  it.each([
    ['date', '2026-09-28'],
    ['month', '2026-09'],
    ['time', '08:30'],
    ['datetime-local', '2026-09-28T08:30'],
  ])('preserves the existing %s value when opening the field', (type, value) => {
    render(<Input aria-label="Ngày hiệu lực" type={type} defaultValue={value} />);
    const input = screen.getByLabelText('Ngày hiệu lực') as HTMLInputElement;
    fireEvent.click(input);
    expect(input.value).toBe(value);
  });
});
