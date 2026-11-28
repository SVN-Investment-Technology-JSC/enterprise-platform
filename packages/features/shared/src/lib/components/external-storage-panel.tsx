'use client';

import {
  formatBytes,
  SHARED_STORAGE_ACCESS_MODE_LABELS,
  type SaveSharedExternalStorageRequest,
  type SharedExternalStorageSettings,
  type SharedStorageAccessMode,
  type SharedStorageTestResult,
} from '@enterprise-platform/contracts-shared';
import { Popconfirm, SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useState } from 'react';
import {
  errorMessage,
  loadExternalStorage,
  saveExternalStorage,
  testExternalStorage,
  transferToExternalStorage,
} from '../shared-api';
import styles from '../shared.module.scss';
import { Field, SelectField } from './dialog';

interface Draft {
  enabled: boolean;
  label: string;
  accessMode: SharedStorageAccessMode;
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  pathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

const ACCESS_MODE_OPTIONS = [
  {
    value: 'proxy',
    label: SHARED_STORAGE_ACCESS_MODE_LABELS.proxy,
    description: 'Chỉ cần máy chủ ERP thấy được kho (LAN, VPN, Tailscale).',
  },
  {
    value: 'direct',
    label: SHARED_STORAGE_ACCESS_MODE_LABELS.direct,
    description: 'Kho cần https công khai và mở CORS cho tên miền ERP.',
  },
];

/** Một lượt chuyển tệp; giao diện gọi lặp tới khi hết. */
const TRANSFER_BATCH = 10;

function draftOf(settings: SharedExternalStorageSettings): Draft {
  return {
    enabled: settings.enabled,
    label: settings.label,
    accessMode: settings.accessMode,
    endpoint: settings.endpoint,
    publicEndpoint: settings.publicEndpoint,
    region: settings.region,
    bucket: settings.bucket,
    pathStyle: settings.pathStyle,
    accessKeyId: settings.accessKeyId,
    secretAccessKey: '',
  };
}

function requestOf(draft: Draft, version: number): SaveSharedExternalStorageRequest {
  return {
    enabled: draft.enabled,
    label: draft.label,
    accessMode: draft.accessMode,
    endpoint: draft.endpoint,
    publicEndpoint: draft.accessMode === 'direct' ? draft.publicEndpoint : undefined,
    region: draft.region,
    bucket: draft.bucket,
    pathStyle: draft.pathStyle,
    accessKeyId: draft.accessKeyId,
    secretAccessKey: draft.secretAccessKey || undefined,
    version,
  };
}

/**
 * Kho lưu trữ ngoài của công ty: tệp của Tài liệu chung và hồ sơ Văn thư lưu vào kho
 * S3 riêng (NAS, MinIO, Amazon S3…) thay vì kho của nền tảng. Quản trị kho xem, quản
 * trị tenant sửa; khoá bí mật không bao giờ hiện lại.
 */
export function ExternalStoragePanel({ onChanged }: { readonly onChanged?: () => void }) {
  const [settings, setSettings] = useState<SharedExternalStorageSettings>();
  const [draft, setDraft] = useState<Draft>();
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState<'save' | 'test' | 'transfer'>();
  const [test, setTest] = useState<SharedStorageTestResult>();
  const [removePlatformCopy, setRemovePlatformCopy] = useState(false);
  const [transferNote, setTransferNote] = useState<string>();
  const [transferErrors, setTransferErrors] = useState<readonly string[]>([]);

  const reload = useCallback(async () => {
    try {
      const next = await loadExternalStorage();
      setSettings(next);
      setDraft(draftOf(next));
      setLoadError(undefined);
    } catch (cause) {
      setLoadError(errorMessage(cause, 'Không tải được cấu hình kho lưu trữ.'));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loadError) {
    return (
      <section className={`${styles.panel} ${styles.storageCard} ${styles.storageWide}`} aria-label="Kho lưu trữ ngoài">
        <p className={styles.alert}>{loadError}</p>
      </section>
    );
  }
  if (!settings || !draft) {
    return (
      <section className={`${styles.panel} ${styles.storageCard} ${styles.storageWide}`} aria-label="Kho lưu trữ ngoài">
        <p className={styles.muted}>Đang tải…</p>
      </section>
    );
  }

  const editable = settings.editable && settings.available;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setTest(undefined);
  };
  const locationChanged =
    settings.configured && (draft.endpoint.trim() !== settings.endpoint || draft.bucket.trim() !== settings.bucket);

  const runTest = async () => {
    setBusy('test');
    try {
      setTest(await testExternalStorage(requestOf(draft, settings.version)));
    } catch (cause) {
      setTest({ ok: false, message: errorMessage(cause, 'Không thử được kết nối.') });
    } finally {
      setBusy(undefined);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      const next = await saveExternalStorage(requestOf(draft, settings.version));
      setSettings(next);
      setDraft(draftOf(next));
      setTest(undefined);
      toast.success(next.enabled ? 'Đã lưu: tệp mới sẽ lưu vào kho ngoài.' : 'Đã lưu: tệp mới lưu ở máy chủ ERP.');
      onChanged?.();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không lưu được cấu hình kho.'));
    } finally {
      setBusy(undefined);
    }
  };

  const transfer = async () => {
    setBusy('transfer');
    setTransferErrors([]);
    let moved = 0;
    const errors: string[] = [];
    try {
      for (;;) {
        const result = await transferToExternalStorage({ limit: TRANSFER_BATCH, removePlatformCopy });
        moved += result.moved;
        errors.push(...result.errors);
        setTransferNote(`Đã chuyển ${moved} tệp, còn ${result.remaining} tệp ở máy chủ ERP.`);
        // Dừng khi hết tệp, hoặc một lượt không chuyển được tệp nào (các tệp còn lại đều lỗi).
        if (result.remaining === 0 || result.moved === 0) break;
      }
      if (errors.length > 0) toast.error(`Đã chuyển ${moved} tệp; ${errors.length} tệp lỗi, xem chi tiết bên dưới.`);
      else toast.success(`Đã chuyển ${moved} tệp sang kho ngoài.`);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Chuyển tệp bị gián đoạn.'));
    } finally {
      setTransferErrors(errors.slice(0, 20));
      setBusy(undefined);
      await reload();
      onChanged?.();
    }
  };

  const status = !settings.configured
    ? { label: 'Chưa cấu hình', tone: styles.badgeInfo }
    : settings.enabled
      ? { label: 'Đang bật', tone: styles.badgeSuccess }
      : { label: 'Đang tắt', tone: styles.badgeWarn };

  return (
    <section className={`${styles.panel} ${styles.storageCard}`} aria-label="Kho lưu trữ ngoài">
      <div className={styles.sectionTitle}>
        <h3>Kho lưu trữ ngoài</h3>
        <span className={`${styles.badge} ${status.tone}`}>{status.label}</span>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Trên máy chủ ERP</dt>
          <dd>
            {settings.usage.platform.files.toLocaleString('vi-VN')} tệp · {formatBytes(settings.usage.platform.bytes)}
          </dd>
        </div>
        <div>
          <dt>Trên kho ngoài</dt>
          <dd>
            {settings.usage.external.files.toLocaleString('vi-VN')} tệp · {formatBytes(settings.usage.external.bytes)}
          </dd>
        </div>
        {settings.updatedAt ? (
          <div>
            <dt>Cập nhật</dt>
            <dd>
              {new Date(settings.updatedAt).toLocaleString('vi-VN')}
              {settings.updatedByName ? ` · ${settings.updatedByName}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>

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
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={!editable}
            onChange={(event) => set('enabled', event.target.checked)}
          />
          Bật (tệp mới lưu vào kho này)
        </label>
        <div className={styles.fieldRow}>
          <Field label="Tên gọi">
            <input
              value={draft.label}
              maxLength={120}
              placeholder="NAS văn phòng"
              disabled={!editable}
              onChange={(event) => set('label', event.target.value)}
            />
          </Field>
          <SelectField label="Cách truy cập" required>
            <SearchableSelect
              options={ACCESS_MODE_OPTIONS}
              value={draft.accessMode}
              clearable={false}
              searchInDropdown
              hideDropdownSearch
              disabled={!editable}
              onChange={(value) => set('accessMode', (value || 'proxy') as SharedStorageAccessMode)}
            />
          </SelectField>
        </div>
        <div className={styles.fieldRow}>
          <Field label="Địa chỉ kho (S3 endpoint)" required>
            <input
              value={draft.endpoint}
              maxLength={500}
              placeholder="http://100.64.10.20:9000"
              disabled={!editable}
              onChange={(event) => set('endpoint', event.target.value)}
            />
          </Field>
          {draft.accessMode === 'direct' ? (
            <Field label="Địa chỉ công khai cho trình duyệt" required>
              <input
                value={draft.publicEndpoint}
                maxLength={500}
                placeholder="https://s3.congty.vn"
                disabled={!editable}
                onChange={(event) => set('publicEndpoint', event.target.value)}
              />
            </Field>
          ) : null}
        </div>
        <div className={styles.fieldRow}>
          <Field label="Bucket" required>
            <input
              value={draft.bucket}
              maxLength={63}
              placeholder="erp-documents"
              disabled={!editable}
              onChange={(event) => set('bucket', event.target.value)}
            />
          </Field>
          <Field label="Region">
            <input
              value={draft.region}
              maxLength={64}
              placeholder="us-east-1"
              disabled={!editable}
              onChange={(event) => set('region', event.target.value)}
            />
          </Field>
        </div>
        <div className={styles.fieldRow}>
          <Field label="Access key" required>
            <input
              value={draft.accessKeyId}
              maxLength={255}
              autoComplete="off"
              disabled={!editable}
              onChange={(event) => set('accessKeyId', event.target.value)}
            />
          </Field>
          <Field label="Secret key" required={!settings.hasSecret}>
            <input
              type="password"
              value={draft.secretAccessKey}
              maxLength={500}
              autoComplete="new-password"
              placeholder={settings.hasSecret ? 'Đã lưu; để trống nếu giữ nguyên' : ''}
              disabled={!editable}
              onChange={(event) => set('secretAccessKey', event.target.value)}
            />
          </Field>
        </div>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={draft.pathStyle}
            disabled={!editable}
            onChange={(event) => set('pathStyle', event.target.checked)}
          />
          Path-style (MinIO, NAS cần bật)
        </label>
        {locationChanged && settings.usage.external.files > 0 ? (
          <p className={styles.warning}>
            Đang có {settings.usage.external.files.toLocaleString('vi-VN')} tệp ở kho ngoài. Đổi địa chỉ hay bucket thì
            các tệp đó phải có sẵn ở kho mới, nếu không sẽ không mở được.
          </p>
        ) : null}
        {test ? (
          <p className={test.ok ? styles.success : styles.alert} role="status">
            {test.message}
          </p>
        ) : null}
        {editable ? (
          <div className={styles.storageActions}>
            <button type="button" className={styles.buttonGhost} disabled={Boolean(busy)} onClick={() => void runTest()}>
              {busy === 'test' ? 'Đang thử…' : 'Thử kết nối'}
            </button>
            <button type="submit" className={styles.buttonPrimary} disabled={Boolean(busy)}>
              {busy === 'save' ? 'Đang lưu…' : 'Lưu cấu hình'}
            </button>
          </div>
        ) : null}
      </form>

      {editable && settings.enabled && (settings.usage.platform.files > 0 || transferNote) ? (
        <div className={styles.storageTransfer}>
          <p className={styles.muted}>
            Còn {settings.usage.platform.files.toLocaleString('vi-VN')} tệp ({formatBytes(settings.usage.platform.bytes)}) ở
            máy chủ ERP.
          </p>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={removePlatformCopy}
              disabled={Boolean(busy)}
              onChange={(event) => setRemovePlatformCopy(event.target.checked)}
            />
            Xoá bản ở máy chủ ERP sau khi chuyển
          </label>
          {transferNote ? <p role="status">{transferNote}</p> : null}
          {transferErrors.length > 0 ? (
            <ul className={styles.storageErrors}>
              {transferErrors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <div className={styles.storageActions}>
            <Popconfirm
              title={`Chuyển ${settings.usage.platform.files.toLocaleString('vi-VN')} tệp sang kho ngoài?`}
              description={removePlatformCopy ? 'Bản ở máy chủ ERP sẽ bị xoá sau khi chuyển.' : 'Bản ở máy chủ ERP được giữ lại.'}
              okText="Chuyển"
              okType="primary"
              onConfirm={() => void transfer()}
            >
              <button type="button" className={styles.buttonPrimary} disabled={Boolean(busy) || settings.usage.platform.files === 0}>
                {busy === 'transfer' ? 'Đang chuyển…' : 'Chuyển sang kho ngoài'}
              </button>
            </Popconfirm>
          </div>
        </div>
      ) : null}
    </section>
  );
}
