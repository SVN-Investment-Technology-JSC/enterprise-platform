import type { DragEvent as ReactDragEvent } from 'react';
import { fileDropHandlers, guardWindowFileDrop, readDrop } from './file-drop';

/** Mục tệp như `webkitGetAsEntry()` trả về; đọc tệp bất đồng bộ như trình duyệt. */
const fileEntry = (fullPath: string) =>
  ({
    isFile: true,
    isDirectory: false,
    name: fullPath.split('/').pop(),
    fullPath,
    file: (resolve: (file: File) => void) => setTimeout(() => resolve(new File(['x'], fullPath.split('/').pop() ?? '')), 0),
  }) as unknown as FileSystemEntry;

/** Mục thư mục; `readEntries` trả từng lô `batch` mục như Chrome, hết thì trả lô rỗng. */
const dirEntry = (fullPath: string, children: FileSystemEntry[], batch = 100) =>
  ({
    isFile: false,
    isDirectory: true,
    name: fullPath.split('/').pop(),
    fullPath,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
          const slice = children.slice(offset, offset + batch);
          offset += slice.length;
          setTimeout(() => resolve(slice), 0);
        },
      };
    },
  }) as unknown as FileSystemEntry;

const transfer = (entries: (FileSystemEntry | null)[], files: File[] = []) =>
  ({
    items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })),
    files,
    types: ['Files'],
  }) as unknown as DataTransfer;

describe('readDrop', () => {
  it('đọc đệ quy thư mục thả vào, kể cả thư mục rỗng và thư mục nhiều hơn một lô', async () => {
    const many = Array.from({ length: 150 }, (_, index) => fileEntry(`/Hồ sơ/2026/HĐ${index + 1}.pdf`));
    const tree = dirEntry('/Hồ sơ', [
      fileEntry('/Hồ sơ/a.pdf'),
      dirEntry('/Hồ sơ/Trống', []),
      dirEntry('/Hồ sơ/2026', many),
    ]);

    const entries = await readDrop(transfer([tree, fileEntry('/lẻ.pdf')]));

    expect(entries).toHaveLength(155);
    expect(entries.filter((entry) => !entry.file).map((entry) => entry.path).sort()).toEqual([
      'Hồ sơ',
      'Hồ sơ/2026',
      'Hồ sơ/Trống',
    ]);
    expect(entries.filter((entry) => entry.path.startsWith('Hồ sơ/2026/'))).toHaveLength(150);
    expect(entries.find((entry) => entry.path === 'lẻ.pdf')?.file?.name).toBe('lẻ.pdf');
  });

  it('trình duyệt không cho đọc thư mục: lấy các tệp lẻ', async () => {
    const loose = new File(['x'], 'a.pdf');
    expect(await readDrop(transfer([null], [loose]))).toEqual([{ file: loose, path: 'a.pdf' }]);
  });
});

interface FakeDrag {
  readonly dataTransfer: { readonly types: string[]; dropEffect: string };
  defaultPrevented: boolean;
  propagationStopped: boolean;
  readonly relatedTarget: unknown;
  readonly currentTarget: { readonly contains: (node: unknown) => boolean };
  readonly preventDefault: () => void;
  readonly stopPropagation: () => void;
}

/** Phần tử con của vùng thả trong các sự kiện giả. */
const INSIDE = {};

/** Sự kiện kéo tối giản cho bộ xử lý; `relatedTarget` là chỗ con trỏ vừa sang. */
function dragEvent(types: string[], relatedTarget: unknown = null) {
  const event: FakeDrag = {
    dataTransfer: { types, dropEffect: 'none' },
    defaultPrevented: false,
    propagationStopped: false,
    relatedTarget,
    currentTarget: { contains: (node) => node === INSIDE },
    preventDefault: () => {
      event.defaultPrevented = true;
    },
    stopPropagation: () => {
      event.propagationStopped = true;
    },
  };
  return { event, react: event as unknown as ReactDragEvent<HTMLDivElement> };
}

describe('fileDropHandlers', () => {
  const setup = (accept: boolean) => {
    const onHover = jest.fn();
    const onDrop = jest.fn();
    return { onHover, onDrop, handlers: fileDropHandlers<HTMLDivElement>({ accept: () => accept, onHover, onDrop }) };
  };

  it('nhận tệp thả vào: chặn trình duyệt mở tệp, không để vùng ngoài nhận lần nữa, tô viền khi kéo ngang qua', () => {
    const { onHover, onDrop, handlers } = setup(true);
    const over = dragEvent(['Files']);
    handlers.onDragOver(over.react);
    expect(over.event).toMatchObject({ defaultPrevented: true, propagationStopped: true });
    expect(over.event.dataTransfer.dropEffect).toBe('copy');
    expect(onHover).toHaveBeenLastCalledWith(true);

    const drop = dragEvent(['Files']);
    handlers.onDrop(drop.react);
    expect(onDrop).toHaveBeenCalledWith(drop.event.dataTransfer);
    expect(onHover).toHaveBeenLastCalledWith(false);
  });

  it('vùng không nhận (không có quyền ghi) để sự kiện đi tiếp ra vùng ngoài', () => {
    const { onHover, onDrop, handlers } = setup(false);
    const drop = dragEvent(['Files']);
    handlers.onDragOver(drop.react);
    handlers.onDrop(drop.react);
    expect(drop.event).toMatchObject({ defaultPrevented: false, propagationStopped: false });
    expect(onHover).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('kéo chữ, kéo phần tử trong trang thì bỏ qua', () => {
    const { onDrop, handlers } = setup(true);
    const drop = dragEvent(['text/plain']);
    handlers.onDrop(drop.react);
    expect(drop.event.defaultPrevented).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('sang phần tử con vẫn giữ viền; ra khỏi vùng thì bỏ viền', () => {
    const { onHover, handlers } = setup(true);
    handlers.onDragLeave(dragEvent(['Files'], INSIDE).react);
    expect(onHover).not.toHaveBeenCalled();
    handlers.onDragLeave(dragEvent(['Files']).react);
    expect(onHover).toHaveBeenCalledWith(false);
  });
});

describe('guardWindowFileDrop', () => {
  it('chặn thả tệp ra ngoài vùng nhận (trình duyệt sẽ mở tệp, rời trang), không đụng tới kéo chữ', () => {
    const target = new EventTarget();
    const stop = guardWindowFileDrop(target as unknown as Window);
    const fire = (type: string, types: string[]) => {
      const event = new Event(type, { cancelable: true });
      const dataTransfer = { types, dropEffect: 'copy' };
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      target.dispatchEvent(event);
      return { prevented: event.defaultPrevented, dropEffect: dataTransfer.dropEffect };
    };

    expect(fire('dragover', ['Files'])).toEqual({ prevented: true, dropEffect: 'none' });
    expect(fire('drop', ['Files']).prevented).toBe(true);
    expect(fire('dragover', ['text/plain'])).toEqual({ prevented: false, dropEffect: 'copy' });

    stop();
    expect(fire('dragover', ['Files']).prevented).toBe(false);
  });
});
