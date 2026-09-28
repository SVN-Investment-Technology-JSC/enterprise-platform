import type { Pool, PoolClient } from 'pg';
import type {
  HrmProcedureLink,
  HrmSubmission,
} from '@enterprise-platform/contracts-hrm';
import {
  HRM_REQUEST_TABLES,
  prepareHrmProcedureLink,
} from './hrm-procedure-links.js';
import { hrmTransaction } from './hrm-transaction.js';
import { isoDate } from './hrm-time.js';

type Submission = Omit<HrmSubmission, 'requestId' | 'revision'>;
type Starter = {
  startOrResume(
    pool: Pool,
    linkId: string,
    tenantId: string,
  ): Promise<HrmProcedureLink>;
};

/** Business facts are derived from the validated row, never overridden by form attributes. */
export function submissionAttributes(
  input: Submission,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const facts: Record<string, unknown> = { ly_do: row.reason };
  if (row.from_date) facts.tu_ngay = isoDate(row.from_date);
  if (row.to_date) facts.den_ngay = isoDate(row.to_date);
  switch (input.kind) {
    case 'leave':
      Object.assign(facts, {
        so_ngay_nghi: Number(row.duration),
        duration: Number(row.duration),
        leave_type_id: row.leave_type_id,
        is_negative_leave: Boolean(row.is_negative_leave),
      });
      break;
    case 'ot':
      Object.assign(facts, {
        so_gio_ot: Number(row.planned_minutes) / 60,
        ot_hours: Number(row.planned_minutes) / 60,
        loai_ot: row.ot_type,
        is_night_ot: Boolean(row.is_night_ot),
      });
      break;
    case 'business_trip':
      Object.assign(facts, {
        so_ngay_cong_tac: Number(row.days_count),
        days_count: Number(row.days_count),
        loai_cong_tac: row.business_trip_type,
        dia_diem: row.destination,
        allow_ot: Boolean(row.allow_ot),
      });
      break;
    case 'advance':
      Object.assign(facts, {
        so_tien: Number(row.requested_amount),
        amount: Number(row.requested_amount),
        so_ky_tra: Number(row.number_of_installments),
      });
      break;
    case 'correction':
      facts.ngay = isoDate(row.request_date);
      break;
    case 'shift_change':
      facts.loai_doi_ca = row.change_type;
      break;
    case 'profile_correction':
      break;
  }
  const attributes = { ...input.attributes, ...facts };
  for (const key of Object.keys(attributes)) {
    if (!key.startsWith('process:') && !key.startsWith('step:')) continue;
    const code = key.slice(key.lastIndexOf(':') + 1);
    if (Object.hasOwn(facts, code)) attributes[key] = facts[code];
  }
  return attributes;
}

export async function submitHrmRequest(
  pool: Pool,
  bridge: Starter,
  input: Submission,
  create: (db: PoolClient) => Promise<Record<string, unknown>>,
): Promise<{ row: Record<string, unknown>; link: HrmProcedureLink | null }> {
  const prepared = await hrmTransaction(pool, async (db) => {
    const row = await create(db);
    // Drafts and swaps waiting for a peer have no Procedure side effects.
    if (
      row.status === 'DRAFT' ||
      (input.kind === 'shift_change' &&
        row.swap_with_employee_id &&
        !row.swap_peer_confirmed)
    )
      return { row, link: null };
    let subTypeCode = input.subTypeCode;
    if (input.kind === 'leave')
      subTypeCode = (
        await db.query(
          'SELECT code FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2',
          [input.tenantId, row.leave_type_id],
        )
      ).rows[0]?.code;
    if (input.kind === 'business_trip')
      subTypeCode = String(row.business_trip_type);
    if (input.kind === 'ot') subTypeCode = String(row.ot_type);
    const link = await prepareHrmProcedureLink(db, {
      ...input,
      subTypeCode,
      requestId: row.id as string,
      revision: Number(row.revision ?? 1),
      attributes: submissionAttributes(input, row),
    });
    return { row, link };
  });
  if (!prepared.link) return prepared;
  const link = await bridge.startOrResume(
    pool,
    prepared.link.id,
    input.tenantId,
  );
  const row = (
    await pool.query(
      `SELECT * FROM hrm_schema.${HRM_REQUEST_TABLES[input.kind]} WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, prepared.row.id],
    )
  ).rows[0];
  return { row, link };
}
