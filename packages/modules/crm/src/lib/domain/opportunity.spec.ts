import { CrmConflictError, CrmValidationError } from './crm.error.js';
import {
  allowedTransitions,
  assertRequirementsMet,
  assertStageTransition,
  blockingRequirements,
  canTransition,
  estimateMargin,
  evaluateRequirements,
  findStage,
  firstStage,
  normalizeProbability,
  stageSideEffects,
  type RequirementContext,
} from './opportunity.js';
import { buildPipeline, fiveStagePipeline, sevenStagePipeline } from './pipeline-fixture.js';

/** Bảng chuyển ở mục 5.1 kế hoạch phase 1, viết tay để so với cấu hình luồng 7 giai đoạn. */
const VALID_7: readonly (readonly [string, string])[] = [
  ['NEW', 'CONTACTED'], ['CONTACTED', 'DISCOVERY'], ['DISCOVERY', 'QUOTING'], ['QUOTING', 'NEGOTIATION'],
  ['NEGOTIATION', 'WON'], ['CONTACTED', 'NEW'], ['DISCOVERY', 'CONTACTED'], ['QUOTING', 'DISCOVERY'],
  ['NEGOTIATION', 'QUOTING'], ['NEW', 'LOST'], ['CONTACTED', 'LOST'], ['DISCOVERY', 'LOST'],
  ['QUOTING', 'LOST'], ['NEGOTIATION', 'LOST'],
];
const VALID_5: readonly (readonly [string, string])[] = [
  ['LEAD', 'QUALIFIED'], ['QUALIFIED', 'PROPOSAL'], ['PROPOSAL', 'CLOSED_WON'], ['QUALIFIED', 'LEAD'],
  ['PROPOSAL', 'QUALIFIED'], ['LEAD', 'CLOSED_LOST'], ['QUALIFIED', 'CLOSED_LOST'], ['PROPOSAL', 'CLOSED_LOST'],
];

function table(pipeline: ReturnType<typeof sevenStagePipeline>, valid: readonly (readonly [string, string])[]) {
  const codes = pipeline.stages.map((stage) => stage.code);
  const pairs = codes.flatMap((from) => codes.map((to) => [from, to] as const));
  const isValid = (from: string, to: string) => valid.some(([a, b]) => a === from && b === to);
  return { pairs, valid: pairs.filter(([a, b]) => isValid(a, b)), invalid: pairs.filter(([a, b]) => !isValid(a, b)) };
}

function stage(pipeline: ReturnType<typeof sevenStagePipeline>, code: string) {
  const found = findStage(pipeline, code);
  if (!found) throw new Error(`no stage ${code}`);
  return found;
}

describe.each([
  ['luồng 7 giai đoạn', sevenStagePipeline(), VALID_7, 49, 14],
  ['luồng 5 giai đoạn', fiveStagePipeline(), VALID_5, 25, 8],
] as const)('máy trạng thái cơ hội, %s', (_name, pipeline, validPairs, total, validCount) => {
  const { valid, invalid, pairs } = table(pipeline, validPairs);

  it('đủ số cặp, đúng số cặp hợp lệ', () => {
    expect(pairs).toHaveLength(total);
    expect(valid).toHaveLength(validCount);
  });

  it.each(valid)('TC-SM-01: %s → %s chạy được', (from, to) => {
    const target = stage(pipeline, to);
    expect(canTransition(pipeline, stage(pipeline, from), target)).toBe(true);
    const reason = assertStageTransition(pipeline, stage(pipeline, from), target, target.semantic === 'LOST' ? '  Giá cao  ' : null);
    expect(reason).toBe(target.semantic === 'LOST' ? 'Giá cao' : null);
  });

  it.each(invalid)('TC-SM-02: %s → %s bị chặn 409 bằng tiếng Việt', (from, to) => {
    expect(canTransition(pipeline, stage(pipeline, from), stage(pipeline, to))).toBe(false);
    let thrown: unknown;
    try {
      assertStageTransition(pipeline, stage(pipeline, from), stage(pipeline, to), 'lý do');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CrmConflictError);
    expect(thrown).toMatchObject({ statusCode: 409, code: 'INVALID_STAGE_TRANSITION' });
    expect((thrown as Error).message).toMatch(/^Không thể chuyển cơ hội từ ".+" sang ".+"\.$/);
  });
});

