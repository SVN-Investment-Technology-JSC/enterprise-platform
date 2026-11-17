/**
 * @jest-environment jsdom
 */
import type { EllipseGeometry, IconShape, PathGeometry, RectGeometry } from './model';
import { importSvg } from './svg-import';

const svg = (inner: string, attrs = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
const rectOf = (shape: IconShape) => shape.geometry as RectGeometry;
const warned = (warnings: readonly string[], text: string) => warnings.some((warning) => warning.includes(text));
const gradientDefs = '<linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>';

describe('importSvg: CSS trong <style>', () => {
  it('quy tắc theo thẻ, lớp, id và con cháu được áp; thuộc tính trình bày có độ ưu tiên thấp nhất', () => {
    const result = importSvg(
      svg(
        '<style>rect{fill:#111111} .a{fill:#222222} #c{fill:#333333} g > .d{fill:#444444}</style>' +
          '<rect width="4" height="4" fill="#999999"/><rect class="a" width="4" height="4"/><rect id="c" class="a" width="4" height="4"/><g><rect class="d" width="4" height="4"/></g>',
      ),
    );
    expect(result.shapes.map((shape) => shape.fill)).toEqual(['#111111', '#222222', '#333333', '#444444']);
  });

  it('style nội tuyến thắng quy tắc; !important của quy tắc thắng style nội tuyến thường', () => {
    const result = importSvg(
      svg(
        '<style>.a{fill:#222222} .b{fill:#333333 !important}</style>' +
          '<rect class="a" style="fill:#111111" width="4" height="4"/><rect class="b" style="fill:#111111" width="4" height="4"/>',
      ),
    );
    expect(result.shapes.map((shape) => shape.fill)).toEqual(['#111111', '#333333']);
  });

  it('bộ chọn phức tạp (thuộc tính, :first-child, :not, danh sách) dùng bộ khớp của trình duyệt', () => {
    const result = importSvg(
      svg(
        '<style>[data-k="x"]{fill:#aa0000} g rect:first-child{stroke:#00aa00} rect:not(.skip){fill-opacity:.5} .p, .q{fill:#0000aa}</style>' +
          '<g><rect data-k="x" width="4" height="4"/><rect class="p" width="4" height="4"/></g>',
      ),
    );
    expect(result.shapes[0]).toMatchObject({ fill: '#aa0000', stroke: '#00aa00', fillOpacity: 0.5 });
    expect(result.shapes[1]).toMatchObject({ fill: '#0000aa', fillOpacity: 0.5 });
  });

  it('biến CSS var(--x, dự phòng) kế thừa qua nhóm', () => {
    const result = importSvg(
      svg('<g style="--c:#336699"><rect width="4" height="4" style="fill:var(--c)"/><rect width="4" height="4" style="fill:var(--none,#112233)"/></g>'),
    );
    expect(result.shapes.map((shape) => shape.fill)).toEqual(['#336699', '#112233']);
  });

  it('biến CSS tham chiếu biến khác trên cùng phần tử; tham chiếu vòng thì bị bỏ', () => {
    const result = importSvg(
      svg('<style>svg{--a:#00897b;--b:var(--a);--x:var(--y);--y:var(--x)}.p{fill:var(--b)}.q{fill:var(--x,#112233)}</style><rect class="p" width="4" height="4"/><rect class="q" width="4" height="4"/>'),
    );
    expect(result.shapes.map((shape) => shape.fill)).toEqual(['#00897b', '#112233']);
  });

  it('luật @media bị bỏ qua và báo; comment trong CSS không gây hại', () => {
    const result = importSvg(svg('<style>/* x */ rect{fill:#112233} @media (min-width:1px){rect{fill:#ff0000}}</style><rect width="4" height="4"/>'));
    expect(result.shapes[0].fill).toBe('#112233');
    expect(warned(result.warnings, '@media')).toBe(true);
  });
});

describe('importSvg: màu', () => {
  const fills = (values: string[]) =>
    importSvg(svg(values.map((value) => `<rect width="4" height="4" fill="${value}"/>`).join(''))).shapes.map((shape) => [shape.fill, shape.fillOpacity]);

  it('rgb, rgba, hsl, cú pháp dấu cách, phần trăm, #rgba, #rrggbbaa và tên màu', () => {
    expect(fills(['rgb(255,0,0)', 'rgba(0,128,0,0.5)', 'rgb(0 0 255 / 25%)', 'hsl(120, 100%, 25%)', '#f008', '#0000ff80', 'rebeccapurple', 'rgb(100%, 0%, 0%)'])).toEqual([
      ['#ff0000', 1],
      ['#008000', 0.5],
      ['#0000ff', 0.25],
      ['#008000', 1],
      ['#ff0000', 0.533],
      ['#0000ff', 0.502],
      ['#663399', 1],
      ['#ff0000', 1],
    ]);
  });

  it('transparent hoặc alpha 0 thì không tô', () => {
    const result = importSvg(svg('<rect width="4" height="4" fill="transparent"/><rect width="4" height="4" fill="rgba(0,0,0,0)"/><rect width="4" height="4" fill="#123456"/>'));
    expect(result.shapes).toHaveLength(1);
  });

  it('màu đen là currentColor (theo chữ); color đặt trên nhóm làm currentColor thành màu thật', () => {
    const result = importSvg(
      svg('<rect width="4" height="4" fill="#000"/><g color="#336699"><rect width="4" height="4" fill="currentColor"/></g><rect width="4" height="4" fill="currentColor"/>'),
    );
    expect(result.shapes.map((shape) => shape.fill)).toEqual(['currentColor', '#336699', 'currentColor']);
  });

  it('độ đặc của màu nét nhân vào độ mờ của nét', () => {
    const result = importSvg(svg('<path d="M1 1 L5 5" fill="none" stroke="rgba(255,0,0,0.5)" stroke-opacity="0.5"/>'));
    expect(result.shapes[0].opacity).toBe(0.25);
  });
});

describe('importSvg: khung nhìn, đơn vị, viewBox', () => {
  it('width/height có đơn vị (in, mm, em) được quy ra px', () => {
    const inch = importSvg(svg('<rect width="96" height="96" fill="#123456"/>', 'width="1in" height="1in"'));
    expect(rectOf(inch.shapes[0]).width).toBeCloseTo(24, 4);
    const mm = importSvg(svg('<rect width="96" height="96" fill="#123456"/>', 'width="25.4mm" height="25.4mm"'));
    expect(rectOf(mm.shapes[0]).width).toBeCloseTo(24, 3);
    const em = importSvg(svg('<rect width="16" height="16" fill="#123456"/>', 'width="1em" height="1em"'));
    expect(rectOf(em.shapes[0]).width).toBeCloseTo(24, 4);
  });

  it('độ dài có đơn vị và phần trăm trên phần tử', () => {
    const result = importSvg(svg('<rect x="1em" y="10%" width="50%" height="1in" fill="#123456"/>', 'viewBox="0 0 200 200"'));
    const rect = rectOf(result.shapes[0]);
    const scale = 24 / 200;
    expect(rect.x).toBeCloseTo(16 * scale, 3);
    expect(rect.y).toBeCloseTo(20 * scale, 3);
    expect(rect.width).toBeCloseTo(100 * scale, 3);
    expect(rect.height).toBeCloseTo(96 * scale, 3);
  });

  it('viewBox lệch gốc toạ độ được dời về lưới', () => {
    const result = importSvg(svg('<rect x="-10" y="-10" width="20" height="20" fill="#123456"/>', 'viewBox="-10 -10 20 20"'));
    expect(rectOf(result.shapes[0])).toMatchObject({ x: 0, y: 0 });
    expect(rectOf(result.shapes[0]).width).toBeCloseTo(24, 4);
  });

  it('viewBox không vuông: co vừa lưới, căn giữa (xMidYMid meet)', () => {
    const result = importSvg(svg('<rect width="48" height="24" fill="#123456"/>', 'viewBox="0 0 48 24"'));
    const rect = rectOf(result.shapes[0]);
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([0, 6, 24, 12]);
  });

  it('preserveAspectRatio="none" kéo giãn lệch trục; slice phủ kín rồi cắt phần tràn', () => {
    const none = importSvg(svg('<circle cx="5" cy="2.5" r="2" fill="#123456"/>', 'viewBox="0 0 10 5" width="24" height="24" preserveAspectRatio="none"'));
    const ellipse = none.shapes[0].geometry as EllipseGeometry;
    expect(ellipse.rx).toBeCloseTo(4.8, 4);
    expect(ellipse.ry).toBeCloseTo(9.6, 4);
    const slice = importSvg(svg('<rect width="10" height="5" fill="#123456"/>', 'viewBox="0 0 10 5" width="24" height="24" preserveAspectRatio="xMidYMid slice"'));
    // khung 24x24 phủ kín bằng viewBox 10x5: tỷ lệ 4.8, hình rộng 48 bị cắt bằng khung nhìn
    expect(rectOf(slice.shapes[0]).width).toBeCloseTo(48, 3);
    expect(rectOf(slice.shapes[0]).x).toBeCloseTo(-12, 3);
  });

  it('khung nhìn không vuông (width khác height): nội dung tràn khung bị cắt, nội dung nằm trong thì không cần cắt', () => {
    const inside = importSvg(svg('<rect width="10" height="10" fill="#123456"/>', 'viewBox="0 0 48 24"'));
    expect(inside.shapes[0].mask).toBeUndefined();
    const overflow = importSvg(svg('<rect width="60" height="30" fill="#123456"/>', 'viewBox="0 0 48 24"'));
    expect(overflow.shapes[0].mask?.layers.length).toBeGreaterThan(0);
  });

  it('không có viewBox lẫn kích thước: báo và dùng toạ độ như lưới', () => {
    const result = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#123456"/></svg>');
    expect(warned(result.warnings, 'không có viewBox')).toBe(true);
  });
});

describe('importSvg: use, symbol và svg lồng nhau', () => {
  it('use nhân bản phần tử trong defs với x, y, transform; màu thừa kế từ use', () => {
    const result = importSvg(
      svg('<defs><rect id="r" width="4" height="4"/></defs><use href="#r" x="2" y="3" fill="#ff0000"/><use href="#r" transform="translate(10 10)" fill="#0000ff"/>'),
    );
    expect(result.shapes.map((shape) => [rectOf(shape).x, rectOf(shape).y, shape.fill])).toEqual([
      [2, 3, '#ff0000'],
      [10, 10, '#0000ff'],
    ]);
  });

  it('xlink:href không khai báo namespace vẫn đọc được', () => {
    const result = importSvg('<svg viewBox="0 0 24 24"><defs><rect id="r" width="4" height="4"/></defs><use xlink:href="#r" fill="#ff0000"/></svg>');
    expect(result.shapes).toHaveLength(1);
  });

  it('symbol có viewBox được đặt vào khung của use (width/height)', () => {
    const result = importSvg(
      svg(
        '<defs><symbol id="s" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123456"/></symbol></defs><use href="#s" x="2" y="2" width="20" height="20"/>',
      ),
    );
    expect(rectOf(result.shapes[0])).toMatchObject({ x: 2, y: 2, width: 20, height: 20 });
  });

  it('use lồng use, vòng tham chiếu không treo', () => {
    const nested = importSvg(
      svg('<defs><rect id="r" width="2" height="2"/><use id="u" href="#r" x="5"/></defs><use href="#u" y="5" fill="#123456"/>'),
    );
    expect(rectOf(nested.shapes[0])).toMatchObject({ x: 5, y: 5 });
    const loop = importSvg(svg('<defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs><use href="#a"/><rect width="4" height="4"/>'));
    expect(loop.shapes).toHaveLength(1);
  });

  it('use không tìm thấy đích thì báo', () => {
    const result = importSvg(svg('<use href="#khong-co"/><rect width="4" height="4"/>'));
    expect(result.shapes).toHaveLength(1);
    expect(warned(result.warnings, 'không có trong tệp')).toBe(true);
  });

  it('svg lồng nhau: dời theo x, y, đổi hệ toạ độ theo viewBox; hình nằm trong khung thì không cần cắt', () => {
    const result = importSvg(
      svg('<svg x="4" y="4" width="10" height="10" viewBox="0 0 5 5"><rect width="2" height="2" fill="#123456"/></svg>'),
    );
    expect(rectOf(result.shapes[0])).toMatchObject({ x: 4, y: 4, width: 4, height: 4 });
    expect(result.shapes[0].mask).toBeUndefined();
  });

  it('svg lồng nhau cắt phần tràn ra ngoài khung (overflow mặc định hidden), overflow="visible" thì không', () => {
    const clipped = importSvg(svg('<svg x="4" y="4" width="10" height="10"><rect width="30" height="30" fill="#123456"/></svg>'));
    expect(clipped.shapes[0].mask?.layers.length).toBeGreaterThan(0);
    const visible = importSvg(svg('<svg x="4" y="4" width="10" height="10" overflow="visible"><rect width="30" height="30" fill="#123456"/></svg>'));
    expect(visible.shapes[0].mask).toBeUndefined();
  });

  it('nhân bản use quá nhiều (bom lồng nhau) bị chặn và báo', () => {
    let defs = '<g id="l0"><rect width="1" height="1"/></g>';
    for (let level = 1; level <= 12; level += 1) defs += `<g id="l${level}"><use href="#l${level - 1}"/><use href="#l${level - 1}" x="1"/></g>`;
    const result = importSvg(svg(`<defs>${defs}</defs><use href="#l12"/>`));
    expect(result.shapes.length).toBeLessThanOrEqual(500);
    expect(warned(result.warnings, '500')).toBe(true);
  });
});

describe('importSvg: clipPath', () => {
  it('clipPath thành lớp trắng của mặt nạ, theo toạ độ của phần tử được cắt', () => {
    const result = importSvg(
      svg('<defs><clipPath id="c"><circle cx="12" cy="12" r="6"/></clipPath></defs><rect width="24" height="24" fill="#123456" clip-path="url(#c)"/>'),
    );
    const layers = result.shapes[0].mask?.layers ?? [];
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ fill: '#ffffff', stroke: 'none' });
    expect(layers[0].geometry).toMatchObject({ type: 'ellipse', cx: 12, cy: 12, rx: 6 });
  });

  it('vùng cắt phủ kín khung (cắt thừa) thì bỏ; hình nằm trọn trong vùng cắt hình chữ nhật cũng không cần mặt nạ', () => {
    const full = importSvg(
      svg('<defs><clipPath id="c"><rect width="24" height="24"/></clipPath></defs><g clip-path="url(#c)"><path d="M2 2 L20 20" fill="none" stroke="#123456" stroke-width="2"/></g>'),
    );
    expect(full.shapes[0].mask).toBeUndefined();
    const inside = importSvg(
      svg('<defs><clipPath id="c"><rect x="0" y="0" width="12" height="12"/></clipPath></defs><rect x="2" y="2" width="4" height="4" fill="#123456" clip-path="url(#c)"/>'),
    );
    expect(inside.shapes[0].mask).toBeUndefined();
  });

  it('clip-rule evenodd và transform của clipPath được giữ', () => {
    const result = importSvg(
      svg(
        '<defs><clipPath id="c" transform="translate(2 0)"><path clip-rule="evenodd" d="M0 0H10V10H0Z M3 3H7V7H3Z"/></clipPath></defs><rect width="24" height="24" fill="#123456" clip-path="url(#c)"/>',
      ),
    );
    const layer = result.shapes[0].mask?.layers[0];
    expect(layer?.fillRule).toBe('evenodd');
    expect((layer?.geometry as PathGeometry).subpaths[0].nodes[0]).toMatchObject({ x: 2, y: 0 });
  });

  it('clipPathUnits=objectBoundingBox co theo khung bao của phần tử', () => {
    const result = importSvg(
      svg(
        '<defs><clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="0.5" height="1"/></clipPath></defs><rect x="4" y="2" width="10" height="8" fill="#123456" clip-path="url(#c)"/>',
      ),
    );
    expect(result.shapes[0].mask?.layers[0].geometry).toMatchObject({ x: 4, y: 2, width: 5, height: 8 });
  });

  it('clipPath rỗng che hết: phần tử không hiện', () => {
    const result = importSvg(
      svg('<defs><clipPath id="c"/></defs><rect width="24" height="24" fill="#123456" clip-path="url(#c)"/><rect width="4" height="4" fill="#ff0000"/>'),
    );
    expect(result.shapes).toHaveLength(1);
  });

  it('clip-path trên nhóm áp cho mọi hình con; clip-path cùng mask: giao bằng lớp đen phủ phần ngoài vùng cắt', () => {
    const result = importSvg(
      svg(
        '<defs><clipPath id="c"><rect x="2" y="2" width="8" height="8"/></clipPath><mask id="m"><rect width="24" height="24" fill="#fff"/></mask></defs>' +
          '<g clip-path="url(#c)"><rect width="24" height="24" fill="#123456" mask="url(#m)"/></g>',
      ),
    );
    const layers = result.shapes[0].mask?.layers ?? [];
    expect(layers.length).toBe(2);
    expect(layers[1]).toMatchObject({ fill: '#000000', fillRule: 'evenodd' });
    expect(result.warnings).toEqual([]);
  });

  it('clip-path dạng hình CSS hoặc không đọc được thì báo', () => {
    const result = importSvg(svg('<rect width="24" height="24" fill="#123456" style="clip-path:circle(50%)"/>'));
    expect(warned(result.warnings, 'clip-path')).toBe(true);
  });
});

