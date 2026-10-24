'use client';

import {
  DEFAULT_WORK_ITEM_PRIORITY,
  type WorkspaceLabelOption,
  type WorkspaceLabelSettingsView,
} from '@enterprise-platform/contracts-workspace';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as api from '../workspace-api';
import { applyLabelSettings, toneOfColor } from '../workspace-labels';
import styles from '../workspace.module.scss';

/** Màu chọn nhanh cho trạng thái và mức ưu tiên; gồm cả các màu mặc định. */
const LABEL_COLORS = [
  '#4b5563',
  '#6b7280',
  '#1d4ed8',
  '#0d9488',
  '#047857',
  '#16a34a',
  '#d97706',
  '#92400e',
  '#9a3412',
  '#b91c1c',
  '#991b1b',
  '#7c3aed',
  '#db2777',
];

type Draft = Omit<WorkspaceLabelOption, 'key'> & { readonly key?: string };

interface Drafts {
  readonly workItemStatuses: readonly Draft[];
  readonly projectStatuses: readonly Draft[];
  readonly priorities: readonly Draft[];
}

/**
 * Cài đặt "Trạng thái và ưu tiên": tên, màu, thứ tự của trạng thái công việc, trạng thái dự án và mức ưu tiên.
 * Trạng thái gắn với quy trình duyệt và báo cáo nên chỉ đổi tên, màu, thứ tự; mức ưu tiên thêm và xoá được.
 */
export function LabelSettings() {
  const [settings, setSettings] = useState<WorkspaceLabelSettingsView>();
  const [drafts, setDrafts] = useState<Drafts>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .loadLabelSettings()
      .then((loaded) => {
        // Áp luôn bản mới nhất: có thể người khác vừa đổi sau lần trang nạp cài đặt.
        applyLabelSettings(loaded);
        setSettings(loaded);
        setDrafts(loaded);
      })
      .catch((cause: { message?: string }) =>
        setError(cause?.message ?? 'Không tải được cài đặt trạng thái và ưu tiên.'),
      );
  }, []);

  if (!settings || !drafts) {
    return error ? (
      <p role="alert" className={styles.alert}>
        {error}
      </p>
    ) : (
      <p className={styles.muted}>Đang tải cài đặt…</p>
    );
  }

  const canEdit = settings.canEdit;
  const changed =
    JSON.stringify(drafts) !==
    JSON.stringify({
      workItemStatuses: settings.workItemStatuses,
      projectStatuses: settings.projectStatuses,
      priorities: settings.priorities,
    });

  const setGroup = (group: keyof Drafts, next: readonly Draft[]) => {
    setDrafts((current) => (current ? { ...current, [group]: next } : current));
    setNotice(undefined);
  };

  const save = async () => {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const saved = await api.saveLabelSettings({
        workItemStatuses: drafts.workItemStatuses as WorkspaceLabelOption[],
        projectStatuses: drafts.projectStatuses as WorkspaceLabelOption[],
        priorities: drafts.priorities,
      });
      applyLabelSettings(saved);
      setSettings(saved);
      setDrafts(saved);
      setNotice('Đã lưu. Các trang khác hiện tên và màu mới khi mở lại.');
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được cài đặt.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.roleSettings}>
      <p className={styles.muted}>
        Trạng thái gắn với quy trình duyệt, đóng việc và báo cáo, nên chỉ đổi được tên, màu và thứ tự hiển
        thị. Mức ưu tiên thêm, xoá được; mức đang có việc dùng và mức mặc định của việc mới thì không xoá
        được.
        {canEdit ? '' : ' Chỉ quản trị viên được sửa.'}
      </p>

      <OptionTable
        title="Trạng thái công việc"
        options={drafts.workItemStatuses}
        canEdit={canEdit}
        onChange={(next) => setGroup('workItemStatuses', next)}
      />
      <OptionTable
        title="Trạng thái dự án"
        options={drafts.projectStatuses}
        canEdit={canEdit}
        onChange={(next) => setGroup('projectStatuses', next)}
      />
      <OptionTable
        title="Mức ưu tiên (từ thấp tới cao)"
        options={drafts.priorities}
        canEdit={canEdit}
        removable
        onChange={(next) => setGroup('priorities', next)}
      />

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}

      {canEdit ? (
        <div>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={saving || !changed}
            onClick={() => void save()}
          >
            {saving ? 'Đang lưu…' : 'Lưu cài đặt'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function OptionTable({
  title,
  options,
  canEdit,
  removable = false,
  onChange,
}: {
  title: string;
  options: readonly Draft[];
  canEdit: boolean;
  /** Thêm và xoá được (mức ưu tiên); trạng thái thì giữ đủ bộ. */
  removable?: boolean;
  onChange: (next: readonly Draft[]) => void;
}) {
  const update = (index: number, patch: Partial<Draft>) =>
    onChange(options.map((option, at) => (at === index ? { ...option, ...patch } : option)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    onChange(next);
  };

  return (
    <section className={styles.tableCard} aria-label={title}>
      <div className={`${styles.roleSettingsHead} ${styles.labelTableHead}`}>
        <strong>{title}</strong>
        {canEdit && removable ? (
          <button
            type="button"
            className={styles.buttonSmall}
            onClick={() => onChange([...options, { label: '', color: LABEL_COLORS[0] as string }])}
          >
            <Plus size={13} /> Thêm mức
          </button>
        ) : null}
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Hiển thị</th>
            <th>Tên</th>
            <th>Màu</th>
            <th aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>
          {options.map((option, index) => {
            const tone = toneOfColor(option.color);
            return (
              <tr key={option.key ?? `new-${index}`}>
                <td>
                  <span className={styles.pill} style={{ background: tone.bg, color: tone.fg }}>
                    {option.label || 'Chưa đặt tên'}
                  </span>
                </td>
                <td>
                  <input
                    value={option.label}
                    maxLength={40}
                    disabled={!canEdit}
                    aria-label={`Tên ${title.toLowerCase()} ${index + 1}`}
                    onChange={(event) => update(index, { label: event.target.value })}
                  />
                </td>
                <td>
                  <div className={styles.tagColorPicker} role="radiogroup" aria-label="Màu">
                    {LABEL_COLORS.map((swatch) => (
                      <button
                        key={swatch}
                        type="button"
                        role="radio"
                        disabled={!canEdit}
                        aria-checked={option.color.toLowerCase() === swatch}
                        aria-label={`Màu ${swatch}`}
                        className={
                          option.color.toLowerCase() === swatch ? styles.tagSwatchActive : styles.tagSwatch
                        }
                        style={{ background: swatch }}
                        onClick={() => update(index, { color: swatch })}
                      />
                    ))}
                  </div>
                </td>
                <td>
                  {canEdit ? (
                    <span className={styles.roleActions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label="Lên trên"
                        title="Lên trên"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label="Xuống dưới"
                        title="Xuống dưới"
                        disabled={index === options.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                      {removable && option.key !== DEFAULT_WORK_ITEM_PRIORITY ? (
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`Xoá ${option.label}`}
                          title="Xoá mức này"
                          onClick={() => onChange(options.filter((_, at) => at !== index))}
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
