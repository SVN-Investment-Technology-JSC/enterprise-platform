'use client';

import {
  PROJECT_PERMISSION_LABELS,
  PROJECT_PERMISSIONS,
  type ProjectPermission,
  type ProjectRoleDefinition,
  type ProjectRoleList,
} from '@enterprise-platform/contracts-workspace';
import { Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';
import { publishProjectRoles } from './use-project-roles';
import { Confirm } from './confirm-box';

/**
 * Cài đặt "Vai trò trong dự án": danh sách vai dùng chung cho mọi dự án, mỗi
 * vai một bộ quyền. Bốn vai mặc định (chủ nhiệm, quản lý, thành viên, người
 * xem) không xoá được; chủ nhiệm luôn giữ đủ quyền.
 */
export function ProjectRoleSettings() {
  const [list, setList] = useState<ProjectRoleList>();
  const [error, setError] = useState<string>();
  /** Hộp thêm / sửa vai: `null` là thêm mới. */
  const [editing, setEditing] = useState<ProjectRoleDefinition | null>();
  /** Hộp xem và thêm quyền của một vai. */
  const [viewing, setViewing] = useState<ProjectRoleDefinition>();

  useEffect(() => {
    api
      .listProjectRoles()
      .then(setList)
      .catch((cause: { message?: string }) =>
        setError(cause?.message ?? 'Không tải được danh sách vai trò.'),
      );
  }, []);

  const apply = (next: ProjectRoleList) => {
    setList(next);
    publishProjectRoles(next);
    setError(undefined);
  };

  const save = async (key: string | undefined, name: string, permissions: ProjectPermission[]) => {
    const next = key
      ? await api.updateProjectRole(key, { name, permissions })
      : await api.createProjectRole({ name, permissions });
    apply(next);
  };

  const remove = async (role: ProjectRoleDefinition) => {
    try {
      apply(await api.deleteProjectRole(role.key));
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không xoá được vai trò.');
    }
  };

  const canEdit = list?.canEdit ?? false;

  return (
    <div className={styles.roleSettings}>
      <div className={styles.roleSettingsHead}>
        <p className={styles.muted}>
          {canEdit
            ? 'Gán vai cho thành viên ở hộp "Thành viên dự án" của từng dự án.'
            : 'Chỉ quản trị viên được thêm hoặc sửa vai trò.'}
        </p>
        {canEdit ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setEditing(null)}>
            <Plus size={15} /> Thêm vai trò
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {!list ? (
        error ? null : <p className={styles.muted}>Đang tải vai trò…</p>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Vai trò</th>
                <th>Quyền</th>
                <th>Đang giữ</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {list.items.map((role) => (
                <tr key={role.key}>
                  <td>
                    <span className={styles.roleName}>
                      <b>{role.name}</b>
                      {role.isSystem ? <span className={styles.roleSystemTag}>Mặc định</span> : null}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.rolePermissionCount}
                      onClick={() => setViewing(role)}
                      title="Xem các quyền của vai trò này"
                    >
                      {role.permissions.length} quyền
                    </button>
                  </td>
                  <td className={styles.muted}>{role.memberCount} thành viên</td>
                  <td>
                    {canEdit ? (
                      <span className={styles.roleActions}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`Sửa vai trò ${role.name}`}
                          title="Sửa vai trò"
                          onClick={() => setEditing(role)}
                        >
                          <Pencil size={13} />
                        </button>
                        {role.isSystem ? null : (
                          <Confirm
                            title={`Bạn có chắc chắn muốn xoá vai trò "${role.name}"?`}
                            description={
                              role.memberCount > 0
                                ? `Đang có ${role.memberCount} thành viên giữ vai này; hãy đổi vai của họ trước.`
                                : 'Vai trò bị xoá hẳn, không hoàn tác được.'
                            }
                            okText="Xoá"
                            okType="danger"
                            disabled={role.memberCount > 0}
                            onConfirm={() => remove(role)}
                          >
                            <button
                              type="button"
                              className={styles.iconButton}
                              aria-label={`Xoá vai trò ${role.name}`}
                              title={
                                role.memberCount > 0
                                  ? 'Vai trò đang được gán cho thành viên, không xoá được.'
                                  : 'Xoá vai trò'
                              }
                              disabled={role.memberCount > 0}
                            >
                              <Trash2 size={13} />
                            </button>
                          </Confirm>
                        )}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RoleFormDialog
        open={editing !== undefined}
        role={editing ?? undefined}
        onClose={() => setEditing(undefined)}
        onSave={(name, permissions) => save(editing?.key, name, permissions)}
      />

      <RolePermissionsDialog
        role={viewing}
        canEdit={canEdit}
        onClose={() => setViewing(undefined)}
        onSave={async (role, permissions) => save(role.key, role.name, permissions)}
      />
    </div>
  );
}

/** Thêm hoặc sửa vai: tên và các ô tích quyền. */
function RoleFormDialog({
  open,
  role,
  onClose,
  onSave,
}: {
  readonly open: boolean;
  readonly role?: ProjectRoleDefinition;
  readonly onClose: () => void;
  readonly onSave: (name: string, permissions: ProjectPermission[]) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState<ReadonlySet<ProjectPermission>>(new Set());
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setPermissions(new Set(role?.permissions ?? ['project.view_related']));
    setError(undefined);
    setSubmitting(false);
  }, [open, role]);

  const locked = role?.locked ?? false;

  const submit = async () => {
    if (!name.trim()) {
      setError('Nhập tên vai trò.');
      return;
    }
    setSubmitting(true);
    try {
      await onSave(
        name.trim(),
        PROJECT_PERMISSIONS.filter((permission) => permissions.has(permission)),
      );
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được vai trò.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={role ? `Sửa vai trò "${role.name}"` : 'Thêm vai trò'}
      submitLabel="Lưu"
      submitting={submitting}
      submitDisabled={!name.trim()}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tên vai trò" required>
        <input
          value={name}
          maxLength={80}
          placeholder="Ví dụ: Giám sát kỹ thuật"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <fieldset className={styles.permissionGrid} disabled={locked}>
        <legend className={styles.fieldLabel}>Quyền trong dự án</legend>
        {locked ? (
          <p className={styles.muted}>
            <Lock size={12} /> Chủ nhiệm luôn giữ đủ mọi quyền.
          </p>
        ) : null}
        {PROJECT_PERMISSIONS.map((permission) => (
          <label key={permission} className={styles.permissionOption}>
            <input
              type="checkbox"
              checked={locked || permissions.has(permission)}
              onChange={() =>
                setPermissions((current) => {
                  const next = new Set(current);
                  if (next.has(permission)) next.delete(permission);
                  else next.add(permission);
                  return next;
                })
              }
            />
            {PROJECT_PERMISSION_LABELS[permission]}
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}

/**
 * Bấm "N quyền": liệt kê quyền hiện có của vai, gỡ hoặc thêm quyền mới rồi
 * lưu. Người không có quyền sửa chỉ xem.
 */
function RolePermissionsDialog({
  role,
  canEdit,
  onClose,
  onSave,
}: {
  readonly role?: ProjectRoleDefinition;
  readonly canEdit: boolean;
  readonly onClose: () => void;
  readonly onSave: (role: ProjectRoleDefinition, permissions: ProjectPermission[]) => Promise<void>;
}) {
  const [permissions, setPermissions] = useState<ProjectPermission[]>([]);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!role) return;
    setPermissions([...role.permissions]);
    setAdding('');
    setError(undefined);
    setSubmitting(false);
  }, [role]);

  const editable = canEdit && !role?.locked;
  const missing = PROJECT_PERMISSIONS.filter((permission) => !permissions.includes(permission));
  const changed =
    role !== undefined &&
    (permissions.length !== role.permissions.length ||
      permissions.some((permission) => !role.permissions.includes(permission)));

  const add = () => {
    if (!adding) return;
    setPermissions((current) =>
      PROJECT_PERMISSIONS.filter(
        (permission) => current.includes(permission) || permission === adding,
      ),
    );
    setAdding('');
  };

  const submit = async () => {
    if (!role) return;
    if (!editable || !changed) {
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      await onSave(role, permissions);
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được quyền của vai trò.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={role !== undefined}
      title={role ? `Quyền của "${role.name}"` : 'Quyền'}
      subtitle={`${permissions.length} quyền`}
      submitLabel={editable ? 'Lưu' : 'Đóng'}
      cancelLabel={editable ? 'Huỷ' : null}
      submitting={submitting}
      submitDisabled={editable && !changed}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {permissions.length === 0 ? (
        <p className={styles.muted}>Vai trò này chưa có quyền nào.</p>
      ) : (
        <ul className={styles.memberList}>
          {permissions.map((permission) => (
            <li key={permission}>
              <span className={styles.memberName}>{PROJECT_PERMISSION_LABELS[permission]}</span>
              {editable ? (
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`Gỡ quyền ${PROJECT_PERMISSION_LABELS[permission]}`}
                  title="Gỡ quyền"
                  onClick={() =>
                    setPermissions((current) => current.filter((entry) => entry !== permission))
                  }
                >
                  <X size={13} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {role?.locked ? (
        <p className={styles.muted}>
          <Lock size={12} /> Chủ nhiệm luôn giữ đủ mọi quyền.
        </p>
      ) : editable && missing.length > 0 ? (
        <div className={styles.permissionAdd}>
          <span className={styles.fieldLabel}>Thêm quyền</span>
          <div className={styles.permissionAddRow}>
            <Choice
              label="Quyền cần thêm"
              value={adding}
              placeholder="Chọn quyền…"
              options={missing.map((permission) => ({
                value: permission,
                label: PROJECT_PERMISSION_LABELS[permission],
              }))}
              onChange={setAdding}
            />
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={!adding}
              onClick={add}
            >
              <Plus size={14} /> Thêm
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