describe('quy tắc theo nghĩa giai đoạn', () => {
  const seven = sevenStagePipeline();
  const five = fiveStagePipeline();

  it('TC-OPP-04, TC-PL-07: sang giai đoạn nghĩa LOST thiếu lý do trả 400, kể cả khi tên là "Rớt"', () => {
    for (const reason of [undefined, null, '', '   ']) {
      expect(() => assertStageTransition(seven, stage(seven, 'NEGOTIATION'), stage(seven, 'LOST'), reason)).toThrow(
        'Phải ghi lý do thua.',
      );
      expect(() => assertStageTransition(five, stage(five, 'PROPOSAL'), stage(five, 'CLOSED_LOST'), reason)).toThrow(
        CrmValidationError,
      );
    }
    expect(() =>
      assertStageTransition(five, stage(five, 'PROPOSAL'), stage(five, 'CLOSED_LOST'), 'x'.repeat(2001)),
    ).toThrow('tối đa 2000');
    expect(assertStageTransition(five, stage(five, 'PROPOSAL'), stage(five, 'CLOSED_LOST'), ' Giá cao ')).toBe('Giá cao');
  });

  it('chuyển sang giai đoạn không phải LOST không bắt buộc lý do', () => {
    expect(assertStageTransition(five, stage(five, 'LEAD'), stage(five, 'QUALIFIED'), undefined)).toBeNull();
  });

  it('chuyển sai bảng báo 409 trước khi xét lý do; giai đoạn cuối không chuyển đi đâu', () => {
    expect(() => assertStageTransition(seven, stage(seven, 'WON'), stage(seven, 'LOST'), '')).toThrow(CrmConflictError);
    expect(allowedTransitions(seven, stage(seven, 'WON'))).toEqual([]);
    expect(allowedTransitions(five, stage(five, 'CLOSED_LOST'))).toEqual([]);
  });

  it('giai đoạn cuối không chuyển đi được kể cả khi bảng có bước chuyển lạc', () => {
    const odd = buildPipeline({
      code: 'ODD',
      stages: [
        { code: 'A', name: 'A', semantic: 'OPEN' },
        { code: 'W', name: 'W', semantic: 'WON' },
      ],
      transitions: [['A', 'W'], ['W', 'A']],
    });
    expect(canTransition(odd, stage(odd, 'W'), stage(odd, 'A'))).toBe(false);
  });

  it('giai đoạn đích cho kanban theo thứ tự luồng', () => {
    expect(allowedTransitions(seven, stage(seven, 'NEW')).map((item) => item.code)).toEqual(['CONTACTED', 'LOST']);
    expect(allowedTransitions(seven, stage(seven, 'NEGOTIATION')).map((item) => item.code)).toEqual(['QUOTING', 'WON', 'LOST']);
    expect(allowedTransitions(five, stage(five, 'QUALIFIED')).map((item) => item.code)).toEqual(['LEAD', 'PROPOSAL', 'CLOSED_LOST']);
  });

  it('TC-PL-15: không chuyển mới vào giai đoạn đã tắt, nhưng từ giai đoạn đã tắt vẫn chuyển đi được', () => {
    const pipeline = buildPipeline({
      code: 'OFF',
      stages: [
        { code: 'A', name: 'A', semantic: 'OPEN' },
        { code: 'B', name: 'B', semantic: 'OPEN', active: false },
        { code: 'C', name: 'C', semantic: 'OPEN' },
      ],
      transitions: [['A', 'B'], ['A', 'C'], ['B', 'C']],
    });
    expect(canTransition(pipeline, stage(pipeline, 'A'), stage(pipeline, 'B'))).toBe(false);
    expect(allowedTransitions(pipeline, stage(pipeline, 'A')).map((item) => item.code)).toEqual(['C']);
    expect(canTransition(pipeline, stage(pipeline, 'B'), stage(pipeline, 'C'))).toBe(true);
    expect(firstStage(pipeline)?.code).toBe('A');
  });

  it('giai đoạn đầu: bật, nghĩa OPEN, thứ tự nhỏ nhất', () => {
    expect(firstStage(seven)?.code).toBe('NEW');
    expect(firstStage(five)?.code).toBe('LEAD');
  });

  it('TC-OPP-06: xác suất là số nguyên 0–100', () => {
    expect(normalizeProbability(50)).toBe(50);
    expect(normalizeProbability(undefined, 10)).toBe(10);
    for (const bad of [-1, 101, 12.5, 'abc']) {
      expect(() => normalizeProbability(bad)).toThrow('Xác suất phải là số nguyên từ 0 đến 100.');
    }
  });

  it('tác động phụ theo giai đoạn đích: Báo giá tạo nháp, nghĩa LOST từ chối báo giá mở, Thắng không còn cứng', () => {
    expect(stageSideEffects({ code: 'QUOTING', semantic: 'OPEN' }, '2026-11-02')).toEqual({
      draftQuoteValidUntil: '2026-12-02',
    });
    expect(stageSideEffects({ code: 'CLOSED_LOST', semantic: 'LOST' }, '2026-11-02')).toEqual({ declineOpenQuotes: true });
    expect(stageSideEffects({ code: 'WON', semantic: 'WON' }, '2026-11-02')).toEqual({});
  });
});

