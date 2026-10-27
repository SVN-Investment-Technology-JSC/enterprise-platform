import { OPPORTUNITY_STAGES, type OpportunityStage } from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmValidationError } from './crm.error.js';
import { allowedTransitions, assertStageTransition, canTransition, normalizeProbability } from './opportunity.js';

/** Bảng chuyển ở mục 5.1 kế hoạch, viết tay để so với code. */
const VALID: readonly (readonly [OpportunityStage, OpportunityStage])[] = [
  ['NEW', 'CONTACTED'],
  ['CONTACTED', 'DISCOVERY'],
  ['DISCOVERY', 'QUOTING'],
  ['QUOTING', 'NEGOTIATION'],
  ['NEGOTIATION', 'WON'],
  ['CONTACTED', 'NEW'],
  ['DISCOVERY', 'CONTACTED'],
  ['QUOTING', 'DISCOVERY'],
  ['NEGOTIATION', 'QUOTING'],
  ['NEW', 'LOST'],
  ['CONTACTED', 'LOST'],
  ['DISCOVERY', 'LOST'],
  ['QUOTING', 'LOST'],
  ['NEGOTIATION', 'LOST'],
];
const isValid = (from: OpportunityStage, to: OpportunityStage) =>
  VALID.some(([validFrom, validTo]) => validFrom === from && validTo === to);
const ALL_PAIRS = OPPORTUNITY_STAGES.flatMap((from) => OPPORTUNITY_STAGES.map((to) => [from, to] as const));
const INVALID = ALL_PAIRS.filter(([from, to]) => !isValid(from, to));

describe('máy trạng thái cơ hội', () => {
  it('đủ 49 cặp, 14 hợp lệ', () => {
    expect(ALL_PAIRS).toHaveLength(49);
    expect(INVALID).toHaveLength(35);
  });

  it.each(VALID)('TC-SM-01: %s → %s chạy được', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(assertStageTransition(from, to, to === 'LOST' ? '  Giá cao  ' : null)).toBe(to === 'LOST' ? 'Giá cao' : null);
  });

  it.each(INVALID)('TC-SM-02: %s → %s bị chặn 409', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    let thrown: unknown;
    try {
      assertStageTransition(from, to, 'lý do');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CrmConflictError);
    expect(thrown).toMatchObject({ statusCode: 409, code: 'INVALID_STAGE_TRANSITION' });
    expect((thrown as Error).message).toMatch(/^Không thể chuyển cơ hội từ/);
  });

  it('TC-OPP-04: sang Thua thiếu lý do trả 400 "Phải ghi lý do thua"', () => {
    for (const reason of [undefined, null, '', '   ']) {
      expect(() => assertStageTransition('NEGOTIATION', 'LOST', reason)).toThrow(CrmValidationError);
      expect(() => assertStageTransition('NEGOTIATION', 'LOST', reason)).toThrow('Phải ghi lý do thua.');
    }
    expect(() => assertStageTransition('NEGOTIATION', 'LOST', 'x'.repeat(2001))).toThrow('tối đa 2000');
  });

  it('chuyển sai bảng báo 409 trước khi xét lý do', () => {
    expect(() => assertStageTransition('WON', 'LOST', '')).toThrow(CrmConflictError);
  });

  it('giai đoạn đích hợp lệ cho kanban', () => {
    expect(allowedTransitions('NEW')).toEqual(['CONTACTED', 'LOST']);
    expect(allowedTransitions('NEGOTIATION')).toEqual(['QUOTING', 'WON', 'LOST']);
    expect(allowedTransitions('WON')).toEqual([]);
    expect(allowedTransitions('LOST')).toEqual([]);
  });

  it('TC-OPP-06: xác suất là số nguyên 0–100', () => {
    expect(normalizeProbability(50)).toBe(50);
    expect(normalizeProbability(0)).toBe(0);
    expect(normalizeProbability(100)).toBe(100);
    expect(normalizeProbability(undefined, 10)).toBe(10);
    for (const bad of [-1, 101, 12.5, 'abc']) {
      expect(() => normalizeProbability(bad)).toThrow('Xác suất phải là số nguyên từ 0 đến 100.');
    }
  });
});
