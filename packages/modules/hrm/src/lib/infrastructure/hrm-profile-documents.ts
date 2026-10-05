import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { lifecycleAudit } from './hrm-lifecycle.js';
import { isoDate } from './hrm-time.js';
import { requireDate, requireText, requireUuid } from './hrm-validation.js';

export const PROFILE_DOCUMENT_TYPES = [
  'PHOTO',
  'ID_CARD_FRONT',
  'ID_CARD_BACK',
] as const;
export type ProfileDocumentType = (typeof PROFILE_DOCUMENT_TYPES)[number];

/** Hộ chiếu và giấy phép lao động thuộc nhóm chứng chỉ, không có cột riêng trong hồ sơ. */
export const QUALIFICATION_TYPES = [
  'DEGREE',
  'CERTIFICATE',
  'LANGUAGE',
  'PROFESSIONAL',
  'PASSPORT',
  'WORK_PERMIT',
  'LICENSE',
  'OTHER',
] as const;
const CONFIDENTIAL_QUALIFICATIONS = new Set(['PASSPORT', 'WORK_PERMIT']);

const profileColumn: Record<ProfileDocumentType, string> = {
  PHOTO: 'photo_attachment_id',
  ID_CARD_FRONT: 'identity_card_front_attachment_id',
  ID_CARD_BACK: 'identity_card_back_attachment_id',
};
const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];

export interface QualificationInput {
  readonly type: string;
  readonly name: string;
  readonly level?: string | null;
  readonly major?: string | null;
  readonly institution?: string | null;
  readonly certificateNumber?: string | null;
  readonly issuedDate?: string | null;
  readonly effectiveFrom?: string | null;
  readonly expiryDate?: string | null;
  readonly grade?: string | null;
  readonly note?: string | null;
  readonly attachmentId?: string | null;
}

export type ProfileDocumentChange =
  | {
      readonly op: 'SET_DOCUMENT';
      readonly documentType: ProfileDocumentType;
      readonly attachmentId: string;
    }
  | {
      readonly op: 'ADD_QUALIFICATION';
      readonly qualification: QualificationInput;
    }
  | {
      readonly op: 'UPDATE_QUALIFICATION';
      readonly id: string;
      readonly qualification: QualificationInput;
    }
  | { readonly op: 'REMOVE_QUALIFICATION'; readonly id: string };

function optionalText(value: unknown, field: string, max: number) {
  if (value === undefined || value === null || value === '') return null;
  return requireText(value, field, max);
}

function optionalDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return null;
  return requireDate(value, field);
}

function parseQualification(raw: unknown): QualificationInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new BadRequestException('Thiếu thông tin bằng cấp, chứng chỉ');
  const q = raw as Record<string, unknown>;
  if (
    typeof q.type !== 'string' ||
    !(QUALIFICATION_TYPES as readonly string[]).includes(q.type)
  )
    throw new BadRequestException('Loại bằng cấp, chứng chỉ không hợp lệ');
  const effectiveFrom = optionalDate(q.effectiveFrom, 'Ngày hiệu lực');
  const expiryDate = optionalDate(q.expiryDate, 'Ngày hết hạn');
  if (effectiveFrom && expiryDate && expiryDate < effectiveFrom)
    throw new BadRequestException('Ngày hết hạn không được trước ngày hiệu lực');
  return {
    type: q.type,
    name: requireText(q.name, 'Tên bằng cấp, chứng chỉ', 255),
    level: optionalText(q.level, 'Trình độ', 100),
    major: optionalText(q.major, 'Chuyên ngành', 255),
    institution: optionalText(q.institution, 'Nơi cấp', 255),
    certificateNumber: optionalText(q.certificateNumber, 'Số hiệu', 100),
    issuedDate: optionalDate(q.issuedDate, 'Ngày cấp'),
    effectiveFrom,
    expiryDate,
    grade: optionalText(q.grade, 'Xếp loại', 100),
    note: optionalText(q.note, 'Ghi chú', 2000),
    attachmentId: q.attachmentId ? requireUuid(q.attachmentId, 'Tệp') : null,
  };
}

/** Kiểm tra cấu trúc; chưa chạm cơ sở dữ liệu. */
export function parseDocumentChanges(raw: unknown): ProfileDocumentChange[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 20)
    throw new BadRequestException('Danh sách thay đổi giấy tờ không hợp lệ');
  return raw.map((item): ProfileDocumentChange => {
    if (!item || typeof item !== 'object')
      throw new BadRequestException('Thay đổi giấy tờ không hợp lệ');
    const c = item as Record<string, unknown>;
    switch (c.op) {
      case 'SET_DOCUMENT':
        if (
          typeof c.documentType !== 'string' ||
          !(PROFILE_DOCUMENT_TYPES as readonly string[]).includes(
            c.documentType,
          )
        )
          throw new BadRequestException('Loại giấy tờ không hợp lệ');
        return {
          op: 'SET_DOCUMENT',
          documentType: c.documentType as ProfileDocumentType,
          attachmentId: requireUuid(c.attachmentId, 'Tệp'),
        };
      case 'ADD_QUALIFICATION':
        return {
          op: 'ADD_QUALIFICATION',
          qualification: parseQualification(c.qualification),
        };
      case 'UPDATE_QUALIFICATION':
        return {
          op: 'UPDATE_QUALIFICATION',
          id: requireUuid(c.id, 'Bằng cấp'),
          qualification: parseQualification(c.qualification),
        };
      case 'REMOVE_QUALIFICATION':
        return { op: 'REMOVE_QUALIFICATION', id: requireUuid(c.id, 'Bằng cấp') };
      default:
        throw new BadRequestException('Thao tác giấy tờ không được hỗ trợ');
    }
  });
}