describe('importSvg: nét và thứ tự vẽ', () => {
  it('nét đứt: dasharray và dashoffset nhân theo tỷ lệ lưới; miterlimit giữ nguyên', () => {
    const result = importSvg(
      svg('<path d="M1 1 L90 90" fill="none" stroke="#123456" stroke-width="10" stroke-dasharray="20 10" stroke-dashoffset="5" stroke-miterlimit="2"/>', 'viewBox="0 0 120 120"'),
    );
    const shape = result.shapes[0];
    expect(shape.strokeDasharray).toEqual([4, 2]);
    expect(shape.strokeDashoffset).toBe(1);
    expect(shape.strokeMiterlimit).toBe(2);
    expect(shape.strokeWidth).toBe(2);
  });

  it('dasharray none hoặc toàn 0 là nét liền', () => {
    const result = importSvg(
      svg('<path d="M1 1 L9 9" fill="none" stroke="#123456" stroke-dasharray="0 0"/><path d="M1 1 L9 9" fill="none" stroke="#123456" stroke-dasharray="none"/>'),
    );
    expect(result.shapes.every((shape) => shape.strokeDasharray === undefined)).toBe(true);
  });

  it('có cả tô và nét với độ mờ nét khác 1: tách thành hai lớp (tô trước, nét sau)', () => {
    const result = importSvg(svg('<rect width="8" height="8" fill="#ff0000" stroke="#0000ff" stroke-width="2" stroke-opacity="0.5"/>'));
    expect(result.shapes).toHaveLength(2);
    expect(result.shapes[0]).toMatchObject({ fill: '#ff0000', stroke: 'none' });
    expect(result.shapes[1]).toMatchObject({ fill: 'none', stroke: '#0000ff', opacity: 0.5 });
  });

  it('paint-order: stroke vẽ nét trước rồi tô đè lên', () => {
    const result = importSvg(svg('<rect width="8" height="8" fill="#ff0000" stroke="#0000ff" stroke-width="2" style="paint-order:stroke"/>'));
    expect(result.shapes).toHaveLength(2);
    expect(result.shapes[0].stroke).toBe('#0000ff');
    expect(result.shapes[1].fill).toBe('#ff0000');
  });

  it('một lớp có cả tô và nét khi không cần tách', () => {
    const result = importSvg(svg('<rect width="8" height="8" fill="#ff0000" stroke="#0000ff" stroke-width="2"/>'));
    expect(result.shapes).toHaveLength(1);
  });

  it('visibility: hidden bỏ hình, con đặt visible vẫn hiện', () => {
    const result = importSvg(
      svg('<g visibility="hidden"><rect width="4" height="4" fill="#111111"/><rect width="5" height="5" fill="#222222" visibility="visible"/></g>'),
    );
    expect(result.shapes.map((shape) => shape.fill)).toEqual(['#222222']);
  });

  it('nét bị co giãn lệch trục: báo', () => {
    const result = importSvg(svg('<path d="M1 1 L9 9" fill="none" stroke="#123456" transform="scale(2 1)"/>'));
    expect(warned(result.warnings, 'lệch trục')).toBe(true);
  });
});

