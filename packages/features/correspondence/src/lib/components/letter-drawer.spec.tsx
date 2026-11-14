/**
 * @jest-environment jsdom
 */
import type { CorrespondenceConfig } from '@enterprise-platform/contracts-correspondence';
import { fireEvent, render, screen } from '@testing-library/react';
import { loadLetter } from '../correspondence-api';
import { LetterDrawer } from './letter-drawer';

jest.mock('../correspondence-api', () => ({
  ...jest.requireActual('../correspondence-api'),
  loadLetter: jest.fn(),
}));

const loadLetterMock = loadLetter as jest.MockedFunction<typeof loadLetter>;

function open() {
  const onClose = jest.fn();
  render(
    <LetterDrawer
      letterId="letter-1"
      config={{} as CorrespondenceConfig}
      onClose={onClose}
      onChanged={jest.fn()}
      onOpenLetter={jest.fn()}
    />,
  );
  const drawer = screen.getByRole('dialog', { name: 'Chi tiết công văn' });
  const backdrop = drawer.parentElement as HTMLElement;
  return { onClose, drawer, backdrop };
}

describe('LetterDrawer', () => {
  beforeEach(() => {
    // Chưa tải xong: ngăn vẫn có đầu ngăn và nút đóng.
    loadLetterMock.mockReturnValue(new Promise(() => undefined));
  });

  it('closes when clicking the dimmed area outside the drawer', () => {
    const { onClose, backdrop } = open();
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open for clicks inside the drawer or a drag that ends outside it', () => {
    const { onClose, drawer, backdrop } = open();
    fireEvent.mouseDown(drawer);
    fireEvent.click(drawer);
    // Kéo chọn chữ từ trong ngăn ra ngoài: nhấn trong, thả ngoài.
    fireEvent.mouseDown(drawer);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes with the close button', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
