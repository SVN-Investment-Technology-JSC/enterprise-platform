'use client';

import type { ProjectMember, ProjectRole } from '@enterprise-platform/contracts-workspace';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog } from './dialog';
import { OrgPicker } from './org-picker';
import { PeoplePicker } from './people-picker';
import { useDirectory } from './use-directory';
import { roleOptions, useProjectRoles } from './use-project-roles';

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

/** Hai cách thêm người: gõ tên, hay tích đơn vị / chức danh trên cây tổ chức. */
type AddMode = 'name' | 'org';

/**
 * Thêm, gỡ, đổi vai trò thành viên dự án.
 *
 * Người mới chọn từ danh bạ cả tổ chức — từng người theo tên, hoặc nhiều
 * người một lần theo đơn vị và chức danh. Lưu một lần cả danh sách qua
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
  const projectRoles = useProjectRoles();
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<AddMode>('name');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  // Chỉ nạp lại danh sách khi hộp thoại MỞ, không phải mỗi lần `members` đổi
  // tham chiếu: trang cha có thể tự tải lại chi tiết dự án (poll tin chưa đọc,
  // kéo tiến độ quy trình…) khi hộp thoại đang mở, và nếu nạp lại theo `members`
  // thì mỗi lần như vậy sẽ xoá sạch những người vừa thêm — đúng lỗi "chọn người
  // sau mất người trước".
  const initialized = useRef(false);
  useEffect(() => {
    if (!open) {
      initialized.current = false;
      return;
    }
    if (initialized.current) return;
    initialized.current = true;
    setRows(members.map((member) => ({ userId: member.userId, role: member.role })));
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

  /** Thêm người vừa chọn thành dòng mới; người đã có thì giữ nguyên vai cũ. */
  const addPeople = (userIds: readonly string[], role: ProjectRole = 'member') => {
    setRows((current) => {
      const present = new Set(current.map((row) => row.userId));
      const added = userIds
        .filter((userId) => !present.has(userId))
        .map((userId) => ({ userId, role }));
      return added.length > 0 ? [...current, ...added] : current;
    });
  };

  const submit = async () => {
    if (rows.filter((row) => row.role === 'owner').length !== 1) {
      setError('Dự án phải có đúng một chủ nhiệm.');
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      await onSave(rows);
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được danh sách thành viên.');
      setSubmitting(false);
    }
  };

  const memberRoleOptions = roleOptions(projectRoles, false);

  return (
    <Dialog
      open={open}
      size="wide"
      title="Thành viên dự án"
      subtitle={`${rows.length} thành viên`}
      submitLabel="Lưu"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <ul className={`${styles.memberList} ${styles.memberListScroll}`}>
        {rows.map((row) => {
          const person = directory.find(row.userId);
          const lockedOwner = row.role === 'owner' && !canTransferOwner;
          return (
            <li key={row.userId}>
              <span className={styles.memberName}>
                {directory.nameOf(row.userId)}
                {person?.positionName || person?.unitNames.length ? (
                  <span className={styles.muted}>
                    {' '}
                    ·{' '}
                    {[person.positionName, person.unitNames.join(', ')]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                ) : null}
              </span>
              <span className={`${styles.memberRole} ${styles.memberRoleEdit}`}>
                <Choice
                  label={`Vai trò của ${directory.nameOf(row.userId)}`}
                  value={row.role}
                  disabled={lockedOwner}
                  title={lockedOwner ? 'Chỉ chủ nhiệm mới trao được vai trò chủ nhiệm.' : undefined}
                  options={roleOptions(
                    projectRoles,
                    canTransferOwner || row.role === 'owner',
                  )}
                  onChange={(value) => setRole(row.userId, value)}
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

      <section className={styles.memberAdd} aria-label="Thêm người">
        <div className={styles.memberAddHead}>
          <span className={styles.fieldLabel}>Thêm người</span>
          <div className={styles.segmented} role="tablist" aria-label="Cách thêm người">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'name'}
              className={mode === 'name' ? styles.segmentActive : styles.segment}
              onClick={() => setMode('name')}
            >
              Theo tên
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'org'}
              className={mode === 'org' ? styles.segmentActive : styles.segment}
              onClick={() => setMode('org')}
            >
              Theo đơn vị / chức danh
            </button>
          </div>
        </div>

        {mode === 'name' ? (
          <>
            <PeoplePicker
              people={directory.people}
              // Người đã thêm hiện thành dòng có ô vai trò ở trên, nên ô tìm không
              // giữ lại "chip": chọn xong là thêm ngay rồi xoá từ khoá.
              selected={[]}
              onChange={(userIds) => addPeople(userIds)}
              nameOf={directory.nameOf}
              exclude={rows.map((row) => row.userId)}
              degraded={directory.degraded}
              loaded={directory.loaded}
            />
            <span className={styles.fieldHint}>
              Người vừa chọn hiện thành một dòng bên trên; chọn vai trò ngay tại dòng đó.
            </span>
          </>
        ) : (
          <OrgPicker
            nodes={directory.orgNodes}
            people={directory.people}
            exclude={rows.map((row) => row.userId)}
            roleOptions={memberRoleOptions}
            defaultRole="member"
            onAdd={addPeople}
          />
        )}
      </section>
    </Dialog>
  );
}
