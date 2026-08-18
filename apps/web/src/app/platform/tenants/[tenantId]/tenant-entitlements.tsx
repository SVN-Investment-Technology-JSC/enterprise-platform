'use client';

import type {
  SetTenantEntitlementResponse,
  TenantEntitlementOverview,
  TenantEntitlementStatus,
  TenantModuleEntitlement,
} from '@enterprise-platform/contracts-tenancy';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './tenant-entitlements.module.scss';

interface ApiErrorPayload {
  readonly message?: string | readonly string[];
}

const STATUS_LABEL: Readonly<Record<TenantEntitlementStatus, string>> = {
  'not-entitled': 'Chưa cấp',
  provisioning: 'Đang provisioning',
  active: 'Đang hoạt động',
  disabled: 'Đã thu hồi',
  failed: 'Provisioning lỗi',
};

const STATUS_CLASS: Readonly<Record<TenantEntitlementStatus, string>> = {
  'not-entitled': styles.notEntitled,
  provisioning: styles.provisioning,
  active: styles.active,
  disabled: styles.disabled,
  failed: styles.failed,
};

function csrfToken(): string {
  const encoded = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('ep_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
  return encoded ? decodeURIComponent(encoded) : '';
}

function errorMessage(payload: ApiErrorPayload, fallback: string): string {
  if (Array.isArray(payload.message)) return payload.message.join(' ');
  return typeof payload.message === 'string' ? payload.message : fallback;
}

function updateModuleStatus(
  modules: readonly TenantModuleEntitlement[],
  moduleKey: string,
  status: TenantEntitlementStatus,
): TenantModuleEntitlement[] {
  return modules.map((module) =>
    module.key === moduleKey
      ? { ...module, entitlementStatus: status }
      : module,
  );
}

export function TenantEntitlements({
  initialOverview,
}: {
  initialOverview: TenantEntitlementOverview;
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [updatingKey, setUpdatingKey] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const hasProvisioning = overview.modules.some(
    (module) => module.entitlementStatus === 'provisioning',
  );

  useEffect(() => {
    if (!hasProvisioning) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/platform/v1/tenants/${overview.tenant.id}/modules`,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        if (response.ok) {
          setOverview((await response.json()) as TenantEntitlementOverview);
        }
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError('Mất kết nối khi theo dõi tiến trình provisioning.');
        }
      }
    };
    const timer = window.setInterval(() => void refresh(), 2_000);
    void refresh();
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [hasProvisioning, overview.tenant.id]);

  async function setEntitlement(
    module: TenantModuleEntitlement,
    enabled: boolean,
  ) {
    setUpdatingKey(module.key);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch(
        `/api/platform/v1/tenants/${overview.tenant.id}/entitlements/${encodeURIComponent(module.key)}`,
        {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken(),
          },
          body: JSON.stringify({ enabled }),
        },
      );
      const payload = (await response.json()) as SetTenantEntitlementResponse &
        ApiErrorPayload;
      if (!response.ok) {
        throw new Error(
          errorMessage(payload, 'Không thể cập nhật entitlement.'),
        );
      }
      setOverview((current) => ({
        ...current,
        modules: updateModuleStatus(
          current.modules,
          module.key,
          payload.status,
        ),
      }));
      setNotice(
        enabled
          ? `${module.name} đã vào hàng đợi provisioning.`
          : `${module.name} đã được thu hồi; schema và dữ liệu vẫn được giữ nguyên.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Không thể cập nhật entitlement.',
      );
    } finally {
      setUpdatingKey(undefined);
    }
  }

  return (
    <div className={styles.workspace}>
      <Link className={styles.backLink} href="/platform/tenants">
        ← Quay lại danh sách tenant
      </Link>

      <section className={styles.tenantContext} aria-label="Thông tin tenant">
        <div>
          <small>Tenant</small>
          <strong>{overview.tenant.slug}</strong>
        </div>
        <div>
          <small>Tenant admin</small>
          <strong>{overview.tenant.admin?.email ?? 'Chưa có'}</strong>
        </div>
        <div>
          <small>Dedicated DB</small>
          <strong>
            {overview.tenant.database?.databaseName ?? 'Chưa cấu hình'}
          </strong>
        </div>
        <div>
          <small>Secret reference</small>
          <strong>
            <code>{overview.tenant.database?.secretRef ?? '—'}</code>
          </strong>
        </div>
      </section>

      <header className={styles.sectionHeader}>
        <div>
          <small>Module Registry</small>
          <h2>Entitlement của tenant</h2>
        </div>
        <p>
          Worker tự động xử lý migration. Trang sẽ cập nhật trạng thái trong lúc
          provisioning.
        </p>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      <section className={styles.moduleGrid} aria-label="Danh sách module">
        {overview.modules.map((module) => {
          const enabled = module.entitlementStatus === 'active';
          const provisioning = module.entitlementStatus === 'provisioning';
          const failed = module.entitlementStatus === 'failed';
          const busy = updatingKey === module.key || provisioning;
          return (
            <article className={styles.moduleCard} key={module.key}>
              <header>
                <span className={styles.moduleIcon}>{module.icon ?? '◈'}</span>
                <span
                  className={`${styles.status} ${STATUS_CLASS[module.entitlementStatus]}`}
                >
                  {STATUS_LABEL[module.entitlementStatus]}
                </span>
              </header>
              <div>
                <small>
                  {module.key} · v{module.version}
                </small>
                <h3>{module.name}</h3>
                <p>{module.description}</p>
              </div>
              <dl>
                <div>
                  <dt>Launch URL</dt>
                  <dd>
                    <code>{module.launchUrl}</code>
                  </dd>
                </div>
                <div>
                  <dt>Đã provision</dt>
                  <dd>
                    {module.provisionedVersion
                      ? `v${module.provisionedVersion}`
                      : '—'}
                  </dd>
                </div>
              </dl>
              {module.latestJob?.error && failed ? (
                <p className={styles.jobError} role="alert">
                  {module.latestJob.error}
                </p>
              ) : null}
              <footer>
                <small>
                  {provisioning
                    ? 'Đang tạo/cập nhật schema…'
                    : enabled
                      ? 'Module đang hiển thị trong Tenant Portal.'
                      : 'Dữ liệu cũ không bị xóa khi thu hồi.'}
                </small>
                <button
                  className={
                    enabled ? styles.disableButton : styles.enableButton
                  }
                  disabled={busy}
                  onClick={() => void setEntitlement(module, !enabled)}
                  type="button"
                >
                  {updatingKey === module.key
                    ? 'Đang cập nhật…'
                    : provisioning
                      ? 'Đang provisioning…'
                      : enabled
                        ? 'Thu hồi entitlement'
                        : failed
                          ? 'Thử provisioning lại'
                          : 'Cấp entitlement'}
                </button>
              </footer>
            </article>
          );
        })}
      </section>
    </div>
  );
}
