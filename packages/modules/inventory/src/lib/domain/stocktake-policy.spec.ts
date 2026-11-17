import type { StocktakeLine } from '@enterprise-platform/contracts-inventory';
import {
  assertStocktakeNotSelfApproved,
  assertStocktakeTransition,
  buildAdjustmentLines,
  lineFigures,
  linesMissingReason,
  nextStocktakeCode,
  requireCountedQuantity,
  sessionTotals,
} from './stocktake-policy.js';

function line(overrides: Partial<StocktakeLine>): StocktakeLine {
  return {
    id: 'l1',
    sessionId: 's1',
    materialId: 'm1',
    materialCode: 'VT-001',
    materialName: 'Vật tư 1',
    unit: 'Cái',
    systemQuantity: 10,
    actualQuantity: 10,
    difference: 0,
    unitCost: 1000,
    differenceValue: 0,
    status: 'MATCHED',
    ...overrides,
  };
}

describe('stocktake policy', () => {
  describe('máy trạng thái', () => {
    it('cho phép đúng các bước của vòng đời', () => {
      expect(() => assertStocktakeTransition({ code: 'KK-1', status: 'DRAFT' }, 'start')).not.toThrow();
      expect(() => assertStocktakeTransition({ code: 'KK-1', status: 'COUNTING' }, 'submit')).not.toThrow();
      expect(() => assertStocktakeTransition({ code: 'KK-1', status: 'PENDING_APPROVAL' }, 'approve')).not.toThrow();
      expect(() => assertStocktakeTransition({ code: 'KK-1', status: 'PENDING_APPROVAL' }, 'reject')).not.toThrow();
      expect(() => assertStocktakeTransition({ code: 'KK-1', status: 'APPROVED' }, 'post')).not.toThrow();
    });

    it('chặn bước sai thứ tự, kể cả ghi sổ khi chưa duyệt', () => {
      expect(() => assertStocktakeTransition({ code: 'KK-1', status: 'COUNTING' }, 'post')).toThrow(/Đang kiểm đếm/);
      expect(() => assertStocktakeTransition({ code: 'KK-1', status: 'PENDING_APPROVAL' }, 'post')).toThrow(
        /không thể ghi sổ/,
      );
      expect(() => assertStocktakeTransition({ code: 'KK-1', status: 'DRAFT' }, 'count')).toThrow();
    });

    it('đợt đã ghi sổ hoặc đã huỷ là cuối, không đổi được nữa', () => {
      for (const status of ['POSTED', 'CANCELLED'] as const) {
        for (const action of ['start', 'count', 'submit', 'reject', 'approve', 'post', 'cancel'] as const) {
          expect(() => assertStocktakeTransition({ code: 'KK-1', status }, action)).toThrow();
        }
      }
    });

    it('huỷ được ở mọi trạng thái chưa ghi sổ', () => {
      for (const status of ['DRAFT', 'COUNTING', 'PENDING_APPROVAL', 'APPROVED'] as const) {
        expect(() => assertStocktakeTransition({ code: 'KK-1', status }, 'cancel')).not.toThrow();
      }
    });
  });

  describe('tự duyệt', () => {
    it('chặn người lập hoặc người gửi duyệt tự duyệt khi cấu hình không cho phép', () => {
      expect(() => assertStocktakeNotSelfApproved({ code: 'KK-1', createdBy: 'u1' }, 'u1', false)).toThrow(
        /cần người khác duyệt/,
      );
      expect(() =>
        assertStocktakeNotSelfApproved({ code: 'KK-1', createdBy: 'u1', submittedBy: 'u2' }, 'u2', false),
      ).toThrow();
    });

    it('cho qua khi cấu hình cho phép hoặc người duyệt là người khác', () => {
      expect(() => assertStocktakeNotSelfApproved({ code: 'KK-1', createdBy: 'u1' }, 'u1', true)).not.toThrow();
      expect(() => assertStocktakeNotSelfApproved({ code: 'KK-1', createdBy: 'u1' }, 'u9', false)).not.toThrow();
    });
  });

  describe('chênh lệch từng dòng', () => {
    it('chưa đếm thì chưa có chênh lệch', () => {
      expect(lineFigures(10, undefined, 500)).toEqual({ difference: 0, differenceValue: 0, status: 'UNCOUNTED' });
    });

    it('khớp, thừa, thiếu và giá trị theo giá vốn chụp', () => {
      expect(lineFigures(10, 10, 500).status).toBe('MATCHED');
      expect(lineFigures(10, 12, 500)).toEqual({ difference: 2, differenceValue: 1000, status: 'SURPLUS' });
      expect(lineFigures(10, 7.5, 400)).toEqual({ difference: -2.5, differenceValue: -1000, status: 'DEFICIT' });
    });

    it('không để số thực làm lệch chênh lệch', () => {
      expect(lineFigures(0.3, 0.1 + 0.2, 100).difference).toBe(0);
    });

    it('đếm 0 là đã đếm (hết hàng), không phải chưa đếm', () => {
      expect(lineFigures(5, 0, 100).status).toBe('DEFICIT');
    });
  });

  describe('số đếm hợp lệ', () => {
    it('từ chối số âm, không hữu hạn, quá 3 chữ số thập phân', () => {
      expect(() => requireCountedQuantity(-1, 'VT-001')).toThrow(/không âm/);
      expect(() => requireCountedQuantity(Number.NaN, 'VT-001')).toThrow();
      expect(() => requireCountedQuantity('5', 'VT-001')).toThrow();
      expect(() => requireCountedQuantity(1.2345, 'VT-001')).toThrow(/3 chữ số/);
      expect(requireCountedQuantity(0, 'VT-001')).toBe(0);
      expect(requireCountedQuantity(2.125, 'VT-001')).toBe(2.125);
    });
  });

  describe('tổng hợp đợt', () => {
    it('đếm dòng đã đếm, dòng lệch và cộng giá trị lệch', () => {
      const totals = sessionTotals([
        line({ status: 'MATCHED' }),
        line({ status: 'SURPLUS', differenceValue: 3000 }),
        line({ status: 'DEFICIT', differenceValue: -1200.5 }),
        line({ status: 'UNCOUNTED', differenceValue: 0 }),
      ]);
      expect(totals).toEqual({ totalItems: 4, countedItems: 3, differenceItems: 2, totalVarianceValue: 1799.5 });
    });
  });

  describe('lý do chênh lệch', () => {
    it('liệt kê dòng lệch mà chưa có lý do', () => {
      const lines = [
        line({ id: 'a', status: 'DEFICIT', difference: -1, reason: 'Hao hụt' }),
        line({ id: 'b', status: 'SURPLUS', difference: 1, reason: '  ' }),
        line({ id: 'c', status: 'MATCHED' }),
      ];
      expect(linesMissingReason(lines).map((item) => item.id)).toEqual(['b']);
    });
  });

  describe('dựng dòng chứng từ điều chỉnh', () => {
    it('dòng khớp không sinh dòng điều chỉnh', () => {
      expect(buildAdjustmentLines('KK-2026-00001', [line({})])).toEqual([]);
    });

    it('vật tư thường: thừa thành nhập, thiếu thành xuất, kèm lý do và mã đợt', () => {
      const result = buildAdjustmentLines('KK-2026-00001', [
        line({ materialCode: 'A', difference: 3, status: 'SURPLUS', reason: 'Nhập chưa ghi' }),
        line({ materialCode: 'B', difference: -2, status: 'DEFICIT', reason: 'Hao hụt' }),
      ]);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ materialCode: 'A', direction: 'IN', quantity: 3, unitCost: 1000 });
      expect(result[1]).toMatchObject({ materialCode: 'B', direction: 'OUT', quantity: 2 });
      expect(result[0].note).toContain('KK-2026-00001');
      expect(result[1].note).toContain('Hao hụt');
    });

    it('dòng chưa đếm giữ nguyên số sổ sách, không sinh điều chỉnh', () => {
      expect(buildAdjustmentLines('KK-1', [line({ status: 'UNCOUNTED', actualQuantity: undefined, difference: 0 })])).toEqual([]);
    });

    it('vật tư theo lô: mỗi lô lệch một dòng, bỏ lô khớp', () => {
      const result = buildAdjustmentLines('KK-1', [
        line({
          isLotTracked: true,
          difference: -1,
          status: 'DEFICIT',
          lotAllocations: [
            { lotNumber: 'lot-a', systemQty: 6, actualQty: 4 },
            { lotNumber: 'LOT-B', systemQty: 4, actualQty: 5 },
            { lotNumber: 'LOT-C', systemQty: 3, actualQty: 3 },
          ],
        }),
      ]);
      expect(result.map((item) => [item.lotNo, item.direction, item.quantity])).toEqual([
        ['LOT-A', 'OUT', 2],
        ['LOT-B', 'IN', 1],
      ]);
    });

    it('vật tư theo lô: báo lỗi khi tổng lệch các lô không khớp dòng, hoặc chưa khai lô', () => {
      expect(() =>
        buildAdjustmentLines('KK-1', [
          line({
            isLotTracked: true,
            difference: -3,
            status: 'DEFICIT',
            lotAllocations: [{ lotNumber: 'L1', systemQty: 5, actualQty: 4 }],
          }),
        ]),
      ).toThrow(/tổng chênh lệch theo lô/);
      expect(() =>
        buildAdjustmentLines('KK-1', [line({ isLotTracked: true, difference: -1, status: 'DEFICIT' })]),
      ).toThrow(/theo từng lô/);
    });

    it('vật tư theo serial: MISSING thành giảm, EXTRA thành tăng', () => {
      const result = buildAdjustmentLines('KK-1', [
        line({
          isSerialized: true,
          difference: -1,
          status: 'DEFICIT',
          serialAllocations: [
            { serialNumber: 'S1', status: 'MISSING' },
            { serialNumber: 'S2', status: 'MISSING' },
            { serialNumber: 'S3', status: 'EXTRA' },
            { serialNumber: 'S4', status: 'FOUND' },
          ],
        }),
      ]);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ direction: 'OUT', quantity: 2, serials: ['S1', 'S2'] });
      expect(result[1]).toMatchObject({ direction: 'IN', quantity: 1, serials: ['S3'] });
    });

    it('vật tư theo serial: báo lỗi khi số serial lệch không khớp chênh lệch', () => {
      expect(() =>
        buildAdjustmentLines('KK-1', [
          line({
            isSerialized: true,
            difference: -2,
            status: 'DEFICIT',
            serialAllocations: [{ serialNumber: 'S1', status: 'MISSING' }],
          }),
        ]),
      ).toThrow(/serial thừa trừ thiếu/);
    });
  });

  describe('mã đợt', () => {
    it('bắt đầu từ 00001 mỗi năm và tăng tiếp từ mã lớn nhất', () => {
      expect(nextStocktakeCode(2026, undefined)).toBe('KK-2026-00001');
      expect(nextStocktakeCode(2026, 'KK-2026-00017')).toBe('KK-2026-00018');
      expect(nextStocktakeCode(2027, 'KK-2026-00017')).toBe('KK-2027-00001');
    });
  });
});
