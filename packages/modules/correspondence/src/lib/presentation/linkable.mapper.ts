import {
  DELIVERY_STATUS_LABELS,
  LETTER_DIRECTION_LABELS,
  type LetterDetail,
  type LetterDirection,
  type LetterSummary,
} from '@enterprise-platform/contracts-correspondence';
import type {
  LinkableCandidate,
  LinkableField,
  LinkableKind,
  LinkableObject,
  LinkableRef,
} from '@enterprise-platform/contracts-integration';

/**
 * Văn thư công bố công văn cho module khác gắn vào (hợp đồng `LinkableObject` ở `contracts-integration`).
 *
 * Chỉ chuyển dạng dữ liệu mà service sẵn có đã trả (đã lọc theo quyền xem từng công văn); không đọc thêm gì. Mỗi chiều
 * (đến, đi) là một loại. Văn bản phát hành nội bộ là công văn đi gửi phòng ban trong công ty, không phải hồ sơ riêng,
 * nên nằm trong loại "Công văn đi".
 *
 * `label` được bên gắn lưu lại và mọi thành viên dự án đều thấy, nên với công văn mật hay thư riêng gửi đích danh,
 * nhãn chỉ gồm số và loại văn bản, không có trích yếu.
 */
export const CORRESPONDENCE_LINKABLE_KINDS = {
  incoming: 'correspondence.incoming',
  outgoing: 'correspondence.outgoing',
} as const satisfies Record<LetterDirection, string>;

export type CorrespondenceLinkableKind =
  (typeof CORRESPONDENCE_LINKABLE_KINDS)[keyof typeof CORRESPONDENCE_LINKABLE_KINDS];

const MODULE_LABEL = 'Văn thư';

/** Ai vào được Văn thư cũng có công văn xem được (ít nhất công văn mình liên quan), nên trả cả hai loại. */
export const CORRESPONDENCE_LINKABLE_KIND_LIST: readonly LinkableKind[] = [
  {
    key: CORRESPONDENCE_LINKABLE_KINDS.incoming,
    moduleLabel: MODULE_LABEL,
    label: LETTER_DIRECTION_LABELS.incoming,
    prefill: false,
  },
  {
    key: CORRESPONDENCE_LINKABLE_KINDS.outgoing,
    moduleLabel: MODULE_LABEL,
    label: LETTER_DIRECTION_LABELS.outgoing,
    prefill: false,
  },
];

export function isCorrespondenceLinkableKind(value: unknown): value is CorrespondenceLinkableKind {
  return CORRESPONDENCE_LINKABLE_KIND_LIST.some((kind) => kind.key === value);
}

export function directionOfKind(kind: CorrespondenceLinkableKind): LetterDirection {
  return kind === CORRESPONDENCE_LINKABLE_KINDS.incoming ? 'incoming' : 'outgoing';
}

/** Màn Văn thư mở ngăn chi tiết công văn bằng hash `#letters/<id>`. */
export function letterLaunchUrl(id: string): string {
  return `/modules/correspondence#letters/${encodeURIComponent(id)}`;
}

const joined = (...parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join(' — ');
const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);
const text = (key: string, label: string, value: string | number | null | undefined): LinkableField => ({
  key,
  label,
  type: 'text',
  value: value == null || value === '' ? null : String(value),
});
const date = (key: string, label: string, value: string | null | undefined): LinkableField => ({
  key,
  label,
  type: 'date',
  value: day(value),
});
const list = (values: readonly string[] | undefined) => (values?.length ? values.join(', ') : null);

/** Công văn mật hay thư riêng: không để trích yếu vào nhãn được lưu ở module khác. */
function sensitive(row: LetterSummary & { readonly personal?: boolean }): boolean {
  return row.restricted || row.personal === true;
}

function letterLabel(row: LetterSummary & { readonly personal?: boolean }): string {
  if (!sensitive(row)) return joined(row.displayNo, row.subject);
  const marker = row.restricted ? 'mật' : 'thư riêng';
  return joined(row.displayNo, `${row.kindName || LETTER_DIRECTION_LABELS[row.direction]} (${marker})`);
}