describe('importSvg: biến đổi và hình học', () => {
  it('transform CSS có đơn vị (deg, px) và transform-origin', () => {
    const result = importSvg(
      svg('<rect width="4" height="4" fill="#123456" style="transform: translate(2px, 0) rotate(90deg); transform-origin: 2px 2px"/>'),
    );
    const geometry = result.shapes[0].geometry;
    expect(geometry.type).toBe('rect');
    expect(rectOf(result.shapes[0])).toEqual({ type: 'rect', x: 2, y: 0, width: 4, height: 4, rx: 0 });
  });

  it('skewX, matrix và rotate quanh tâm đúng số học', () => {
    const skew = importSvg(svg('<path d="M0 0 L10 0 L10 10 Z" fill="#123456" transform="skewX(45)"/>'));
    const nodes = (skew.shapes[0].geometry as PathGeometry).subpaths[0].nodes;
    expect(nodes[2].x).toBeCloseTo(20, 4);
    const rotated = importSvg(svg('<rect x="10" y="10" width="4" height="4" fill="#123456" transform="rotate(180 12 12)"/>'));
    expect(rectOf(rotated.shapes[0])).toMatchObject({ x: 10, y: 10, width: 4, height: 4 });
  });

  it('rect có rx khác ry thành đường góc elip; rx chỉ ghi một trục thì ry lấy theo', () => {
    const elliptic = importSvg(svg('<rect width="10" height="10" rx="4" ry="2" fill="#123456"/>'));
    expect(elliptic.shapes[0].geometry.type).toBe('path');
    const same = importSvg(svg('<rect width="10" height="10" ry="3" fill="#123456"/>'));
    expect(rectOf(same.shapes[0]).rx).toBe(3);
  });

  it('rect bo tròn bị co giãn lệch trục thành đường (không méo góc)', () => {
    const result = importSvg(svg('<rect width="10" height="10" rx="3" fill="#123456" transform="scale(2 1)"/>'));
    expect(result.shapes[0].geometry.type).toBe('path');
  });

  it('chuỗi d sai ở giữa vẫn vẽ phần trước chỗ sai', () => {
    const result = importSvg(svg('<path d="M1 1 L9 1 L9 9 L ? 5" fill="none" stroke="#123456"/>'));
    expect((result.shapes[0].geometry as PathGeometry).subpaths[0].nodes).toHaveLength(3);
  });
});

