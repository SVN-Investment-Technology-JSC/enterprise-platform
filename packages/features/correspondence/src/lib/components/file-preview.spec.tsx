/**
 * @jest-environment jsdom
 */
import type { LetterAttachment } from '@enterprise-platform/contracts-correspondence';
import { fireEvent, render, screen } from '@testing-library/react';
import JSZip from 'jszip';
import { attachmentTicket } from '../correspondence-api';
import { readDeck, resolvePart } from '../pptx-preview';
import { FilePreview } from './file-preview';

jest.mock('../correspondence-api', () => ({
  ...jest.requireActual('../correspondence-api'),
  attachmentTicket: jest.fn(),
  downloadAttachment: jest.fn(),
}));

const ticket = attachmentTicket as jest.MockedFunction<typeof attachmentTicket>;

function file(fileName: string, contentType: string): LetterAttachment {
  return {
    id: 'file-1',
    kind: 'incoming',
    fileName,
    contentType,
    sizeBytes: 10,
    versionNo: 2,
    uploadedBy: 'u',
    createdAt: '2026-11-13T00:00:00.000Z',
    canDelete: false,
    canVersion: false,
  };
}

// jsdom thiếu một số API của trình duyệt: lấy từ Node cho test.
if (typeof globalThis.TextDecoder === 'undefined') {
  const util = jest.requireActual('node:util') as typeof import('node:util');
  Object.assign(globalThis, { TextDecoder: util.TextDecoder, TextEncoder: util.TextEncoder });
}

/** Phản hồi giả của kho tệp (URL ký sẵn) với nội dung chữ. */
function respond(body: string) {
  const bytes = new TextEncoder().encode(body);
  const blob = {
    size: bytes.byteLength,
    slice: (start: number, end: number) => ({ text: async () => new TextDecoder().decode(bytes.slice(start, end)) }),
  };
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    blob: async () => blob,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  ticket.mockImplementation(async (_letter, _id, mode) => ({
    downloadUrl: `https://files.example/${mode}`,
    expiresInSeconds: 60,
    fileName: 'x',
    contentType: '',
  }));
});

describe('Xem trước tệp ngay trong trang', () => {
  it('văn bản thuần hiện nội dung, lấy URL ở chế độ xem', async () => {
    respond('Dòng 1\nDòng 2');
    render(<FilePreview target={{ letterId: 'l1', file: file('ghi-chu.txt', 'text/plain') }} onClose={jest.fn()} />);
    expect(await screen.findByText(/Dòng 1/)).toBeTruthy();
    expect(ticket).toHaveBeenCalledWith('l1', 'file-1', 'preview');
    expect(screen.getByText(/Phiên bản 2/)).toBeTruthy();
  });

  it('bảng tính hiện thành bảng có tên cột A, B, C', async () => {
    respond('Mã,Tên,Số lượng\nVT01,Xi măng,20');
    render(<FilePreview target={{ letterId: 'l1', file: file('vat-tu.csv', 'text/csv') }} onClose={jest.fn()} />);
    expect(await screen.findByText('Xi măng')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'C' })).toBeTruthy();
  });

  it('định dạng đời cũ báo tải xuống; Esc đóng khung xem', async () => {
    const onClose = jest.fn();
    render(<FilePreview target={{ letterId: 'l1', file: file('cu.doc', 'application/msword') }} onClose={onClose} />);
    expect(await screen.findByText(/chưa xem trực tiếp được/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Đọc tệp trình chiếu (.pptx)', () => {
  it('đọc khổ trang, thứ tự trang, khung chữ, bảng; chỗ dành sẵn lấy vị trí từ bố cục', async () => {
    const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const zip = new JSZip();
    zip.file(
      'ppt/presentation.xml',
      `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
    );
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="x/slide" Target="slides/slide2.xml"/><Relationship Id="rId2" Type="x/slide" Target="slides/slide1.xml"/></Relationships>`,
    );
    zip.file(
      'ppt/slides/slide1.xml',
      `<p:sld ${P}><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:p><a:r><a:rPr b="1"/><a:t>Báo cáo quý IV</a:t></a:r></a:p></p:txBody></p:sp>
        <p:graphicFrame><p:xfrm><a:off x="0" y="1000000"/><a:ext cx="4000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Doanh thu</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>120</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
      </p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="x/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    );
    zip.file(
      'ppt/slideLayouts/slideLayout1.xml',
      `<p:sldLayout ${P}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`,
    );
    zip.file(
      'ppt/slides/slide2.xml',
      `<p:sld ${P}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm></p:spPr><p:txBody><a:p><a:pPr algn="ctr"><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="2400"/><a:t>Trang hai</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const deck = await readDeck(await zip.generateAsync({ type: 'arraybuffer' }));
    expect([deck.width, deck.height, deck.total]).toEqual([9144000, 5143500, 2]);
    const [first, second] = deck.slides;
    expect(first[0]).toMatchObject({ kind: 'text', title: true, x: 100, y: 200, w: 300, h: 400 });
    expect(first[1]).toMatchObject({ kind: 'table', rows: [['Doanh thu', '120']] });
    expect(second[0]).toMatchObject({
      kind: 'text',
      paragraphs: [{ align: 'center', bullet: true, runs: [{ text: 'Trang hai', sizePt: 24 }] }],
    });
    deck.dispose();
  });

  it('giải đường dẫn tương đối của quan hệ giữa các phần trong tệp', () => {
    expect(resolvePart('ppt/slides/slide1.xml', '../media/image1.png')).toBe('ppt/media/image1.png');
    expect(resolvePart('ppt/presentation.xml', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml');
    expect(resolvePart('ppt/slides/slide1.xml', '/ppt/media/a.png')).toBe('ppt/media/a.png');
  });
});
