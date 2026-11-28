'use client';

import {
  abbreviate,
  DISPATCH_MODES,
  DISPATCH_MODE_LABELS,
  MAX_CLERKS,
  MAX_DELEGATIONS,
  type CorrespondenceDirectory,
  type Delegation,
  type CorrespondenceSettings,
  type DispatchMode,
} from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect, toast, useBeforeUnloadGuard } from '@enterprise-platform/shared-ui';
import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage, saveSettings } from '../correspondence-api';
import { localToday } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { Field, SelectField } from './form-dialog';

/**
 * Cấu hình sổ văn thư: người làm văn thư, ủy quyền duyệt, ký hiệu số đến, số đi, tiền tố số hồ
 * sơ, hạn xử lý mặc định, cách giao phòng ban.
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
    (form.orgCode ?? '') !== (settings.orgCode ?? '') ||
    JSON.stringify(form.unitCodes ?? []) !== JSON.stringify(settings.unitCodes ?? []) ||
    form.dispatchMode !== settings.dispatchMode ||
    form.clerkUserIds.join() !== settings.clerkUserIds.join() ||
    JSON.stringify(form.delegations ?? []) !== JSON.stringify(settings.delegations ?? []);
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
        delegations: form.delegations ?? [],
        orgCode: (form.orgCode ?? '').trim(),
        unitCodes: (form.unitCodes ?? []).filter((item) => item.unitId && item.code.trim()).map((item) => ({ ...item, code: item.code.trim() })),
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
      <p className={styles.sectionNote}>Đổi ký hiệu chỉ áp dụng cho số cấp sau khi lưu.</p>
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
          <span className={styles.hint}>Bỏ trống là mọi người có quyền văn thư.</span>
        </SelectField>
        <Field label="Ký hiệu cơ quan">
          <input value={form.orgCode ?? ''} maxLength={20} placeholder="Ví dụ: SVN" onChange={(event) => set('orgCode', event.target.value)} />
          <span className={styles.hint}>Phần {'{coquan}'} trong mẫu số, ví dụ 05/QĐ-{form.orgCode || 'SVN'}.</span>
        </Field>
        <UnitCodesField
          codes={form.unitCodes ?? []}
          units={directory?.units ?? []}
          onChange={(unitCodes) => set('unitCodes', unitCodes)}
        />
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
        <DelegationsField
          delegations={form.delegations ?? []}
          people={people}
          nameOf={nameOf}
          onChange={(delegations) => set('delegations', delegations)}
        />
        <SelectField label="Khi văn thư giao công văn đến cho phòng ban">
          <SearchableSelect
            options={DISPATCH_MODES.map((value) => ({ value, label: DISPATCH_MODE_LABELS[value] }))}
            value={form.dispatchMode}
            searchInDropdown
            hideDropdownSearch
            onChange={(value) => set('dispatchMode', value as DispatchMode)}
          />
          <span className={styles.hint}>Phải chọn người xử lý: văn thư chọn sẵn một người cho mỗi phòng.</span>
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

/** Ký hiệu đơn vị ({donvi} trong mẫu số): đơn vị chưa đặt thì lấy chữ cái đầu của tên. */
function UnitCodesField({
  codes,
  units,
  onChange,
}: {
  readonly codes: readonly { readonly unitId: string; readonly code: string }[];
  readonly units: readonly { readonly id: string; readonly name: string }[];
  readonly onChange: (codes: { unitId: string; code: string }[]) => void;
}) {
  const update = (index: number, patch: Partial<{ unitId: string; code: string }>) =>
    onChange(codes.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  return (
    <div className={styles.field} role="group" aria-label="Ký hiệu đơn vị">
      <span className={styles.fieldLabel}>Ký hiệu đơn vị</span>
      <span className={styles.hint}>Phần {'{donvi}'} trong mẫu số; chưa đặt thì lấy chữ cái đầu của tên.</span>
      {codes.map((item, index) => (
        <div key={index} className={styles.unitCodeRow}>
          <SearchableSelect
            options={units
              .filter((unit) => unit.id === item.unitId || !codes.some((other) => other.unitId === unit.id))
              .map((unit) => ({ value: unit.id, label: unit.name }))}
            value={item.unitId}
            placeholder="Chọn đơn vị"
            onChange={(value) => update(index, { unitId: value ?? '' })}
          />
          <input
            aria-label={`Ký hiệu đơn vị ${index + 1}`}
            value={item.code}
            maxLength={20}
            placeholder={abbreviate(units.find((unit) => unit.id === item.unitId)?.name ?? '', true) || 'KD'}
            onChange={(event) => update(index, { code: event.target.value })}
          />
          <button type="button" className={styles.iconButton} aria-label={`Bỏ ký hiệu đơn vị ${index + 1}`} onClick={() => onChange(codes.filter((_, at) => at !== index))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <div>
        <button type="button" className={styles.buttonGhost} onClick={() => onChange([...codes, { unitId: '', code: '' }])}>
          <Plus size={14} /> Thêm ký hiệu đơn vị
        </button>
      </div>
    </div>
  );
}

/**
 * Ủy quyền duyệt: trong khoảng ngày, người được ủy quyền (thường là cấp phó) làm được các bước
 * duyệt, bút phê giao cho người ủy quyền; lịch sử ghi rõ duyệt thay ai.
 */
function DelegationsField({
  delegations,
  people,
  nameOf,
  onChange,
}: {
  readonly delegations: readonly Delegation[];
  readonly people: readonly { readonly userId: string; readonly name: string }[];
  readonly nameOf: ReadonlyMap<string, string>;
  readonly onChange: (delegations: Delegation[]) => void;
}) {
  const options = people.map((person) => ({ value: person.userId, label: person.name }));
  const update = (index: number, patch: Partial<Delegation>) =>
    onChange(delegations.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const today = localToday();
  return (
    <div className={styles.field} role="group" aria-label="Ủy quyền duyệt">
      <span className={styles.fieldLabel}>Ủy quyền duyệt</span>
      {delegations.map((item, index) => {
        const active = item.fromDate <= today && today <= item.toDate;
        return (
          <div key={index} className={styles.delegationRow}>
            <SearchableSelect
              options={options}
              value={item.fromUserId}
              placeholder="Người ủy quyền"
              onChange={(value) => update(index, { fromUserId: value ?? '' })}
            />
            <SearchableSelect
              options={options.filter((option) => option.value !== item.fromUserId)}
              value={item.toUserId}
              placeholder="Người được ủy quyền"
              onChange={(value) => update(index, { toUserId: value ?? '' })}
            />
            <input type="date" aria-label={`Từ ngày ${index + 1}`} value={item.fromDate} onChange={(event) => update(index, { fromDate: event.target.value })} />
            <input
              type="date"
              aria-label={`Đến ngày ${index + 1}`}
              value={item.toDate}
              min={item.fromDate}
              onChange={(event) => update(index, { toDate: event.target.value })}
            />
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`Bỏ ủy quyền ${index + 1}`}
              onClick={() => onChange(delegations.filter((_, at) => at !== index))}
            >
              <X size={14} />
            </button>
            <span className={styles.hint}>
              {item.fromUserId && item.toUserId
                ? `${nameOf.get(item.toUserId) ?? 'Người được ủy quyền'} duyệt thay ${nameOf.get(item.fromUserId) ?? 'người ủy quyền'}${active ? ' · đang hiệu lực' : ''}`
                : 'Chọn người ủy quyền và người được ủy quyền'}
            </span>
          </div>
        );
      })}
      <div>
        <button
          type="button"
          className={styles.buttonGhost}
          disabled={delegations.length >= MAX_DELEGATIONS}
          onClick={() => onChange([...delegations, { fromUserId: '', toUserId: '', fromDate: today, toDate: today }])}
        >
          <Plus size={14} /> Thêm ủy quyền
        </button>
      </div>
    </div>
  );
}
