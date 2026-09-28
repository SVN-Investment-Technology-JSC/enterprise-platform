'use client';

import {
  PROJECT_ROLES,
  type ProjectMember,
  type ProjectRole,
} from '@enterprise-platform/contracts-workspace';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ROLE_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';
import { PeoplePicker } from './people-picker';
import { useDirectory } from './use-directory';

export interface MembersDialogProps {
  readonly open: boolean;
  readonly members: readonly ProjectMember[];
  /** Chỉ chủ nhiệm (hoặc quản trị tenant) đổi được vai trò chủ nhiệm. */
  readonly canTransferOwner: boolean;
  readonly onClose: () => void;
  readonly onSave: (members: { userId: string; role: ProjectRole }[]) => Promise<void>;
}

interface Row {
  readonly userId: string;
  readonly role: ProjectRole;
}

/**
 * Thêm, gỡ, đổi vai trò thành viên dự án.
 *
 * Người mới chọn từ danh bạ cả tổ chức. Lưu một lần cả danh sách qua
 * `PUT /projects/:id/members` — server giữ hai quy tắc: đúng một chủ nhiệm,
 * và không gỡ người còn việc chưa đóng. Giao diện chỉ kiểm sớm quy tắc thứ
 * nhất; quy tắc thứ hai cần dữ liệu công việc nên để server trả lỗi.
 */
export function MembersDialog({
  open,
  members,
  canTransferOwner,
  onClose,
  onSave,
}: MembersDialogProps) {
  const directory = useDirectory();
  const [rows, setRows] = useState<Row[]>([]);
  const [adding, setAdding] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows(members.map((member) => ({ userId: member.userId, role: member.role })));
    setAdding([]);
    setError(undefined);
    setSubmitting(false);
  }, [open, members]);

  const setRole = (userId: string, role: ProjectRole) =>
    setRows((current) =>
      current.map((row) => {
        if (row.userId === userId) return { ...row, role };
        // Chỉ có một chủ nhiệm: trao vai trò cho người mới thì người cũ lùi
        // xuống quản lý, thay vì để server trả lỗi "phải có đúng một".
        if (role === 'owner' && row.role === 'owner') return { ...row, role: 'manager' };
        return row;
      }),
    );

  const submit = async () => {
    const next: Row[] = [
      ...rows,
      ...adding.map((userId) => ({ userId, role: 'member' as ProjectRole })),
    ];
    if (next.filter((row) => row.role === 'owner').length !== 1) {
      setError('Dự án phải có đúng một chủ nhiệm.');
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      await onSave(next);
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được danh sách thành viên.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Thành viên dự án"
      subtitle="Thêm người từ danh bạ tổ chức. Người được giao việc phải là thành viên."
      submitLabel="Lưu"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <ul className={styles.memberList}>
        {rows.map((row) => {
          const person = directory.find(row.userId);
          const lockedOwner = row.role === 'owner' && !canTransferOwner;
          return (
            <li key={row.userId}>
              <span className={styles.memberName}>
                {directory.nameOf(row.userId)}
                {person?.unitNames.length ? (
                  <span className={styles.muted}> · {person.unitNames.join(', ')}</span>
                ) : null}
              </span>
              <span className={styles.memberRole}>
                <Choice
                  label={`Vai trò của ${directory.nameOf(row.userId)}`}
                  value={row.role}
                  disabled={lockedOwner}
                  title={lockedOwner ? 'Chỉ chủ nhiệm mới trao được vai trò chủ nhiệm.' : undefined}
                  options={PROJECT_ROLES.filter(
                    (role) => role !== 'owner' || canTransferOwner || row.role === 'owner',
                  ).map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
                  onChange={(value) => setRole(row.userId, value as ProjectRole)}
                />
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`Gỡ ${directory.nameOf(row.userId)}`}
                  disabled={row.role === 'owner'}
                  title={row.role === 'owner' ? 'Trao vai trò chủ nhiệm cho người khác trước khi gỡ.' : undefined}
                  onClick={() => setRows((current) => current.filter((entry) => entry.userId !== row.userId))}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      <Field label="Thêm người" hint="Người mới vào với vai trò Thành viên; đổi vai trò sau khi lưu.">
        <PeoplePicker
          people={directory.people}
          selected={adding}
          onChange={setAdding}
          nameOf={directory.nameOf}
          exclude={rows.map((row) => row.userId)}
          degraded={directory.degraded}
          loaded={directory.loaded}
        />
      </Field>
    </Dialog>
  );
}