/** Tệp phải thuộc đúng nhân sự, đã tải lên thành công và đúng định dạng của loại giấy tờ. */
async function loadAttachment(
  db: PoolClient,
  tenantId: string,
  employeeId: string,
  attachmentId: string,
  imageOnly: boolean,
) {
  const result = await db.query(
    `SELECT id, content_type FROM hrm_schema.attachments
     WHERE tenant_id=$1 AND id=$2 AND employee_id=$3 AND status='READY' AND deleted_at IS NULL`,
    [tenantId, attachmentId, employeeId],
  );
  if (!result.rows[0])
    throw new BadRequestException(
      'Tệp đính kèm không tồn tại hoặc chưa tải lên hoàn tất',
    );
  if (imageOnly && !imageTypes.includes(result.rows[0].content_type))
    throw new BadRequestException('Ảnh thẻ phải là PNG, JPEG hoặc WEBP');
}

export async function validateDocumentChanges(
  db: PoolClient,
  tenantId: string,
  employeeId: string,
  changes: ProfileDocumentChange[],
) {
  for (const change of changes) {
    if (change.op === 'SET_DOCUMENT')
      await loadAttachment(
        db,
        tenantId,
        employeeId,
        change.attachmentId,
        change.documentType === 'PHOTO',
      );
    else if (
      (change.op === 'ADD_QUALIFICATION' ||
        change.op === 'UPDATE_QUALIFICATION') &&
      change.qualification.attachmentId
    )
      await loadAttachment(
        db,
        tenantId,
        employeeId,
        change.qualification.attachmentId,
        false,
      );
    if (change.op === 'UPDATE_QUALIFICATION' || change.op === 'REMOVE_QUALIFICATION') {
      const found = await db.query(
        `SELECT 1 FROM hrm_schema.employee_qualifications WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 AND deleted_at IS NULL`,
        [tenantId, employeeId, change.id],
      );
      if (!found.rowCount)
        throw new ConflictException('Bằng cấp không còn tồn tại trong hồ sơ');
    }
  }
}

async function markAttachment(
  db: PoolClient,
  tenantId: string,
  attachmentId: string,
  documentType: string,
  confidential: boolean,
) {
  await db.query(
    `UPDATE hrm_schema.attachments SET document_type=$3,is_confidential=$4 WHERE tenant_id=$1 AND id=$2`,
    [tenantId, attachmentId, documentType, confidential],
  );
}

