import type { SharedDocumentSummary, SharedFolder } from '@enterprise-platform/contracts-shared';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FolderDrop } from '../file-drop';
import { ContentsTable, type ContentRow } from './contents-table';

const folder = (id: string, name: string): SharedFolder => ({
  id,
  parentId: 'current',
  name,
  depth: 1,
  isActive: true,
  documentCount: 0,
  totalDocumentCount: 0,
  totalBytes: 0,
  createdBy: 'u-1',
  createdAt: '2026-11-05T00:00:00Z',
  updatedAt: '2026-11-05T00:00:00Z',
});

const OPEN = folder('open', 'Hồ sơ');
const LOCKED = folder('locked', 'Chỉ xem');
const DOCUMENT = {
  id: 'doc-1',
  folderId: 'current',
  name: 'Biên bản',
  updatedAt: '2026-11-05T00:00:00Z',
} as SharedDocumentSummary;

const ROWS: ContentRow[] = [
  { type: 'folder', folder: OPEN },
  { type: 'folder', folder: LOCKED },
  { type: 'document', document: DOCUMENT },
];

/** Tệp kéo từ máy: jsdom không có DataTransfer, testing-library gắn thẳng đối tượng này vào sự kiện. */
const files = () => ({ types: ['Files'], dropEffect: 'none', items: [], files: [] });

function setup() {
  const drop: FolderDrop = {
    accepts: (target) => target?.id !== LOCKED.id,
    onDrop: jest.fn(),
  };
  render(
    <ContentsTable
      rows={ROWS}
      loading={false}
      showPath={false}
      label="Hồ sơ dự án"
      onSelect={jest.fn()}
      onOpenFolder={jest.fn()}
      onOpenDocument={jest.fn()}
      onRowMenu={jest.fn()}
      onBlankMenu={() => false}
      drop={drop}
    />,
  );
  const row = (name: string) => screen.getByText(name).closest('[role="row"]') as HTMLElement;
  return { drop, panel: screen.getByRole('region', { name: 'Hồ sơ dự án' }), row };
}

describe('ContentsTable – kéo thả tệp từ máy', () => {
  it('thả lên dòng thư mục: vào đúng thư mục đó, chỉ dòng đó sáng viền', () => {
    const { drop, panel, row } = setup();
    fireEvent.dragOver(row('Hồ sơ'), { dataTransfer: files() });
    expect(row('Hồ sơ').getAttribute('data-drop')).toBe('true');
    expect(panel.getAttribute('data-drop')).toBeNull();

    const dataTransfer = files();
    fireEvent.drop(row('Hồ sơ'), { dataTransfer });
    expect(drop.onDrop).toHaveBeenCalledTimes(1);
    expect(drop.onDrop).toHaveBeenCalledWith(OPEN, dataTransfer);
    expect(row('Hồ sơ').getAttribute('data-drop')).toBeNull();
  });

  it('thả lên dòng tài liệu, chỗ trống, hay thư mục không có quyền ghi: vào thư mục đang mở', () => {
    const { drop, panel, row } = setup();
    fireEvent.dragOver(row('Chỉ xem'), { dataTransfer: files() });
    expect(row('Chỉ xem').getAttribute('data-drop')).toBeNull();
    expect(panel.getAttribute('data-drop')).toBe('true');

    fireEvent.drop(row('Chỉ xem'), { dataTransfer: files() });
    fireEvent.drop(row('Biên bản'), { dataTransfer: files() });
    fireEvent.drop(panel, { dataTransfer: files() });
    expect((drop.onDrop as jest.Mock).mock.calls.map(([target]) => target)).toEqual([undefined, undefined, undefined]);
  });

  it('kéo chữ thì không nhận', () => {
    const { drop, panel } = setup();
    fireEvent.drop(panel, { dataTransfer: { types: ['text/plain'] } });
    expect(drop.onDrop).not.toHaveBeenCalled();
  });
});
