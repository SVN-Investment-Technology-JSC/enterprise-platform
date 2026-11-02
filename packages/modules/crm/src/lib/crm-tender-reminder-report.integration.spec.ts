import { randomUUID } from 'node:crypto';
import {
  CRM_NO_CAPABILITIES,
  CRM_TENDER_DEADLINE_DUE_SOON,
  CRM_TENDER_DEADLINE_OVERDUE,
  type CrmTenderDeadlinePayload,
} from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { SalesReportService } from './application/sales-report.service.js';
import { notifyTenderDeadlines } from './application/tender-reminder.job.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { PostgresSalesSettingsStore } from './infrastructure/postgres-contract.store.js';
import { PostgresSalesReportStore } from './infrastructure/postgres-sales-report.store.js';
import { PostgresTenderReminderStore } from './infrastructure/postgres-tender-reminder.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const OWNER = randomUUID();
const SUBMITTER = randomUUID();
const OTHER = randomUUID();
const HOUR = 3_600_000;

/**
 * Bán hàng GĐ E: nhắc hạn nộp thầu (P2E-05, TC-TND-07) và báo cáo chào thầu (P2E-07, TC-TND-11) trên PostgreSQL thật.
 * Đồng hồ giả: job nhận `now` nên không phải chờ thời gian thật.
 */
