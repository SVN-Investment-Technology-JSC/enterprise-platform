'use client';

import {
  DISPATCH_MODES,
  DISPATCH_MODE_LABELS,
  MAX_CLERKS,
  type CorrespondenceDirectory,
  type CorrespondenceSettings,
  type DispatchMode,
} from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect, toast, useBeforeUnloadGuard } from '@enterprise-platform/shared-ui';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage, saveSettings } from '../correspondence-api';
import styles from '../correspondence.module.scss';
import { Field, SelectField } from './form-dialog';

/**
 * Cấu hình sổ văn thư: người làm văn thư, ký hiệu số đến, số đi, tiền tố số hồ sơ, hạn xử lý
 * mặc định, cách giao phòng ban.
 */
export function SettingsView({
  settings,
  directory,
  onSaved,
}: {
  readonly settings: CorrespondenceSettings;
  readonly directory?: CorrespondenceDirectory;
  readonly onSaved: (next: CorrespondenceSettings) => void;
}) {
  const [form, setForm] = useState({ ...settings, defaultDueDays: String(settings.defaultDueDays) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => setForm({ ...settings, defaultDueDays: String(settings.defaultDueDays) }), [settings]);

  const dirty =
    form.incomingSuffix !== settings.incomingSuffix ||
    form.outgoingSuffix !== settings.outgoingSuffix ||
    form.archivePrefix !== settings.archivePrefix ||
    form.defaultDueDays !== String(settings.defaultDueDays) ||
    form.dispatchMode !== settings.dispatchMode ||
    form.clerkUserIds.join() !== settings.clerkUserIds.join();
  useBeforeUnloadGuard(dirty);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const year = new Date().getFullYear();
  const people = directory?.people ?? [];
  const nameOf = new Map(people.map((person) => [person.userId, person.name]));

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await saveSettings({
        incomingSuffix: form.incomingSuffix,
        outgoingSuffix: form.outgoingSuffix,
        archivePrefix: form.archivePrefix,
        defaultDueDays: Number(form.defaultDueDays),
        dispatchMode: form.dispatchMode,
        clerkUserIds: form.clerkUserIds,
      });
      onSaved(next);
      toast.success('Đã lưu cấu hình sổ văn thư.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được cấu hình.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${styles.card} ${styles.settings}`}>
      <h2>Cấu hình sổ văn thư</h2>
      <p className={styles.muted} style={{ margin: '0 0 8px', fontSize: 13 }}>
        Số thứ tự đếm lại từ 1 mỗi năm. Đổi ký hiệu chỉ áp dụng cho số cấp sau khi lưu.
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <SelectField label="Người làm văn thư">
          <SearchableSelect
            options={people.filter((person) => !form.clerkUserIds.includes(person.userId)).map((person) => ({ value: person.userId, label: person.name }))}
            value=""
            placeholder={form.clerkUserIds.length >= MAX_CLERKS ? `Đã đủ ${MAX_CLERKS} người` : 'Tìm và thêm người làm văn thư'}
            disabled={form.clerkUserIds.length >= MAX_CLERKS}
            emptyText="Không còn người nào để thêm."
            onChange={(value) => value && set('clerkUserIds', [...form.clerkUserIds, value])}
          />
          {form.clerkUserIds.length > 0 ? (
            <div className={styles.unitChips}>
              {form.clerkUserIds.map((userId) => (
                <span key={userId} className={styles.unitChip}>
                  {nameOf.get(userId) ?? 'Người dùng không còn hoạt động'}
                  <button type="button" aria-label="Bỏ" onClick={() => set('clerkUserIds', form.clerkUserIds.filter((item) => item !== userId))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <span className={styles.hint}>
            Người được chọn làm việc của văn thư (tiếp nhận, kiểm tra, ban hành, lưu trữ), nhận thông báo việc của văn thư và hiện tên
            ở các bước của văn thư. Bỏ trống là mọi người có quyền văn thư trong Phân quyền.
          </span>
        </SelectField>
        <div className={styles.formRow}>
          <Field label="Ký hiệu số đến" required>
            <input value={form.incomingSuffix} maxLength={30} onChange={(event) => set('incomingSuffix', event.target.value)} />
            <span className={styles.hint}>Ví dụ: 41/{form.incomingSuffix || 'CVĐ'}</span>
          </Field>
          <Field label="Ký hiệu số đi" required>
            <input value={form.outgoingSuffix} maxLength={30} onChange={(event) => set('outgoingSuffix', event.target.value)} />
            <span className={styles.hint}>Ví dụ: 198/{form.outgoingSuffix || 'CV'}</span>
          </Field>
        </div>
        <div className={styles.formRow}>
          <Field label="Tiền tố số hồ sơ lưu trữ" required>
            <input value={form.archivePrefix} maxLength={20} onChange={(event) => set('archivePrefix', event.target.value)} />
            <span className={styles.hint}>
              Ví dụ: {form.archivePrefix || 'HS'}-{year}-0001
            </span>
          </Field>
          <Field label="Hạn xử lý mặc định (ngày)">
            <input
              type="number"
              min={0}
              max={365}
              value={form.defaultDueDays}
              onChange={(event) => set('defaultDueDays', event.target.value)}
            />
            <span className={styles.hint}>0 là không tự đặt hạn khi tiếp nhận.</span>
          </Field>
        </div>
        <SelectField label="Khi văn thư giao công văn đến cho phòng ban">
          <SearchableSelect
            options={DISPATCH_MODES.map((value) => ({ value, label: DISPATCH_MODE_LABELS[value] }))}
            value={form.dispatchMode}
            searchInDropdown
            hideDropdownSearch
            onChange={(value) => set('dispatchMode', value as DispatchMode)}
          />
          <span className={styles.hint}>
            Cả phòng cùng nhận: mọi nhân sự của phòng được báo, trưởng phòng phân công người xử lý sau nếu cần. Phải chọn người xử
            lý: văn thư chọn sẵn một người cho mỗi phòng.
          </span>
        </SelectField>
        {error ? (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        ) : null}
        <div className={styles.formActions}>
          <button type="submit" className={styles.buttonPrimary} disabled={busy || !dirty}>
            {busy ? 'Đang lưu…' : 'Lưu cấu hình'}
          </button>
        </div>
      </form>
    </section>
  );
}
