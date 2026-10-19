'use client';

import {
  SHARED_FOLDER_ROLE_LABELS,
  type SharedDirectory,
  type SharedFolder,
  type SharedFolderRole,
  type SharedFolderSharing,
  type SharedPrincipalType,
} from '@enterprise-platform/contracts-shared';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Briefcase, Building2, Plus, User, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatDate } from '../library.model';
import * as api from '../shared-api';
import styles from '../shared.module.scss';
import {
  draftsFrom,
  emptyDraft,
  EXPIRY_OPTIONS,
  grantsFrom,
  parsePrincipal,
  principalOptions,
  principalValue,
  ROLE_OPTIONS,
  takenPrincipals,
  type ShareDraft,
} from '../sharing.model';
import { Dialog } from './dialog';

const ICONS: Readonly<Record<SharedPrincipalType, ReactNode>> = {
  everyone: <Users size={15} aria-hidden />,
  unit: <Building2 size={15} aria-hidden />,
  position: <Briefcase size={15} aria-hidden />,
  user: <User size={15} aria-hidden />,
};

/** Hôm nay theo máy người dùng, `YYYY-MM-DD`: chặn chọn ngày hết hạn trong quá khứ. */
function todayValue(): string {
  const now = new Date();
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface ShareDialogProps {
  /** Thư mục đang chia sẻ; rỗng là đóng. */
  readonly folder?: SharedFolder;
  readonly onClose: () => void;
  /** Gọi sau khi lưu: quyền của chính người dùng ở thư mục có thể đã đổi. */
  readonly onSaved: () => void;
}

/**
 * "Chia sẻ" thư mục như hộp thoại của 1Office: chủ sở hữu ở dòng đầu, chia sẻ
 * kế thừa từ thư mục cha (chỉ đọc), rồi các dòng đặt trên thư mục này — đối
 * tượng, quyền, thời hạn — thêm bằng nút "Thêm", bỏ bằng nút ở cuối dòng.
 */
export function ShareDialog({ folder, onClose, onSaved }: ShareDialogProps) {
  const [sharing, setSharing] = useState<SharedFolderSharing>();
  const [directory, setDirectory] = useState<SharedDirectory>();
  const [drafts, setDrafts] = useState<ShareDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!folder) return;
    let alive = true;
    setSharing(undefined);
    setDirectory(undefined);
    setDrafts([]);
    setError(undefined);
    setSubmitting(false);
    setLoading(true);
    Promise.all([api.loadFolderSharing(folder.id), api.loadDirectory().catch(() => undefined)])
      .then(([loaded, people]) => {
        if (!alive) return;
        setSharing(loaded);
        setDirectory(people);
        const rows = draftsFrom(loaded);
        setDrafts(rows.length ? rows : [emptyDraft()]);
      })
      .catch((cause) => alive && setError(api.errorMessage(cause, 'Không tải được danh sách chia sẻ.')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [folder]);

  const taken = useMemo(() => takenPrincipals(drafts), [drafts]);

  if (!folder) return null;

  const change = (key: string, patch: Partial<ShareDraft>) =>
    setDrafts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const pickPrincipal = (row: ShareDraft, value: string) => {
    const parsed = value ? parsePrincipal(value) : undefined;
    const option = value ? principalOptions(directory, new Set(), value).find((item) => item.value === value) : undefined;
    change(row.key, {
      principalType: parsed?.principalType,
      principalId: parsed?.principalId,
      label: option?.label,
      detail: option?.description,
    });
  };

  const submit = async () => {
    const result = grantsFrom(drafts);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await api.saveFolderSharing(folder.id, result.grants);
      onSaved();
      onClose();
    } catch (cause) {
      setError(api.errorMessage(cause, 'Không cập nhật được chia sẻ.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      wide
      title={`Chia sẻ thư mục — ${folder.name}`}
      submitLabel="Cập nhật"
      submittingLabel="Đang cập nhật…"
      submitting={submitting}
      submitDisabled={loading || !sharing}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {directory?.degraded ? (
        <p className={styles.warning} role="status">
          Chưa đọc được sơ đồ tổ chức.
        </p>
      ) : null}
      <div className={styles.shareTable} role="table" aria-label="Chia sẻ">
        <div className={`${styles.shareRow} ${styles.shareHead}`} role="row">
          <span role="columnheader">Đối tượng</span>
          <span role="columnheader">Quyền</span>
          <span role="columnheader">Thời hạn</span>
          <span aria-hidden />
        </div>

        {loading ? <div className={styles.empty}>Đang tải…</div> : null}

        {sharing ? (
          <div className={styles.shareRow} role="row">
            <Subject icon={ICONS.user} label={sharing.owner.name ?? '—'} />
            <span className={styles.shareFixed} role="cell">
              Chủ sở hữu
            </span>
            <span className={styles.shareFixed} role="cell">
              Không
            </span>
            <span aria-hidden />
          </div>
        ) : null}

        {sharing?.inherited.map((share, index) => (
          <div key={`inherited-${index}`} className={`${styles.shareRow} ${styles.shareInherited}`} role="row">
            <Subject
              icon={ICONS[share.principalType]}
              label={share.label}
              detail={share.detail}
              source={share.owner ? `Chủ sở hữu “${share.fromFolderName}”` : `Từ “${share.fromFolderName}”`}
              expired={share.expired}
              missing={share.missing}
            />
            <span className={styles.shareFixed} role="cell">
              {SHARED_FOLDER_ROLE_LABELS[share.role]}
            </span>
            <span className={styles.shareFixed} role="cell">
              {share.expiresOn ? formatDate(share.expiresOn) : 'Không'}
            </span>
            <span aria-hidden />
          </div>
        ))}

        {drafts.map((row) => {
          const current = row.principalType ? principalValue(row.principalType, row.principalId) : '';
          return (
            <div key={row.key} className={styles.shareRow} role="row">
              {row.saved ? (
                <Subject
                  icon={ICONS[row.principalType ?? 'user']}
                  label={row.label ?? '—'}
                  detail={row.detail}
                  expired={row.expired}
                  missing={row.missing}
                />
              ) : (
                <div className={styles.shareCell} role="cell">
                  <SearchableSelect
                    options={principalOptions(directory, taken, current)}
                    value={current}
                    placeholder="Phòng ban, chức danh, nhân sự"
                    clearable={false}
                    height={36}
                    onChange={(value) => pickPrincipal(row, value)}
                  />
                </div>
              )}
              <div className={styles.shareCell} role="cell" aria-label="Quyền">
                <SearchableSelect
                  options={ROLE_OPTIONS}
                  value={row.role}
                  placeholder="Chọn quyền"
                  clearable={false}
                  height={36}
                  onChange={(value) => change(row.key, { role: value as SharedFolderRole })}
                />
              </div>
              <div className={`${styles.shareCell} ${styles.shareExpiry}`} role="cell" aria-label="Thời hạn">
                <SearchableSelect
                  options={EXPIRY_OPTIONS}
                  value={row.limited ? 'until' : 'none'}
                  clearable={false}
                  height={36}
                  onChange={(value) => change(row.key, { limited: value === 'until' })}
                />
                {row.limited ? (
                  <input
                    type="date"
                    aria-label="Ngày hết hạn"
                    value={row.expiresOn}
                    min={row.saved && row.expiresOn ? undefined : todayValue()}
                    onChange={(event) => change(row.key, { expiresOn: event.target.value })}
                  />
                ) : null}
              </div>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Bỏ ${row.label ?? 'dòng này'}`}
                onClick={() => setDrafts((rows) => rows.filter((item) => item.key !== row.key))}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div>
        <button
          type="button"
          className={styles.buttonGhost}
          disabled={loading || !sharing}
          onClick={() => setDrafts((rows) => [...rows, emptyDraft()])}
        >
          <Plus size={15} /> Thêm
        </button>
      </div>
    </Dialog>
  );
}

function Subject({
  icon,
  label,
  detail,
  source,
  expired,
  missing,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly detail?: string;
  readonly source?: string;
  readonly expired?: boolean;
  readonly missing?: boolean;
}) {
  const sub = [detail, source].filter(Boolean).join(' · ');
  return (
    <div className={styles.shareSubject} role="cell">
      <span className={styles.shareIcon}>{icon}</span>
      <span className={styles.shareName}>
        <span>
          <strong title={label}>{label}</strong>
          {expired ? <span className={`${styles.badge} ${styles.badgeDanger}`}>Hết hạn</span> : null}
          {missing ? <span className={`${styles.badge} ${styles.badgeWarn}`}>Không còn</span> : null}
        </span>
        {sub ? <small title={sub}>{sub}</small> : null}
      </span>
    </div>
  );
}
