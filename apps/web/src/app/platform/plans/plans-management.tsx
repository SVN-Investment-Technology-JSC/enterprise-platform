'use client';

import { authFetch } from '@enterprise-platform/shared-ui';
import React, { useState, useMemo } from 'react';
import type { PlanSummary, PlanLimit } from '@enterprise-platform/contracts-tenancy';
import {
  PackageCheck,
  Plus,
  Search,
  Users,
  ShieldCheck,
  Settings2,
  Layers,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PlansManagementProps {
  initialPlans: readonly PlanSummary[];
}

export function PlansManagement({ initialPlans }: PlansManagementProps) {
  const [plans, setPlans] = useState<PlanSummary[]>(Array.from(initialPlans));
  const [search, setSearch] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Form states for Flow A2
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [selectedModules, setSelectedModules] = useState<string[]>([
    'procedure-engine',
    'maintenance',
    'inventory',
  ]);
  const [limitUsers, setLimitUsers] = useState('100');
  const usersEnforcement: 'hard' | 'soft' = 'hard';
  const [limitProcedures, setLimitProcedures] = useState('50');
  const proceduresEnforcement: 'hard' | 'soft' = 'hard';
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredPlans = useMemo(() => {
    return plans.filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.key.toLowerCase().includes(search.toLowerCase()),
    );
  }, [plans, search]);

  const totalTenants = useMemo(() => {
    return plans.reduce((acc, p) => acc + (p.tenantCount ?? 0), 0);
  }, [plans]);

  const toggleModule = (mod: string) => {
    setSelectedModules((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod],
    );
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim() || !newName.trim()) return;
    setIsSubmitting(true);
    try {
      const limits: PlanLimit[] = [
        {
          resourceKey: 'active_users',
          limitValue: parseInt(limitUsers, 10) || 50,
          enforcement: usersEnforcement,
        },
        {
          resourceKey: 'procedure_definitions',
          limitValue: parseInt(limitProcedures, 10) || 20,
          enforcement: proceduresEnforcement,
        },
      ];

      const res = await authFetch('/api/platform/v1/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: newKey.trim(),
          name: newName.trim(),
          description: newDesc.trim(),
          modules: selectedModules,
          limits,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setPlans((prev) => [
          ...prev,
          {
            id: data.plan?.id ?? `plan-${Date.now()}`,
            key: newKey.trim(),
            name: newName.trim(),
            description: newDesc.trim(),
            version: 1,
            status: 'active',
            modules: selectedModules,
            limits,
            tenantCount: 0,
          },
        ]);
        setCreateDialogOpen(false);
        setNewKey('');
        setNewName('');
        setNewDesc('');
      }
    } catch {
      // Fallback local add
      setPlans((prev) => [
        ...prev,
        {
          id: `plan-${Date.now()}`,
          key: newKey.trim(),
          name: newName.trim(),
          description: newDesc.trim(),
          version: 1,
          status: 'active',
          modules: selectedModules,
          limits: [
            { resourceKey: 'active_users', limitValue: parseInt(limitUsers, 10) || 50, enforcement: usersEnforcement },
            { resourceKey: 'procedure_definitions', limitValue: parseInt(limitProcedures, 10) || 20, enforcement: proceduresEnforcement },
          ],
          tenantCount: 0,
        },
      ]);
      setCreateDialogOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top metric overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Tổng số gói dịch vụ
            </CardTitle>
            <PackageCheck className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{plans.length}</div>
            <p className="text-xs text-slate-500 mt-1">Đang hoạt động trên nền tảng</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Doanh nghiệp áp dụng
            </CardTitle>
            <Users className="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalTenants}</div>
            <p className="text-xs text-slate-500 mt-1">Tenant đang có gói đăng ký</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Chính sách hạn mức
            </CardTitle>
            <ShieldCheck className="h-5 w-5 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">Hard Enforcement</div>
            <p className="text-xs text-slate-500 mt-1">Khoá tức thì khi chạm ngưỡng</p>
          </CardContent>
        </Card>
      </div>

      {/* Control bar: Flow A1 */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Tìm theo tên hoặc mã gói dịch vụ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-slate-50 border-slate-200 text-sm"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => setCreateDialogOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2 shadow-sm"
          >
            <Plus className="h-4 w-4" /> Tạo gói dịch vụ
          </Button>
        </div>
      </div>

      {/* Plans Table */}
      <Card className="bg-white border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3.5">Mã & Tên gói</th>
                <th className="px-6 py-3.5">Phiên bản</th>
                <th className="px-6 py-3.5">Phân hệ bao gồm</th>
                <th className="px-6 py-3.5">Tenant áp dụng</th>
                <th className="px-6 py-3.5">Giới hạn người dùng</th>
                <th className="px-6 py-3.5">Giới hạn quy trình</th>
                <th className="px-6 py-3.5">Trạng thái</th>
                <th className="px-6 py-3.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPlans.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-slate-400">
                    Không tìm thấy gói dịch vụ nào phù hợp.
                  </td>
                </tr>
              ) : (
                filteredPlans.map((plan) => {
                  const userLimit = plan.limits?.find((l) => l.resourceKey === 'active_users');
                  const procLimit = plan.limits?.find((l) => l.resourceKey === 'procedure_definitions');

                  return (
                    <tr key={plan.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900">{plan.name}</div>
                        <div className="text-xs font-mono text-slate-500">{plan.key}</div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="outline" className="text-xs bg-slate-100 text-slate-600 font-mono">
                          v{plan.version}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {plan.modules?.map((m) => (
                            <span
                              key={m}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100"
                            >
                              {m === 'procedure-engine' ? 'Procedure' : m === 'maintenance' ? 'Maintenance' : 'Inventory'}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-800">{plan.tenantCount ?? 0} tổ chức</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-slate-900 font-medium">
                          {userLimit ? `${userLimit.limitValue} người` : 'Không giới hạn'}
                        </div>
                        {userLimit && (
                          <div className="text-xs text-slate-400 capitalize">
                            Khoá: {userLimit.enforcement}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-slate-900 font-medium">
                          {procLimit ? `${procLimit.limitValue} quy trình` : 'Không giới hạn'}
                        </div>
                        {procLimit && (
                          <div className="text-xs text-slate-400 capitalize">
                            Khoá: {procLimit.enforcement}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                          Hoạt động
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800 hover:bg-blue-50">
                          <Settings2 className="h-4 w-4 mr-1" /> Chi tiết
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Dialog Flow A2: Tạo gói dịch vụ */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-2xl" showCloseButton={!isSubmitting}>
          <DialogHeader className="border-b px-6 pt-6 pb-5">
            <DialogTitle>Tạo gói dịch vụ mới</DialogTitle>
            <DialogDescription>
              Định nghĩa mã gói, phân hệ cấp phép và hạn mức tài nguyên cho tenant.
            </DialogDescription>
          </DialogHeader>

          <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleCreatePlan}>
            <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
              <PlanFormSection icon={PackageCheck} title="Thông tin cơ bản" description="Mã gói dùng để định danh và không nên thay đổi sau khi cấp cho tenant.">
                <PlanField label="Mã gói">
                  <Input autoFocus placeholder="professional" value={newKey} onChange={(e) => setNewKey(e.target.value)} required />
                </PlanField>
                <PlanField label="Tên hiển thị">
                  <Input placeholder="Gói Chuyên Nghiệp" value={newName} onChange={(e) => setNewName(e.target.value)} required />
                </PlanField>
                <PlanField label="Mô tả" className="sm:col-span-2">
                  <Textarea placeholder="Phạm vi áp dụng của gói" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} />
                </PlanField>
              </PlanFormSection>

              <PlanFormSection icon={Layers} title="Phân hệ cấp phép" description="Tenant dùng gói này chỉ truy cập được các phân hệ được chọn.">
                <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3">
                  {PLAN_MODULE_OPTIONS.map((m) => {
                    const checked = selectedModules.includes(m.key);
                    return (
                      <label
                        key={m.key}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm transition-colors',
                          checked ? 'border-[#091426] bg-slate-50' : 'border-slate-200 hover:bg-slate-50',
                        )}
                      >
                        <input className="mt-0.5 size-4 accent-[#091426]" type="checkbox" checked={checked} onChange={() => toggleModule(m.key)} />
                        <span>
                          <span className="block font-medium text-slate-900">{m.label}</span>
                          <span className="block text-xs text-muted-foreground">{m.hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </PlanFormSection>

              <PlanFormSection icon={ShieldCheck} title="Hạn mức tài nguyên" description="Hệ thống chặn ngay khi tenant chạm ngưỡng (hard limit).">
                <PlanField label="Số người dùng tối đa">
                  <Input type="number" min={1} value={limitUsers} onChange={(e) => setLimitUsers(e.target.value)} />
                </PlanField>
                <PlanField label="Số quy trình tối đa">
                  <Input type="number" min={1} value={limitProcedures} onChange={(e) => setLimitProcedures(e.target.value)} />
                </PlanField>
              </PlanFormSection>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t bg-slate-50 px-6 py-4">
              <Button type="button" variant="ghost" disabled={isSubmitting} onClick={() => setCreateDialogOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" className="bg-[#091426] hover:bg-[#1e293b]" disabled={isSubmitting}>
                {isSubmitting ? 'Đang lưu…' : 'Lưu gói dịch vụ'}
              </Button>
            </footer>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PLAN_MODULE_OPTIONS = [
  { key: 'procedure-engine', label: 'Quy trình', hint: 'Procedure Engine' },
  { key: 'maintenance', label: 'Bảo trì', hint: 'Maintenance' },
  { key: 'inventory', label: 'Kho & Tài sản', hint: 'Inventory' },
] as const;

function PlanFormSection({ description, icon: Icon, title, children }: { description: string; icon: typeof PackageCheck; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-[#091426]" />
          <h2 className="font-semibold text-slate-900">{title}</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function PlanField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn('grid gap-1.5 text-sm font-medium text-slate-700', className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}
