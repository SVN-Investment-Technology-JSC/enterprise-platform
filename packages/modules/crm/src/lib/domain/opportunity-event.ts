import type { CrmOpportunityStageChangedPayload, StageSemantic } from '@enterprise-platform/contracts-crm';

export interface OpportunityStageChangedInput {
  readonly opportunityId: string;
  readonly customerId: string;
  readonly name: string;
  readonly ownerUserId: string;
  readonly from: string;
  readonly fromStageId: string;
  readonly fromSemantic: StageSemantic;
  readonly to: string;
  readonly toStageId: string;
  readonly toSemantic: StageSemantic;
  readonly pipelineId: string;
  readonly reason: string | null;
  readonly actorUserId: string | null;
}

/**
 * Payload sự kiện `crm.opportunity.stage-changed`. Trường `fromStage`, `stage`
 * là MÃ giai đoạn (như cột `stage`); `semantic`, `pipelineId`, `stageId`,
 * `fromStageId`, `fromSemantic` là trường thêm ở GĐ B. Không đổi tên hay đổi
 * nghĩa trường cũ (luật cứng 5).
 */
export function buildOpportunityStageChangedPayload(
  input: OpportunityStageChangedInput,
): CrmOpportunityStageChangedPayload {
  return {
    opportunityId: input.opportunityId,
    customerId: input.customerId,
    name: input.name,
    ownerUserId: input.ownerUserId,
    fromStage: input.from,
    stage: input.to,
    reason: input.reason,
    actorUserId: input.actorUserId,
    semantic: input.toSemantic,
    pipelineId: input.pipelineId,
    stageId: input.toStageId,
    fromStageId: input.fromStageId,
    fromSemantic: input.fromSemantic,
  };
}
