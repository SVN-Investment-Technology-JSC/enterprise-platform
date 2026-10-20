import { geometryBounds } from './geometry';
import { GLYPH_LIBRARY, LEGACY_PRESETS } from './legacy-data';
import type { PathGeometry, Point } from './model';
import {
  MAX_PATH_DATA_LENGTH,
  formatNumber,
  isValidPathData,
  parsePathData,
  pathToData,
  subpathToData,
} from './path-data';

const nodesOf = (data: string, sub = 0) => parsePathData(data).subpaths[sub].nodes;
const close = (actual: number, expected: number, digits = 6) => expect(actual).toBeCloseTo(expected, digits);
const pointClose = (actual: Point | undefined, expected: Point, digits = 6) => {
  expect(actual).toBeDefined();
  close((actual as Point).x, expected.x, digits);
  close((actual as Point).y, expected.y, digits);
};

/** Đường sau khi qua `pathToData` rồi đọc lại phải ra đúng hình (sai số làm tròn 3 chữ số). */
function expectSameShape(a: PathGeometry, b: PathGeometry) {
  expect(b.subpaths).toHaveLength(a.subpaths.length);
  a.subpaths.forEach((sub, subIndex) => {
    const other = b.subpaths[subIndex];
    expect(other.closed).toBe(sub.closed);
    expect(other.nodes).toHaveLength(sub.nodes.length);
    sub.nodes.forEach((node, index) => {
      const peer = other.nodes[index];
      pointClose(peer, node, 2);
      expect(Boolean(peer.hin)).toBe(Boolean(node.hin));
      expect(Boolean(peer.hout)).toBe(Boolean(node.hout));
      if (node.hin) pointClose(peer.hin, node.hin, 2);
      if (node.hout) pointClose(peer.hout, node.hout, 2);
    });
  });
}

describe('formatNumber', () => {
  it('làm tròn 3 chữ số và bỏ số 0 thừa', () => {
    expect(formatNumber(1.23456)).toBe('1.235');
    expect(formatNumber(2)).toBe('2');
    expect(formatNumber(0.5)).toBe('0.5');
    expect(formatNumber(1.0004)).toBe('1');
  });

  it('không bao giờ in -0', () => {
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(-0.0001)).toBe('0');
  });
});

