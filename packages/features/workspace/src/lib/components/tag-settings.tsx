'use client';

import type { Tag } from '@enterprise-platform/contracts-workspace';
import { Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { Dialog, Field } from './dialog';
import { tagColor, useTags } from './use-tags';
import { Confirm } from './confirm-box';

/** Màu chọn nhanh cho nhãn; rỗng là để hệ thống tự chọn theo tên. */
const TAG_COLORS = ['#2563eb', '#0d9488', '#7c3aed', '#db2777', '#d97706', '#16a34a', '#dc2626', '#475569'];

/**
 * Cài đặt "Nhãn": danh mục nhãn dùng chung cho công việc và dự án. Ai ghi được công việc cũng tạo được nhãn
 * khi gắn; đổi tên, đổi màu, ẩn hay xoá ảnh hưởng cả tenant nên chỉ quản trị viên làm được.
 */
export function TagSettings() {
  const tags = useTags();
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string>();
  /** Hộp thêm / sửa: `null` là thêm mới. */
  const [editing, setEditing] = useState<Tag | null>();

  useEffect(() => {
    api
      .loadWorkspaceStatus()
      .then((status) => setCanEdit(Boolean(status.capabilities?.isTenantAdmin)))
      .catch(() => setCanEdit(false));
  }, []);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    try {
      await action();
      setError(undefined);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? fallback);
    }
  };

  const sorted = [...tags.tags].sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  return (
    <div className={styles.roleSettings}>
      <div className={styles.roleSettingsHead}>
        <p className={styles.muted}>
          {canEdit
            ? 'Nhãn đã ẩn vẫn giữ trên nơi đã gắn nhưng không chọn thêm được.'
            : 'Chỉ quản trị viên được sửa, ẩn hoặc xoá nhãn.'}
        </p>
        {canEdit ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setEditing(null)}>
            <Plus size={15} /> Thêm nhãn
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {!tags.loaded ? (
        <p className={styles.muted}>Đang tải nhãn…</p>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nhãn</th>
                <th>Trạng thái</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((tag) => (
                <tr key={tag.id}>
                  <td>
                    <span className={styles.wbsTag} style={{ color: tagColor(tag) }}>
                      {tag.name}
                    </span>
                  </td>
                  <td className={styles.muted}>{tag.isActive ? 'Đang dùng' : 'Đã ẩn'}</td>
                  <td>
                    {canEdit ? (
                      <span className={styles.roleActions}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`Sửa nhãn ${tag.name}`}
                          title="Sửa nhãn"
                          onClick={() => setEditing(tag)}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={tag.isActive ? `Ẩn nhãn ${tag.name}` : `Dùng lại nhãn ${tag.name}`}
                          title={tag.isActive ? 'Ẩn nhãn' : 'Dùng lại nhãn'}
                          onClick={() =>
                            void run(
                              () => tags.update(tag.id, { isActive: !tag.isActive }),
                              'Không đổi được trạng thái nhãn.',
                            )
                          }
                        >
                          {tag.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        <Confirm
                          title={`Bạn có chắc chắn muốn xoá nhãn "${tag.name}"?`}
                          description="Nhãn bị gỡ khỏi mọi công việc và dự án đang gắn, không hoàn tác được."
                          okText="Xoá"
                          okType="danger"
                          onConfirm={() => run(() => tags.remove(tag.id), 'Không xoá được nhãn.')}
                        >
                          <button
                            type="button"
                            className={styles.iconButton}
                            aria-label={`Xoá nhãn ${tag.name}`}
                            title="Xoá nhãn"
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
          {sorted.length === 0 ? <p className={styles.emptyRow}>Chưa có nhãn nào.</p> : null}
        </div>
      )}

      <TagFormDialog
        open={editing !== undefined}
        tag={editing ?? undefined}
        onClose={() => setEditing(undefined)}
        onSave={async (name, color) => {
          if (editing) {
            await tags.update(editing.id, { name, color: color || null });
          } else {
            const created = await tags.create(name);
            if (color) await tags.update(created.id, { color });
          }
          setError(undefined);
        }}
      />
    </div>
  );
}

/** Thêm nhãn mới hoặc sửa tên, màu của nhãn. */
function TagFormDialog({
  open,
  tag,
  onClose,
  onSave,
}: {
  readonly open: boolean;
  readonly tag?: Tag;
  readonly onClose: () => void;
  readonly onSave: (name: string, color: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(tag?.name ?? '');
    setColor(tag?.color ?? '');
    setError(undefined);
    setSubmitting(false);
  }, [open, tag]);

  const submit = async () => {
    if (!name.trim()) {
      setError('Nhập tên nhãn.');
      return;
    }
    setSubmitting(true);
    try {
      await onSave(name.trim(), color);
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được nhãn.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={tag ? `Sửa nhãn "${tag.name}"` : 'Thêm nhãn'}
      subtitle="Tên nhãn được lưu bằng chữ thường để không trùng kiểu hoa thường."
      submitLabel="Lưu"
      submitting={submitting}
      submitDisabled={!name.trim()}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tên nhãn" required>
        <input
          value={name}
          maxLength={40}
          placeholder="Ví dụ: khẩn"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label="Màu">
        <div className={styles.tagColorPicker} role="radiogroup" aria-label="Màu nhãn">
          <button
            type="button"
            role="radio"
            aria-checked={!color}
            className={!color ? styles.tagColorAutoActive : styles.tagColorAuto}
            onClick={() => setColor('')}
          >
            Tự động
          </button>
          {TAG_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={color === swatch}
              aria-label={`Màu ${swatch}`}
              className={color === swatch ? styles.tagSwatchActive : styles.tagSwatch}
              style={{ background: swatch }}
              onClick={() => setColor(swatch)}
            />
          ))}
        </div>
      </Field>
    </Dialog>
  );
}
