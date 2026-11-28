'use client';

import type { Tag } from '@enterprise-platform/contracts-workspace';
import { Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { ErrorToast } from './error-toast';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tooltip } from './tooltip';
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
        {canEdit ? <span /> : <p className={styles.muted}>Chỉ quản trị viên được sửa, ẩn hoặc xoá nhãn.</p>}
        {canEdit ? (
          <Button type="button" onClick={() => setEditing(null)}>
            <Plus aria-hidden /> Thêm nhãn
          </Button>
        ) : null}
      </div>

      <ErrorToast message={error} />

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
                        <Tooltip content="Sửa nhãn">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={`Sửa nhãn ${tag.name}`}
                            onClick={() => setEditing(tag)}
                          >
                            <Pencil aria-hidden />
                          </Button>
                        </Tooltip>
                        <Tooltip content={tag.isActive ? 'Ẩn nhãn' : 'Dùng lại nhãn'}>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={tag.isActive ? `Ẩn nhãn ${tag.name}` : `Dùng lại nhãn ${tag.name}`}
                            onClick={() =>
                              void run(
                                () => tags.update(tag.id, { isActive: !tag.isActive }),
                                'Không đổi được trạng thái nhãn.',
                              )
                            }
                          >
                            {tag.isActive ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                          </Button>
                        </Tooltip>
                        <Tooltip content="Xoá nhãn">
                          <span className={styles.tooltipAnchor}>
                            <Confirm
                              title={`Bạn có chắc chắn muốn xoá nhãn "${tag.name}"?`}
                              description="Nhãn bị gỡ khỏi mọi công việc và dự án đang gắn, không hoàn tác được."
                              okText="Xoá"
                              okType="danger"
                              onConfirm={() => run(() => tags.remove(tag.id), 'Không xoá được nhãn.')}
                            >
                              <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                className="hover:bg-destructive/10 hover:text-destructive"
                                aria-label={`Xoá nhãn ${tag.name}`}
                              >
                                <Trash2 aria-hidden />
                              </Button>
                            </Confirm>
                          </span>
                        </Tooltip>
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
      submitLabel="Lưu"
      submitting={submitting}
      submitDisabled={!name.trim()}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tên nhãn" required>
        <Input
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
