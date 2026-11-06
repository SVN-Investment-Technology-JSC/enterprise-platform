/**
 * @jest-environment node
 */
import * as docx from 'docx';
import { inflateRawSync } from 'node:zlib';
import { fixtureCustomer, fixtureDetail, fixtureFullLayout, fixtureLine, fixtureVersion, FIXTURE_XSS } from './quote-layout.fixtures';
import { buildQuoteLayoutData } from './quote-layout.data';
import { createQuoteDocument, loadDocx, mmToTwip, readImageSize } from './export-docx';

jest.mock('./quote-layout.module.scss', () => ({ __esModule: true, default: {} }));

/** Đọc các file trong một file zip (thư mục trung tâm), đủ cho file `.docx`. */
function unzip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('Không phải file zip');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Thư mục zip hỏng');
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressed);
    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const now = new Date(2026, 10, 6);

async function documentXml(layout = fixtureFullLayout(), data = buildQuoteLayoutData({ detail: fixtureDetail(), customer: fixtureCustomer(), now })) {
  const buffer = await docx.Packer.toBuffer(createQuoteDocument(docx, layout, data));
  const files = unzip(buffer);
  return { files, xml: files.get('word/document.xml')?.toString('utf8') ?? '', styles: files.get('word/styles.xml')?.toString('utf8') ?? '' };
}