/* ------------------------------------------------------------------ Công văn */

export function letterCandidate(row: LetterSummary & { readonly personal?: boolean }): LinkableCandidate {
  const party = row.direction === 'incoming' ? row.senderOrg : row.recipient ?? row.senderOrg;
  return {
    kind: CORRESPONDENCE_LINKABLE_KINDS[row.direction],
    id: row.id,
    code: row.displayNo || undefined,
    label: letterLabel(row),
    status: row.stageLabel,
    hint: joined(party, day(row.receivedOn)),
  };
}

export function letterObject(row: LetterDetail): LinkableObject {
  const incoming = row.direction === 'incoming';
  const upstream: LinkableRef[] = row.relatedLetterId
    ? [
        {
          kind: CORRESPONDENCE_LINKABLE_KINDS.incoming,
          id: row.relatedLetterId,
          code: row.relatedLetterNo,
          label: row.relatedLetterNo ? `${LETTER_DIRECTION_LABELS.incoming} ${row.relatedLetterNo}` : LETTER_DIRECTION_LABELS.incoming,
        },
      ]
    : [];
  const fields: LinkableField[] = incoming
    ? [
        text('subject', 'Trích yếu', row.subject),
        text('incomingNo', 'Số đến', row.incomingNo),
        date('receivedOn', 'Ngày đến', row.receivedOn),
        text('senderOrg', 'Cơ quan gửi', row.senderOrg),
        text('senderRef', 'Số, ký hiệu', row.senderRef),
        date('senderDate', 'Ngày văn bản', row.senderDate),
        text('kind', 'Loại văn bản', row.kindName),
        text('urgency', 'Độ khẩn', row.urgencyName),
        text('confidentiality', 'Độ mật', row.confidentialityName),
        date('dueOn', 'Hạn xử lý', row.dueOn),
        text('stage', 'Trạng thái', row.stageLabel),
        text('currentStep', 'Bước hiện tại', row.currentStepName),
        text('assignees', 'Người đang xử lý', list(row.currentAssigneeNames)),
        text('units', 'Phòng ban xử lý', list(row.unitNames)),
        text('register', 'Sổ đăng ký', row.registerName),
        text('archiveCode', 'Mã lưu trữ', row.archiveCode),
      ]
    : [
        text('subject', 'Trích yếu', row.subject),
        text('outgoingNo', 'Số ban hành', row.outgoingNo),
        text('draftNo', 'Số dự thảo', row.incomingNo),
        text('authorUnit', 'Đơn vị soạn thảo', row.authorUnitName ?? row.senderOrg),
        text('author', 'Người soạn', row.authorName),
        text('recipient', 'Nơi nhận', row.recipient),
        text('kind', 'Loại văn bản', row.kindName),
        text('urgency', 'Độ khẩn', row.urgencyName),
        text('confidentiality', 'Độ mật', row.confidentialityName),
        date('dueOn', 'Hạn ban hành', row.dueOn),
        text('stage', 'Trạng thái', row.stageLabel),
        text('currentStep', 'Bước hiện tại', row.currentStepName),
        text('assignees', 'Người đang xử lý', list(row.currentAssigneeNames)),
        text('signer', 'Người ký', joined(row.signerName, row.signerTitle)),
        date('publishedOn', 'Ngày ban hành', row.publishedOn),
        text('delivery', 'Tình trạng gửi', row.deliveryStatus ? DELIVERY_STATUS_LABELS[row.deliveryStatus] : null),
        text('register', 'Sổ đăng ký', row.registerName),
        text('archiveCode', 'Mã lưu trữ', row.archiveCode),
        text('relatedLetter', 'Trả lời công văn đến', row.relatedLetterNo),
      ];
  return {
    ...letterCandidate(row),
    launchUrl: letterLaunchUrl(row.id),
    fields,
    upstream,
  };
}
