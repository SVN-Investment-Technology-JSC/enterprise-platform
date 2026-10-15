'use client';

import { Pencil, Plus, UserRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { HrmFleetDriver } from '@enterprise-platform/contracts-hrm';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmEmployeeOptions, hrmFetch, type EmployeeOption } from '../hrm-api';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { PageTitle } from '../ui/page-title';
import { EmptyPanel, InfoNote, SettingsField, StatusPill } from '../ui/settings-kit';
import { toast } from '../ui/toast';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Không thực hiện được thao tác.';
}

/** Tài xế chuyên trách: chọn từ danh sách nhân viên. Tài xế ngừng hoạt động không còn xuất hiện khi chọn. */
export default function FleetDriversScreen() {
  const [drivers, setDrivers] = useState<HrmFleetDriver[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HrmFleetDriver | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [licenseNo, setLicenseNo] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setDrivers((await hrmFetch<{ data: HrmFleetDriver[] }>('/fleet/drivers')).data);
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setEmployeeId('');
    setLicenseNo('');
    setFormError('');
    setDialogOpen(true);
    // Danh sách nhân viên chỉ cần khi thêm tài xế mới.
    hrmEmployeeOptions().then(setEmployees, (error) => setFormError(errorText(error)));
  }

  function openEdit(driver: HrmFleetDriver) {
    setEditing(driver);
    setEmployeeId(driver.employeeId);
    setLicenseNo(driver.licenseNo ?? '');
    setFormError('');
    setDialogOpen(true);
  }

  async function save() {
    if (!editing && !employeeId) {
      setFormError('Chọn nhân viên làm tài xế.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const license = licenseNo.trim() || null;
      if (editing) {
        await hrmFetch(`/fleet/drivers/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ licenseNo: license }) });
        toast.success('Đã cập nhật tài xế.');
      } else {
        await hrmFetch('/fleet/drivers', { method: 'POST', body: JSON.stringify({ employeeId, licenseNo: license }) });
        toast.success('Đã thêm tài xế.');
      }
      setDialogOpen(false);
      await load();
    } catch (error) {
      setFormError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(driver: HrmFleetDriver, status: 'ACTIVE' | 'INACTIVE') {
    try {
      await hrmFetch(`/fleet/drivers/${driver.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast.success(status === 'ACTIVE' ? 'Đã kích hoạt lại tài xế.' : 'Đã ngừng hoạt động tài xế.');
      await load();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  const taken = new Set(drivers.map((d) => d.employeeId));

  return (
    <div className="@container mx-auto max-w-[1400px] space-y-4">
      <PageTitle
        title="Tài xế"
        description="Tài xế chuyên trách được chọn cùng xe khi đặt lịch. Hệ thống chặn trùng lịch cả theo xe lẫn theo tài xế."
        withTabs
        actions={
          <Button permission="hrm.fleet.manage" className="h-9 gap-1.5 px-4 text-xs font-semibold" onClick={openCreate}>
            <Plus className="size-4" aria-hidden />
            Thêm tài xế
          </Button>
        }
      />

      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loadError ? (
          <div className="p-3">
            <InfoNote tone="red" role="alert">
              {loadError}
            </InfoNote>
          </div>
        ) : loading ? (
          <div role="status" className="p-6 text-sm text-slate-500">
            Đang tải danh sách tài xế…
          </div>
        ) : !drivers.length ? (
          <EmptyPanel icon={UserRound} title="Chưa có tài xế nào." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {drivers.map((driver) => (
              <li key={driver.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{driver.employeeName ?? 'Nhân viên đã xóa'}</span>
                    <StatusPill tone={driver.status === 'ACTIVE' ? 'green' : 'slate'}>
                      {driver.status === 'ACTIVE' ? 'Đang hoạt động' : 'Ngừng hoạt động'}
                    </StatusPill>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {driver.employeeCode ?? ''}
                    {driver.licenseNo ? ` · Bằng lái ${driver.licenseNo}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button variant="outline" permission="hrm.fleet.manage" className="h-9 gap-1.5 px-3 text-xs" onClick={() => openEdit(driver)}>
                    <Pencil className="size-3.5" aria-hidden />
                    Sửa
                  </Button>
                  {driver.status === 'ACTIVE' ? (
                    <Popconfirm
                      title="Ngừng hoạt động tài xế này?"
                      description="Tài xế không còn xuất hiện khi chọn. Lịch đã đặt trước đó giữ nguyên."
                      okText="Ngừng hoạt động"
                      cancelText="Không"
                      okType="danger"
                      placement="top-end"
                      onConfirm={() => setStatus(driver, 'INACTIVE')}
                    >
                      <Button variant="outline" permission="hrm.fleet.manage" className="h-9 border-amber-300 px-3 text-xs text-amber-700 hover:bg-amber-50">
                        Ngừng hoạt động
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button
                      variant="outline"
                      permission="hrm.fleet.manage"
                      className="h-9 border-blue-200 px-3 text-xs text-blue-700 hover:bg-blue-50"
                      onClick={() => void setStatus(driver, 'ACTIVE')}
                    >
                      Kích hoạt lại
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg gap-0 bg-white p-0" aria-label={editing ? 'Cập nhật tài xế' : 'Thêm tài xế'}>
          <DialogHeader className="shrink-0 border-b border-slate-200 px-5 py-4 pr-12">
            <DialogTitle>{editing ? `Cập nhật tài xế: ${editing.employeeName ?? ''}` : 'Thêm tài xế mới'}</DialogTitle>
            <DialogDescription>Tài xế là nhân viên đang có hồ sơ trong HRM.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
            {formError ? (
              <InfoNote tone="red" role="alert">
                {formError}
              </InfoNote>
            ) : null}
            {editing ? null : (
              <SettingsField label="Nhân viên" required htmlFor="fleet-driver-employee">
                <SearchableSelect
                  height={36}
                  placeholder="Chọn nhân viên"
                  searchPlaceholder="Tìm theo mã hoặc tên"
                  options={employees.map((e) => ({ value: e.value, label: e.label, disabled: taken.has(e.value) }))}
                  value={employeeId}
                  onChange={setEmployeeId}
                />
              </SettingsField>
            )}
            <SettingsField label="Số bằng lái" htmlFor="fleet-driver-license">
              <Input
                id="fleet-driver-license"
                value={licenseNo}
                onChange={(e) => setLicenseNo(e.target.value)}
                className="h-9 text-xs"
              />
            </SettingsField>
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <Button variant="outline" className="h-9 px-4 text-xs" onClick={() => setDialogOpen(false)}>
              Hủy
            </Button>
            <Button className="h-9 px-4 text-xs font-semibold" disabled={saving} onClick={() => void save()}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
