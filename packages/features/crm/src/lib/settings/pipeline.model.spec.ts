import type { AdminPipeline, AdminPipelineStage } from '@enterprise-platform/contracts-crm';
import {
  assigneeParamError,
  assigneeParamValue,
  fieldRefOptions,
  moveId,
  pipelineActiveBlock,
  pipelineDefaultBlock,
  pipelineDeleteBlock,
  requirementFormError,
  requirementKindsFor,
  stageDeleteBlock,
  stageFormError,
  toRequirementInput,
  transitionTargets,
} from './pipeline.model';

const stage = (id: string, patch: Partial<AdminPipelineStage> = {}): AdminPipelineStage => ({
  id,
  pipelineId: 'p',
  code: id.toUpperCase(),
  name: id,
  semantic: 'OPEN',
  sortOrder: 1,
  defaultProbability: 10,
  active: true,
  skippable: false,
  assigneeRule: 'NONE',
  assigneeParam: null,
  nextStageIds: [],
  requirements: [],
  opportunityCount: 0,
  used: false,
  ...patch,
});
const pipeline = (patch: Partial<AdminPipeline> = {}): AdminPipeline => ({
  id: 'p',
  code: 'P',
  name: 'P',
  profile: 'STANDARD',
  isDefault: false,
  active: true,
  sortOrder: 1,
  careSuggestion: false,
  opportunityCount: 0,
  stages: [stage('a'), stage('b'), stage('w', { semantic: 'WON' })],
  ...patch,
});

describe('cấu hình luồng', () => {
  it('khoá xoá giai đoạn đã dùng', () => {
    expect(stageDeleteBlock(stage('a', { used: true }))).toMatch(/đã được dùng/);
    expect(stageDeleteBlock(stage('a'))).toBeUndefined();
  });
  it('khoá xoá và tắt luồng mặc định, luồng có cơ hội', () => {
    expect(pipelineDeleteBlock(pipeline({ isDefault: true }))).toMatch(/mặc định/);
    expect(pipelineDeleteBlock(pipeline({ opportunityCount: 3 }))).toMatch(/3 cơ hội/);
    expect(pipelineDeleteBlock(pipeline())).toBeUndefined();
    expect(pipelineActiveBlock(pipeline({ isDefault: true }))).toBeDefined();
  });
  it('mặc định phải là luồng tiêu chuẩn đang bật', () => {
    expect(pipelineDefaultBlock(pipeline({ profile: 'TENDER' }))).toMatch(/tiêu chuẩn/);
    expect(pipelineDefaultBlock(pipeline({ active: false }))).toMatch(/bật/);
    expect(pipelineDefaultBlock(pipeline())).toBeUndefined();
  });
  it('loại điều kiện thầu chỉ cho luồng thầu', () => {
    expect(requirementKindsFor('STANDARD')).not.toContain('TENDER_FIELD');
    expect(requirementKindsFor('TENDER')).toContain('TENDER_PLAN_APPROVED');
  });
  it('tham chiếu trường lấy từ hợp đồng', () => {
    expect(fieldRefOptions('FIELD').map((o) => o.value)).toContain('budget');
    expect(fieldRefOptions('TENDER_FIELD').map((o) => o.value)).toContain('packageName');
  });
  it('kiểm điều kiện', () => {
    expect(requirementFormError({ kind: 'DOCUMENT_TYPE', message: 'x' })).toMatch(/loại tài liệu/);
    expect(requirementFormError({ kind: 'REASON', message: ' ' })).toMatch(/thông báo/);
    expect(requirementFormError({ kind: 'REASON', message: 'Ghi lý do' })).toBeUndefined();
  });
  it('dữ liệu điều kiện gửi lên', () => {
    expect(toRequirementInput({ kind: 'REASON', ref: 'zzz', message: ' m ' })).toEqual({ kind: 'REASON', required: true, message: 'm' });
    expect(toRequirementInput({ kind: 'DOCUMENT_TYPE', ref: 'HD', required: false, message: 'm' })).toEqual({ kind: 'DOCUMENT_TYPE', ref: 'HD', required: false, message: 'm' });
  });
  it('kiểm giai đoạn', () => {
    expect(stageFormError({ code: '1a', name: 'x', probability: '' })).toMatch(/Mã/);
    expect(stageFormError({ name: ' ', probability: '' })).toMatch(/tên/);
    expect(stageFormError({ name: 'x', probability: '101' })).toMatch(/Xác suất/);
    expect(stageFormError({ code: 'moi', name: 'x', probability: '50' })).toBeUndefined();
  });
  it('tham số quy tắc gán', () => {
    expect(assigneeParamError('FIXED_USER', '')).toBeDefined();
    expect(assigneeParamError('MANAGER_LEVEL', '11')).toBeDefined();
    expect(assigneeParamError('MANAGER_LEVEL', '2')).toBeUndefined();
    expect(assigneeParamError('PROJECT_OWNER', '')).toBeUndefined();
    expect(assigneeParamValue('PROJECT_OWNER', 'x')).toBeNull();
    expect(assigneeParamValue('POSITION', ' pos ')).toBe('pos');
  });
  it('sắp xếp lên xuống', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
  it('giai đoạn đích: bỏ chính nó, giai đoạn kết thúc không có bước đi', () => {
    const p = pipeline();
    expect(transitionTargets(p, p.stages[0]).map((s) => s.id)).toEqual(['b', 'w']);
    expect(transitionTargets(p, p.stages[2])).toEqual([]);
  });
});
