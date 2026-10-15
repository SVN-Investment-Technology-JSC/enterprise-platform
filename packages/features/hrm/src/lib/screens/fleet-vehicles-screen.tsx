'use client';

import { Car, Pencil, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HrmFleetVehicle } from '@enterprise-platform/contracts-hrm';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { PageTitle } from '../ui/page-title';
import { EmptyPanel, InfoNote, SettingsField, StatusPill } from '../ui/settings-kit';
import { toast } from '../ui/toast';

interface VehicleForm {
  plateNo: string;
  name: string;
  seats: string;
  note: string;
}

const EMPTY_FORM: VehicleForm = { plateNo: '', name: '', seats: '4', note: '' };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Không thực hiện được thao tác.';
}

/** Danh mục xe công ty. Xe ngừng sử dụng không còn xuất hiện khi chọn xe trên đơn; lịch cũ giữ nguyên. */
export default function FleetVehiclesScreen() {
  const [vehicles, setVehicles] = useState<HrmFleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HrmFleetVehicle | null>(null);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setVehicles((await hrmFetch<{ data: HrmFleetVehicle[] }>('/fleet/vehicles')).data);
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return vehicles.filter((v) => !needle || v.plateNo.toLowerCase().includes(needle) || v.name.toLowerCase().includes(needle));
  }, [vehicles, search]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setDialogOpen(true);
  }

  function openEdit(vehicle: HrmFleetVehicle) {
    setEditing(vehicle);
    setForm({ plateNo: vehicle.plateNo, name: vehicle.name, seats: String(vehicle.seats), note: vehicle.note ?? '' });
    setFormError('');
    setDialogOpen(true);
  }

  async function save() {
    const seats = Number(form.seats);
    if (!form.plateNo.trim() || !form.name.trim()) {
      setFormError('Nhập biển số và tên xe.');
      return;
    }
    if (!Number.isInteger(seats) || seats < 1 || seats > 100) {
      setFormError('Số chỗ ngồi từ 1 đến 100.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const body = JSON.stringify({ plateNo: form.plateNo.trim(), name: form.name.trim(), seats, note: form.note.trim() || null });
      if (editing) await hrmFetch(`/fleet/vehicles/${editing.id}`, { method: 'PATCH', body });
      else await hrmFetch('/fleet/vehicles', { method: 'POST', body });
      toast.success(editing ? `Đã cập nhật xe ${form.plateNo.trim()}.` : `Đã thêm xe ${form.plateNo.trim()}.`);
      setDialogOpen(false);
      await load();
    } catch (error) {
      setFormError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(vehicle: HrmFleetVehicle, status: 'ACTIVE' | 'INACTIVE') {
    try {
      await hrmFetch(`/fleet/vehicles/${vehicle.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast.success(status === 'ACTIVE' ? `Đã kích hoạt lại xe ${vehicle.plateNo}.` : `Đã ngừng sử dụng xe ${vehicle.plateNo}.`);
      await load();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  return (
    <div className="@container mx-auto max-w-[1400px] space-y-4">
      <PageTitle
        title="Danh mục xe"
        description="Xe công ty có thể được chọn khi làm đơn công tác, công việc, lịch họp và phiếu sự cố."
        withTabs
        actions={
          <Button permission="hrm.fleet.manage" className="h-9 gap-1.5 px-4 text-xs font-semibold" onClick={openCreate}>
            <Plus className="size-4" aria-hidden />
            Thêm xe
          </Button>
        }
      />

      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              aria-label="Tìm biển số hoặc tên xe"
              placeholder="Tìm biển số, tên xe..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9 text-xs"
            />
          </div>
        </div>

        {loadError ? (
          <div className="p-3">
            <InfoNote tone="red" role="alert">
              {loadError}
            </InfoNote>
          </div>
        ) : loading ? (
          <div role="status" className="p-6 text-sm text-slate-500">
            Đang tải danh mục xe…
          </div>
        ) : !filtered.length ? (
          <EmptyPanel icon={Car} title={vehicles.length ? 'Không có xe nào phù hợp.' : 'Chưa có xe nào trong danh mục.'} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((vehicle) => (
              <li key={vehicle.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-slate-900">{vehicle.plateNo}</span>
                    <StatusPill tone={vehicle.status === 'ACTIVE' ? 'green' : 'slate'}>
                      {vehicle.status === 'ACTIVE' ? 'Đang sử dụng' : 'Ngừng sử dụng'}
                    </StatusPill>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {vehicle.name} · {vehicle.seats} chỗ{vehicle.note ? ` · ${vehicle.note}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button variant="outline" permission="hrm.fleet.manage" className="h-9 gap-1.5 px-3 text-xs" onClick={() => openEdit(vehicle)}>
                    <Pencil className="size-3.5" aria-hidden />
                    Sửa
                  </Button>
                  {vehicle.status === 'ACTIVE' ? (
                    <Popconfirm
                      title={`Ngừng sử dụng xe ${vehicle.plateNo}?`}
                      description="Xe không còn xuất hiện khi chọn xe. Lịch đã đặt trước đó giữ nguyên."
                      okText="Ngừng sử dụng"
                      cancelText="Không"
                      okType="danger"
                      placement="top-end"
                      onConfirm={() => setStatus(vehicle, 'INACTIVE')}
                    >
                      <Button variant="outline" permission="hrm.fleet.manage" className="h-9 border-amber-300 px-3 text-xs text-amber-700 hover:bg-amber-50">
                        Ngừng sử dụng
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button
                      variant="outline"
                      permission="hrm.fleet.manage"
                      className="h-9 border-blue-200 px-3 text-xs text-blue-700 hover:bg-blue-50"
                      onClick={() => void setStatus(vehicle, 'ACTIVE')}
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
        <DialogContent className="max-h-[90dvh] max-w-lg gap-0 bg-white p-0" aria-label={editing ? 'Cập nhật xe' : 'Thêm xe'}>
          <DialogHeader className="shrink-0 border-b border-slate-200 px-5 py-4 pr-12">
            <DialogTitle>{editing ? `Cập nhật xe: ${editing.plateNo}` : 'Thêm xe mới'}</DialogTitle>
            <DialogDescription>Biển số không được trùng với xe khác trong danh mục.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
            {formError ? (
              <InfoNote tone="red" role="alert">
                {formError}
              </InfoNote>
            ) : null}
            <SettingsField label="Biển số" required htmlFor="fleet-plate">
              <Input
                id="fleet-plate"
                placeholder="Ví dụ: 51A-123.45"
                value={form.plateNo}
                onChange={(e) => setForm({ ...form, plateNo: e.target.value.toUpperCase() })}
                className="h-9 font-mono text-xs font-bold"
              />
            </SettingsField>
            <SettingsField label="Tên xe" required htmlFor="fleet-name">
              <Input
                id="fleet-name"
                placeholder="Ví dụ: Toyota Innova"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-9 text-xs"
              />
            </SettingsField>
            <SettingsField label="Số chỗ ngồi" required htmlFor="fleet-seats">
              <Input
                id="fleet-seats"
                inputMode="numeric"
                value={form.seats}
                onChange={(e) => setForm({ ...form, seats: e.target.value.replace(/\D/g, '') })}
                className="h-9 w-28 text-xs"
              />
            </SettingsField>
            <SettingsField label="Ghi chú" htmlFor="fleet-note">
              <Input
                id="fleet-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
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
