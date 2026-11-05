import { buildOpportunityStageChangedPayload } from './opportunity-event.js';

describe('payload sự kiện crm.opportunity.stage-changed', () => {
  const payload = buildOpportunityStageChangedPayload({
    opportunityId: 'o1',
    customerId: 'c1',
    name: 'Dự án A',
    ownerUserId: 'u1',
    from: 'NEGOTIATION',
    fromStageId: 's-neg',
    fromSemantic: 'OPEN',
    to: 'WON',
    toStageId: 's-won',
    toSemantic: 'WON',
    pipelineId: 'p1',
    reason: null,
    actorUserId: 'u2',
  });

  it('TC-PL-13: trường cũ giữ nguyên (stage, fromStage là mã), thêm semantic, pipelineId', () => {
    expect(payload).toMatchObject({
      opportunityId: 'o1',
      customerId: 'c1',
      name: 'Dự án A',
      ownerUserId: 'u1',
      fromStage: 'NEGOTIATION',
      stage: 'WON',
      reason: null,
      actorUserId: 'u2',
      semantic: 'WON',
      pipelineId: 'p1',
      stageId: 's-won',
      fromStageId: 's-neg',
      fromSemantic: 'OPEN',
    });
  });

  it('khoá của payload là tập đã biết (thêm khoá mới phải chủ ý)', () => {
    expect(Object.keys(payload).sort()).toEqual(
      [
        'opportunityId', 'customerId', 'name', 'ownerUserId', 'fromStage', 'stage', 'reason', 'actorUserId',
        'semantic', 'pipelineId', 'stageId', 'fromStageId', 'fromSemantic',
      ].sort(),
    );
  });
});