describe('parsePathData: lệnh cơ bản', () => {
  it('đọc M và L tuyệt đối', () => {
    const geometry = parsePathData('M 10 20 L 30 40');
    expect(geometry.type).toBe('path');
    expect(geometry.subpaths).toEqual([{ closed: false, nodes: [{ x: 10, y: 20 }, { x: 30, y: 40 }] }]);
  });

  it('đọc lệnh tương đối m, l, h, v', () => {
    expect(nodesOf('m 10 10 l 5 5 h 5 v 5')).toEqual([
      { x: 10, y: 10 },
      { x: 15, y: 15 },
      { x: 20, y: 15 },
      { x: 20, y: 20 },
    ]);
  });

  it('đọc H và V tuyệt đối', () => {
    expect(nodesOf('M 1 2 H 10 V 8')).toEqual([
      { x: 1, y: 2 },
      { x: 10, y: 2 },
      { x: 10, y: 8 },
    ]);
  });

  it('coi m đầu tiên là toạ độ tuyệt đối', () => {
    expect(nodesOf('m 4 5 l 1 1')[0]).toEqual({ x: 4, y: 5 });
  });

  it('lệnh M lặp ngầm thành L, lệnh m lặp ngầm thành l', () => {
    expect(nodesOf('M 0 0 10 10 20 0')).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
    expect(nodesOf('m 1 1 2 2 3 3')).toEqual([
      { x: 1, y: 1 },
      { x: 3, y: 3 },
      { x: 6, y: 6 },
    ]);
  });

  it('lệnh L, C lặp ngầm nhiều đoạn', () => {
    expect(nodesOf('M 0 0 L 1 1 2 2 3 3')).toHaveLength(4);
    const curve = nodesOf('M 0 0 C 1 0 2 1 3 3 4 5 5 6 6 6');
    expect(curve).toHaveLength(3);
    pointClose(curve[1].hout, { x: 4, y: 5 });
    pointClose(curve[2].hin, { x: 5, y: 6 });
  });

  it('đọc dấu phẩy, số viết liền và số mũ', () => {
    expect(nodesOf('M10,20L30,40')).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
    expect(nodesOf('M0-5L-5.5.5')).toEqual([
      { x: 0, y: -5 },
      { x: -5.5, y: 0.5 },
    ]);
    expect(nodesOf('M1.5.5L1e1 2E1')).toEqual([
      { x: 1.5, y: 0.5 },
      { x: 10, y: 20 },
    ]);
    expect(nodesOf('M 1 2 L +3 -4e-1')[1]).toEqual({ x: 3, y: -0.4 });
  });

  it('chấp nhận chuỗi rỗng và khoảng trắng đầu cuối', () => {
    expect(parsePathData('').subpaths).toEqual([]);
    expect(parsePathData('   M 1 1 L 2 2   ').subpaths).toHaveLength(1);
  });

  it('bắt đầu bằng lệnh khác M thì lấy gốc (0,0)', () => {
    expect(nodesOf('L 5 5')).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  it('ném lỗi khi lệnh không hợp lệ hoặc thiếu tham số', () => {
    expect(() => parsePathData('M 0 0 X 1 1')).toThrow();
    expect(() => parsePathData('M 0')).toThrow();
    expect(() => parsePathData('M 0 0 L 1')).toThrow();
    expect(() => parsePathData('M 0 0 C 1 2 3 4 5')).toThrow();
    expect(() => parsePathData('M 0 0 L a b')).toThrow();
    expect(() => parsePathData('M')).toThrow();
  });
});

describe('parsePathData: đóng đường và nhiều đường con', () => {
  it('Z đóng đường con', () => {
    const geometry = parsePathData('M 0 0 L 10 0 L 10 10 Z');
    expect(geometry.subpaths).toHaveLength(1);
    expect(geometry.subpaths[0].closed).toBe(true);
    expect(geometry.subpaths[0].nodes).toHaveLength(3);
  });

  it('bỏ điểm cuối trùng điểm đầu khi đóng', () => {
    const closed = parsePathData('M 0 0 L 10 0 L 10 10 L 0 0 Z');
    expect(closed.subpaths[0].nodes).toHaveLength(3);
    // không có Z thì giữ nguyên, vì đường vẫn mở
    expect(parsePathData('M 0 0 L 10 0 L 10 10 L 0 0').subpaths[0].nodes).toHaveLength(4);
  });

  it('chuyển tay cầm vào của điểm cuối trùng sang điểm đầu', () => {
    const circle = parsePathData(
      'M 0 0 C 0 5 5 10 10 10 C 15 10 20 5 20 0 C 20 -5 15 -10 10 -10 C 5 -10 0 -5 0 0 Z',
    ).subpaths[0];
    expect(circle.closed).toBe(true);
    expect(circle.nodes).toHaveLength(4);
    pointClose(circle.nodes[0].hin, { x: 0, y: -5 });
    pointClose(circle.nodes[0].hout, { x: 0, y: 5 });
  });

  it('lệnh vẽ ngay sau Z mở đường con mới tại điểm đầu của đường vừa đóng', () => {
    const geometry = parsePathData('M 10 10 L 20 20 Z L 30 30');
    expect(geometry.subpaths).toHaveLength(2);
    expect(geometry.subpaths[0].closed).toBe(true);
    expect(geometry.subpaths[1]).toEqual({ closed: false, nodes: [{ x: 10, y: 10 }, { x: 30, y: 30 }] });
  });

  it('m sau Z tính tương đối so với điểm đầu của đường vừa đóng', () => {
    const geometry = parsePathData('M 10 10 L 20 10 L 20 20 Z m 5 5 l 1 1');
    expect(geometry.subpaths).toHaveLength(2);
    expect(geometry.subpaths[1].nodes[0]).toEqual({ x: 15, y: 15 });
  });

  it('giữ nhiều đường con theo thứ tự', () => {
    const geometry = parsePathData('M 0 0 L 1 1 M 5 5 L 6 6 M 9 9 L 8 8 Z');
    expect(geometry.subpaths.map((sub) => sub.closed)).toEqual([false, false, true]);
  });

  it('Z lặp hoặc Z mà không có đường thì không sinh đường con rỗng', () => {
    expect(parsePathData('Z').subpaths).toEqual([]);
    expect(parsePathData('M 0 0 L 5 5 Z Z').subpaths).toHaveLength(1);
  });

  it('đường con chỉ có điểm M đóng bằng Z vẫn giữ lại điểm đó', () => {
    const geometry = parsePathData('M 3 4 Z');
    expect(geometry.subpaths).toEqual([{ closed: true, nodes: [{ x: 3, y: 4 }] }]);
  });
});

describe('parsePathData: đường cong Bezier', () => {
  it('C tuyệt đối đặt tay cầm ra của điểm trước và tay cầm vào của điểm sau', () => {
    const nodes = nodesOf('M 0 0 C 1 2 3 4 5 6');
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toEqual({ x: 0, y: 0, hout: { x: 1, y: 2 } });
    expect(nodes[1]).toEqual({ x: 5, y: 6, hin: { x: 3, y: 4 } });
  });

  it('c tương đối tính theo điểm hiện tại', () => {
    const nodes = nodesOf('M 10 10 c 1 2 3 4 5 6');
    expect(nodes[0].hout).toEqual({ x: 11, y: 12 });
    expect(nodes[1]).toEqual({ x: 15, y: 16, hin: { x: 13, y: 14 } });
  });

  it('bỏ tay cầm trùng với điểm neo', () => {
    const nodes = nodesOf('M 0 0 C 0 0 3 4 5 6');
    expect(nodes[0].hout).toBeUndefined();
    expect(nodes[1].hin).toEqual({ x: 3, y: 4 });
  });

  it('S phản chiếu tay cầm của C liền trước qua điểm hiện tại', () => {
    const nodes = nodesOf('M 0 0 C 1 0 2 1 3 3 S 6 6 7 7');
    pointClose(nodes[1].hout, { x: 4, y: 5 });
    pointClose(nodes[2].hin, { x: 6, y: 6 });
    expect(nodes[2]).toMatchObject({ x: 7, y: 7 });
  });

  it('S không có đường cong liền trước thì tay cầm đầu trùng điểm hiện tại', () => {
    const nodes = nodesOf('M 0 0 L 10 10 S 20 20 30 30');
    expect(nodes[1].hout).toBeUndefined();
    expect(nodes[2].hin).toEqual({ x: 20, y: 20 });
  });

  it('S chỉ phản chiếu từ lệnh C hoặc S liền trước, không phải sau L', () => {
    const nodes = nodesOf('M 0 0 C 1 0 2 1 3 3 L 5 5 S 8 8 9 9');
    expect(nodes[2].hout).toBeUndefined();
  });

  it('s tương đối và chuỗi S liên tiếp', () => {
    const nodes = nodesOf('M 0 0 C 0 2 2 4 4 4 s 2 -2 4 -2 s 2 2 4 2');
    pointClose(nodes[1].hout, { x: 6, y: 4 });
    pointClose(nodes[2].hin, { x: 6, y: 2 });
    pointClose(nodes[2].hout, { x: 10, y: 2 });
    pointClose(nodes[3].hin, { x: 10, y: 4 });
    expect(nodes[3]).toMatchObject({ x: 12, y: 4 });
  });

  it('Q đổi sang Bezier bậc ba đúng 2/3 khoảng cách', () => {
    const nodes = nodesOf('M 0 0 Q 6 0 6 6');
    pointClose(nodes[0].hout, { x: 4, y: 0 });
    pointClose(nodes[1].hin, { x: 6, y: 2 });
    expect(nodes[1]).toMatchObject({ x: 6, y: 6 });
  });

  it('T phản chiếu điểm điều khiển của Q liền trước', () => {
    const nodes = nodesOf('M 0 0 Q 3 3 6 0 T 12 0');
    // điểm điều khiển phản chiếu: (9, -3)
    pointClose(nodes[1].hout, { x: 6 + (2 / 3) * 3, y: -2 });
    pointClose(nodes[2].hin, { x: 12 + (2 / 3) * (9 - 12), y: (2 / 3) * -3 });
  });

  it('T sau lệnh không phải Q/T thì điểm điều khiển là điểm hiện tại', () => {
    const nodes = nodesOf('M 0 0 L 6 0 T 12 0');
    // điểm điều khiển trùng điểm đầu: tay cầm ra bị bỏ, tay cầm vào nằm ở 2/3 về phía điểm đầu
    expect(nodes[1].hout).toBeUndefined();
    pointClose(nodes[2].hin, { x: 8, y: 0 });
  });

  it('Q rồi S không phản chiếu từ Q', () => {
    const nodes = nodesOf('M 0 0 Q 3 3 6 0 S 9 3 12 0');
    // S sau Q không có tay cầm cubic liền trước nên tay cầm ra trùng điểm hiện tại
    expect(nodes[1].hout).toBeUndefined();
  });

  it('đường Q cho cùng đường cong với công thức bậc hai', () => {
    const bounds = geometryBounds(parsePathData('M 0 0 Q 5 10 10 0'));
    close(bounds.x, 0);
    close(bounds.width, 10);
    // đỉnh của Q (0,0)-(5,10)-(10,0) là y = 5
    close(bounds.y, 0);
    close(bounds.height, 5);
  });
});

describe('parsePathData: cung elip (A)', () => {
  it('nửa đường tròn đi qua điểm đúng phía theo cờ sweep', () => {
    const up = geometryBounds(parsePathData('M 0 0 A 5 5 0 0 1 10 0'));
    close(up.x, 0, 3);
    close(up.width, 10, 3);
    close(up.y, -5, 2);
    close(up.height, 5, 2);

    const down = geometryBounds(parsePathData('M 0 0 A 5 5 0 0 0 10 0'));
    close(down.y, 0, 2);
    close(down.height, 5, 2);
  });

  it('cờ large-arc chọn cung dài hơn nửa vòng', () => {
    // từ (10,0) tới (0,10), bán kính 10, sweep=1 (chiều kim đồng hồ trên màn hình):
    // cung ngắn quanh tâm (0,0), cung dài (270 độ) quanh tâm (10,10)
    const small = geometryBounds(parsePathData('M 10 0 A 10 10 0 0 1 0 10'));
    close(small.x, 0, 2);
    close(small.y, 0, 2);
    close(small.width, 10, 2);
    close(small.height, 10, 2);

    const large = geometryBounds(parsePathData('M 10 0 A 10 10 0 1 1 0 10'));
    close(large.x, 0, 2);
    close(large.width, 20, 2);
    close(large.y, 0, 2);
    close(large.height, 20, 2);
  });

  it('chia cung thành các đoạn tối đa 90 độ', () => {
    // 270 độ -> 3 đoạn; 90 độ -> 1 đoạn
    expect(nodesOf('M 10 0 A 10 10 0 1 1 0 10')).toHaveLength(4);
    expect(nodesOf('M 10 0 A 10 10 0 0 1 0 10')).toHaveLength(2);
    expect(nodesOf('M 0 0 A 5 5 0 0 1 10 0')).toHaveLength(3);
  });

  it('điểm cuối của cung chính xác bằng điểm cuối khai báo', () => {
    const nodes = nodesOf('M 3 4 A 7 5 30 1 0 17.25 9.5');
    expect(nodes[nodes.length - 1]).toMatchObject({ x: 17.25, y: 9.5 });
  });

  it('cung tương đối a tính theo điểm hiện tại', () => {
    const nodes = nodesOf('M 10 10 a 5 5 0 0 1 10 0');
    expect(nodes[nodes.length - 1]).toMatchObject({ x: 20, y: 10 });
  });

  it('đọc cờ cung viết liền không có dấu cách', () => {
    const compact = parsePathData('M 0 0 a1 1 0 00.5.5');
    const spaced = parsePathData('M 0 0 a 1 1 0 0 0 0.5 0.5');
    expectSameShape(spaced, compact);

    const flagsTight = parsePathData('M 0 0 a2 2 0 1110 0');
    const flagsSpaced = parsePathData('M 0 0 a 2 2 0 1 1 10 0');
    expectSameShape(flagsSpaced, flagsTight);
  });

  it('bán kính quá nhỏ được phóng to vừa đủ để nối hai điểm', () => {
    const bounds = geometryBounds(parsePathData('M 0 0 A 1 1 0 0 1 10 0'));
    // bán kính hiệu dụng 5 -> nửa đường tròn cao 5
    close(bounds.width, 10, 2);
    close(Math.abs(bounds.height), 5, 2);
  });

  it('bán kính 0 thành đoạn thẳng', () => {
    expect(nodesOf('M 0 0 A 0 5 0 0 1 10 10')).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(nodesOf('M 0 0 A 5 0 0 0 1 10 10')).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('điểm cuối trùng điểm đầu thì bỏ cung', () => {
    expect(nodesOf('M 5 5 A 3 3 0 0 1 5 5')).toEqual([{ x: 5, y: 5 }]);
    // đường vẫn đi tiếp bình thường sau cung bị bỏ
    expect(nodesOf('M 5 5 A 3 3 0 0 1 5 5 L 9 9')).toEqual([
      { x: 5, y: 5 },
      { x: 9, y: 9 },
    ]);
  });

  it('cung elip xoay: mọi điểm của đường nằm trên elip', () => {
    const geometry = parsePathData('M 12 4 A 8 4 40 0 1 4 12');
    const nodes = geometry.subpaths[0].nodes;
    const radians = (40 * Math.PI) / 180;
    // tìm tâm: giải theo công thức chuyển điểm cuối sang tâm
    const dx = (12 - 4) / 2;
    const dy = (4 - 12) / 2;
    const x1p = Math.cos(radians) * dx + Math.sin(radians) * dy;
    const y1p = -Math.sin(radians) * dx + Math.cos(radians) * dy;
    const lambda = (x1p * x1p) / 64 + (y1p * y1p) / 16;
    const scale = lambda > 1 ? Math.sqrt(lambda) : 1;
    const rx = 8 * scale;
    const ry = 4 * scale;
    const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const factor = Math.sqrt(Math.max(0, numerator / denominator)); // large=0, sweep=1 -> dấu dương
    const cxp = (factor * rx * y1p) / ry;
    const cyp = (-factor * ry * x1p) / rx;
    const cx = Math.cos(radians) * cxp - Math.sin(radians) * cyp + 8;
    const cy = Math.sin(radians) * cxp + Math.cos(radians) * cyp + 8;
    for (const node of nodes) {
      const ux = Math.cos(radians) * (node.x - cx) + Math.sin(radians) * (node.y - cy);
      const uy = -Math.sin(radians) * (node.x - cx) + Math.cos(radians) * (node.y - cy);
      close((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry), 1, 6);
    }
  });

  it('tay cầm Bezier của cung tròn xấp xỉ đường tròn dưới 0,1%', () => {
    // vòng tròn đầy đủ từ hai cung nửa vòng
    const geometry = parsePathData('M 0 12 A 12 12 0 1 1 24 12 A 12 12 0 1 1 0 12 Z');
    const bounds = geometryBounds(geometry);
    close(bounds.x, 0, 2);
    close(bounds.y, 0, 2);
    close(bounds.width, 24, 2);
    close(bounds.height, 24, 2);
  });
});

describe('pathToData / subpathToData', () => {
  it('xuất đoạn thẳng, đoạn cong và Z', () => {
    expect(pathToData(parsePathData('M 0 0 L 10 0 L 10 10 Z'))).toBe('M 0 0 L 10 0 L 10 10 Z');
    expect(pathToData(parsePathData('M 0 0 C 1 2 3 4 5 6'))).toBe('M 0 0 C 1 2 3 4 5 6');
    expect(pathToData(parsePathData('M 0 0 L 4 4'))).toBe('M 0 0 L 4 4');
  });

  it('đường đóng có đoạn cong quay về điểm đầu thì xuất thêm đoạn C trước Z', () => {
    const data = pathToData(parsePathData('M 0 0 C 0 5 5 10 10 10 C 15 10 20 5 20 0 C 20 -5 15 -10 10 -10 C 5 -10 0 -5 0 0 Z'));
    expect(data.endsWith('C 5 -10 0 -5 0 0 Z')).toBe(true);
  });

  it('đường đóng chỉ có đoạn thẳng không thêm đoạn quay về', () => {
    expect(subpathToData({ closed: true, nodes: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }] })).toBe(
      'M 0 0 L 4 0 L 4 4 Z',
    );
  });

  it('đoạn chỉ có một tay cầm vẫn xuất thành C với tay cầm còn lại trùng điểm neo', () => {
    const data = subpathToData({
      closed: false,
      nodes: [{ x: 0, y: 0, hout: { x: 2, y: 0 } }, { x: 4, y: 4 }],
    });
    expect(data).toBe('M 0 0 C 2 0 4 4 4 4');
  });

  it('đường con rỗng cho chuỗi rỗng và bị lọc khỏi pathToData', () => {
    expect(subpathToData({ closed: false, nodes: [] })).toBe('');
    expect(pathToData({ type: 'path', subpaths: [{ closed: false, nodes: [] }, { closed: false, nodes: [{ x: 1, y: 1 }] }] })).toBe(
      'M 1 1',
    );
    expect(pathToData({ type: 'path', subpaths: [] })).toBe('');
  });

  it('đường con một điểm đóng xuất M ... Z', () => {
    expect(subpathToData({ closed: true, nodes: [{ x: 2, y: 3 }] })).toBe('M 2 3 Z');
  });
});

describe('vòng khứ hồi parse -> pathToData -> parse', () => {
  const samples: Record<string, string> = {
    thẳng: 'M 2 2 L 10 2 L 10 10 L 2 10 Z',
    'tương đối': 'm 2 2 l 8 0 l 0 8 l -8 0 z',
    'nhiều đường con': 'M 0 0 L 4 4 M 6 6 C 7 6 8 7 8 8 L 9 9 Z',
    'đóng bằng điểm cuối trùng': 'M 0 0 C 0 5 5 10 10 10 C 15 10 20 5 20 0 C 20 -5 15 -10 10 -10 C 5 -10 0 -5 0 0 Z',
    'S, Q, T': 'M 0 0 C 1 0 2 1 3 3 S 6 6 7 7 Q 8 10 10 7 T 14 7',
    cung: 'M 3 4 A 7 5 30 1 0 17.25 9.5 l 2 2 a 3 3 0 0 1 4 0',
  };

  for (const [label, data] of Object.entries(samples)) {
    it(`giữ nguyên hình dạng: ${label}`, () => {
      const first = parsePathData(data);
      const second = parsePathData(pathToData(first));
      expectSameShape(first, second);
      // xuất lần nữa phải ổn định
      expect(pathToData(second)).toBe(pathToData(first));
    });
  }

  it('giữ nguyên hình dạng với toàn bộ nét của thư viện hình mẫu và icon mẫu', () => {
    const all = [
      ...GLYPH_LIBRARY.map((glyph) => glyph.path),
      ...LEGACY_PRESETS.flatMap((spec) => [spec.glyphPath, spec.secondaryPath ?? '']).filter(Boolean),
    ];
    expect(all.length).toBeGreaterThan(20);
    for (const data of all) {
      const first = parsePathData(data);
      expect(first.subpaths.length).toBeGreaterThan(0);
      const second = parsePathData(pathToData(first));
      expectSameShape(first, second);
    }
  });
});

describe('isValidPathData', () => {
  it('chấp nhận chuỗi rỗng, undefined và chuỗi bắt đầu bằng M', () => {
    expect(isValidPathData(undefined)).toBe(true);
    expect(isValidPathData('')).toBe(true);
    expect(isValidPathData('   ')).toBe(true);
    expect(isValidPathData('M 1 1 L 2 2 Z')).toBe(true);
    expect(isValidPathData('m1,1l2e1-3z')).toBe(true);
  });

  it('từ chối chuỗi không bắt đầu bằng M hoặc có ký tự lạ', () => {
    expect(isValidPathData('L 1 1')).toBe(false);
    expect(isValidPathData('M 1 1"')).toBe(false);
    expect(isValidPathData('M 1 1 <script>')).toBe(false);
    expect(isValidPathData('M 1 1; DROP')).toBe(false);
    expect(isValidPathData('M 1 1 onload=1')).toBe(false);
  });

  it('từ chối chuỗi dài quá giới hạn', () => {
    const body = ' L 1 1'.repeat(Math.ceil(MAX_PATH_DATA_LENGTH / 6) + 1);
    expect(isValidPathData(`M 0 0${body}`)).toBe(false);
    expect(isValidPathData(`M 0 0${' L 1 1'.repeat(100)}`)).toBe(true);
  });
});