/** Áp dụng thay đổi đã được duyệt (hoặc do HR thực hiện trực tiếp). Gọi trong giao dịch. */
export async function applyDocumentChanges(
  db: PoolClient,
  tenantId: string,
  employeeId: string,
  actorId: string,
  changes: ProfileDocumentChange[],
) {
  await validateDocumentChanges(db, tenantId, employeeId, changes);
  for (const change of changes) {
    if (change.op === 'SET_DOCUMENT') {
      const column = profileColumn[change.documentType];
      const before = await db.query(
        `SELECT ${column} AS current FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND employee_id=$2`,
        [tenantId, employeeId],
      );
      await markAttachment(
        db,
        tenantId,
        change.attachmentId,
        change.documentType,
        change.documentType !== 'PHOTO',
      );
      await db.query(
        `UPDATE hrm_schema.employee_profiles SET ${column}=$3,updated_by=$4,updated_at=now() WHERE tenant_id=$1 AND employee_id=$2`,
        [tenantId, employeeId, change.attachmentId, actorId],
      );
      await lifecycleAudit(db, tenantId, actorId, 'PROFILE_DOCUMENT_SET', employeeId, {
        documentType: change.documentType,
        before: before.rows[0]?.current ?? null,
        after: change.attachmentId,
      });
    } else if (change.op === 'REMOVE_QUALIFICATION') {
      await db.query(
        `UPDATE hrm_schema.employee_qualifications SET deleted_at=now(),deleted_by=$4 WHERE tenant_id=$1 AND employee_id=$2 AND id=$3`,
        [tenantId, employeeId, change.id, actorId],
      );
      await lifecycleAudit(db, tenantId, actorId, 'QUALIFICATION_REMOVED', change.id, {
        employeeId,
      });
    } else {
      const q = change.qualification;
      const values = [
        q.type,
        q.name,
        q.level ?? null,
        q.major ?? null,
        q.institution ?? null,
        q.certificateNumber ?? null,
        q.issuedDate ?? null,
        q.effectiveFrom ?? null,
        q.expiryDate ?? null,
        q.grade ?? null,
        q.note ?? null,
        q.attachmentId ?? null,
      ];
      if (q.attachmentId)
        await markAttachment(
          db,
          tenantId,
          q.attachmentId,
          'QUALIFICATION',
          CONFIDENTIAL_QUALIFICATIONS.has(q.type),
        );
      if (change.op === 'ADD_QUALIFICATION') {
        const created = await db.query(
          `INSERT INTO hrm_schema.employee_qualifications
             (tenant_id,employee_id,qualification_type,name,level,major,institution,certificate_number,issued_date,effective_from,expiry_date,grade,note,attachment_id,created_by,updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING id`,
          [tenantId, employeeId, ...values, actorId],
        );
        await lifecycleAudit(db, tenantId, actorId, 'QUALIFICATION_ADDED', created.rows[0].id, {
          employeeId,
          qualification: q,
        });
      } else {
        await db.query(
          `UPDATE hrm_schema.employee_qualifications SET qualification_type=$4,name=$5,level=$6,major=$7,institution=$8,certificate_number=$9,issued_date=$10,effective_from=$11,expiry_date=$12,grade=$13,note=$14,attachment_id=$15,updated_by=$16,updated_at=now()
           WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 AND deleted_at IS NULL`,
          [tenantId, employeeId, change.id, ...values, actorId],
        );
        await lifecycleAudit(db, tenantId, actorId, 'QUALIFICATION_UPDATED', change.id, {
          employeeId,
          qualification: q,
        });
      }
    }
  }
}

const iso = (value: unknown) => (value ? isoDate(value) : null);

export async function loadProfileDocuments(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  employeeId: string,
) {
  const profile = await db.query(
    `SELECT identity_card_number, identity_card_expiry_date,
            photo_attachment_id, identity_card_front_attachment_id, identity_card_back_attachment_id
     FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND employee_id=$2 AND deleted_at IS NULL`,
    [tenantId, employeeId],
  );
  const row = profile.rows[0];
  if (!row) return null;
  const ids = [
    row.photo_attachment_id,
    row.identity_card_front_attachment_id,
    row.identity_card_back_attachment_id,
  ].filter(Boolean);
  const files = ids.length
    ? await db.query(
        `SELECT id,file_name,content_type,size_bytes,created_at FROM hrm_schema.attachments WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [tenantId, ids],
      )
    : { rows: [] as Record<string, unknown>[] };
  const byId = new Map(files.rows.map((f) => [f.id as string, f]));
  const ref = (id: string | null) => {
    const f = id ? byId.get(id) : undefined;
    return f
      ? {
          id: f.id,
          fileName: f.file_name,
          contentType: f.content_type,
          sizeBytes: f.size_bytes,
          uploadedAt: f.created_at,
        }
      : null;
  };
  const qualifications = await db.query(
    `SELECT q.*, a.file_name, a.content_type, a.size_bytes
     FROM hrm_schema.employee_qualifications q
     LEFT JOIN hrm_schema.attachments a ON a.id=q.attachment_id AND a.deleted_at IS NULL
     WHERE q.tenant_id=$1 AND q.employee_id=$2 AND q.deleted_at IS NULL
     ORDER BY q.expiry_date NULLS LAST, q.created_at`,
    [tenantId, employeeId],
  );
  const photo = ref(row.photo_attachment_id);
  const front = ref(row.identity_card_front_attachment_id);
  const back = ref(row.identity_card_back_attachment_id);
  const missing = [
    !row.identity_card_number && 'identityCardNumber',
    !front && 'identityCardFront',
    !back && 'identityCardBack',
  ].filter(Boolean) as string[];
  return {
    employeeId,
    identityCardExpiryDate: iso(row.identity_card_expiry_date),
    photo,
    identityCardFront: front,
    identityCardBack: back,
    qualifications: qualifications.rows.map((q) => ({
      id: q.id,
      type: q.qualification_type,
      name: q.name,
      level: q.level,
      major: q.major,
      institution: q.institution,
      certificateNumber: q.certificate_number,
      issuedDate: iso(q.issued_date),
      effectiveFrom: iso(q.effective_from),
      expiryDate: iso(q.expiry_date),
      grade: q.grade,
      note: q.note,
      attachment: q.attachment_id
        ? {
            id: q.attachment_id,
            fileName: q.file_name,
            contentType: q.content_type,
            sizeBytes: q.size_bytes,
          }
        : null,
    })),
    /** CCCD là bắt buộc: số, ảnh mặt trước và mặt sau. Ảnh thẻ và bằng cấp là tùy chọn. */
    missingRequired: missing,
  };
}
