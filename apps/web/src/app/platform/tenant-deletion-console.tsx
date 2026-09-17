'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  TenantDeletionJob,
  TenantDeletionPreview,
  TenantSummary,
} from '@enterprise-platform/contracts-tenancy';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { AlertTriangle, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const stepLabels: Record<TenantDeletionJob['step'], string> = {
  quiesce: 'Chờ kết nối và upload kết thúc',
  drop_database: 'Xóa database riêng',
  purge_storage: 'Xóa tệp đính kèm',
  purge_integration: 'Dọn dữ liệu tích hợp',
  purge_platform: 'Kiểm chứng và dọn dữ liệu quản lý',
};

export function csrfToken(): string {
  const value = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith('ep_csrf='))
    ?.slice(8);
  return value ? decodeURIComponent(value) : '';
}

export async function deletionApi<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      Array.isArray(body.message)
        ? body.message.join(' ')
        : (body.message ?? 'Không thể xử lý tác vụ xóa tenant.'),
    );
  return body as T;
}

interface Props {
  open: boolean;
  tenant: TenantSummary | undefined;
  jobs: readonly TenantDeletionJob[];
  onOpenChange: (open: boolean) => void;
  onJob: (job: TenantDeletionJob) => void;
}

export function TenantDeletionConsole({
  open,
  tenant,
  jobs,
  onOpenChange,
  onJob,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>
            {tenant ? `Xóa tenant: ${tenant.name}` : 'Lịch sử xóa tenant'}
          </SheetTitle>
          <SheetDescription>
            Database, tệp và dữ liệu đang vận hành được xóa vĩnh viễn. Backup
            hết hạn theo chính sách lưu trữ.
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <DeletionContent
            key={tenant?.id ?? 'history'}
            tenant={tenant}
            jobs={jobs}
            onJob={onJob}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DeletionContent({
  tenant,
  jobs,
  onJob,
}: Omit<Props, 'open' | 'onOpenChange'>) {
  const job = tenant
    ? jobs.find((item) => item.tenantId === tenant.id)
    : undefined;
  const [preview, setPreview] = useState<TenantDeletionPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const requestKey = useRef<string | undefined>(undefined);
  const tenantId = tenant?.id;
  const jobId = job?.id;

  useEffect(() => {
    if (!tenantId || jobId) return;
    const controller = new AbortController();
    deletionApi<TenantDeletionPreview>(
      `/api/platform/v1/tenants/${tenantId}/deletion-preview`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setPreview(value);
          requestKey.current = crypto.randomUUID();
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Không thể kiểm tra tenant.',
          );
      });
    return () => controller.abort();
  }, [tenantId, jobId, revision]);

  async function start(confirmedInput?: string) {
    if (!tenant || !preview || !requestKey.current) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await deletionApi<TenantDeletionJob>(
        `/api/platform/v1/tenants/${tenant.id}/deletion`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken(),
            'idempotency-key': requestKey.current,
          },
          body: JSON.stringify({
            confirmSlug: confirmedInput ?? '',
            previewToken: preview.previewToken,
          }),
        },
      );
      onJob(result);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Không thể gửi yêu cầu xóa.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function retry(current: TenantDeletionJob) {
    setBusy(true);
    setError(undefined);
    try {
      onJob(
        await deletionApi<TenantDeletionJob>(
          `/api/platform/v1/tenant-deletions/${current.id}/retry`,
          {
            method: 'POST',
            headers: { 'x-csrf-token': csrfToken() },
          },
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Không thể thử lại tác vụ.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 p-5">
      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {tenant && !job ? (
        <>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-950">
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4" />
              Thao tác không thể hoàn tác tại đây
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>Toàn bộ database và dữ liệu các module.</li>
              <li>
                Tài khoản của tenant, phiên đăng nhập và liên kết đặt lại mật
                khẩu.
              </li>
              <li>Tệp đính kèm và dữ liệu quản lý tenant.</li>
            </ul>
          </div>
          {preview ? (
            <dl className="grid grid-cols-[120px_1fr] gap-3 rounded-lg border p-4 text-sm">
              <dt>Mã tenant</dt>
              <dd className="break-all font-mono font-semibold">
                {preview.slug}
              </dd>
              <dt>Database</dt>
              <dd className="break-all font-mono">{preview.databaseName}</dd>
              <dt>Backup</dt>
              <dd>{preview.backupPolicy}</dd>
            </dl>
          ) : !error ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <LoaderCircle className="size-4 animate-spin" />
              Đang kiểm tra tài nguyên…
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            {error ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPreview(undefined);
                  setError(undefined);
                  setRevision((value) => value + 1);
                }}
              >
                Kiểm tra lại
              </Button>
            ) : null}
            {preview ? (
              <Popconfirm
                title="Xóa vĩnh viễn tenant này?"
                description="Tenant sẽ bị khóa ngay khi yêu cầu được chấp nhận. Database và tệp sẽ được xóa."
                confirmInput={{
                  requiredText: preview.slug,
                  label: 'Nhập chính xác mã tenant để xác nhận:',
                }}
                onConfirm={start}
                loading={busy}
                okText="Xóa vĩnh viễn"
                cancelText="Hủy"
                okType="danger"
                placement="top-end"
              >
                <Button disabled={busy} variant="destructive">
                  <Trash2 className="size-4" />
                  Xóa vĩnh viễn
                </Button>
              </Popconfirm>
            ) : null}
          </div>
        </>
      ) : null}
      {(tenant ? (job ? [job] : []) : jobs).map((current) => (
        <section key={current.id} className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">
              {current.status === 'completed'
                ? 'Đã xóa hoàn tất'
                : current.status === 'failed'
                  ? 'Xóa chưa hoàn tất'
                  : 'Đang xóa tenant'}
            </h3>
            {['pending', 'processing'].includes(current.status) ? (
              <LoaderCircle
                className="size-4 animate-spin"
                aria-label="Đang xử lý"
              />
            ) : null}
          </div>
          <p className="break-all text-xs text-muted-foreground">
            Tenant: {current.tenantId}
          </p>
          <p className="text-sm" role="status">
            {current.status === 'completed'
              ? 'Đã kiểm chứng xóa dữ liệu đang vận hành. Giữ backup theo retention và nhật ký tối thiểu.'
              : stepLabels[current.step]}
          </p>
          <p className="text-xs text-muted-foreground">
            Yêu cầu lúc {new Date(current.createdAt).toLocaleString('vi-VN')}
          </p>
          {current.error ? (
            <p className="text-sm text-red-700" role="alert">
              {current.error}
            </p>
          ) : null}
          {current.retryable ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => retry(current)}
            >
              <RefreshCw className="size-4" />
              Thử lại
            </Button>
          ) : null}
        </section>
      ))}
      {!tenant && !jobs.length ? (
        <p className="text-sm text-muted-foreground">
          Chưa có tác vụ xóa tenant.
        </p>
      ) : null}
    </div>
  );
}
