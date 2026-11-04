import { randomUUID } from 'node:crypto';
import { buildPipeline, sevenStagePipeline } from './pipeline-fixture.js';
import {
  assertCanBeDefault,
  assertCanDeactivatePipeline,
  assertCanDeletePipeline,
  assertCanDeleteStage,
  assertCareSuggestionAllowed,
  assertOutcomeStages,
  assertSameIdSet,
  assertStageCodeFree,
  assertStagePatchAllowed,
  normalizeAssignee,
  normalizeCode,
  parseNewPipeline,
  parseNewStage,
  parsePipelinePatch,
  parseStagePatch,
  validateRequirements,
  validateTransitionTargets,
} from './pipeline-config.js';

const DOC_CODES = new Set(['LEGAL_DOSSIER', 'ESTIMATE', 'BUSINESS_PLAN']);
const standard = sevenStagePipeline();
const stage = (code: string) => standard.stages.find((candidate) => candidate.code === code)!;

describe('pipeline-config (domain)', () => {
  describe('mã và tên', () => {
    it('đổi mã sang chữ hoa, từ chối ký tự lạ, rỗng, bắt đầu bằng số', () => {
      expect(normalizeCode(' gui_mau ', 'giai đoạn')).toBe('GUI_MAU');
      for (const bad of ['', '  ', '1ABC', 'GỬI', 'A B', 'A'.repeat(33), null, 5]) {
        expect(() => normalizeCode(bad, 'giai đoạn')).toThrow(expect.objectContaining({ statusCode: 400 }));
      }
    });

    it('luồng mới cần mã và tên; profile sai bị từ chối', () => {
      expect(parseNewPipeline({ code: 'abc', name: ' Luồng ', profile: 'TENDER' })).toMatchObject({ code: 'ABC', name: 'Luồng', profile: 'TENDER' });
      expect(() => parseNewPipeline({ code: 'ABC', name: '  ' })).toThrow(expect.objectContaining({ code: 'NAME_REQUIRED' }));
      expect(() => parseNewPipeline({ code: 'ABC', name: 'x', profile: 'OTHER' })).toThrow(expect.objectContaining({ code: 'INVALID_PROFILE' }));
      expect(() => parseNewPipeline('x')).toThrow(expect.objectContaining({ code: 'INVALID_BODY' }));
    });

    it('sửa luồng: không đổi profile, mã; không để trống', () => {
      expect(() => parsePipelinePatch({ profile: 'TENDER' })).toThrow(expect.objectContaining({ code: 'PROFILE_LOCKED' }));
      expect(() => parsePipelinePatch({ code: 'X' })).toThrow(expect.objectContaining({ code: 'PIPELINE_CODE_LOCKED' }));
      expect(() => parsePipelinePatch({})).toThrow(expect.objectContaining({ code: 'NOTHING_TO_UPDATE' }));
      expect(parsePipelinePatch({ active: false })).toEqual({ active: false });
      expect(() => parsePipelinePatch({ active: 'no' })).toThrow(expect.objectContaining({ statusCode: 400 }));
    });
  });

  describe('giai đoạn', () => {
    it('mặc định OPEN, xác suất 0 (WON là 100), không gán người', () => {
      expect(parseNewStage({ code: 'gui_mau', name: 'Gửi mẫu' })).toMatchObject({
        code: 'GUI_MAU',
        semantic: 'OPEN',
        defaultProbability: 0,
        skippable: false,
        assigneeRule: 'NONE',
        assigneeParam: null,
        active: true,
      });
      expect(parseNewStage({ code: 'W', name: 'Thắng', semantic: 'WON' }).defaultProbability).toBe(100);
    });

    it('kiểm nghĩa, xác suất, cờ bỏ qua chỉ cho OPEN', () => {
      expect(() => parseNewStage({ code: 'A', name: 'a', semantic: 'MAYBE' })).toThrow(expect.objectContaining({ code: 'INVALID_SEMANTIC' }));
      for (const bad of [-1, 101, 1.5, '50']) {
        expect(() => parseNewStage({ code: 'A', name: 'a', defaultProbability: bad })).toThrow(expect.objectContaining({ code: 'INVALID_PROBABILITY' }));
      }
      expect(() => parseNewStage({ code: 'A', name: 'a', semantic: 'LOST', skippable: true })).toThrow(expect.objectContaining({ code: 'INVALID_SKIPPABLE' }));
    });

    it('tham số gán người theo quy tắc', () => {
      const id = randomUUID();
      expect(normalizeAssignee('NONE', 'bỏ')).toBeNull();
      expect(normalizeAssignee('PROJECT_OWNER', id)).toBeNull();
      expect(normalizeAssignee('FIXED_USER', id.toUpperCase())).toBe(id);
      expect(normalizeAssignee('POSITION', id)).toBe(id);
      expect(normalizeAssignee('MANAGER_LEVEL', 3)).toBe('3');
      expect(() => normalizeAssignee('FIXED_USER', 'abc')).toThrow(expect.objectContaining({ code: 'INVALID_ASSIGNEE_PARAM' }));
      expect(() => normalizeAssignee('FIXED_USER', null)).toThrow(expect.objectContaining({ code: 'INVALID_ASSIGNEE_PARAM' }));
      for (const bad of [0, 11, 'x', '']) expect(() => normalizeAssignee('MANAGER_LEVEL', bad)).toThrow(expect.objectContaining({ code: 'INVALID_ASSIGNEE_PARAM' }));
      expect(() => parseNewStage({ code: 'A', name: 'a', assigneeRule: 'BOSS' })).toThrow(expect.objectContaining({ code: 'INVALID_ASSIGNEE_RULE' }));
    });

    it('sửa giai đoạn: đổi quy tắc xoá tham số cũ; chuyển sang nghĩa kết thúc không kèm skippable', () => {
      const id = randomUUID();
      const fixed = { ...stage('NEW'), assigneeRule: 'FIXED_USER' as const, assigneeParam: id };
      expect(parseStagePatch({ assigneeRule: 'PROJECT_OWNER' }, fixed)).toEqual({ assigneeRule: 'PROJECT_OWNER', assigneeParam: null });
      expect(parseStagePatch({ name: 'Mới tinh' }, fixed)).toEqual({ name: 'Mới tinh' });
      expect(() => parseStagePatch({ assigneeRule: 'MANAGER_LEVEL' }, fixed)).toThrow(expect.objectContaining({ code: 'INVALID_ASSIGNEE_PARAM' }));
      expect(() => parseStagePatch({ semantic: 'WON', skippable: true }, stage('NEW'))).toThrow(expect.objectContaining({ code: 'INVALID_SKIPPABLE' }));
      const skippable = { ...stage('NEW'), skippable: true };
      expect(parseStagePatch({ semantic: 'LOST' }, skippable)).toEqual({ semantic: 'LOST', skippable: false });
    });

    it('mã giai đoạn duy nhất trong luồng', () => {
      expect(() => assertStageCodeFree(standard, 'NEW')).toThrow(expect.objectContaining({ statusCode: 409, code: 'STAGE_CODE_TAKEN' }));
      expect(() => assertStageCodeFree(standard, 'NEW', stage('NEW').id)).not.toThrow();
      expect(() => assertStageCodeFree(standard, 'MOI')).not.toThrow();
    });

    it('giai đoạn đã dùng: khoá mã và nghĩa, vẫn đổi tên, tắt', () => {
      const used = { opportunityCount: 0, used: true };
      expect(() => assertStagePatchAllowed(stage('NEW'), used, { code: 'X' })).toThrow(expect.objectContaining({ code: 'STAGE_CODE_LOCKED' }));
      expect(() => assertStagePatchAllowed(stage('NEW'), used, { semantic: 'LOST' })).toThrow(expect.objectContaining({ code: 'STAGE_SEMANTIC_LOCKED' }));
      expect(() => assertStagePatchAllowed(stage('NEW'), used, { name: 'Khác', active: false, code: 'NEW', semantic: 'OPEN' })).not.toThrow();
      expect(() => assertStagePatchAllowed(stage('NEW'), { opportunityCount: 0, used: false }, { code: 'X', semantic: 'LOST' })).not.toThrow();
    });

    it('không xoá giai đoạn đang có cơ hội (đề nghị tắt) hoặc đã có trong lịch sử', () => {
      expect(() => assertCanDeleteStage(stage('NEW'), { opportunityCount: 3, used: true })).toThrow(
        expect.objectContaining({ statusCode: 409, code: 'STAGE_IN_USE', message: expect.stringContaining('tắt') }),
      );
      expect(() => assertCanDeleteStage(stage('NEW'), { opportunityCount: 0, used: true })).toThrow(expect.objectContaining({ code: 'STAGE_HAS_HISTORY' }));
      expect(() => assertCanDeleteStage(stage('NEW'), { opportunityCount: 0, used: false })).not.toThrow();
    });
  });

  describe('mỗi luồng có OPEN, WON, LOST đang bật', () => {
    const after = (mutate: (stages: typeof standard.stages) => typeof standard.stages) => mutate(standard.stages);
    it('đủ thì qua', () => expect(() => assertOutcomeStages('L', standard.stages)).not.toThrow());
    it('mất WON cuối cùng (xoá, tắt hoặc đổi nghĩa) là 409', () => {
      expect(() => assertOutcomeStages('L', after((s) => s.filter((x) => x.code !== 'WON')))).toThrow(expect.objectContaining({ statusCode: 409, code: 'LAST_WON_STAGE' }));
      expect(() => assertOutcomeStages('L', after((s) => s.map((x) => (x.code === 'WON' ? { ...x, active: false } : x))))).toThrow(expect.objectContaining({ code: 'LAST_WON_STAGE' }));
      expect(() => assertOutcomeStages('L', after((s) => s.map((x) => (x.code === 'WON' ? { ...x, semantic: 'OPEN' as const } : x))))).toThrow(expect.objectContaining({ code: 'LAST_WON_STAGE' }));
    });
    it('mất LOST cuối cùng hoặc OPEN cuối cùng là 409', () => {
      expect(() => assertOutcomeStages('L', after((s) => s.filter((x) => x.code !== 'LOST')))).toThrow(expect.objectContaining({ code: 'LAST_LOST_STAGE' }));
      expect(() => assertOutcomeStages('L', after((s) => s.filter((x) => x.semantic !== 'OPEN')))).toThrow(expect.objectContaining({ code: 'LAST_OPEN_STAGE' }));
    });
    it('còn WON thứ hai đang bật thì tắt cái đầu được', () => {
      const two = [...standard.stages, { ...stage('WON'), id: randomUUID(), code: 'WON2' }];
      expect(() => assertOutcomeStages('L', two.map((x) => (x.code === 'WON' ? { ...x, active: false } : x)))).not.toThrow();
    });
  });

  describe('luồng', () => {
    const tender = buildPipeline({
      code: 'T',
      profile: 'TENDER',
      stages: [{ code: 'A', name: 'A', semantic: 'OPEN' }, { code: 'W', name: 'W', semantic: 'WON' }, { code: 'L', name: 'L', semantic: 'LOST' }],
      transitions: [],
    });
    it('mặc định phải là STANDARD và đang bật', () => {
      expect(() => assertCanBeDefault(tender)).toThrow(expect.objectContaining({ code: 'DEFAULT_MUST_BE_STANDARD' }));
      expect(() => assertCanBeDefault({ ...standard, active: false })).toThrow(expect.objectContaining({ code: 'DEFAULT_MUST_BE_ACTIVE' }));
      expect(() => assertCanBeDefault(standard)).not.toThrow();
    });
    it('không tắt, không xoá luồng mặc định; không xoá luồng có cơ hội', () => {
      expect(() => assertCanDeactivatePipeline(standard)).toThrow(expect.objectContaining({ statusCode: 409 }));
      expect(() => assertCanDeletePipeline(standard, 0)).toThrow(expect.objectContaining({ code: 'DEFAULT_PIPELINE_LOCKED' }));
      expect(() => assertCanDeletePipeline(tender, 2)).toThrow(expect.objectContaining({ code: 'PIPELINE_IN_USE', message: expect.stringContaining('tắt') }));
      expect(() => assertCanDeletePipeline(tender, 0)).not.toThrow();
    });
    it('luồng TENDER không bật gợi ý chăm sóc lại', () => {
      expect(() => assertCareSuggestionAllowed('TENDER', true)).toThrow(expect.objectContaining({ code: 'CARE_SUGGESTION_NOT_APPLICABLE' }));
      expect(() => assertCareSuggestionAllowed('TENDER', false)).not.toThrow();
      expect(() => assertCareSuggestionAllowed('STANDARD', true)).not.toThrow();
    });
    it('sắp xếp phải đủ và đúng tập id', () => {
      expect(() => assertSameIdSet(['a', 'b'], ['b', 'a'], 'luồng')).not.toThrow();
      for (const bad of [['a'], ['a', 'a'], ['a', 'c'], ['a', 'b', 'c']]) {
        expect(() => assertSameIdSet(bad, ['a', 'b'], 'luồng')).toThrow(expect.objectContaining({ code: 'INVALID_ORDER' }));
      }
    });
  });

  describe('bước chuyển', () => {
    it('chỉ giữa giai đoạn cùng luồng, không tự trỏ, không trùng', () => {
      expect(validateTransitionTargets(standard, stage('NEW'), [stage('CONTACTED').id, stage('LOST').id])).toHaveLength(2);
      expect(() => validateTransitionTargets(standard, stage('NEW'), [stage('NEW').id])).toThrow(expect.objectContaining({ code: 'SELF_TRANSITION' }));
      expect(() => validateTransitionTargets(standard, stage('NEW'), [randomUUID()])).toThrow(expect.objectContaining({ code: 'TRANSITION_OUT_OF_PIPELINE' }));
      const other = sevenStagePipeline();
      const foreign = buildPipeline({ code: 'OTHER', stages: [{ code: 'NEW', name: 'x', semantic: 'OPEN' }], transitions: [] });
      expect(() => validateTransitionTargets(standard, stage('NEW'), [foreign.stages[0].id])).toThrow(expect.objectContaining({ code: 'TRANSITION_OUT_OF_PIPELINE' }));
      expect(other).toBeDefined();
      const id = stage('LOST').id;
      expect(() => validateTransitionTargets(standard, stage('NEW'), [id, id])).toThrow(expect.objectContaining({ code: 'DUPLICATE_TRANSITION' }));
    });
    it('giai đoạn WON và LOST không có bước chuyển đi; tập rỗng vẫn hợp lệ', () => {
      expect(() => validateTransitionTargets(standard, stage('WON'), [stage('NEW').id])).toThrow(expect.objectContaining({ code: 'TERMINAL_STAGE_TRANSITION' }));
      expect(() => validateTransitionTargets(standard, stage('LOST'), [stage('NEW').id])).toThrow(expect.objectContaining({ statusCode: 400 }));
      expect(validateTransitionTargets(standard, stage('WON'), [])).toEqual([]);
    });
  });

  describe('điều kiện', () => {
    const ok = (items: unknown, profile: 'STANDARD' | 'TENDER' = 'STANDARD') => validateRequirements(items, profile, DOC_CODES);
    it('DOCUMENT_TYPE: ref là mã loại tài liệu có thật, cờ bắt buộc giữ nguyên, thứ tự theo danh sách', () => {
      const result = ok([
        { kind: 'DOCUMENT_TYPE', ref: 'LEGAL_DOSSIER', required: false, message: 'Cần hồ sơ pháp lý.' },
        { kind: 'DOCUMENT_TYPE', ref: 'ESTIMATE', message: 'Cần dự toán.' },
      ]);
      expect(result.map((r) => [r.ref, r.required, r.sortOrder])).toEqual([['LEGAL_DOSSIER', false, 10], ['ESTIMATE', true, 20]]);
      expect(() => ok([{ kind: 'DOCUMENT_TYPE', ref: 'NOPE', message: 'm' }])).toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT_TYPE' }));
      expect(() => ok([{ kind: 'DOCUMENT_TYPE', ref: '', message: 'm' }])).toThrow(expect.objectContaining({ code: 'REQUIREMENT_REF_REQUIRED' }));
    });
    it('FIELD thuộc trường cơ hội; TENDER_FIELD thuộc trường hồ sơ thầu và chỉ cho luồng TENDER', () => {
      expect(ok([{ kind: 'FIELD', ref: 'expectedValue', message: 'm' }])).toHaveLength(1);
      expect(() => ok([{ kind: 'FIELD', ref: 'winningPrice', message: 'm' }])).toThrow(expect.objectContaining({ code: 'INVALID_FIELD' }));
      expect(ok([{ kind: 'TENDER_FIELD', ref: 'winningPrice', message: 'm' }, { kind: 'TENDER_PLAN_APPROVED', message: 'm' }], 'TENDER')).toHaveLength(2);
      expect(() => ok([{ kind: 'TENDER_FIELD', ref: 'expectedValue', message: 'm' }], 'TENDER')).toThrow(expect.objectContaining({ code: 'INVALID_FIELD' }));
      expect(() => ok([{ kind: 'TENDER_FIELD', ref: 'winningPrice', message: 'm' }])).toThrow(expect.objectContaining({ code: 'REQUIREMENT_NOT_FOR_PROFILE' }));
      expect(() => ok([{ kind: 'TENDER_PLAN_APPROVED', message: 'm' }])).toThrow(expect.objectContaining({ code: 'REQUIREMENT_NOT_FOR_PROFILE' }));
    });
    it('loại không cần ref thì ref rỗng; có ref là lỗi; trùng, thiếu thông báo, sai loại là 400', () => {
      expect(ok([{ kind: 'REASON', message: 'Ghi lý do.' }, { kind: 'QUOTE_APPROVED', message: 'Cần báo giá.' }]).map((r) => r.ref)).toEqual(['', '']);
      expect(() => ok([{ kind: 'REASON', ref: 'x', message: 'm' }])).toThrow(expect.objectContaining({ code: 'REQUIREMENT_REF_NOT_ALLOWED' }));
      expect(() => ok([{ kind: 'REASON', message: 'm' }, { kind: 'REASON', message: 'n' }])).toThrow(expect.objectContaining({ code: 'DUPLICATE_REQUIREMENT' }));
      expect(() => ok([{ kind: 'REASON', message: '  ' }])).toThrow(expect.objectContaining({ code: 'REQUIREMENT_MESSAGE_REQUIRED' }));
      expect(() => ok([{ kind: 'REASON', message: 'x'.repeat(501) }])).toThrow(expect.objectContaining({ code: 'REQUIREMENT_MESSAGE_TOO_LONG' }));
      expect(() => ok([{ kind: 'MAGIC', message: 'm' }])).toThrow(expect.objectContaining({ code: 'INVALID_REQUIREMENT_KIND' }));
      expect(() => ok({ kind: 'REASON' })).toThrow(expect.objectContaining({ statusCode: 400 }));
      expect(ok([])).toEqual([]);
    });
  });
});
