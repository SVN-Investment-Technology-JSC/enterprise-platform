import {
  SHARED_FOLDER_ROLE_LABELS,
  SHARED_FOLDER_ROLES,
  SHARED_PRINCIPAL_TYPE_LABELS,
  type SharedDirectory,
  type SharedFolderRole,
  type SharedFolderSharing,
  type SharedPrincipalType,
  type SharedShareGrant,
} from '@enterprise-platform/contracts-shared';
import type { SearchableSelectOption } from '@enterprise-platform/shared-ui';

/** Một dòng đang sửa trong hộp thoại chia sẻ. */
export interface ShareDraft {
  /** Khoá của dòng trên màn hình, không gửi lên server. */
  readonly key: string;
  /** Dòng đã lưu: đối tượng cố định, chỉ đổi quyền và thời hạn. */
  readonly saved: boolean;
  readonly principalType?: SharedPrincipalType;
  readonly principalId?: string;
  readonly label?: string;
  readonly detail?: string;
  readonly role: SharedFolderRole | '';
  readonly limited: boolean;
  /** `YYYY-MM-DD`; chỉ có nghĩa khi `limited`. */
  readonly expiresOn: string;
  readonly expired?: boolean;
  readonly missing?: boolean;
}

export const ROLE_OPTIONS: readonly SearchableSelectOption[] = SHARED_FOLDER_ROLES.map((role) => ({
  value: role,
  label: SHARED_FOLDER_ROLE_LABELS[role],
}));

export const EXPIRY_OPTIONS: readonly SearchableSelectOption[] = [
  { value: 'none', label: 'Không' },
  { value: 'until', label: 'Đến ngày' },
];

/** Giá trị của ô chọn đối tượng: `everyone:` hoặc `unit:<id>`… */
export const principalValue = (type: SharedPrincipalType, id?: string) => `${type}:${id ?? ''}`;

export function parsePrincipal(value: string): { principalType: SharedPrincipalType; principalId?: string } | undefined {
  const [type, id] = value.split(':') as [SharedPrincipalType, string | undefined];
  if (!(type in SHARED_PRINCIPAL_TYPE_LABELS)) return undefined;
  return { principalType: type, principalId: id || undefined };
}

let sequence = 0;
const nextKey = () => `row-${++sequence}`;

/** Dòng trống mới; quyền mặc định là Xem, mức thấp nhất. */
export function emptyDraft(): ShareDraft {
  return { key: nextKey(), saved: false, role: 'viewer', limited: false, expiresOn: '' };
}

/** Các dòng đặt trên thư mục, để sửa. */
export function draftsFrom(sharing: SharedFolderSharing): ShareDraft[] {
  return sharing.shares.map((share) => ({
    key: nextKey(),
    saved: true,
    principalType: share.principalType,
    principalId: share.principalId,
    label: share.label,
    detail: share.detail,
    role: share.role,
    limited: Boolean(share.expiresOn),
    expiresOn: share.expiresOn ?? '',
    expired: share.expired,
    missing: share.missing,
  }));
}

/**
 * Lựa chọn của ô đối tượng: Mọi người, phòng ban, chức danh, nhân sự. Bỏ những
 * đối tượng đã có dòng (`taken`) trừ chính dòng đang sửa.
 */
export function principalOptions(
  directory: SharedDirectory | undefined,
  taken: ReadonlySet<string>,
  current?: string,
): SearchableSelectOption[] {
  const options: SearchableSelectOption[] = [
    { value: principalValue('everyone'), label: SHARED_PRINCIPAL_TYPE_LABELS.everyone, badge: SHARED_PRINCIPAL_TYPE_LABELS.everyone },
  ];
  for (const node of directory?.nodes ?? []) {
    options.push({
      value: principalValue(node.kind, node.id),
      label: node.name,
      description: node.path || undefined,
      badge: SHARED_PRINCIPAL_TYPE_LABELS[node.kind],
    });
  }
  for (const person of directory?.people ?? []) {
    options.push({
      value: principalValue('user', person.userId),
      label: person.displayName,
      description: [person.positionName, ...person.unitNames].filter(Boolean).join(' · ') || person.email,
      badge: SHARED_PRINCIPAL_TYPE_LABELS.user,
    });
  }
  return options.filter((option) => option.value === current || !taken.has(option.value));
}

/** Đối tượng đã có dòng, để ô chọn của dòng khác không đưa ra lại. */
export function takenPrincipals(drafts: readonly ShareDraft[]): Set<string> {
  const taken = new Set<string>();
  for (const draft of drafts) {
    if (draft.principalType) taken.add(principalValue(draft.principalType, draft.principalId));
  }
  return taken;
}

/**
 * Dòng nháp → danh sách gửi server. Dòng mới chưa chọn đối tượng thì bỏ qua
 * như 1Office; dòng thiếu quyền hay chọn "Đến ngày" mà chưa có ngày thì báo.
 */
export function grantsFrom(drafts: readonly ShareDraft[]): { grants: SharedShareGrant[] } | { error: string } {
  const grants: SharedShareGrant[] = [];
  for (const draft of drafts) {
    if (!draft.principalType) continue;
    if (!draft.role) return { error: `Chọn quyền cho ${draft.label ?? 'đối tượng'}.` };
    if (draft.limited && !draft.expiresOn) return { error: `Chọn ngày hết hạn cho ${draft.label ?? 'đối tượng'}.` };
    grants.push({
      principalType: draft.principalType,
      principalId: draft.principalId,
      role: draft.role,
      expiresOn: draft.limited ? draft.expiresOn : undefined,
    });
  }
  return { grants };
}
