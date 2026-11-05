import { computeSubordinateUserIds, type ReportingLineSnapshot } from './reporting-line.js';

/**
 * Sơ đồ mẫu:
 *   GD (giám đốc)  ← TP (trưởng phòng) ← NV1, NV2 (nhân viên)
 *                  ← KT (kế toán, báo cáo thẳng giám đốc)
 */
const POSITIONS = [
  { id: 'GD', reportsToPositionId: null },
  { id: 'TP', reportsToPositionId: 'GD' },
  { id: 'NV1', reportsToPositionId: 'TP' },
  { id: 'NV2', reportsToPositionId: 'TP' },
  { id: 'KT', reportsToPositionId: 'GD' },
];

function snapshot(assignments: ReportingLineSnapshot['assignments'], positions = POSITIONS): ReportingLineSnapshot {
  return { positions, assignments };
}

const BASE = snapshot([
  { userId: 'giam-doc', positionId: 'GD' },
  { userId: 'truong-phong', positionId: 'TP' },
  { userId: 'nhan-vien-1', positionId: 'NV1' },
  { userId: 'nhan-vien-2', positionId: 'NV2' },
  { userId: 'ke-toan', positionId: 'KT' },
]);

const sorted = (ids: Set<string>) => [...ids].sort();

describe('computeSubordinateUserIds', () => {
  it('nhân viên không có cấp dưới, và không tự tính chính mình', () => {
    expect(sorted(computeSubordinateUserIds(BASE, 'nhan-vien-1'))).toEqual([]);
  });

  it('trưởng phòng thấy cấp dưới trực tiếp', () => {
    expect(sorted(computeSubordinateUserIds(BASE, 'truong-phong'))).toEqual(['nhan-vien-1', 'nhan-vien-2']);
  });

  it('giám đốc thấy cả cấp dưới gián tiếp', () => {
    expect(sorted(computeSubordinateUserIds(BASE, 'giam-doc'))).toEqual([
      'ke-toan',
      'nhan-vien-1',
      'nhan-vien-2',
      'truong-phong',
    ]);
  });

  it('người không giữ chức danh nào thì không có cấp dưới', () => {
    expect(sorted(computeSubordinateUserIds(BASE, 'nguoi-la'))).toEqual([]);
  });

  it('ô ghi đè của phân công thắng "Báo cáo cho" của chức danh', () => {
    const data = snapshot([
      { userId: 'truong-phong', positionId: 'TP' },
      // NV1 theo chức danh báo cáo TP, nhưng phân công này ghi đè sang KT.
      { userId: 'nhan-vien-1', positionId: 'NV1', reportsToOverrideId: 'KT' },
      { userId: 'nhan-vien-2', positionId: 'NV2' },
      { userId: 'ke-toan', positionId: 'KT' },
    ]);
    expect(sorted(computeSubordinateUserIds(data, 'truong-phong'))).toEqual(['nhan-vien-2']);
    expect(sorted(computeSubordinateUserIds(data, 'ke-toan'))).toEqual(['nhan-vien-1']);
  });

  it('ô ghi đè chỉ áp cho bước đầu, sau đó leo theo chức danh', () => {
    const data = snapshot([
      { userId: 'giam-doc', positionId: 'GD' },
      { userId: 'nhan-vien-1', positionId: 'NV1', reportsToOverrideId: 'KT' },
    ]);
    // NV1 → (ghi đè) KT → GD.
    expect(sorted(computeSubordinateUserIds(data, 'giam-doc'))).toEqual(['nhan-vien-1']);
  });

  it('vòng lặp trong dữ liệu không treo và không tính người ngoài vòng', () => {
    const cyclic = [
      { id: 'A', reportsToPositionId: 'B' },
      { id: 'B', reportsToPositionId: 'C' },
      { id: 'C', reportsToPositionId: 'A' },
      { id: 'X', reportsToPositionId: null },
    ];
    const data = snapshot(
      [
        { userId: 'a', positionId: 'A' },
        { userId: 'b', positionId: 'B' },
        { userId: 'c', positionId: 'C' },
        { userId: 'x', positionId: 'X' },
      ],
      cyclic,
    );
    expect(sorted(computeSubordinateUserIds(data, 'a'))).toEqual(['b', 'c']);
    expect(sorted(computeSubordinateUserIds(data, 'x'))).toEqual([]);
  });

  it('chức danh tự báo cáo cho chính nó không làm người giữ thành cấp dưới của mình', () => {
    const data = snapshot(
      [
        { userId: 'a', positionId: 'A' },
        { userId: 'b', positionId: 'B' },
      ],
      [
        { id: 'A', reportsToPositionId: 'A' },
        { id: 'B', reportsToPositionId: 'B' },
      ],
    );
    expect(sorted(computeSubordinateUserIds(data, 'a'))).toEqual([]);
  });

  it('người giữ nhiều chức danh: cấp dưới của mọi chức danh, trừ chính mình', () => {
    const data = snapshot([
      { userId: 'kiem-nhiem', positionId: 'TP' },
      { userId: 'kiem-nhiem', positionId: 'KT' },
      { userId: 'kiem-nhiem', positionId: 'NV1' },
      { userId: 'nhan-vien-2', positionId: 'NV2' },
      { userId: 'giam-doc', positionId: 'GD' },
    ]);
    expect(sorted(computeSubordinateUserIds(data, 'kiem-nhiem'))).toEqual(['nhan-vien-2']);
  });

  it('một người có một phân công nằm dưới actor là đủ thành cấp dưới', () => {
    const data = snapshot([
      { userId: 'truong-phong', positionId: 'TP' },
      { userId: 'hai-viec', positionId: 'KT' },
      { userId: 'hai-viec', positionId: 'NV1' },
    ]);
    expect(sorted(computeSubordinateUserIds(data, 'truong-phong'))).toEqual(['hai-viec']);
  });

  it('chức danh trỏ tới node không có trong sơ đồ thì dừng', () => {
    const data = snapshot(
      [
        { userId: 'truong-phong', positionId: 'TP' },
        { userId: 'mo-coi', positionId: 'M' },
      ],
      [...POSITIONS, { id: 'M', reportsToPositionId: 'KHONG-CO' }],
    );
    expect(sorted(computeSubordinateUserIds(data, 'truong-phong'))).toEqual([]);
  });

  it('chuỗi quá sâu (dữ liệu hỏng) dừng ở giới hạn', () => {
    const positions = Array.from({ length: 80 }, (_, index) => ({
      id: `P${index}`,
      reportsToPositionId: index === 0 ? null : `P${index - 1}`,
    }));
    const data = snapshot(
      [
        { userId: 'dinh', positionId: 'P0' },
        { userId: 'gan', positionId: 'P10' },
        { userId: 'xa', positionId: 'P79' },
      ],
      positions,
    );
    expect(sorted(computeSubordinateUserIds(data, 'dinh'))).toEqual(['gan']);
  });
});
