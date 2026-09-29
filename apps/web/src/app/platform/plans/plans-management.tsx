'use client';

import React, { useState, useMemo } from 'react';
import type { PlanSummary, PlanLimit } from '@enterprise-platform/contracts-tenancy';
import {
  PackageCheck,
  Plus,
  Search,
  Users,
  ShieldCheck,
  Settings2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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

      const res = await fetch('/api/platform/v1/plans', {
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
        <DialogContent className="max-w-2xl bg-white text-slate-900 border-slate-200">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900">
              Tạo mới gói dịch vụ (Service Plan)
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm">
              Định nghĩa mã gói, phân hệ cấp phép và chính sách hạn mức tài nguyên (Quota Policy).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreatePlan} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Thông tin cơ bản
                </h4>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">
                    Mã gói (Key) *
                  </label>
                  <Input
                    placeholder="e.g. professional"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    required
                    className="bg-slate-50 border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">
                    Tên hiển thị *
                  </label>
                  <Input
                    placeholder="e.g. Gói Chuyên Nghiệp"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                    className="bg-slate-50 border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">
                    Mô tả gói dịch vụ
                  </label>
                  <Input
                    placeholder="Mô tả phạm vi áp dụng..."
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="bg-slate-50 border-slate-200 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Phân hệ cấp phép (Modules)
                </h4>
                <div className="space-y-2 border border-slate-200 p-3 rounded-md bg-slate-50">
                  {[
                    { key: 'procedure-engine', label: 'Procedure Engine (Quy trình)' },
                    { key: 'maintenance', label: 'Maintenance (Bảo trì)' },
                    { key: 'inventory', label: 'Inventory (Kho & Tài sản)' },
                  ].map((m) => (
                    <label key={m.key} className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedModules.includes(m.key)}
                        onChange={() => toggleModule(m.key)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      {m.label}
                    </label>
                  ))}
                </div>

                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 pt-2">
                  Hạn mức Quota
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Người dùng</label>
                    <Input
                      type="number"
                      value={limitUsers}
                      onChange={(e) => setLimitUsers(e.target.value)}
                      className="bg-slate-50 border-slate-200 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Quy trình</label>
                    <Input
                      type="number"
                      value={limitProcedures}
                      onChange={(e) => setLimitProcedures(e.target.value)}
                      className="bg-slate-50 border-slate-200 text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                className="border-slate-200 text-slate-700"
              >
                Huỷ bỏ
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isSubmitting ? 'Đang lưu...' : 'Lưu gói dịch vụ'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
