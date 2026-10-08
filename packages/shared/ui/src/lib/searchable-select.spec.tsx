import { fireEvent, render, screen } from '@testing-library/react';
import { SearchableSelect } from './searchable-select';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

describe('SearchableSelect Escape handling', () => {
  it('closes only the dropdown and hides Escape from outer dialog listeners', () => {
    const outerEscape = jest.fn();
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') outerEscape();
    };
    // Giả lập Dialog nghe Esc ở pha capture trên document.
    document.addEventListener('keydown', onDocKey, true);
    render(<SearchableSelect options={options} value="a" />);
    const input = screen.getByRole('textbox');
    fireEvent.click(input);
    expect(screen.queryByRole('listbox')).not.toBeNull();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(outerEscape).not.toHaveBeenCalled();

    // Dropdown đã đóng: Esc đi tiếp tới Dialog như bình thường.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(outerEscape).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', onDocKey, true);
  });
});
