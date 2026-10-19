/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { NoteEditor } from './note-editor';

describe('NoteEditor', () => {
  it('hiện thanh công cụ định dạng và nội dung ban đầu', async () => {
    render(<NoteEditor value="<p>Xin chào</p>" onChange={jest.fn()} />);
    expect(await screen.findByText('Xin chào')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'In đậm' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'In nghiêng' })).toBeTruthy();
  });

  it('dán ảnh khi phiếu chưa lưu thì báo lỗi, không chèn ảnh', async () => {
    const onProblem = jest.fn();
    render(<NoteEditor value="" onChange={jest.fn()} onProblem={onProblem} />);
    const editable = await screen.findByText('', { selector: '.finance-note-prose' });
    const file = new File(['x'], 'anh.png', { type: 'image/png' });
    const clipboardData = { files: [file], items: [], types: ['Files'], getData: () => '' };
    fireEvent.paste(editable, { clipboardData });
    expect(onProblem).toHaveBeenCalledWith('Lưu phiếu trước khi dán ảnh vào ghi chú.');
  });

  it('có onPasteImages: ảnh dán được chuyển cho nơi gọi, không báo lỗi và không chèn vào ghi chú', async () => {
    const onProblem = jest.fn();
    const onPasteImages = jest.fn();
    render(<NoteEditor value="" onChange={jest.fn()} onProblem={onProblem} onPasteImages={onPasteImages} />);
    const editable = await screen.findByText('', { selector: '.finance-note-prose' });
    const file = new File(['x'], 'image.png', { type: 'image/png' });
    fireEvent.paste(editable, { clipboardData: { files: [file], items: [], types: ['Files'], getData: () => '' } });
    expect(onPasteImages).toHaveBeenCalledWith([file]);
    expect(onProblem).not.toHaveBeenCalled();
    expect(editable.querySelector('img')).toBeNull();
  });

  it('tắt sửa khi disabled', () => {
    render(<NoteEditor value="<p>Khoá</p>" onChange={jest.fn()} disabled />);
    const editable = document.querySelector('.finance-note-prose') as HTMLElement;
    expect(editable.getAttribute('contenteditable')).toBe('false');
  });
});
