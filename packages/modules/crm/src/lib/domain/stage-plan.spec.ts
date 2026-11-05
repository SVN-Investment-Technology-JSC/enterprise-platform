import { allowedTransitions } from './opportunity.js';
import { buildPipeline } from './pipeline-fixture.js';
import { assertSkippable, normalizeSkipReason, planStages, validateCreationSkips } from './stage-plan.js';

// A -> B -> C -> D(WON); lùi được; LOST từ mọi giai đoạn mở. B và C bỏ qua được.
const pipeline = buildPipeline({
  code: 'P',
  stages: [
    { code: 'A', name: 'A', semantic: 'OPEN' },
    { code: 'B', name: 'B', semantic: 'OPEN', skippable: true },
    { code: 'C', name: 'C', semantic: 'OPEN', skippable: true },
    { code: 'D', name: 'D', semantic: 'OPEN' },
    { code: 'W', name: 'W', semantic: 'WON', skippable: true },
    { code: 'L', name: 'L', semantic: 'LOST' },
  ],
  transitions: [
    ['A', 'B'], ['A', 'L'],
    ['B', 'A'], ['B', 'C'], ['B', 'L'],
    ['C', 'B'], ['C', 'D'], ['C', 'L'],
    ['D', 'C'], ['D', 'W'], ['D', 'L'],
  ],
});
const stage = (code: string) => pipeline.stages.find((s) => s.code === code)!;
const codes = (from: string, skipped: string[] = []) =>
  allowedTransitions(pipeline, stage(from), new Set(skipped.map((c) => stage(c).id))).map((s) => s.code);

describe('allowedTransitions với giai đoạn bỏ qua (SKP-01)', () => {
  it('không bỏ qua gì thì như bảng bước chuyển', () => {
    expect(codes('A')).toEqual(['B', 'L']);
  });
  it('TC-SKP-04: giai đoạn kế đã bỏ qua thì tới giai đoạn kế còn áp dụng', () => {
    expect(codes('A', ['B'])).toEqual(['C', 'L']);
    expect(codes('A', ['B', 'C'])).toEqual(['D', 'L']);
  });
  it('lùi cũng bỏ qua giai đoạn đã bỏ qua', () => {
    expect(codes('D', ['C'])).toEqual(['B', 'W', 'L']);
    expect(codes('D', ['C', 'B'])).toEqual(['A', 'W', 'L']);
  });
  it('không chuyển được về chính nó hay tới giai đoạn đã bỏ qua', () => {
    expect(codes('C', ['B'])).not.toContain('B');
    expect(codes('B', ['C'])).toEqual(['A', 'D', 'L']);
  });
});

describe('assertSkippable và validateCreationSkips', () => {
  it('TC-SKP-01: giai đoạn không đánh dấu thì 409', () => {
    expect(() => assertSkippable(stage('D'), 'PENDING')).toThrow(expect.objectContaining({ statusCode: 409 }));
  });
  it('TC-SKP-08: giai đoạn hiện tại, đã qua, đã bỏ qua, Thắng, Thua đều 409', () => {
    expect(() => assertSkippable(stage('B'), 'ACTIVE')).toThrow(expect.objectContaining({ code: 'STAGE_IS_CURRENT' }));
    expect(() => assertSkippable(stage('B'), 'DONE')).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(() => assertSkippable(stage('B'), 'SKIPPED')).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(() => assertSkippable(stage('W'), 'PENDING')).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(() => assertSkippable(stage('L'), 'PENDING')).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(() => assertSkippable(stage('B'), 'PENDING')).not.toThrow();
  });
  it('TC-SKP-03: lý do bắt buộc (400), cắt khoảng trắng, tối đa 2000 ký tự', () => {
    expect(() => normalizeSkipReason('  ')).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => normalizeSkipReason(undefined)).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => normalizeSkipReason('x'.repeat(2001))).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(normalizeSkipReason(' Khách đã khảo sát ')).toBe('Khách đã khảo sát');
  });
  it('TC-SKP-02: bỏ qua lúc tạo; giai đoạn đầu, mã lạ, trùng, thiếu lý do bị chặn', () => {
    const start = stage('A');
    expect([...validateCreationSkips(pipeline, start, [{ stage: 'B', reason: 'Đã khảo sát' }]).entries()]).toEqual([
      [stage('B').id, 'Đã khảo sát'],
    ]);
    expect(() => validateCreationSkips(pipeline, start, [{ stage: 'A', reason: 'x' }])).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    );
    expect(() => validateCreationSkips(pipeline, start, [{ stage: 'ZZ', reason: 'x' }])).toThrow(
      expect.objectContaining({ statusCode: 400 }),
    );
    expect(() => validateCreationSkips(pipeline, start, [{ stage: 'B', reason: '' }])).toThrow(
      expect.objectContaining({ statusCode: 400 }),
    );
    expect(() =>
      validateCreationSkips(pipeline, start, [
        { stage: 'B', reason: 'x' },
        { stage: 'B', reason: 'y' },
      ]),
    ).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
  it('kế hoạch chỉ gồm giai đoạn đang bật theo thứ tự', () => {
    expect(planStages(pipeline).map((s) => s.code)).toEqual(['A', 'B', 'C', 'D', 'W', 'L']);
  });
});