describe('importSvg: phần tử và thuộc tính', () => {
  it('visibility, display none, switch, a và nhóm lồng nhau', () => {
    const result = importSvg(
      svg('<switch><rect width="4" height="4" fill="#111111"/><rect width="5" height="5" fill="#222222"/></switch><a><g display="none"><rect width="6" height="6"/></g></a>'),
    );
    expect(result.shapes.map((shape) => shape.fill)).toEqual(['#111111']);
  });

  it('chữ, ảnh, bộ lọc, marker, hoa văn, hoà trộn và hoạt hình được báo thay vì bỏ lặng lẽ', () => {
    const result = importSvg(
      svg(
        '<defs><filter id="f"/><pattern id="p" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1"/></pattern><marker id="m"/></defs>' +
          '<text x="1" y="5">A</text><image href="a.png" width="4" height="4"/>' +
          '<rect width="4" height="4" fill="#123456" filter="url(#f)"/>' +
          '<path d="M1 1 L9 9" stroke="#123456" fill="none" marker-end="url(#m)"/>' +
          '<rect width="4" height="4" fill="url(#p)"/>' +
          '<rect width="4" height="4" fill="#123456" style="mix-blend-mode:multiply"/>' +
          '<rect width="4" height="4" fill="#123456"><animate attributeName="x" from="0" to="5" dur="1s"/></rect>',
      ),
    );
    for (const text of ['chữ', 'ảnh', 'bộ lọc', 'marker', 'hoa văn', 'hoà trộn', 'chuyển động']) expect(warned(result.warnings, text)).toBe(true);
  });

  it('chỉ có chữ hoặc ảnh thì báo lỗi nêu đích danh', () => {
    expect(() => importSvg(svg('<text x="1" y="5">A</text>'))).toThrow(/chữ/);
    expect(() => importSvg(svg('<image href="a.png" width="4" height="4"/>'))).toThrow(/ảnh/);
  });

  it('nhóm có độ mờ chung mà con chồng lên nhau: báo; con không chồng thì không báo', () => {
    const overlap = importSvg(svg('<g opacity="0.5"><rect width="6" height="6" fill="#111111"/><rect x="3" y="3" width="6" height="6" fill="#222222"/></g>'));
    expect(warned(overlap.warnings, 'độ mờ chung')).toBe(true);
    const apart = importSvg(svg('<g opacity="0.5"><rect width="4" height="4" fill="#111111"/><rect x="10" y="10" width="4" height="4" fill="#222222"/></g>'));
    expect(warned(apart.warnings, 'độ mờ chung')).toBe(false);
  });

  it('nét không co giãn (vector-effect) được báo', () => {
    const result = importSvg(svg('<path d="M1 1 L9 9" fill="none" stroke="#123456" vector-effect="non-scaling-stroke"/>'));
    expect(warned(result.warnings, 'non-scaling-stroke')).toBe(true);
  });
});

