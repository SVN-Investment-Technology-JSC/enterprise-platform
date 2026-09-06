'use client';

import type {
  DataImportDatasetKey,
  DataImportExecutionResponse,
  DataImportPreviewResponse,
} from '@enterprise-platform/contracts-data-import';
import type { TenantSummary } from '@enterprise-platform/contracts-tenancy';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import {
  AlertCircle,
  CheckCircle2,
  FileArchive,
  FileCheck2,
  LoaderCircle,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface DataImportWorkspaceProps {
  readonly tenants: readonly TenantSummary[];
}

interface ApiErrorPayload {
  readonly message?: string | readonly string[];
  readonly preview?: DataImportPreviewResponse;
}

const rowLabels: Record<DataImportDatasetKey, string> = {
  users: 'Người dùng',
  organizationNodeTypes: 'Loại node tổ chức',
  organizationTrees: 'Cây tổ chức',
  organizationNodes: 'Node tổ chức',
  organizationAssignments: 'Bổ nhiệm',
  inventorySettings: 'Cấu hình Inventory',
  inventoryWarehouses: 'Kho',
  inventoryMaterials: 'Vật tư',
  inventoryAssets: 'Thiết bị',
  inventoryOpeningStock: 'Tồn đầu kỳ',
  procedureDefinitions: 'Quy trình',
  procedureInstances: 'Hồ sơ quy trình',
  maintenanceSchedules: 'Lịch bảo trì',
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

function apiErrorMessage(payload: ApiErrorPayload, fallback: string): string {
  if (Array.isArray(payload.message)) return payload.message.join(' ');
  return typeof payload.message === 'string' ? payload.message : fallback;
}

export function DataImportWorkspace({ tenants }: DataImportWorkspaceProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const eligibleTenants = useMemo(
    () => tenants.filter((tenant) => tenant.status === 'active'),
    [tenants],
  );
  const [tenantId, setTenantId] = useState(eligibleTenants[0]?.id ?? '');
  const [files, setFiles] = useState<readonly File[]>([]);
  const [preview, setPreview] = useState<DataImportPreviewResponse>();
  const [result, setResult] = useState<DataImportExecutionResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'preview' | 'execute'>();

  const selectedTenant = tenants.find((tenant) => tenant.id === tenantId);
  const totalRows = preview
    ? Object.values(preview.rowCounts).reduce((sum, count) => sum + count, 0)
    : 0;

  function resetValidation() {
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
  }

  function changeTenant(value: string) {
    setTenantId(value);
    resetValidation();
  }

  function changeFiles(nextFiles: FileList | null) {
    setFiles(nextFiles ? Array.from(nextFiles) : []);
    resetValidation();
  }

  function requestBody(previewId?: string): FormData {
    const form = new FormData();
    form.append('tenantId', tenantId);
    if (previewId) form.append('previewId', previewId);
    files.forEach((file) => form.append('files', file));
    return form;
  }

  async function validateFiles() {
    if (!tenantId || files.length === 0) {
      setError('Hãy chọn tenant và ít nhất một file XLSX hoặc CSV.');
      return;
    }
    setBusy('preview');
    setError(undefined);
    setResult(undefined);
    try {
      const response = await fetch('/api/platform/v1/data-import/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrfToken() },
        body: requestBody(),
      });
      const payload = (await response.json().catch(() => ({}))) as
        | DataImportPreviewResponse
        | ApiErrorPayload;
      if (!response.ok) {
        throw new Error(
          apiErrorMessage(payload as ApiErrorPayload, 'Không thể kiểm tra file.'),
        );
      }
      setPreview(payload as DataImportPreviewResponse);
    } catch (cause) {
      setPreview(undefined);
      setError(cause instanceof Error ? cause.message : 'Không thể kiểm tra file.');
    } finally {
      setBusy(undefined);
    }
  }

  async function executeImport() {
    if (!preview?.valid) return;
    setBusy('execute');
    setError(undefined);
    try {
      const response = await fetch('/api/platform/v1/data-import/execute', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrfToken() },
        body: requestBody(preview.previewId),
      });
      const payload = (await response.json().catch(() => ({}))) as
        | DataImportExecutionResponse
        | ApiErrorPayload;
      if (!response.ok) {
        const failed = payload as ApiErrorPayload;
        if (failed.preview) setPreview(failed.preview);
        throw new Error(apiErrorMessage(failed, 'Không thể import dữ liệu.'));
      }
      setResult(payload as DataImportExecutionResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể import dữ liệu.');
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
            <ShieldCheck className="size-4" />
            Chỉ dành cho Super Admin
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">
            Data Import
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Kiểm tra tenant, Tenant Admin, database, entitlement và schema của từng
            module trước khi ghi. Mỗi module chỉ ghi vào schema do chính module đó
            sở hữu.
          </p>
        </div>
        <Badge className="w-fit bg-slate-900 px-3 py-1 text-white hover:bg-slate-900">
          Preview bắt buộc trước Import
        </Badge>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <Card className="h-fit border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <UploadCloud className="size-5 text-blue-700" />
              1. Chọn dữ liệu nguồn
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <label className="block space-y-2 text-sm font-medium text-slate-800">
              Tenant đích
              <select
                className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                value={tenantId}
                onChange={(event) => changeTenant(event.target.value)}
              >
                <option value="">Chọn tenant</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name} ({tenant.slug})
                    {tenant.status !== 'active' ? ' — đang khóa' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <span className="mb-2 block text-sm font-medium text-slate-800">
                File XLSX hoặc bộ CSV
              </span>
              <input
                ref={fileInput}
                className="sr-only"
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                multiple
                onChange={(event) => changeFiles(event.target.files)}
              />
              <button
                className="flex min-h-36 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-5 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                type="button"
                onClick={() => fileInput.current?.click()}
              >
                <FileArchive className="mb-3 size-8 text-slate-500" />
                <span className="text-sm font-semibold text-slate-800">
                  Chọn file từ máy
                </span>
                <span className="mt-1 text-xs leading-5 text-slate-500">
                  Một workbook XLSX, hoặc nhiều CSV có tên trùng tên sheet mẫu.
                  Tối đa 10 MB mỗi file.
                </span>
              </button>
            </div>

            {files.length > 0 ? (
              <ul className="space-y-2" aria-label="File đã chọn">
                {files.map((file) => (
                  <li
                    className="flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 text-sm"
                    key={`${file.name}:${file.size}:${file.lastModified}`}
                  >
                    <span className="min-w-0 truncate font-medium">{file.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <Button
              className="w-full bg-[#091426] hover:bg-slate-800"
              disabled={!tenantId || files.length === 0 || Boolean(busy)}
              onClick={validateFiles}
            >
              {busy === 'preview' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <FileCheck2 />
              )}
              Kiểm tra trước khi import
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3 text-lg">
                <span>2. Kết quả kiểm tra</span>
                {preview ? (
                  <Badge
                    className={cn(
                      preview.valid
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                        : 'bg-red-100 text-red-800 hover:bg-red-100',
                    )}
                  >
                    {preview.valid ? 'Hợp lệ' : 'Đã chặn'}
                  </Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!preview ? (
                <div className="grid min-h-56 place-items-center rounded-lg border border-dashed bg-slate-50 p-8 text-center">
                  <div>
                    <ShieldCheck className="mx-auto mb-3 size-9 text-slate-400" />
                    <p className="font-medium text-slate-700">
                      Chưa có kết quả kiểm tra
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Hệ thống chưa ghi dữ liệu ở bước này.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {preview.checks.map((check) => (
                      <div
                        className={cn(
                          'rounded-lg border p-3',
                          check.status === 'failed'
                            ? 'border-red-200 bg-red-50'
                            : check.status === 'passed'
                              ? 'border-emerald-200 bg-emerald-50'
                              : 'bg-slate-50',
                        )}
                        key={check.key}
                      >
                        <div className="flex items-start gap-2">
                          {check.status === 'failed' ? (
                            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                          ) : (
                            <CheckCircle2
                              className={cn(
                                'mt-0.5 size-4 shrink-0',
                                check.status === 'passed'
                                  ? 'text-emerald-700'
                                  : 'text-slate-400',
                              )}
                            />
                          )}
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {check.label}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-slate-600">
                              {check.detail}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-semibold text-slate-900">
                      Dữ liệu nhận diện: {totalRows} dòng
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(preview.rowCounts)
                        .filter(([, count]) => count > 0)
                        .map(([key, count]) => (
                          <Badge className="bg-blue-50 text-blue-800" key={key}>
                            {rowLabels[key as DataImportDatasetKey]}: {count}
                          </Badge>
                        ))}
                    </div>
                  </div>

                  {preview.issues.length > 0 ? (
                    <div className="max-h-72 overflow-auto rounded-lg border">
                      <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
                          <tr>
                            <th className="px-3 py-2 font-medium">Mức</th>
                            <th className="px-3 py-2 font-medium">Vị trí</th>
                            <th className="px-3 py-2 font-medium">Nội dung</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.issues.map((issue, index) => (
                            <tr className="border-t align-top" key={`${issue.code}:${issue.sheet}:${issue.row}:${index}`}>
                              <td className="px-3 py-2">
                                <Badge
                                  className={cn(
                                    issue.level === 'error'
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-amber-100 text-amber-800',
                                  )}
                                >
                                  {issue.level === 'error' ? 'Lỗi' : 'Cảnh báo'}
                                </Badge>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
                                {issue.sheet ?? 'SYSTEM'}
                                {issue.row ? ` · dòng ${issue.row}` : ''}
                                {issue.field ? ` · ${issue.field}` : ''}
                              </td>
                              <td className="px-3 py-2 text-slate-800">{issue.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      Không phát hiện lỗi hoặc cảnh báo.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex flex-col justify-between gap-4 py-5 sm:flex-row sm:items-center">
              <div>
                <p className="font-semibold text-slate-900">3. Xác nhận ghi dữ liệu</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {preview?.valid
                    ? `Sẵn sàng import ${totalRows} dòng vào ${selectedTenant?.name ?? 'tenant đã chọn'}.`
                    : 'Nút Import chỉ mở khi toàn bộ kiểm tra bắt buộc đã đạt.'}
                </p>
              </div>
              <Popconfirm
                title="Import dữ liệu vào tenant?"
                description="Thao tác có thể tạo nhiều bản ghi và không tự động hoàn tác. File sẽ được kiểm tra lại trước khi ghi."
                okText="Import ngay"
                cancelText="Kiểm tra lại"
                okType="warning"
                placement="top-end"
                disabled={!preview?.valid || Boolean(busy) || Boolean(result)}
                loading={busy === 'execute'}
                onConfirm={executeImport}
              >
                <Button
                  className="min-w-36 bg-blue-700 hover:bg-blue-800"
                  disabled={!preview?.valid || Boolean(busy) || Boolean(result)}
                >
                  {busy === 'execute' ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <UploadCloud />
                  )}
                  Import dữ liệu
                </Button>
              </Popconfirm>
            </CardContent>
          </Card>
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}
      {result ? (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900" role="status">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">Import hoàn tất</p>
            <p className="mt-1 text-sm">
              Mã lượt import: <span className="font-mono">{result.importId}</span>.
              Hoạt động đã được ghi vào audit log của Platform.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default DataImportWorkspace;
