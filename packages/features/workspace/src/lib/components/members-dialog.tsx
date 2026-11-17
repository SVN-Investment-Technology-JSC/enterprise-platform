'use client';

import type { ProjectMember, ProjectRole } from '@enterprise-platform/contracts-workspace';
import { toast } from '@enterprise-platform/shared-ui';
import { useEffect, useRef, useState } from 'react';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog } from './dialog';
import { MemberAddPanel } from './member-add-panel';
import { Tooltip } from './tooltip';
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

/** Toast "Hoàn tác" tự tắt sau chừng này mili giây. */
const UNDO_MS = 8000;

/**
 * Thêm, gỡ, đổi vai trò thành viên dự án.
 *
 * Mỗi thao tác có hiệu lực ngay (không có nháp chờ "Lưu"): thêm người, gỡ
 * người, đổi vai trò đều gửi cả danh sách mới qua `PUT /projects/:id/members`
 * rồi báo bằng toast kèm "Hoàn tác". Server giữ hai quy tắc: đúng một chủ
 * nhiệm, và không gỡ người còn việc chưa đóng. Giao diện chỉ kiểm sớm quy tắc
 * thứ nhất; thao tác bị server từ chối thì danh sách lùi về như cũ và hiện lỗi.
 *
 * Người mới chọn từ danh bạ cả tổ chức — từng người theo tên, hoặc nhiều
 * người một lần theo đơn vị và chức danh. Gỡ và đổi vai trò nhiều người cùng
 * lúc bằng ô tích ở danh sách hiện tại.
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [newRole, setNewRole] = useState<ProjectRole>('member');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** Toast "Hoàn tác" đang hiện: tắt nó trước thao tác kế tiếp để không hoàn tác chồng lên thay đổi mới. */
  const undoToast = useRef<string | number | undefined>(undefined);

  // Chỉ nạp lại danh sách khi hộp thoại MỞ, không phải mỗi lần `members` đổi
  // tham chiếu: trang cha có thể tự tải lại chi tiết dự án (poll tin chưa đọc,
  // kéo tiến độ quy trình…) khi hộp thoại đang mở, và nếu nạp lại theo `members`
  // thì mỗi lần như vậy sẽ xoá sạch thay đổi vừa làm.
  const initialized = useRef<boolean>(false);
  useEffect(() => {
    if (!open) {
      initialized.current = false;
      if (undoToast.current !== undefined) toast.dismiss(undoToast.current);
      undoToast.current = undefined;
      return;
    }
    if (initialized.current) return;
    initialized.current = true;
    setRows(members.map((member) => ({ userId: member.userId, role: member.role })));
    setSelected(new Set());
    setNewRole('member');
    setError(undefined);
    setBusy(false);
  }, [open, members]);

  /**
   * Áp dụng danh sách mới ngay: hiện luôn trên giao diện, gửi lên server, lỗi thì lùi về `previous`.
   * `undoable` bật toast "Hoàn tác" đưa danh sách về `previous`.
   */
  const apply = async (next: Row[], previous: Row[], message: string, undoable = true) => {
    if (next.filter((row) => row.role === 'owner').length !== 1) {
      setError('Dự án phải có đúng một chủ nhiệm.');
      return;
    }
    if (undoToast.current !== undefined) toast.dismiss(undoToast.current);
    undoToast.current = undefined;
    setError(undefined);
    setBusy(true);
    setRows(next);
    try {
      await onSave(next);
      undoToast.current = toast.success(
        message,
        undoable
          ? {
              duration: UNDO_MS,
              action: { label: 'Hoàn tác', onClick: () => void apply(previous, next, 'Đã hoàn tác.', false) },
            }
          : undefined,
      );
    } catch (cause) {
      setRows(previous);
      setError((cause as { message?: string })?.message ?? 'Không lưu được danh sách thành viên.');
    } finally {
      setBusy(false);
    }
  };

  const setRole = (userId: string, role: ProjectRole) => {
    const previous = rows;
    const next = rows.map((row) => {
      if (row.userId === userId) return { ...row, role };
      // Chỉ có một chủ nhiệm: trao vai trò cho người mới thì người cũ lùi
      // xuống quản lý, thay vì để server trả lỗi "phải có đúng một".
      if (role === 'owner' && row.role === 'owner') return { ...row, role: 'manager' as ProjectRole };
      return row;
    });
    void apply(next, previous, `Đã đổi vai trò của ${directory.nameOf(userId)}.`);
  };

  /** Thêm người vừa chọn; người đã có thì giữ nguyên vai cũ. */
  const addPeople = (userIds: readonly string[]) => {
    const present = new Set(rows.map((row) => row.userId));
    const added = userIds
      .filter((userId) => !present.has(userId))
      .map((userId) => ({ userId, role: newRole }));
    if (added.length === 0) return;
    void apply([...rows, ...added], rows, `Đã thêm ${added.length} người vào dự án.`);
  };

  // Chủ nhiệm không tích được: phải trao vai cho người khác trước khi gỡ hay đổi hàng loạt.
  const selectable = rows.filter((row) => row.role !== 'owner').map((row) => row.userId);
  const picked = selectable.filter((userId) => selected.has(userId));
  const allPicked = selectable.length > 0 && picked.length === selectable.length;

  const toggleOne = (userId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const removePicked = () => {
    if (picked.length === 0) return;
    const gone = new Set(picked);
    void apply(
      rows.filter((row) => !gone.has(row.userId)),
      rows,
      picked.length === 1
        ? `Đã gỡ ${directory.nameOf(picked[0])} khỏi dự án.`
        : `Đã gỡ ${picked.length} người khỏi dự án.`,
    );
    setSelected(new Set());
  };

  const rolePicked = (role: ProjectRole) => {
    if (picked.length === 0) return;
    const hit = new Set(picked);
    void apply(
      rows.map((row) => (hit.has(row.userId) ? { ...row, role } : row)),
      rows,
      `Đã đổi vai trò của ${picked.length} người.`,
    );
    setSelected(new Set());
  };

  const ownerless = roleOptions(projectRoles, false);

  return (
    <Dialog
      open={open}
      size="extraWide"
      fixedHeight
      title="Thành viên dự án"
      subtitle={`${rows.length} thành viên`}
      submitLabel="Xong"
      cancelLabel={null}
      guardDiscard={false}
      // Tạm ẩn chân popup (nút "Xong"): mọi thao tác đã lưu ngay, đóng bằng nút X hoặc Esc.
      // Muốn hiện lại thì bỏ dòng `hideFooter` dưới đây.
      hideFooter
      submitting={false}
      submitDisabled={busy}
      error={error}
      onClose={onClose}
      onSubmit={onClose}
    >
      <div className={styles.membersLayout}>
        <section className={styles.membersCurrent} aria-label="Thành viên hiện tại">
          {picked.length === 0 ? (
            <div className={styles.membersBar}>
              <label className={styles.membersBarCheck}>
                <input
                  type="checkbox"
                  checked={allPicked}
                  disabled={selectable.length === 0 || busy}
                  aria-label="Chọn tất cả thành viên"
                  onChange={() => setSelected(allPicked ? new Set() : new Set(selectable))}
                />
                <span className={styles.fieldLabel}>Thành viên hiện tại ({rows.length})</span>
              </label>
            </div>
          ) : (
            <div className={`${styles.membersBar}`} role="toolbar" aria-label="Thao tác với người đã chọn">
              <label className={styles.membersBarCheck}>
                <input
                  type="checkbox"
                  checked={allPicked}
                  aria-label="Chọn tất cả thành viên"
                  onChange={() => setSelected(allPicked ? new Set() : new Set(selectable))}
                />
                <span className={styles.fieldLabel}>Đã chọn {picked.length}</span>
              </label>
              <span className={styles.membersBarActions}>
                <span className={styles.membersBarRole}>
                  <Choice
                    selectOnly
                    label="Đổi vai trò những người đã chọn"
                    value=""
                    placeholder="Vai trò"
                    disabled={busy}
                    options={ownerless}
                    onChange={(value) => rolePicked(value as ProjectRole)}
                  />
                </span>
                <Tooltip content="Gỡ những người đã chọn khỏi dự án">
                  <button type="button" className={styles.buttonDanger} disabled={busy} onClick={removePicked}>
                    Gỡ
                  </button>
                </Tooltip>
                <button type="button" className={styles.buttonGhost} onClick={() => setSelected(new Set())}>
                  Bỏ chọn
                </button>
              </span>
            </div>
          )}
          <ul className={`${styles.memberList} ${styles.membersCurrentList}`}>
            {rows.map((row) => {
              const person = directory.find(row.userId);
              const lockedOwner = row.role === 'owner' && !canTransferOwner;
              const isOwner = row.role === 'owner';
              const name = directory.nameOf(row.userId);
              const position = person?.positionName ?? '';
              const units = person?.unitNames.join(', ') ?? '';
              return (
                <li key={row.userId}>
                  <label className={styles.memberPick}>
                    <Tooltip
                      content={isOwner ? 'Trao vai trò chủ nhiệm cho người khác trước khi gỡ.' : undefined}
                      side="right"
                    >
                      <span className={styles.tooltipAnchor}>
                        <input
                          type="checkbox"
                          checked={selected.has(row.userId) && !isOwner}
                          disabled={isOwner || busy}
                          aria-label={`Chọn ${directory.nameOf(row.userId)}`}
                          onChange={() => toggleOne(row.userId)}
                        />
                      </span>
                    </Tooltip>
                    <Tooltip content={[name, position, units].filter(Boolean).join(' · ')} side="top" align="start">
                      <span className={styles.personText}>
                        <strong>{name}</strong>
                        {position ? <span className={styles.muted}>{position}</span> : null}
                        {units ? <span className={styles.muted}>{units}</span> : null}
                      </span>
                    </Tooltip>
                  </label>
                  <span className={`${styles.memberRole} ${styles.memberRoleEdit}`}>
                    <Choice
                      selectOnly
                      label={`Vai trò của ${directory.nameOf(row.userId)}`}
                      value={row.role}
                      disabled={lockedOwner || busy}
                      title={lockedOwner ? 'Chỉ chủ nhiệm mới trao được vai trò chủ nhiệm.' : undefined}
                      options={roleOptions(projectRoles, canTransferOwner || row.role === 'owner')}
                      onChange={(value) => setRole(row.userId, value)}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <MemberAddPanel
          people={directory.people}
          orgNodes={directory.orgNodes}
          exclude={rows.map((row) => row.userId)}
          degraded={directory.degraded}
          loaded={directory.loaded}
          busy={busy}
          onAdd={addPeople}
          roleControl={
            <span className={styles.addRole}>
              <Choice
                selectOnly
                label="Vai trò của người sắp thêm"
                value={newRole}
                disabled={busy}
                options={ownerless}
                onChange={(value) => setNewRole(value)}
              />
            </span>
          }
        />
      </div>
    </Dialog>
  );
}