describe('importSvg: đọc mã SVG lộn xộn', () => {
  it('BOM, khai báo xml, DOCTYPE và thực thể do tệp tự khai (Illustrator)', () => {
    const markup =
      '﻿<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n<!ENTITY ns_svg "http://www.w3.org/2000/svg">\n]>\n<svg xmlns="&ns_svg;" viewBox="0 0 24 24"><rect width="4" height="4" fill="#123456"/></svg>';
    expect(importSvg(markup).shapes).toHaveLength(1);
  });

  it('thuộc tính không nháy, thẻ không đóng, thực thể HTML: đọc bằng bộ đọc dễ tính', () => {
    const result = importSvg('<svg viewBox="0 0 24 24"><title>a&nbsp;b</title><rect width=4 height=4 fill=#123456></svg>');
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0].fill).toBe('#123456');
  });

  it('CDATA trong <style> và nhiều thẻ <style>', () => {
    const result = importSvg(
      svg('<style><![CDATA[ .a{fill:#111111} ]]></style><style>.b{fill:#222222}</style><rect class="a" width="4" height="4"/><rect class="b" width="4" height="4"/>'),
    );
    expect(result.shapes.map((shape) => shape.fill)).toEqual(['#111111', '#222222']);
  });
});

describe('importSvg: tệp độc hại hoặc cực lớn', () => {
  it('lồng nhóm cực sâu không làm tràn ngăn xếp: báo lỗi rõ thay vì treo hay văng', () => {
    const deep = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${'<g>'.repeat(3000)}<rect width="4" height="4"/>${'</g>'.repeat(3000)}</svg>`;
    expect(() => importSvg(deep)).toThrow(/quá sâu/);
    const fine = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${'<g>'.repeat(100)}<rect width="4" height="4"/>${'</g>'.repeat(100)}</svg>`;
    expect(importSvg(fine).shapes).toHaveLength(1);
  });

  it('toạ độ và phép biến đổi cực đoan không văng lỗi lạ: hình hỏng bị bỏ và báo', () => {
    const result = importSvg(
      svg(
        '<rect width="4" height="4" transform="scale(1e308)"/><rect width="1e999" height="4"/><path d="M0 0 L1e400 5" stroke="#000"/><rect x="NaN" width="4" height="4" fill="#123456"/>',
      ),
    );
    expect(result.shapes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('importSvg: gradient trên hình đã biến đổi', () => {
  it('gradient của nét và của tô dùng được trong cùng một hình, qua use và nhóm biến đổi', () => {
    const result = importSvg(
      svg(
        `<defs>${gradientDefs}<rect id="r" width="10" height="10" fill="url(#g)" stroke="url(#g)" stroke-width="1"/></defs><use href="#r" x="4" y="4"/>`,
      ),
    );
    expect(result.shapes[0].fill.startsWith('linear:')).toBe(true);
    expect(result.shapes[0].stroke.startsWith('linear:')).toBe(true);
  });
});