describe('điều kiện chuyển giai đoạn', () => {
  const context = (patch: Partial<RequirementContext> = {}): RequirementContext => ({
    fields: {},
    reason: null,
    hasAcceptedQuote: false,
    ...patch,
  });
  const gate = (requirements: Parameters<typeof buildPipeline>[0]['stages'][number]['requirements']) =>
    stage(
      buildPipeline({
        code: 'G',
        stages: [
          { code: 'A', name: 'A', semantic: 'OPEN' },
          { code: 'B', name: 'Đàm phán', semantic: 'OPEN', requirements },
        ],
        transitions: [['A', 'B']],
      }),
      'B',
    );

  it('TC-PL-08: QUOTE_APPROVED thiếu thì chặn bằng mã ACCEPTED_QUOTE_REQUIRED và thông báo cấu hình', () => {
    const to = gate([{ kind: 'QUOTE_APPROVED', message: 'Cần báo giá được chấp nhận.' }]);
    expect(() => assertRequirementsMet(evaluateRequirements(to, context()))).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'ACCEPTED_QUOTE_REQUIRED', message: 'Cần báo giá được chấp nhận.' }),
    );
    expect(() => assertRequirementsMet(evaluateRequirements(to, context({ hasAcceptedQuote: true })))).not.toThrow();
  });

  it('TC-PL-09: FIELD thiếu nêu rõ trường; điền rồi qua; 0 là có giá trị, chuỗi trắng là trống', () => {
    const to = gate([{ kind: 'FIELD', ref: 'budget' }]);
    expect(() => assertRequirementsMet(evaluateRequirements(to, context({ fields: { budget: null } })))).toThrow(
      'Cần điền "Ngân sách" trước khi chuyển sang "Đàm phán".',
    );
    expect(() => assertRequirementsMet(evaluateRequirements(to, context({ fields: { budget: 0 } })))).not.toThrow();
    expect(() => assertRequirementsMet(evaluateRequirements(to, context({ fields: { budget: 5_000_000 } })))).not.toThrow();
    const text = gate([{ kind: 'FIELD', ref: 'need' }]);
    expect(() => assertRequirementsMet(evaluateRequirements(text, context({ fields: { need: '   ' } })))).toThrow('"Nhu cầu"');
  });

  it('REASON: cần lý do khi chuyển vào giai đoạn không phải LOST', () => {
    const to = gate([{ kind: 'REASON' }]);
    expect(() => assertRequirementsMet(evaluateRequirements(to, context()))).toThrow(
      expect.objectContaining({ code: 'STAGE_REQUIREMENTS_NOT_MET' }),
    );
    expect(() => assertRequirementsMet(evaluateRequirements(to, context({ reason: 'Khách yêu cầu' })))).not.toThrow();
  });

  it('thiếu nhiều điều kiện: một lỗi 409 nêu đủ, kèm danh sách missing', () => {
    const to = gate([{ kind: 'FIELD', ref: 'budget' }, { kind: 'QUOTE_APPROVED' }]);
    let thrown: unknown;
    try {
      assertRequirementsMet(evaluateRequirements(to, context()));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ statusCode: 409, code: 'STAGE_REQUIREMENTS_NOT_MET' });
    expect((thrown as CrmConflictError).details?.['missing']).toHaveLength(2);
  });

  it('TC-PL-20: DOCUMENT_TYPE bắt buộc thiếu chặn, không bắt buộc không chặn nhưng vẫn nằm trong danh sách', () => {
    const to = gate([
      { kind: 'DOCUMENT_TYPE', ref: 'HOP_DONG', required: true, message: 'Cần hợp đồng.' },
      { kind: 'DOCUMENT_TYPE', ref: 'BAO_GIA_PDF', required: false, message: 'Nên có báo giá PDF.' },
    ]);
    const present = new Set<string>();
    const checks = evaluateRequirements(to, context({ documentTypeMet: (ref) => present.has(ref) }));
    expect(blockingRequirements(checks).map((check) => check.ref)).toEqual(['HOP_DONG']);
    expect(() => assertRequirementsMet(checks)).toThrow('Cần hợp đồng.');
    present.add('HOP_DONG');
    const after = evaluateRequirements(to, context({ documentTypeMet: (ref) => present.has(ref) }));
    expect(() => assertRequirementsMet(after)).not.toThrow();
    expect(after.find((check) => check.ref === 'BAO_GIA_PDF')).toMatchObject({ required: false, met: false });
  });

  it('DOCUMENT_TYPE khi chưa có kho tài liệu: chưa kiểm được (met = null), không chặn', () => {
    const to = gate([{ kind: 'DOCUMENT_TYPE', ref: 'HOP_DONG', required: true }]);
    const checks = evaluateRequirements(to, context());
    expect(checks[0]).toMatchObject({ met: null, required: true });
    expect(() => assertRequirementsMet(checks)).not.toThrow();
  });

  it('không có điều kiện thì không chặn', () => {
    expect(evaluateRequirements(gate([]), context())).toEqual([]);
  });
});

describe('lợi nhuận dự toán (P2D-09)', () => {
  it('tính lợi nhuận và tỷ suất; thiếu số hoặc tổng bằng 0 thì không có tỷ suất', () => {
    expect(estimateMargin(1000, 750)).toEqual({ profit: 250, marginPercent: 25 });
    expect(estimateMargin(3, 2)).toEqual({ profit: 1, marginPercent: 33.33 });
    expect(estimateMargin(500, 600)).toEqual({ profit: -100, marginPercent: -20 });
    expect(estimateMargin(0, 0)).toEqual({ profit: 0, marginPercent: null });
    expect(estimateMargin(null, 100)).toBeNull();
    expect(estimateMargin(100, undefined)).toBeNull();
  });
});
