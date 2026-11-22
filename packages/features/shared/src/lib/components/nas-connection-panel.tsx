'use client';

import {
  SHARED_NAS_PROVIDER_LABELS,
  type SharedDirectoryPerson,
  type SharedNasAccount,
  type SharedNasConnectionSettings,
  type SharedNasProvider,
  type SharedNasShareConfig,
} from '@enterprise-platform/contracts-shared';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as api from '../shared-api';
import styles from '../shared.module.scss';
import { Field, SelectField } from './dialog';

interface Draft {
  enabled: boolean;
  label: string;
  provider: SharedNasProvider;
  baseUrl: string;
  username: string;
  password: string;
  syncMinutes: string;
  shares: SharedNasShareConfig[];
}

const PROVIDER_OPTIONS = Object.entries(SHARED_NAS_PROVIDER_LABELS).map(([value, label]) => ({ value, label }));

function draftOf(settings: SharedNasConnectionSettings): Draft {
  return {
    enabled: settings.enabled,
    label: settings.label,
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    username: settings.username,
    password: '',
    syncMinutes: String(settings.syncMinutes),
    shares: [...settings.shares],
  };
}

function Card({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <section className={`${styles.panel} ${styles.storageCard}`} aria-label={label}>
      {children}
    </section>
  );
}

/**
 * Kết nối NAS: địa chỉ DSM, tài khoản kết nối, thư mục chia sẻ hiện trong Kho NAS, chu kỳ
 * đồng bộ người dùng, nhóm, quyền. Quản trị kho xem, quản trị tenant sửa; mật khẩu không hiện lại.
 */
