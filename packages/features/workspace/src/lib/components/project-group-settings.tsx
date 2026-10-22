'use client';

import type { ProjectGroup, ProjectGroupList } from '@enterprise-platform/contracts-workspace';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { Dialog, Field } from './dialog';
import { Confirm } from './confirm-box';
import { upperCaseKeepingCaret } from './upper-case-input';

/**
 * Cài đặt "Nhóm dự án": danh mục nhóm dùng chung cho mọi dự án, để chọn khi tạo
 * dự án, lọc và gom nhóm trên trang Dự án. Đổi tên nhóm thì mọi dự án của nhóm
 * đổi theo; xoá nhóm thì dự án của nhóm về "Chưa phân loại".
 */
export function ProjectGroupSettings() {
  const [list, setList] = useState<ProjectGroupList>();
  const [error, setError] = useState<string>();
  /** Hộp thêm / đổi tên: `null` là thêm mới. */
  const [editing, setEditing] = useState<ProjectGroup | null>();

  useEffect(() => {
    api
      .listProjectGroups()
      .then(setList)
      .catch((cause: { message?: string }) =>
        setError(cause?.message ?? 'Không tải được danh sách nhóm dự án.'),
      );
  }, []);

  const apply = (next: ProjectGroupList) => {
    setList(next);
    setError(undefined);
  };

  const save = async (id: string | undefined, name: string, code: string) => {
    apply(
      id
        ? await api.renameProjectGroup(id, { name, code })
        : await api.createProjectGroup({ name, code }),
    );
  };

  const remove = async (group: ProjectGroup) => {
    try {
      apply(await api.deleteProjectGroup(group.id));
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không xoá được nhóm dự án.');
    }
  };

  const canEdit = list?.canEdit ?? false;

  return (
    <div className={styles.roleSettings}>
      <div className={styles.roleSettingsHead}>
        <p className={styles.muted}>
          {canEdit
            ? 'Chọn nhóm cho dự án khi tạo, hoặc dùng "Chuyển nhóm" trên trang Dự án.'
            : 'Chỉ quản trị viên được thêm hoặc sửa nhóm dự án.'}
        </p>
        {canEdit ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setEditing(null)}>
            <Plus size={15} /> Thêm nhóm
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {!list ? (
        error ? null : <p className={styles.muted}>Đang tải nhóm dự án…</p>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nhóm dự án</th>
                <th>Mã viết tắt</th>
                <th>Số dự án</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {list.items.map((group) => (
                <tr key={group.id}>
                  <td>
                    <b>{group.name}</b>
                  </td>
                  <td className={styles.treeCode}>
                    {group.code ?? <span className={styles.muted}>Chưa đặt</span>}
                  </td>
                  <td className={styles.muted}>{group.projectCount} dự án</td>
                  <td>
                    {canEdit ? (
                      <span className={styles.roleActions}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`Sửa nhóm ${group.name}`}
                          title="Sửa nhóm"
                          onClick={() => setEditing(group)}
                        >
                          <Pencil size={13} />
                        </button>
                        <Confirm
                          title={`Bạn có chắc chắn muốn xoá nhóm "${group.name}"?`}
                          description={
                            group.projectCount > 0
                              ? `${group.projectCount} dự án của nhóm sẽ về "Chưa phân loại".`
                              : 'Nhóm bị xoá hẳn, không hoàn tác được.'
                          }
                          okText="Xoá"
                          okType="danger"
                          onConfirm={() => remove(group)}
                        >
                          <button
                            type="button"
                            className={styles.iconButton}
                            aria-label={`Xoá nhóm ${group.name}`}
                            title="Xoá nhóm"
                          >
                            <Trash2 size={13} />
                          </button>
                        </Confirm>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.items.length === 0 ? (
            <p className={styles.emptyRow}>Chưa có nhóm dự án nào.</p>
          ) : null}
        </div>
      )}

      <GroupFormDialog
        open={editing !== undefined}
        group={editing ?? undefined}
        onClose={() => setEditing(undefined)}
        onSave={(name, code) => save(editing?.id, name, code)}
      />
    </div>
  );
}

/** Thêm nhóm mới hoặc sửa tên, mã viết tắt của nhóm. */
function GroupFormDialog({
  open,
  group,
  onClose,
  onSave,
}: {
  readonly open: boolean;
  readonly group?: ProjectGroup;
  readonly onClose: () => void;
  readonly onSave: (name: string, code: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setCode(group?.code ?? '');
    setError(undefined);
    setSubmitting(false);
  }, [open, group]);

  const submit = async () => {
    if (!name.trim()) {
      setError('Nhập tên nhóm dự án.');
      return;
    }
    setSubmitting(true);
    try {
      await onSave(name.trim(), code.trim());
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được nhóm dự án.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={group ? `Sửa nhóm "${group.name}"` : 'Thêm nhóm dự án'}
      subtitle={
        group && group.projectCount > 0
          ? `${group.projectCount} dự án của nhóm sẽ mang tên mới.`
          : undefined
      }
      submitLabel="Lưu"
      submitting={submitting}
      submitDisabled={!name.trim()}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tên nhóm" required>
        <input
          value={name}
          maxLength={80}
          placeholder="Ví dụ: Dịch vụ thí nghiệm"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field
        label="Mã viết tắt"
        hint="Dùng cho {NHOM} trong quy tắc mã dự án (Cài đặt > Mã dự án). Chữ in hoa không dấu và số, vd DVTN. Đổi mã không đổi mã các dự án đã tạo."
      >
        <input
          value={code}
          maxLength={16}
          placeholder="Ví dụ: DVTN"
          onChange={(event) => setCode(upperCaseKeepingCaret(event))}
        />
      </Field>
    </Dialog>
  );
}