describe('createQuoteDocument', () => {
  it('TC-EX-06: có chữ đã thay biến, bảng, ảnh và đủ các khối', async () => {
    const { xml, files } = await documentXml();
    expect(xml).toContain('BG2600001');
    expect(xml).toContain('Công ty A');
    expect(xml).toContain('TÊN CÔNG TY');
    expect(xml).toContain('BÁO GIÁ');
    expect(xml).toContain('Máy bơm');
    expect(xml).toContain('1.980.000');
    expect(xml).toContain('Một triệu chín trăm tám mươi nghìn đồng');
    expect(xml).toContain('ĐẠI DIỆN BÊN BÁN');
    expect(xml).not.toMatch(/\{\{[a-z]/);
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:tblHeader');
    expect(xml).toContain('<w:drawing>');
    expect([...files.keys()].some((name) => name.startsWith('word/media/'))).toBe(true);
    // Đường kẻ: viền dưới của đoạn.
    expect(xml).toMatch(/<w:pBdr><w:bottom w:val="single"/);
  });

  it('TC-EX-08: khổ, hướng, lề và font mặc định', async () => {
    const portrait = await documentXml();
    expect(portrait.xml).toContain(`<w:pgSz w:w="${mmToTwip(210)}" w:h="${mmToTwip(297)}" w:orient="portrait"/>`);
    expect(portrait.xml).toMatch(new RegExp(`<w:pgMar w:top="${mmToTwip(15)}" w:right="${mmToTwip(15)}" w:bottom="${mmToTwip(15)}" w:left="${mmToTwip(20)}"`));
    expect(portrait.styles).toContain('w:ascii="Times New Roman"');
    expect(portrait.styles).toContain('<w:sz w:val="24"/>');
    const landscape = await documentXml(fixtureFullLayout({ paper: 'A3', orientation: 'landscape', fontFamily: 'Arial', fontSizePt: 10 }));
    expect(landscape.xml).toContain(`<w:pgSz w:w="${mmToTwip(420)}" w:h="${mmToTwip(297)}" w:orient="landscape"/>`);
    expect(landscape.styles).toContain('w:ascii="Arial"');
    expect(landscape.styles).toContain('<w:sz w:val="20"/>');
  });

  it('TC-EX-09: ảnh giữ tỉ lệ, chiều cao theo heightMm', async () => {
    const { xml } = await documentXml();
    // Ảnh 4×2, cao 20 mm → rộng 40 mm; EMU: 1 mm = 36.000.
    const extent = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(xml);
    expect(extent).not.toBeNull();
    const [cx, cy] = [Number(extent?.[1]), Number(extent?.[2])];
    // Điểm ảnh làm tròn nên tỉ lệ sai lệch dưới 0,05.
    expect(cx / cy).toBeCloseTo(2, 1);
    expect(cy / 36_000).toBeCloseTo(20, 0);
  });

  it('TC-EX-10: bảng hàng có hàng tiêu đề lặp và đủ 200 dòng', async () => {
    const lines = Array.from({ length: 200 }, (_, index) => fixtureLine({ id: `l${index}`, materialName: `Hàng số ${index + 1}` }));
    const data = buildQuoteLayoutData({ detail: fixtureDetail(fixtureVersion({ lines })), now });
    const { xml } = await documentXml(fixtureFullLayout(), data);
    expect(xml).toContain('Hàng số 1<');
    expect(xml).toContain('Hàng số 200<');
    expect(xml.indexOf('Hàng số 199<')).toBeLessThan(xml.indexOf('Hàng số 200<'));
    expect(xml.match(/<w:tblHeader/g)).toHaveLength(1);
  });

  it('bảng hàng rỗng chỉ có hàng tiêu đề', async () => {
    const data = buildQuoteLayoutData({ detail: fixtureDetail(fixtureVersion({ lines: [] })), now });
    const { xml } = await documentXml(fixtureFullLayout(), data);
    expect(xml).not.toContain('Chưa có dòng hàng');
    expect(xml).toContain('Tên hàng hoá, dịch vụ');
  });

  it('TC-EX-11, TC-RD-07: ký tự đặc biệt được thoát, XML hợp lệ, hiện nguyên văn', async () => {
    const detail = fixtureDetail(fixtureVersion({ lines: [fixtureLine({ materialName: 'Ống "A" & <B>' })] }));
    const data = buildQuoteLayoutData({ detail, customer: fixtureCustomer({ name: FIXTURE_XSS }), now });
    const { xml } = await documentXml(fixtureFullLayout(), data);
    expect(xml).not.toContain('<script>');
    expect(xml).not.toContain('<b>');
    expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp;');
    expect(xml).toContain('Ống');
    expect(xml).toMatch(/Ống (&quot;|")A(&quot;|") &amp; &lt;B&gt;/);
    // Mọi thẻ đóng mở cân bằng ở mức thô: số thẻ <w:t> bằng số </w:t>.
    expect((xml.match(/<w:t[ >]/g) ?? []).length).toBe((xml.match(/<\/w:t>/g) ?? []).length);
  });

  it('TC-RD-10: tiếng Việt tổ hợp được chuẩn hoá NFC', async () => {
    const data = buildQuoteLayoutData({ detail: fixtureDetail(), customer: fixtureCustomer({ name: 'Hoà Bình'.normalize('NFD') }), now });
    const { xml } = await documentXml(fixtureFullLayout(), data);
    expect(xml).toContain('Hoà Bình'.normalize('NFC'));
  });
});

describe('readImageSize', () => {
  it('đọc kích thước PNG và JPEG', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGOQkzsBRwzIHABkaggh4UPC6AAAAABJRU5ErkJggg==',
      'base64',
    );
    expect(readImageSize(png)).toEqual({ width: 4, height: 2 });
    // JPEG tối giản: SOI, APP0 rỗng, SOF0 cao 3 rộng 5.
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x03, 0x00, 0x05, 0x01, 0x01, 0x11, 0x00]);
    expect(readImageSize(jpeg)).toEqual({ width: 5, height: 3 });
    expect(readImageSize(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});

describe('tải thư viện', () => {
  it('TC-EX-12: tải docx theo nhu cầu', async () => {
    const loaded = await loadDocx();
    expect(typeof loaded.Packer.toBlob).toBe('function');
  });

  it('TC-EX-12: lỗi tải chunk báo câu tiếng Việt', async () => {
    let isolated: typeof import('./export-docx') | undefined;
    jest.isolateModules(() => {
      jest.doMock('docx', () => {
        throw new Error('ChunkLoadError: Loading chunk 123 failed.');
      });
      isolated = jest.requireActual<typeof import('./export-docx')>('./export-docx');
    });
    const data = buildQuoteLayoutData({ detail: fixtureDetail(), now });
    const result = isolated?.exportQuoteDocx({ layout: fixtureFullLayout(), data, fileName: 'BG_v1' });
    await expect(result).rejects.toMatchObject({ name: 'QuoteExportError' });
    await expect(result).rejects.toThrow('Không tải được bộ xuất Word. Kiểm tra mạng và thử lại.');
    jest.dontMock('docx');
  });
});
