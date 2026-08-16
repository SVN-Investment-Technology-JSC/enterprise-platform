'use client';

import type {
  CreateTenantRequest,
  CreateTenantResponse,
  TenantSummary,
} from '@enterprise-platform/contracts-tenancy';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import styles from './tenant-management.module.scss';

interface TenantManagementProps {
  initialTenants: readonly TenantSummary[];
}

interface ApiErrorPayload {
  message?: string | string[];
}

function csrfToken(): string {
  const encoded = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('ep_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
  return encoded ? decodeURIComponent(encoded) : '';
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function errorMessage(payload: ApiErrorPayload, fallback: string): string {
  if (Array.isArray(payload.message)) return payload.message.join(' ');
  return payload.message ?? fallback;
}

export function TenantManagement({ initialTenants }: TenantManagementProps) {
  const [tenants, setTenants] = useState([...initialTenants]);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState<string>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [adminDisplayName, setAdminDisplayName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [databaseName, setDatabaseName] = useState('');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('5432');
  const [secretRef, setSecretRef] = useState('');
  const [ssl, setSsl] = useState(false);

  const counts = useMemo(() => ({
    total: tenants.length,
    active: tenants.filter((tenant) => tenant.status === 'active').length,
    disabled: tenants.filter((tenant) => tenant.status === 'disabled').length,
  }), [tenants]);

  function updateName(value: string) {
    setName(value);
    const nextSlug = slugify(value);
    setSlug(nextSlug);
    setDatabaseName(nextSlug.replaceAll('-', '_'));
    setSecretRef(nextSlug ? `TENANT_${nextSlug.replaceAll('-', '_').toUpperCase()}_DATABASE_URL` : '');
  }

  function resetForm() {
    setName('');
    setSlug('');
    setAdminDisplayName('');
    setAdminEmail('');
    setInitialPassword('');
    setDatabaseName('');
    setHost('localhost');
    setPort('5432');
    setSecretRef('');
    setSsl(false);
  }

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setSuccess(undefined);
    const input: CreateTenantRequest = {
      name,
      slug,
      admin: { displayName: adminDisplayName, email: adminEmail, initialPassword },
      database: { databaseName, host, port: Number(port), secretRef, ssl },
    };
    try {
      const response = await fetch('/api/platform/v1/tenants', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify(input),
      });
      const payload = await response.json() as CreateTenantResponse & ApiErrorPayload;
      if (!response.ok) throw new Error(errorMessage(payload, 'Không thể tạo tenant.'));
      setTenants((current) => [...current, payload.tenant].sort((left, right) => left.name.localeCompare(right.name, 'vi')));
      setSuccess(`Đã tạo ${payload.tenant.name} và tài khoản ${payload.tenant.admin?.email}.`);
      resetForm();
      setShowCreate(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tạo tenant.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(tenant: TenantSummary) {
    const status = tenant.status === 'active' ? 'disabled' : 'active';
    setUpdatingId(tenant.id);
    setError(undefined);
    setSuccess(undefined);
    try {
      const response = await fetch(`/api/platform/v1/tenants/${tenant.id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json() as { tenant?: TenantSummary } & ApiErrorPayload;
      if (!response.ok || !payload.tenant) throw new Error(errorMessage(payload, 'Không thể cập nhật tenant.'));
      setTenants((current) => current.map((item) => item.id === tenant.id ? payload.tenant as TenantSummary : item));
      setSuccess(`${tenant.name} đã được ${status === 'active' ? 'kích hoạt' : 'khóa'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật tenant.');
    } finally {
      setUpdatingId(undefined);
    }
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.metrics} aria-label="Thống kê tenant">
        <article><span>Tổng tenant</span><strong>{counts.total}</strong></article>
        <article><span>Đang hoạt động</span><strong>{counts.active}</strong></article>
        <article><span>Đã khóa</span><strong>{counts.disabled}</strong></article>
      </section>

      <section className={styles.toolbar}>
        <div>
          <small>Platform database</small>
          <h2>Danh sách tenant</h2>
          <p>Tài khoản quản trị, membership, role và database reference được tạo nguyên tử.</p>
        </div>
        <button className={styles.primaryButton} onClick={() => setShowCreate((current) => !current)} type="button">
          {showCreate ? 'Đóng biểu mẫu' : '+ Tạo tenant'}
        </button>
      </section>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {success ? <p className={styles.success} role="status">{success}</p> : null}

      {showCreate ? (
        <form className={styles.createForm} onSubmit={createTenant}>
          <header>
            <div><small>Bước 1</small><h3>Thông tin tenant</h3></div>
            <p>Tenant được kích hoạt ngay nhưng chưa có module cho tới khi được cấp entitlement.</p>
          </header>
          <div className={styles.formGrid}>
            <label>Tên tenant<input onChange={(event) => updateName(event.currentTarget.value)} required value={name} /></label>
            <label>Slug<input onChange={(event) => setSlug(event.currentTarget.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={slug} /></label>
          </div>

          <header><div><small>Bước 2</small><h3>Tenant Admin</h3></div><p>Tài khoản được tạo với role <code>tenant-admin</code>.</p></header>
          <div className={styles.formGrid}>
            <label>Tên hiển thị<input onChange={(event) => setAdminDisplayName(event.currentTarget.value)} required value={adminDisplayName} /></label>
            <label>Email admin<input autoComplete="off" onChange={(event) => setAdminEmail(event.currentTarget.value)} required type="email" value={adminEmail} /></label>
            <label className={styles.fullWidth}>Mật khẩu khởi tạo<input autoComplete="new-password" minLength={12} onChange={(event) => setInitialPassword(event.currentTarget.value)} required type="password" value={initialPassword} /><small>Tối thiểu 12 ký tự; trao đổi cho admin qua kênh an toàn.</small></label>
          </div>

          <header><div><small>Bước 3</small><h3>Dedicated Database</h3></div><p>Platform chỉ lưu secret reference, không lưu connection string rõ.</p></header>
          <div className={styles.formGrid}>
            <label>Database name<input onChange={(event) => setDatabaseName(event.currentTarget.value)} pattern="[a-z][a-z0-9_]{0,62}" required value={databaseName} /></label>
            <label>Secret reference<input onChange={(event) => setSecretRef(event.currentTarget.value)} pattern="[A-Z][A-Z0-9_]*" required value={secretRef} /></label>
            <label>Host<input onChange={(event) => setHost(event.currentTarget.value)} required value={host} /></label>
            <label>Port<input max="65535" min="1" onChange={(event) => setPort(event.currentTarget.value)} required type="number" value={port} /></label>
            <label className={styles.checkbox}><input checked={ssl} onChange={(event) => setSsl(event.currentTarget.checked)} type="checkbox" /> Sử dụng SSL</label>
          </div>
          <footer>
            <button className={styles.secondaryButton} onClick={() => setShowCreate(false)} type="button">Hủy</button>
            <button className={styles.primaryButton} disabled={busy} type="submit">{busy ? 'Đang tạo…' : 'Tạo tenant và admin'}</button>
          </footer>
        </form>
      ) : null}

      <section className={styles.tenantList} aria-label="Danh sách tenant">
        {tenants.map((tenant) => (
          <article className={styles.tenantCard} key={tenant.id}>
            <div className={styles.tenantIdentity}>
              <span>{tenant.name.slice(0, 2).toUpperCase()}</span>
              <div><small>{tenant.slug}</small><h3>{tenant.name}</h3></div>
            </div>
            <span className={`${styles.status} ${tenant.status === 'active' ? styles.active : styles.disabled}`}>{tenant.status}</span>
            <dl>
              <div><dt>Tenant admin</dt><dd>{tenant.admin?.displayName ?? 'Chưa có'}<small>{tenant.admin?.email}</small></dd></div>
              <div><dt>Database</dt><dd>{tenant.database?.databaseName ?? 'Chưa cấu hình'}<small>{tenant.database ? `${tenant.database.host}:${tenant.database.port}` : null}</small></dd></div>
              <div><dt>Secret reference</dt><dd><code>{tenant.database?.secretRef ?? '—'}</code></dd></div>
              <div><dt>Modules</dt><dd>{tenant.modules.map((module) => module.key).join(' · ') || 'Chưa cấp entitlement'}</dd></div>
            </dl>
            <footer>
              <small>Tạo ngày {new Intl.DateTimeFormat('vi-VN').format(new Date(tenant.createdAt))}</small>
              <div className={styles.cardActions}>
                <Link className={styles.entitlementLink} href={`/platform/tenants/${tenant.id}`}>Quản lý entitlement</Link>
                <button className={tenant.status === 'active' ? styles.dangerButton : styles.secondaryButton} disabled={updatingId === tenant.id} onClick={() => toggleStatus(tenant)} type="button">
                  {updatingId === tenant.id ? 'Đang cập nhật…' : tenant.status === 'active' ? 'Khóa tenant' : 'Kích hoạt'}
                </button>
              </div>
            </footer>
          </article>
        ))}
      </section>
    </div>
  );
}
