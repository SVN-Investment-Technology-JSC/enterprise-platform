import { createHash } from 'node:crypto';
import type {
  Pipeline,
  PipelineProfile,
  PipelineStage,
  StageAssigneeRule,
  StageRequirement,
  StageSemantic,
} from '@enterprise-platform/contracts-crm';

/** Chỉ dùng trong test: dựng cấu hình luồng trong bộ nhớ, id suy từ mã luồng và mã giai đoạn. */
export interface StageSpec {
  readonly code: string;
  readonly name: string;
  readonly semantic: StageSemantic;
  readonly active?: boolean;
  readonly skippable?: boolean;
  readonly assigneeRule?: StageAssigneeRule;
  readonly assigneeParam?: string | null;
  readonly requirements?: readonly Partial<StageRequirement>[];
}

/** Id dạng UUID cố định theo chuỗi (để qua kiểm `isUuid` của service). */
function uuidFrom(text: string): string {
  const hex = createHash('md5').update(text).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function buildPipeline(input: {
  readonly code: string;
  readonly name?: string;
  readonly profile?: PipelineProfile;
  readonly isDefault?: boolean;
  readonly active?: boolean;
  readonly stages: readonly StageSpec[];
  /** Cặp `[mã từ, mã đến]`. */
  readonly transitions: readonly (readonly [string, string])[];
}): Pipeline {
  const pipelineId = uuidFrom(`pipeline-${input.code}`);
  const id = (code: string) => uuidFrom(`${input.code}:${code}`);
  const stages = input.stages.map(
    (stage, index): PipelineStage => ({
      id: id(stage.code),
      pipelineId,
      code: stage.code,
      name: stage.name,
      semantic: stage.semantic,
      sortOrder: (index + 1) * 10,
      defaultProbability: 0,
      active: stage.active ?? true,
      skippable: stage.skippable ?? false,
      assigneeRule: stage.assigneeRule ?? 'NONE',
      assigneeParam: stage.assigneeParam ?? null,
      nextStageIds: input.transitions.filter(([from]) => from === stage.code).map(([, to]) => id(to)),
      requirements: (stage.requirements ?? []).map(
        (requirement, order): StageRequirement => ({
          kind: requirement.kind ?? 'REASON',
          ref: requirement.ref ?? '',
          required: requirement.required ?? true,
          message: requirement.message ?? '',
          sortOrder: requirement.sortOrder ?? order,
        }),
      ),
    }),
  );
  return {
    id: pipelineId,
    code: input.code,
    name: input.name ?? input.code,
    profile: input.profile ?? 'STANDARD',
    isDefault: input.isDefault ?? false,
    active: input.active ?? true,
    sortOrder: 0,
    stages,
  };
}

/** Luồng mặc định 7 giai đoạn như migration 0017. */
export function sevenStagePipeline(): Pipeline {
  return buildPipeline({
    code: 'SALES_STANDARD',
    name: 'Bán hàng thông thường',
    isDefault: true,
    stages: [
      { code: 'NEW', name: 'Mới', semantic: 'OPEN' },
      { code: 'CONTACTED', name: 'Đã liên hệ', semantic: 'OPEN' },
      { code: 'DISCOVERY', name: 'Khảo sát nhu cầu', semantic: 'OPEN' },
      { code: 'QUOTING', name: 'Báo giá', semantic: 'OPEN' },
      { code: 'NEGOTIATION', name: 'Đàm phán', semantic: 'OPEN' },
      {
        code: 'WON',
        name: 'Thắng',
        semantic: 'WON',
        requirements: [
          { kind: 'QUOTE_APPROVED', message: 'Cần có báo giá Khách chấp nhận trước khi chuyển sang Thắng.' },
        ],
      },
      { code: 'LOST', name: 'Thua', semantic: 'LOST', requirements: [{ kind: 'REASON', message: 'Phải ghi lý do thua.' }] },
    ],
    transitions: [
      ['NEW', 'CONTACTED'], ['NEW', 'LOST'],
      ['CONTACTED', 'NEW'], ['CONTACTED', 'DISCOVERY'], ['CONTACTED', 'LOST'],
      ['DISCOVERY', 'CONTACTED'], ['DISCOVERY', 'QUOTING'], ['DISCOVERY', 'LOST'],
      ['QUOTING', 'DISCOVERY'], ['QUOTING', 'NEGOTIATION'], ['QUOTING', 'LOST'],
      ['NEGOTIATION', 'QUOTING'], ['NEGOTIATION', 'WON'], ['NEGOTIATION', 'LOST'],
    ],
  });
}

/** Luồng tuỳ biến 5 giai đoạn, mã và tên khác luồng mặc định, giai đoạn thua tên "Rớt". */
export function fiveStagePipeline(): Pipeline {
  return buildPipeline({
    code: 'SALES_SIMPLE',
    name: 'Bán hàng đơn giản',
    stages: [
      { code: 'LEAD', name: 'Tiếp cận', semantic: 'OPEN' },
      { code: 'QUALIFIED', name: 'Đủ điều kiện', semantic: 'OPEN' },
      { code: 'PROPOSAL', name: 'Đề xuất', semantic: 'OPEN' },
      { code: 'CLOSED_WON', name: 'Chốt', semantic: 'WON' },
      { code: 'CLOSED_LOST', name: 'Rớt', semantic: 'LOST' },
    ],
    transitions: [
      ['LEAD', 'QUALIFIED'], ['LEAD', 'CLOSED_LOST'],
      ['QUALIFIED', 'LEAD'], ['QUALIFIED', 'PROPOSAL'], ['QUALIFIED', 'CLOSED_LOST'],
      ['PROPOSAL', 'QUALIFIED'], ['PROPOSAL', 'CLOSED_WON'], ['PROPOSAL', 'CLOSED_LOST'],
    ],
  });
}
