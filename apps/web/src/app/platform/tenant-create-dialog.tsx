'use client';

import { defineStepper } from '@stepperize/react';
import type { CreateTenantRequest, CreateTenantResponse, TenantSummary } from '@enterprise-platform/contracts-tenancy';
import { ArrowLeft, ArrowRight, Building2, Database, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const tenantCreateStepper = defineStepper([
  { id: 'organization', title: 'Doanh nghiệp', description: 'Định danh tenant' },
  { id: 'administrator', title: 'Quản trị viên', description: 'Tài khoản tenant admin' },
  { id: 'database', title: 'Database', description: 'Dedicated database' },
] as const, { linear: true });

type TenantDraft = { name: string; slug: string; adminDisplayName: string; adminEmail: string; initialPassword: string; confirmation: string; databaseName: string; host: string; port: string; secretRef: string; ssl: boolean };
type TenantCreateDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (tenant: TenantSummary) => void };
const defaultDraft: TenantDraft = { name: '', slug: '', adminDisplayName: '', adminEmail: '', initialPassword: '', confirmation: '', databaseName: '', host: 'localhost', port: '55436', secretRef: '', ssl: false };

function csrfToken() {
  const encoded = document.cookie.split('; ').find((entry) => entry.startsWith('ep_csrf='))?.split('=').slice(1).join('=');
  return encoded ? decodeURIComponent(encoded) : '';
}

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function apiMessage(payload: { message?: string | string[] }) {
  return Array.isArray(payload.message) ? payload.message.join(' ') : (payload.message ?? 'Không thể tạo tenant.');
}

export function TenantCreateDialog({ open, onOpenChange, onCreated }: TenantCreateDialogProps) {
  return <Dialog onOpenChange={onOpenChange} open={open}>{open ? <TenantCreateDialogFlow onCreated={onCreated} onOpenChange={onOpenChange} /> : null}</Dialog>;
}

function TenantCreateDialogFlow({ onCreated, onOpenChange }: Omit<TenantCreateDialogProps, 'open'>) {
  const stepper = tenantCreateStepper.useStepper();
  const [formData, setFormData] = useState<TenantDraft>(defaultDraft);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  function update(patch: Partial<TenantDraft>) { setFormData((current) => ({ ...current, ...patch })); }
  function updateName(name: string) {
    const slug = slugify(name);
    update({ name, slug, databaseName: slug.replaceAll('-', '_'), secretRef: slug ? `TENANT_${slug.replaceAll('-', '_').toUpperCase()}_DATABASE_URL` : '' });
  }
  function validateCurrent() {
    if (stepper.is('organization')) {
      if (!formData.name.trim()) return 'Vui lòng nhập tên doanh nghiệp.';
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(formData.slug)) return 'Mã tenant chỉ gồm chữ thường, số và dấu gạch ngang.';
    }
    if (stepper.is('administrator')) {
      if (!formData.adminDisplayName.trim()) return 'Vui lòng nhập tên hiển thị của quản trị viên.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.adminEmail)) return 'Email quản trị viên không hợp lệ.';
      if (formData.initialPassword.length < 12) return 'Mật khẩu phải có ít nhất 12 ký tự.';
      if (formData.initialPassword !== formData.confirmation) return 'Xác nhận mật khẩu chưa khớp.';
    }
    if (stepper.is('database')) {
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(formData.databaseName)) return 'Tên database phải là định danh PostgreSQL chữ thường hợp lệ.';
      if (!formData.host.trim()) return 'Vui lòng nhập database host.';
      const port = Number(formData.port);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) return 'Database port phải nằm trong khoảng 1–65535.';
      if (!/^[A-Z][A-Z0-9_]*$/.test(formData.secretRef)) return 'Secret reference phải viết hoa, chỉ gồm chữ, số và dấu gạch dưới.';
    }
    return undefined;
  }
  async function next() {
    const validationError = validateCurrent();
    if (validationError) { setError(validationError); return; }
    setError(undefined);
    await stepper.next();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stepper.isLast) { await next(); return; }
    const validationError = validateCurrent();
    if (validationError) { setError(validationError); return; }
    setBusy(true);
    setError(undefined);
    const input: CreateTenantRequest = { name: formData.name, slug: formData.slug, admin: { displayName: formData.adminDisplayName, email: formData.adminEmail, initialPassword: formData.initialPassword }, database: { databaseName: formData.databaseName, host: formData.host, port: Number(formData.port), secretRef: formData.secretRef, ssl: formData.ssl } };
    try {
      const response = await fetch('/api/platform/v1/tenants', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() }, body: JSON.stringify(input) });
      if (!response.ok) throw new Error(apiMessage(await response.json().catch(() => ({}))));
      const payload = (await response.json()) as CreateTenantResponse;
      onCreated(payload.tenant);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tạo tenant.');
    } finally { setBusy(false); }
  }

  return <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden p-0" showCloseButton={!busy}>
    <DialogHeader className="border-b px-6 pt-6 pb-5"><DialogTitle>Tạo Tenant mới</DialogTitle><DialogDescription>Hoàn tất từng bước. Dữ liệu đã nhập luôn được giữ khi quay lại.</DialogDescription></DialogHeader>
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <TenantStepper currentIndex={stepper.index} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {stepper.match({
          organization: () => <OrganizationFields formData={formData} onNameChange={updateName} update={update} />,
          administrator: () => <AdministratorFields formData={formData} update={update} />,
          database: () => <DatabaseFields formData={formData} update={update} />,
        })}
        {error ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p> : null}
      </div>
      <footer className="flex items-center justify-between border-t bg-slate-50 px-6 py-4">
        {stepper.canPrev ? <Button disabled={busy} onClick={() => { setError(undefined); void stepper.prev(); }} type="button" variant="outline"><ArrowLeft />Quay lại</Button> : <Button disabled={busy} onClick={() => onOpenChange(false)} type="button" variant="ghost">Hủy</Button>}
        {stepper.isLast ? <Button className="bg-[#091426] hover:bg-[#1e293b]" disabled={busy} type="submit">{busy ? 'Đang tạo…' : 'Tạo Tenant'}<ArrowRight /></Button> : <Button className="bg-[#091426] hover:bg-[#1e293b]" disabled={busy || !stepper.canNext} onClick={() => void next()} type="button">Tiếp tục<ArrowRight /></Button>}
      </footer>
    </form>
  </DialogContent>;
}

