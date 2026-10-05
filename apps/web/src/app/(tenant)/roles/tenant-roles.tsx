'use client';

import React, { useState, useMemo } from 'react';
import type { TenantRoleSummary } from '@enterprise-platform/contracts-tenancy';
import {
  Shield,
  Plus,
  Search,
  Users,
  Lock,
  UserCheck,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface TenantRolesProps {
  initialRoles: readonly TenantRoleSummary[];
}

export function TenantRoles({ initialRoles }: TenantRolesProps) {
  const [roles, setRoles] = useState<TenantRoleSummary[]>(Array.from(initialRoles));
  const [search, setSearch] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [assignDrawerOpen, setAssignDrawerOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<TenantRoleSummary | null>(null);

  // Form states
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedModules, setSelectedModules] = useState<string[]>([
    'procedure-engine',
  ]);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([
    'procedure.read',
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredRoles = useMemo(() => {
    return roles.filter(
      (r) =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.code.toLowerCase().includes(search.toLowerCase()),
    );
  }, [roles, search]);

  const toggleModule = (mod: string) => {
    setSelectedModules((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod],
    );
  };

  const togglePermission = (perm: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    );
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/platform/v1/tenant-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim().toLowerCase(),
          name: name.trim(),
          description: description.trim(),
          modules: selectedModules,
          permissions: selectedPermissions,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setRoles((prev) => [
          ...prev,
          {
            id: data.role?.id ?? `role-${Date.now()}`,
            code: code.trim().toLowerCase(),
            name: name.trim(),
            description: description.trim(),
            isSystem: false,
            status: 'active',
            modules: selectedModules,
            permissions: selectedPermissions,
            userCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]);
        setCreateDialogOpen(false);
        setCode('');
        setName('');
        setDescription('');
      }
    } catch {
      // Local fallback
      setRoles((prev) => [
        ...prev,
        {
          id: `role-${Date.now()}`,
          code: code.trim().toLowerCase(),
          name: name.trim(),
          description: description.trim(),
          isSystem: false,
          status: 'active',
          modules: selectedModules,
          permissions: selectedPermissions,
          userCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      setCreateDialogOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Tổng số vai trò
            </CardTitle>
            <Shield className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{roles.length}</div>
            <p className="text-xs text-slate-500 mt-1">Được định nghĩa trong tổ chức</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Vai trò hệ thống
            </CardTitle>
            <Lock className="h-5 w-5 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {roles.filter((r) => r.isSystem).length}
            </div>
            <p className="text-xs text-slate-500 mt-1">Chuẩn bảo mật, không thể xoá</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Vai trò tuỳ chỉnh
            </CardTitle>
            <Users className="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {roles.filter((r) => !r.isSystem).length}
            </div>
            <p className="text-xs text-slate-500 mt-1">Phân quyền theo vị trí thực tế</p>
          </CardContent>
        </Card>
      </div>

      {/* Control bar: Flow B1 */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Tìm theo tên hoặc mã vai trò..."
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
            <Plus className="h-4 w-4" /> Tạo vai trò mới
          </Button>
        </div>
      </div>

      {/* Roles Table */}
      <Card className="bg-white border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3.5">Mã & Tên vai trò</th>
                <th className="px-6 py-3.5">Mô tả</th>
                <th className="px-6 py-3.5">Loại vai trò</th>
                <th className="px-6 py-3.5">Phân hệ được phép</th>
                <th className="px-6 py-3.5">Người dùng gán</th>
                <th className="px-6 py-3.5">Trạng thái</th>
                <th className="px-6 py-3.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRoles.map((role) => (
                <tr key={role.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-slate-900">{role.name}</div>
                    <div className="text-xs font-mono text-slate-500">{role.code}</div>
                  </td>
                  <td className="px-6 py-4 max-w-xs truncate text-slate-600">
                    {role.description || '—'}
                  </td>
                  <td className="px-6 py-4">
                    {role.isSystem ? (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                        Hệ thống
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200 text-xs">
                        Tuỳ chỉnh
                      </Badge>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {role.modules?.map((m) => (
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
                    <div className="font-medium text-slate-800">{role.userCount ?? 0} người</div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                      Hoạt động
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedRole(role);
                          setAssignDrawerOpen(true);
                        }}
                        className="text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                      >
                        <UserCheck className="h-4 w-4 mr-1" /> Phân bổ
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Dialog Flow B2: Tạo mới vai trò */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl bg-white text-slate-900 border-slate-200">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900">
              Tạo mới vai trò người dùng (Role)
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm">
              Thiết lập mã vai trò, phân hệ được phép truy cập và ma trận quyền hạn tương ứng.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateRole} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Thông tin vai trò
                </h4>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">
                    Mã vai trò (Code) *
                  </label>
                  <Input
                    placeholder="e.g. maintenance-tech"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    className="bg-slate-50 border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">
                    Tên hiển thị *
                  </label>
                  <Input
                    placeholder="e.g. Kỹ thuật viên bảo trì"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="bg-slate-50 border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">
                    Mô tả chức năng
                  </label>
                  <Input
                    placeholder="Mô tả trách nhiệm của vai trò..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="bg-slate-50 border-slate-200 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Phân hệ được phép
                </h4>
                <div className="space-y-2 border border-slate-200 p-3 rounded-md bg-slate-50">
                  {[
                    { key: 'procedure-engine', label: 'Procedure Engine' },
                    { key: 'maintenance', label: 'Maintenance' },
                    { key: 'inventory', label: 'Inventory' },
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

                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 pt-1">
                  Quyền chi tiết
                </h4>
                <p className="text-xs text-slate-500">
                  Hành động HRM (hrm.*) và các hành động khác không chọn ở đây. Hãy tạo Permission chứa
                  hành động hrm.* tại <a className="text-blue-600 underline" href="/authorization">Phân quyền</a>,
                  sau đó gắn vào vai trò. Có thể dùng nút &quot;Tạo vai trò mẫu HRM&quot; ở Danh mục quyền HRM.
                </p>
                <div className="space-y-2 border border-slate-200 p-3 rounded-md bg-slate-50 max-h-36 overflow-y-auto">
                  {[
                    { key: 'procedure.read', label: 'Đọc quy trình' },
                    { key: 'procedure.manage', label: 'Quản lý quy trình' },
                    { key: 'maintenance.read', label: 'Đọc kế hoạch bảo trì' },
                    { key: 'maintenance.manage', label: 'Quản lý bảo trì' },
                    { key: 'inventory.read', label: 'Xem tồn kho' },
                    { key: 'inventory.transaction.write', label: 'Ghi nhận giao dịch kho' },
                  ].map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedPermissions.includes(p.key)}
                        onChange={() => togglePermission(p.key)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      {p.label} <span className="text-slate-400 font-mono text-[10px]">({p.key})</span>
                    </label>
                  ))}
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
                {isSubmitting ? 'Đang lưu...' : 'Lưu vai trò'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Drawer Flow B3: Gán vai trò */}
      <Sheet open={assignDrawerOpen} onOpenChange={setAssignDrawerOpen}>
        <SheetContent className="w-full sm:max-w-lg bg-white border-l border-slate-200 p-6">
          <SheetHeader>
            <SheetTitle className="text-lg font-bold text-slate-900">
              Phân bổ người dùng cho: {selectedRole?.name}
            </SheetTitle>
            <SheetDescription className="text-slate-500 text-sm">
              Xem danh sách nhân sự đang được gán vai trò này và điều chỉnh phân quyền nhanh.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1">
              <div><span className="font-semibold text-slate-700">Mã vai trò:</span> <code className="text-blue-700 font-mono">{selectedRole?.code}</code></div>
              <div><span className="font-semibold text-slate-700">Phân hệ:</span> {selectedRole?.modules.join(', ')}</div>
              <div><span className="font-semibold text-slate-700">Số lượng nhân sự hiện tại:</span> {selectedRole?.userCount ?? 0} người</div>
            </div>

            <div className="border border-slate-200 rounded-lg p-4 bg-white text-center py-8">
              <UserCheck className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-700">Danh sách nhân sự trực thuộc</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                Nhân sự được gán tự động thừa hưởng quyền truy cập vào các phân hệ đã chọn theo hợp đồng phân quyền kép.
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