export function NasConnectionPanel() {
  const [settings, setSettings] = useState<SharedNasConnectionSettings>();
  const [draft, setDraft] = useState<Draft>();
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState<'test' | 'save' | 'sync'>();
  const [test, setTest] = useState<{ ok: boolean; message: string }>();
  const [available, setAvailable] = useState<readonly string[]>([]);

  const reload = useCallback(async () => {
    try {
      const next = await api.loadNasSettings();
      setSettings(next);
      setDraft(draftOf(next));
      setLoadError(undefined);
    } catch (cause) {
      setLoadError(api.errorMessage(cause, 'Không tải được kết nối NAS.'));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loadError) return <Card label="Kết nối NAS"><p className={styles.alert}>{loadError}</p></Card>;
  if (!settings || !draft) return <Card label="Kết nối NAS"><p className={styles.muted}>Đang tải…</p></Card>;

  const editable = settings.editable && settings.available;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => (current ? { ...current, [key]: value } : current));
  const shareNames = [...new Set([...draft.shares.map((share) => share.name), ...available])];
  const toggleShare = (name: string, on: boolean) =>
    set('shares', on ? [...draft.shares, { name }] : draft.shares.filter((share) => share.name !== name));
  const setShareLabel = (name: string, label: string) =>
    set('shares', draft.shares.map((share) => (share.name === name ? { name, ...(label ? { label } : {}) } : share)));
  const request = () => ({
    enabled: draft.enabled,
    label: draft.label,
    provider: draft.provider,
    baseUrl: draft.baseUrl,
    username: draft.username,
    password: draft.password || undefined,
    shares: draft.shares,
    syncMinutes: Number(draft.syncMinutes) || 15,
    version: settings.version,
  });

  const runTest = async () => {
    setBusy('test');
    try {
      const result = await api.testNasConnection(request());
      setTest(result);
      if (result.shares) setAvailable(result.shares.map((share) => share.name));
    } catch (cause) {
      setTest({ ok: false, message: api.errorMessage(cause, 'Không thử được kết nối.') });
    } finally {
      setBusy(undefined);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      await api.saveNasSettings(request());
      toast.success('Đã lưu kết nối NAS.');
      setTest(undefined);
      await reload();
    } catch (cause) {
      toast.error(api.errorMessage(cause, 'Không lưu được kết nối NAS.'));
    } finally {
      setBusy(undefined);
    }
  };

  const sync = async () => {
    setBusy('sync');
    try {
      toast.success((await api.syncNas()).message);
    } catch (cause) {
      toast.error(api.errorMessage(cause, 'Đồng bộ với NAS thất bại.'));
    } finally {
      await reload();
      setBusy(undefined);
    }
  };

  return (
    <Card label="Kết nối NAS">
      <div className={styles.sectionTitle}>
        <h3>Kết nối NAS</h3>
        <span className={`${styles.badge} ${!settings.configured ? styles.badgeInfo : settings.enabled ? styles.badgeSuccess : styles.badgeWarn}`}>
          {!settings.configured ? 'Chưa cấu hình' : settings.enabled ? 'Đang bật' : 'Đang tắt'}
        </span>
      </div>
      {!settings.available ? (
        <p className={styles.notice}>Máy chủ chưa bật tính năng này (thiếu SHARED_STORAGE_SECRET_KEY).</p>
      ) : !settings.editable ? (
        <p className={styles.notice}>Chỉ quản trị tenant được sửa.</p>
      ) : null}

      <form
        className={styles.storageForm}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className={styles.checkRow}>
          <input type="checkbox" checked={draft.enabled} disabled={!editable} onChange={(event) => set('enabled', event.target.checked)} />
          Bật Kho NAS
        </label>
        <div className={styles.fieldRow}>
          <Field label="Tên hiển thị">
            <input value={draft.label} maxLength={120} placeholder="NAS văn phòng" disabled={!editable} onChange={(event) => set('label', event.target.value)} />
          </Field>
          <SelectField label="Loại NAS" required>
            <SearchableSelect
              options={PROVIDER_OPTIONS}
              value={draft.provider}
              clearable={false}
              searchInDropdown
              hideDropdownSearch
              disabled={!editable}
              onChange={(value) => set('provider', (value || 'synology') as SharedNasProvider)}
            />
          </SelectField>
        </div>
        <div className={styles.fieldRow}>
          <Field label="Địa chỉ NAS" required>
            <input value={draft.baseUrl} maxLength={500} placeholder="http://100.64.10.20:5000" disabled={!editable} onChange={(event) => set('baseUrl', event.target.value)} />
          </Field>
          <Field label="Tài khoản" required>
            <input value={draft.username} maxLength={255} autoComplete="off" disabled={!editable} onChange={(event) => set('username', event.target.value)} />
          </Field>
          <Field label="Mật khẩu" required={!settings.hasSecret}>
            <input
              type="password"
              value={draft.password}
              maxLength={500}
              autoComplete="new-password"
              placeholder={settings.hasSecret ? 'Đã lưu' : ''}
              disabled={!editable}
              onChange={(event) => set('password', event.target.value)}
            />
          </Field>
          <Field label="Đồng bộ quyền (phút)">
            <input type="number" min={5} max={1440} value={draft.syncMinutes} disabled={!editable} onChange={(event) => set('syncMinutes', event.target.value)} />
          </Field>
        </div>

        <div className={styles.field} role="group" aria-label="Thư mục hiện trong Kho NAS">
          <span className={styles.fieldLabel}>Thư mục hiện trong Kho NAS</span>
          {shareNames.length === 0 ? (
            <span className={styles.muted}>Bấm Thử kết nối để lấy danh sách thư mục.</span>
          ) : (
            shareNames.map((name) => {
              const chosen = draft.shares.find((share) => share.name === name);
              return (
                <div key={name} className={styles.nasShareRow}>
                  <label className={styles.checkRow}>
                    <input type="checkbox" checked={Boolean(chosen)} disabled={!editable} onChange={(event) => toggleShare(name, event.target.checked)} />
                    {name}
                  </label>
                  {chosen ? (
                    <input
                      aria-label={`Tên hiển thị của ${name}`}
                      value={chosen.label ?? ''}
                      maxLength={120}
                      placeholder="Tên hiển thị"
                      disabled={!editable}
                      onChange={(event) => setShareLabel(name, event.target.value)}
                    />
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {test ? (
          <p className={test.ok ? styles.success : styles.alert} role="status">
            {test.message}
          </p>
        ) : null}
        <div className={styles.storageActions}>
          {editable ? (
            <>
              <button type="button" className={styles.buttonGhost} disabled={Boolean(busy)} onClick={() => void runTest()}>
                {busy === 'test' ? 'Đang thử…' : 'Thử kết nối'}
              </button>
              <button type="submit" className={styles.buttonPrimary} disabled={Boolean(busy)}>
                {busy === 'save' ? 'Đang lưu…' : 'Lưu'}
              </button>
            </>
          ) : null}
          {settings.enabled ? (
            <button type="button" className={styles.buttonGhost} disabled={Boolean(busy)} onClick={() => void sync()}>
              {busy === 'sync' ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}
            </button>
          ) : null}
        </div>
        {settings.lastSync ? (
          <p className={settings.lastSync.ok ? styles.muted : styles.alert}>
            Đồng bộ lúc {new Date(settings.lastSync.at).toLocaleString('vi-VN')}
            {settings.lastSync.ok ? ` · ${settings.linkedAccounts}/${settings.accounts} tài khoản đã ghép` : `: ${settings.lastSync.message}`}
          </p>
        ) : null}
      </form>
    </Card>
  );
}

const LINK_LABELS = { auto: 'Tự ghép', manual: 'Ghép tay', none: 'Chưa ghép' } as const;

/** Ghép tài khoản NAS với nhân sự ERP: tự ghép theo thư điện tử, cách đặt tên; còn lại ghép tay. */
export function NasAccountsPanel() {
  const [accounts, setAccounts] = useState<readonly SharedNasAccount[]>();
  const [people, setPeople] = useState<readonly SharedDirectoryPerson[]>([]);
  const [editable, setEditable] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    Promise.all([api.loadNasSettings(), api.loadNasAccounts(), api.loadDirectory().catch(() => undefined)])
      .then(([settings, list, directory]) => {
        setEditable(settings.editable);
        setAccounts(list);
        setPeople(directory?.people ?? []);
      })
      .catch((cause) => setLoadError(api.errorMessage(cause, 'Không tải được tài khoản NAS.')));
  }, []);

  const personOptions = useMemo(
    () =>
      people.map((person) => ({
        value: person.userId,
        label: person.displayName,
        description: [person.email, person.unitNames.join(', ')].filter(Boolean).join(' · ') || undefined,
      })),
    [people],
  );

  if (loadError) return <Card label="Tài khoản NAS"><p className={styles.alert}>{loadError}</p></Card>;
  if (!accounts) return <Card label="Tài khoản NAS"><p className={styles.muted}>Đang tải…</p></Card>;

  const link = async (name: string, erpUserId: string | null) => {
    try {
      setAccounts(await api.linkNasAccount(name, erpUserId));
    } catch (cause) {
      toast.error(api.errorMessage(cause, 'Không ghép được tài khoản.'));
    }
  };

  const keyword = filter.trim().toLowerCase();
  const shown = accounts.filter(
    (account) =>
      (!onlyUnlinked || !account.erpUserId) &&
      (!keyword ||
        account.name.toLowerCase().includes(keyword) ||
        (account.erpUserName ?? '').toLowerCase().includes(keyword) ||
        account.groups.some((group) => group.toLowerCase().includes(keyword))),
  );
  const linked = accounts.filter((account) => account.erpUserId).length;

  return (
    <Card label="Tài khoản NAS">
      <div className={styles.sectionTitle}>
        <h3>Tài khoản NAS</h3>
        <span className={`${styles.badge} ${linked === accounts.length ? styles.badgeSuccess : styles.badgeWarn}`}>
          {linked}/{accounts.length} đã ghép
        </span>
      </div>
      <div className={styles.storageActions}>
        <input className={styles.nasFilter} value={filter} placeholder="Tìm tài khoản, nhân sự, nhóm" aria-label="Tìm tài khoản NAS" onChange={(event) => setFilter(event.target.value)} />
        <label className={styles.checkRow}>
          <input type="checkbox" checked={onlyUnlinked} onChange={(event) => setOnlyUnlinked(event.target.checked)} />
          Chỉ hiện chưa ghép
        </label>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.storageTable}>
          <thead>
            <tr>
              <th>Tài khoản NAS</th>
              <th>Nhóm</th>
              <th>Nhân sự ERP</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((account) => (
              <tr key={account.name}>
                <td>
                  {account.name}
                  {account.disabled ? <span className={`${styles.badge} ${styles.badgeWarn}`}> Đã khoá</span> : null}
                </td>
                <td>{account.groups.filter((group) => group !== 'users').join(', ')}</td>
                <td className={styles.nasPersonCell}>
                  <SearchableSelect
                    options={personOptions}
                    value={account.erpUserId ?? ''}
                    placeholder={account.erpUserName ?? 'Chọn nhân sự'}
                    clearable
                    height={32}
                    disabled={!editable}
                    onChange={(value) => void link(account.name, value || null)}
                  />
                </td>
                <td>
                  <span className={`${styles.badge} ${account.erpUserId ? styles.badgeInfo : styles.badgeWarn}`}>
                    {account.erpUserId ? LINK_LABELS[account.linkSource] : 'Chưa ghép'}
                  </span>
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={4} className={styles.muted}>
                  {accounts.length ? 'Không có tài khoản khớp bộ lọc.' : 'Chưa có tài khoản; lưu kết nối NAS rồi đồng bộ.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