function TenantStepper({ currentIndex }: { currentIndex: number }) {
  return <ol className="grid grid-cols-3 gap-2 border-b bg-slate-50 px-6 py-4" aria-label="Tiến trình tạo tenant">{tenantCreateStepper.steps.map((step, index) => { const active = index === currentIndex; const complete = index < currentIndex; return <li className={cn('flex min-w-0 items-center gap-3', !active && 'opacity-50')} key={step.id}><span className={cn('grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold', active || complete ? 'border-[#091426] bg-[#091426] text-white' : 'border-slate-300 bg-white text-slate-500')}>{complete ? '✓' : index + 1}</span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{step.title}</p><p className="truncate text-xs text-muted-foreground">{step.description}</p></div></li>; })}</ol>;
}

function OrganizationFields({ formData, onNameChange, update }: { formData: TenantDraft; onNameChange: (name: string) => void; update: (patch: Partial<TenantDraft>) => void }) {
  return <FormSection description="Đây là định danh dùng xuyên suốt cho tenant và dedicated database." icon={Building2} title="Thông tin doanh nghiệp"><Field label="Tên doanh nghiệp"><Input autoFocus onChange={(event) => onNameChange(event.currentTarget.value)} value={formData.name} /></Field><Field label="Mã tenant"><Input onChange={(event) => update({ slug: event.currentTarget.value })} placeholder="vi-du-cong-ty" value={formData.slug} /></Field></FormSection>;
}

function AdministratorFields({ formData, update }: { formData: TenantDraft; update: (patch: Partial<TenantDraft>) => void }) {
  return <FormSection description="Tài khoản này được gán role tenant-admin sau khi provisioning hoàn tất." icon={ShieldCheck} title="Quản trị viên Tenant"><Field label="Họ và tên"><Input autoFocus onChange={(event) => update({ adminDisplayName: event.currentTarget.value })} value={formData.adminDisplayName} /></Field><Field label="Email công việc"><Input onChange={(event) => update({ adminEmail: event.currentTarget.value })} type="email" value={formData.adminEmail} /></Field><Field label="Mật khẩu tạm thời"><Input autoComplete="new-password" onChange={(event) => update({ initialPassword: event.currentTarget.value })} type="password" value={formData.initialPassword} /></Field><Field label="Xác nhận mật khẩu"><Input autoComplete="new-password" onChange={(event) => update({ confirmation: event.currentTarget.value })} type="password" value={formData.confirmation} /></Field></FormSection>;
}

function DatabaseFields({ formData, update }: { formData: TenantDraft; update: (patch: Partial<TenantDraft>) => void }) {
  return <FormSection description="Platform chỉ lưu secret reference; không lưu chuỗi kết nối database dưới dạng rõ." icon={Database} title="Dedicated Database"><Field label="Database name"><Input autoFocus onChange={(event) => update({ databaseName: event.currentTarget.value })} value={formData.databaseName} /></Field><Field label="Database host"><Input onChange={(event) => update({ host: event.currentTarget.value })} value={formData.host} /></Field><Field label="Port"><Input onChange={(event) => update({ port: event.currentTarget.value })} type="number" value={formData.port} /></Field><Field label="Secret reference"><Input onChange={(event) => update({ secretRef: event.currentTarget.value })} value={formData.secretRef} /></Field><label className="col-span-full flex items-center gap-2 text-sm font-medium text-slate-700"><input checked={formData.ssl} className="size-4" onChange={(event) => update({ ssl: event.currentTarget.checked })} type="checkbox" />Sử dụng SSL</label></FormSection>;
}

function FormSection({ description, icon: Icon, title, children }: { description: string; icon: typeof Building2; title: string; children: React.ReactNode }) {
  return <section><div className="mb-5"><div className="flex items-center gap-2"><Icon className="size-4 text-[#091426]" /><h2 className="font-semibold text-slate-900">{title}</h2></div><p className="mt-1 text-sm text-muted-foreground">{description}</p></div><div className="grid gap-5 sm:grid-cols-2">{children}</div></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm font-medium text-slate-700"><span>{label}</span>{children}</label>; }