integration('Bán hàng GĐ E: nhắc hạn nộp thầu và báo cáo thầu (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  let reminders: PostgresTenderReminderStore;
  let reports: SalesReportService;
  let customerId: string;
  let tenderPipelineId: string;
  const tenantId = randomUUID();
  const sql = (text: string, values: unknown[] = []) => handle.pool.query(text, values);
  const actor = (userId: string, extra: Partial<CrmActor> = {}): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Người dùng',
    ...extra,
  });

  const stageId = async (code: string) =>
    (await sql(`SELECT id FROM crm_schema.pipeline_stages WHERE pipeline_id = $1 AND code = $2`, [tenderPipelineId, code])).rows[0].id as string;

  /** Cơ hội luồng Chào thầu ở giai đoạn `stage` kèm hồ sơ thầu. */
  async function tender(options: {
    stage: string;
    owner?: string;
    value?: number;
    deadline?: Date | null;
    submitter?: string | null;
    submittedAt?: Date | null;
    result?: 'WON' | 'LOST' | null;
    winningPrice?: number | null;
    closedAt?: string | null;
    name?: string;
  }) {
    const semantic = options.stage === 'WON' ? 'WON' : options.stage === 'LOST' ? 'LOST' : 'OPEN';
    const opportunity = await sql(
      `INSERT INTO crm_schema.opportunities (customer_id, name, stage, pipeline_id, stage_id, probability, expected_value, owner_user_id, closed_at, lost_reason)
       VALUES ($1, $2, $3::varchar, $4, $5, 50, $6, $7, $8::timestamptz, CASE WHEN $3::varchar = 'LOST' THEN 'Giá cao' END) RETURNING id`,
      [
        customerId,
        options.name ?? `Thầu ${randomUUID().slice(0, 6)}`,
        options.stage,
        tenderPipelineId,
        await stageId(options.stage),
        options.value ?? 1_000_000_000,
        options.owner ?? OWNER,
        semantic === 'OPEN' ? null : (options.closedAt ?? new Date().toISOString()),
      ],
    );
    const profile = await sql(
      `INSERT INTO crm_schema.tender_profiles
         (opportunity_id, package_name, inviter_name, submission_deadline, submitter_user_id, submitted_at, result, winning_price, created_by, updated_by)
       VALUES ($1, 'Gói thầu thiết bị', 'Sở Y tế', $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
      [
        opportunity.rows[0].id,
        options.deadline === undefined ? null : options.deadline,
        options.submitter === undefined ? null : options.submitter,
        options.submittedAt ?? null,
        options.result ?? null,
        options.winningPrice ?? null,
        OWNER,
      ],
    );
    return { opportunityId: opportunity.rows[0].id as string, profileId: profile.rows[0].id as string };
  }

  const events = async (profileId: string, type?: string) =>
    (
      await sql(
        `SELECT event_type, payload FROM integration_schema.outbox_events WHERE aggregate_id = $1 ${type ? 'AND event_type = $2' : ''} ORDER BY occurred_at, id`,
        type ? [profileId, type] : [profileId],
      )
    ).rows as { event_type: string; payload: { payload: CrmTenderDeadlinePayload } }[];

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    reminders = new PostgresTenderReminderStore(handle.database);
    reports = new SalesReportService(
      new PostgresSalesReportStore(handle.database),
      new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) }),
      new PostgresSalesSettingsStore(handle.database),
    );
    customerId = (
      await sql(`INSERT INTO crm_schema.customers (code, name, owner_user_id, kind) VALUES ('TND-C1', 'Khách thầu', $1, 'CUSTOMER') RETURNING id`, [OWNER])
    ).rows[0].id;
    tenderPipelineId = (await sql(`SELECT id FROM crm_schema.pipelines WHERE code = 'TENDER_STANDARD'`)).rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  it('TC-TND-07: nhắc trước hạn (ngày mai) và quá hạn cho chủ dự án và người nộp; đã nộp, đã có kết quả, quá xa thì không; không nhắc trùng', async () => {
    const t0 = new Date();
    const tomorrow = await tender({ stage: 'PREPARE', deadline: new Date(t0.getTime() + 20 * HOUR), submitter: SUBMITTER });
    const sameOwner = await tender({ stage: 'PREPARE', deadline: new Date(t0.getTime() + 20 * HOUR), submitter: OWNER });
    const late = await tender({ stage: 'PREPARE', deadline: new Date(t0.getTime() - 2 * HOUR), submitter: null });
    const submitted = await tender({ stage: 'SUBMITTED', deadline: new Date(t0.getTime() - 2 * HOUR), submittedAt: new Date(t0.getTime() - 5 * HOUR) });
    const submittedTomorrow = await tender({ stage: 'PLAN_REVIEW', deadline: new Date(t0.getTime() + 5 * HOUR), submittedAt: new Date(t0.getTime() - HOUR) });
    const decided = await tender({ stage: 'LOST', deadline: new Date(t0.getTime() - 3 * HOUR), result: 'LOST' });
    const far = await tender({ stage: 'PREPARE', deadline: new Date(t0.getTime() + 5 * 24 * HOUR), submitter: SUBMITTER });
    const noDeadline = await tender({ stage: 'HSMT', deadline: null });

    expect(await notifyTenderDeadlines(reminders, tenantId, t0, 100)).toBe(3);

    const soon = await events(tomorrow.profileId);
    expect(soon.map((row) => row.event_type)).toEqual([CRM_TENDER_DEADLINE_DUE_SOON]);
    expect(soon[0].payload.payload).toMatchObject({
      profileId: tomorrow.profileId,
      opportunityId: tomorrow.opportunityId,
      milestone: 'DUE_SOON',
      actorUserId: null,
      deepLink: `/modules/crm#opportunities/${tomorrow.opportunityId}`,
    });
    expect([...soon[0].payload.payload.recipientUserIds].sort()).toEqual([OWNER, SUBMITTER].sort());
    // Chủ dự án cũng là người nộp: một người nhận, không trùng.
    expect((await events(sameOwner.profileId))[0].payload.payload.recipientUserIds).toEqual([OWNER]);
    const overdue = await events(late.profileId);
    expect(overdue.map((row) => row.event_type)).toEqual([CRM_TENDER_DEADLINE_OVERDUE]);
    expect(overdue[0].payload.payload.recipientUserIds).toEqual([OWNER]);
    expect(overdue[0].payload.payload.summary).toContain('quá hạn');
    for (const quiet of [submitted, submittedTomorrow, decided, far, noDeadline]) expect(await events(quiet.profileId)).toEqual([]);

    // Chạy lại cùng thời điểm và sau đó 10 phút: không nhắc trùng.
    expect(await notifyTenderDeadlines(reminders, tenantId, t0, 100)).toBe(0);
    expect(await notifyTenderDeadlines(reminders, tenantId, new Date(t0.getTime() + 10 * 60_000), 100)).toBe(0);

    // 4,5 ngày sau: gói "mai" đã quá hạn (nhắc quá hạn một lần, không nhắc "sắp đến hạn" lại); gói xa vào cửa sổ nhắc.
    const later = new Date(t0.getTime() + 108 * HOUR);
    expect(await notifyTenderDeadlines(reminders, tenantId, later, 100)).toBe(3);
    expect((await events(tomorrow.profileId)).map((row) => row.event_type)).toEqual([CRM_TENDER_DEADLINE_DUE_SOON, CRM_TENDER_DEADLINE_OVERDUE]);
    expect((await events(late.profileId)).length).toBe(1);
    expect((await events(far.profileId)).map((row) => row.event_type)).toEqual([CRM_TENDER_DEADLINE_DUE_SOON]);
    expect(await notifyTenderDeadlines(reminders, tenantId, later, 100)).toBe(0);

    // Nộp rồi thì hết nhắc; dời hạn thì nhắc lại theo hạn mới.
    await sql(`UPDATE crm_schema.tender_profiles SET submitted_at = $2 WHERE id = $1`, [far.profileId, later]);
    await sql(`UPDATE crm_schema.tender_profiles SET submission_deadline = $2 WHERE id = $1`, [late.profileId, new Date(later.getTime() + 6 * HOUR)]);
    const afterMove = new Date(later.getTime() + 60_000);
    expect(await notifyTenderDeadlines(reminders, tenantId, afterMove, 100)).toBe(1);
    expect((await events(late.profileId)).map((row) => row.event_type)).toEqual([CRM_TENDER_DEADLINE_OVERDUE, CRM_TENDER_DEADLINE_DUE_SOON]);
    // Cơ hội đã đóng (Trượt qua đường chung) thì không nhắc dù chưa có ngày nộp.
    await sql(`UPDATE crm_schema.opportunities SET stage_id = $2, stage = 'LOST', closed_at = now(), lost_reason = 'x' WHERE id = $1`, [late.opportunityId, await stageId('LOST')]);
    expect(await notifyTenderDeadlines(reminders, tenantId, new Date(later.getTime() + 2 * 24 * HOUR), 100)).toBe(0);
  });

  it('TC-TND-11: báo cáo thầu - tỷ lệ trúng theo luồng, số và giá trị theo trạng thái, theo kỳ và phạm vi dữ liệu', async () => {
    // Bỏ hồ sơ của ca kiểm trước để số liệu chỉ gồm dữ liệu của ca này.
    await sql(`DELETE FROM crm_schema.opportunities WHERE pipeline_id = $1`, [tenderPipelineId]);
    const closed = (day: string) => `${day}T10:00:00+07:00`;
    await tender({ stage: 'WON', result: 'WON', winningPrice: 3_000_000_000, value: 2_000_000_000, closedAt: closed('2025-03-10') });
    await tender({ stage: 'WON', result: 'WON', winningPrice: 1_000_000_000, value: 1_500_000_000, closedAt: closed('2025-03-31') });
    await tender({ stage: 'LOST', result: 'LOST', value: 800_000_000, closedAt: closed('2025-03-15') });
    await tender({ stage: 'LOST', result: 'LOST', value: 500_000_000, closedAt: closed('2025-03-16') });
    await tender({ stage: 'LOST', result: 'LOST', value: 400_000_000, closedAt: closed('2025-03-17') });
    // Ngoài kỳ tháng 3 và của người khác: không vào báo cáo kỳ / phạm vi của NV.
    await tender({ stage: 'WON', result: 'WON', winningPrice: 9_000_000_000, closedAt: closed('2025-04-02') });
    await tender({ stage: 'WON', result: 'WON', winningPrice: 7_000_000_000, owner: OTHER, closedAt: closed('2025-03-12') });
    await tender({ stage: 'SUBMITTED', submittedAt: new Date(), value: 600_000_000, deadline: new Date(Date.now() - 30 * 24 * HOUR) });
    await tender({ stage: 'PREPARE', value: 100_000_000 });
    await tender({ stage: 'HSMT', value: 50_000_000 });
    // Luồng bán hàng thường không lọt vào báo cáo thầu.
    const standard = (await sql(`SELECT id FROM crm_schema.pipelines WHERE is_default`)).rows[0].id;
    await sql(
      `INSERT INTO crm_schema.opportunities (customer_id, name, stage, pipeline_id, stage_id, probability, expected_value, owner_user_id)
       SELECT $1, 'Cơ hội thường', 'NEW', $2, s.id, 10, 123, $3 FROM crm_schema.pipeline_stages s WHERE s.pipeline_id = $2 AND s.code = 'NEW'`,
      [customerId, standard, OWNER],
    );

    const manager = actor(randomUUID(), { canReadReport: true, canReadAll: true });
    const report = await reports.tender(manager, { from: '2025-03-01', to: '2025-03-31' });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ pipelineCode: 'TENDER_STANDARD', pipelineName: 'Chào thầu', winRatePercent: 50 });
    expect(report.rows[0].byStatus).toEqual({
      PREPARING: { count: 2, value: 150_000_000 },
      SUBMITTED: { count: 1, value: 600_000_000 },
      // 3 tỷ + 1 tỷ của OWNER và 7 tỷ của OTHER (quản lý thấy tất cả); giá trị Trúng là giá trúng thầu.
      WON: { count: 3, value: 11_000_000_000 },
      LOST: { count: 3, value: 1_700_000_000 },
    });
    // Tỷ lệ = 3 / (3 + 3) = 50%.
    expect(report.totals).toEqual({ byStatus: report.rows[0].byStatus, winRatePercent: 50 });

    const mine = await reports.tender(actor(OWNER, { canReadReport: true }), { from: '2025-03-01', to: '2025-03-31' });
    expect(mine.rows[0].byStatus.WON).toEqual({ count: 2, value: 4_000_000_000 });
    expect(mine.rows[0].byStatus.LOST).toEqual({ count: 3, value: 1_700_000_000 });
    expect(mine.rows[0].winRatePercent).toBe(40);
    expect(mine.totals.winRatePercent).toBe(40);
    // Lọc theo người phụ trách ngoài phạm vi: rỗng, không mở rộng phạm vi.
    const outside = await reports.tender(actor(OWNER, { canReadReport: true }), { from: '2025-03-01', to: '2025-03-31', ownerUserId: OTHER });
    expect(outside.rows).toEqual([]);
    expect(outside.totals.winRatePercent).toBeNull();
    // Không có quyền xem báo cáo: 403.
    await expect(reports.tender(actor(OWNER), {})).rejects.toMatchObject({ statusCode: 403 });
  });
});
