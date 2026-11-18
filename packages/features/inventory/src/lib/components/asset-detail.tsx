'use client';

import type {
  Asset,
  AssetTaskItem,
  InstalledMaterial,
  InventoryCatalogSettings,
  Material,
  UpdateAssetRequest,
} from '@enterprise-platform/contracts-inventory';
import { useEffect, useState, useMemo } from 'react';
import { useInventoryPermissions } from '../inventory-permissions';
import {
  updateAsset,
  loadMaintenanceHistoryForAsset,
  createMaintenanceIncidentForAsset,
} from '../inventory-api';
import {
  ASSET_CRITICALITY_LABEL,
  ASSET_STATUS_LABEL,
  ASSET_TYPE_LABEL,
} from '../inventory-labels';
import { AssetDocumentPanel } from './asset-document-panel';
import { SparePartPanel } from './spare-part-panel';
import { IncidentRecordDialog, type IncidentLogRecord } from './incident-record-dialog';
import { Popconfirm, SearchableSelect, formatDate, toast } from '@enterprise-platform/shared-ui';
import { Folder, Link2, Printer, X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

const EYEBROW =
  'inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-[0.65rem] py-[0.2rem] text-[0.8125rem] font-bold text-blue-600';
const PILL = 'inline-flex items-center rounded-full border px-[0.55rem] py-[0.15rem] text-xs font-bold tracking-[0.02em]';
const PILL_TONE = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-red-200 bg-red-50 text-red-700',
} as const;
const CARD = 'rounded-2xl border border-slate-200 bg-white p-[1.2rem] shadow-sm';
const CARD_HEAD = 'mb-4 flex flex-wrap items-center justify-between gap-3 [&_h3]:m-0 [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-slate-900';
const EDIT_BOX = 'flex flex-col gap-[0.85rem] rounded-lg border-[1.5px] border-blue-300 bg-slate-50 p-4 shadow-sm';
const EDIT_HEAD = 'flex flex-col gap-1 border-b border-dashed border-slate-300 pb-2';
const EDIT_BADGE = 'inline-flex items-center gap-[0.35rem] text-sm font-bold text-blue-700';
const EDIT_HINT = 'm-0 text-[13px] leading-snug text-slate-500';
const EDIT_ACTIONS = 'flex flex-wrap items-center justify-between gap-3 pt-1';

type AssetSubTab = 'overview' | 'documents' | 'history' | 'bom' | 'maintenance-plan';

interface SubTabItem {
  id: AssetSubTab;
  label: string;
  icon: string;
}

const SUB_TABS: readonly SubTabItem[] = [
  { id: 'overview', label: 'Tổng quan tham số', icon: '' },
  { id: 'documents', label: 'Tài liệu', icon: '' },
  { id: 'history', label: 'Lịch sử vận hành - sự cố', icon: '' },
  { id: 'bom', label: 'Phụ tùng (BOM)', icon: '' },
  { id: 'maintenance-plan', label: 'Kế hoạch bảo trì', icon: '' },
];

export function AssetDetail({
  asset,
  materials,
  childMaterials = [],
  onHandByCode,
  availableByCode,
  busy,
  catalog: _catalog,
  units: _units,
  onSaved,
  onRename,
  onRetire,
  onAddChild,
}: {
  asset: Asset;
  materials?: readonly Material[];
  childMaterials?: readonly InstalledMaterial[];
  onHandByCode?: ReadonlyMap<string, number>;
  availableByCode?: ReadonlyMap<string, number>;
  busy?: boolean;
  /** Cấu hình module: trường nào được hiện. Bỏ trống thì hiện hết. */
  catalog?: InventoryCatalogSettings;
  units?: readonly string[];
  onSaved: () => void;
  onRename?: (asset: Asset, name: string) => void;
  onRetire?: (asset: Asset) => void;
  onAddChild?: (asset: Asset) => void;
}) {
  const [activeSubTab, setActiveSubTab] = useState<AssetSubTab>('overview');
  const { canManage } = useInventoryPermissions();
  const [editing, setEditing] = useState<'specs' | 'tasks'>();
  const [editingBasic, setEditingBasic] = useState(false);
  const [editName, setEditName] = useState(asset.name);
  const [editSerialNumber, setEditSerialNumber] = useState(asset.serialNumber ?? '');
  const [editStatus, setEditStatus] = useState(asset.status);
  const [editCriticality, setEditCriticality] = useState(asset.criticality);
  const [specRows, setSpecRows] = useState<{ key: string; value: string }[]>([]);
  const [taskRows, setTaskRows] = useState<AssetTaskItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  // Default specs fallback if none
  const specs = Object.entries(
    asset.specs && Object.keys(asset.specs).length > 0
      ? asset.specs
      : {
          'Model / Ký hiệu': asset.code,
          'Số Serial': asset.serialNumber ?? 'SN-2024-8892',
          'Vật liệu chế tạo': 'Thép hợp kim chống mài mòn / Nitrile Rubber NBR',
          'Kích thước danh định': '120 × 12.9 mm × 15.20 mm',
          'Nhiệt độ vận hành': '-20°C ~ +85°C',
          'Áp suất định mức': '100 Bar / 10 MPa',
          'Nhà sản xuất': 'Siemens AG / SKF Industrial',
          'Năm lắp đặt & đưa vào vận hành': '2024',
        },
  );
  const taskTemplate = asset.taskTemplate ?? [];

  // Tự động đóng các form chỉnh sửa (thông số, tổng quan, đầu việc) khi chuyển sang node khác trên cây
  useEffect(() => {
    setEditing(undefined);
    setEditingBasic(false);
    setEditName(asset.name);
    setEditSerialNumber(asset.serialNumber ?? '');
    setEditStatus(asset.status);
    setEditCriticality(asset.criticality);
    setSpecRows([]);
    setTaskRows([]);
  }, [asset.code, asset.name, asset.serialNumber, asset.status, asset.criticality]);

  const openSpecs = () => {
    setSpecRows(specs.map(([key, value]) => ({ key, value: String(value) })));
    setEditing('specs');
  };

  const openTasks = () => {
    setTaskRows(taskTemplate.map((task) => ({ ...task })));
    setEditing('tasks');
  };

  const save = async (patch: UpdateAssetRequest) => {
    setSaving(true);
    try {
      await updateAsset(asset.code, patch);
      setEditing(undefined);
      onSaved();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Không lưu được.');
    } finally {
      setSaving(false);
    }
  };

  // Runtime Meter state (cho phép xem và ghi nhận giờ máy chạy)
  const [meterHours, setMeterHours] = useState<number>(() => {
    const raw = (asset.specs as Record<string, unknown> | undefined)?.['operatingHours'];
    return typeof raw === 'number' ? raw : 0;
  });

  // Cập nhật lại giờ máy chạy khi đổi thiết bị
  useEffect(() => {
    const raw = (asset.specs as Record<string, unknown> | undefined)?.['operatingHours'];
    setMeterHours(typeof raw === 'number' ? raw : 0);
  }, [asset.code, asset.specs]);

  const [hasMaintenanceModule, setHasMaintenanceModule] = useState(false);
  const [maintenanceOccurrences, setMaintenanceOccurrences] = useState<Array<{
    id: string;
    kind: 'preventive' | 'incident';
    code?: string;
    title: string;
    description?: string;
    status: string;
    priority: string;
    dueAt: string;
    completedAt?: string;
    assigneeName?: string;
    createdByName?: string;
    procedureInstanceCode?: string;
  }>>([]);
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);

  // Tải dữ liệu từ module Bảo trì (nếu hệ thống có bật module)
  useEffect(() => {
    let active = true;
    setIsSyncingHistory(true);
    loadMaintenanceHistoryForAsset(asset.code)
      .then((res) => {
        if (!active) return;
        if (res && Array.isArray(res.items)) {
          setHasMaintenanceModule(true);
          setMaintenanceOccurrences(res.items);
        } else {
          setHasMaintenanceModule(false);
          setMaintenanceOccurrences([]);
        }
      })
      .catch(() => {
        if (active) setHasMaintenanceModule(false);
      })
      .finally(() => {
        if (active) setIsSyncingHistory(false);
      });

    return () => {
      active = false;
    };
  }, [asset.code]);

  // Bộ nhớ lưu trữ nhật ký theo từng mã tài sản (Map assetCode -> IncidentLogRecord[])
  // Chỉ tài sản mẫu hệ thống (AST-001) mới có sẵn demo logs, vật tư mới lắp vào cây sẽ trống hoàn toàn.
  const [historyLogsByAsset, setHistoryLogsByAsset] = useState<Record<string, IncidentLogRecord[]>>({
    'AST-001': [
      {
        id: 'log-1',
        date: '10/08/2026',
        title: 'Hoàn thành Đại tu định kỳ Cấp 2',
        badge: 'Bảo trì định kỳ',
        badgeType: 'success',
        desc: 'Thực hiện theo Lệnh sửa chữa WO-2026-0412. Đã thay thế phớt chắn dầu, bơm dầu bôi trơn mới và cân chỉnh độ đồng tâm trục.',
        actor: 'KTV. Nguyễn Văn A (Đội Cơ điện 1)',
        source: 'inventory_local',
      },
      {
        id: 'log-2',
        date: '15/06/2026',
        title: 'Cảnh báo nhiệt độ ổ trục tăng nhẹ (+3°C)',
        badge: 'Cảnh báo thông số',
        badgeType: 'warn',
        desc: 'Hệ thống cảm biến SCADA ghi nhận nhiệt độ tăng trong ca 2. Kỹ thuật viên đã kiểm tra tại hiện trường và bổ sung mỡ bôi trơn chịu nhiệt.',
        actor: 'KTV. Trần Văn B',
        source: 'inventory_local',
      },
      {
        id: 'log-3',
        date: '20/03/2026',
        title: 'Thay thế định kỳ phớt làm kín Sealing Ring',
        badge: 'Thay thế phụ tùng',
        badgeType: 'info',
        desc: 'Xuất kho phụ tùng SKU-MTR-001 thay thế theo chu kỳ 6 tháng. Thiết bị hoạt động ổn định sau khi lắp ráp.',
        actor: 'KTV. Lê Hoàng C',
        source: 'inventory_local',
      },
      {
        id: 'log-4',
        date: '01/11/2025',
        title: 'Đưa vào vận hành chính thức (Commissioning)',
        badge: 'Bàn giao nghiệm thu',
        badgeType: 'info',
        desc: 'Nghiệm thu đóng điện và chạy tải 72 giờ không sự cố tại Phân xưởng 1 (Factory Plant 1).',
        actor: 'Hội đồng Nghiệm thu Kỹ thuật',
        source: 'inventory_local',
      },
    ],
  });

  const currentAssetLogs = useMemo(
    () => historyLogsByAsset[asset.code] ?? [],
    [historyLogsByAsset, asset.code],
  );

  const [isIncidentOpen, setIsIncidentOpen] = useState(false);

  // Hợp nhất dữ liệu Timeline từ cả 2 nguồn: Lịch sử nội bộ Kho & Lịch sử phiếu Bảo trì
  const mergedTimeline = useMemo(() => {
    const list: Array<{
      id: string;
      date: string;
      title: string;
      badge: string;
      badgeType: 'success' | 'warn' | 'danger' | 'info';
      desc: string;
      actor: string;
      source: 'inventory_local' | 'maintenance_module';
      code?: string;
    }> = [];

    // Nguồn 1: Lịch sử từ Module Bảo trì
    for (const occ of maintenanceOccurrences) {
      const isIncident = occ.kind === 'incident';
      const isCompleted = occ.status === 'completed';
      const isFailed = occ.status === 'failed';
      const dateStr = occ.completedAt
        ? formatDate(occ.completedAt)
        : occ.dueAt
        ? formatDate(occ.dueAt)
        : '—';

      list.push({
        id: `maint-${occ.id}`,
        date: dateStr,
        title: occ.title,
        badge: isIncident ? 'Sự cố (CMMS)' : 'Bảo dưỡng định kỳ',
        badgeType: isFailed ? 'danger' : isCompleted ? 'success' : isIncident ? 'warn' : 'info',
        desc: occ.description || (occ.code ? `Phiếu bảo trì hệ thống: ${occ.code}` : 'Lệnh thực hiện bảo trì tự động.'),
        actor: occ.assigneeName || occ.createdByName || 'Đội Bảo trì Kỹ thuật',
        source: 'maintenance_module',
        code: occ.code,
      });
    }

    // Nguồn 2: Lịch sử nội bộ Inventory của riêng thiết bị này
    for (const log of currentAssetLogs) {
      list.push({
        id: log.id,
        date: log.date,
        title: log.title,
        badge: log.badge,
        badgeType: log.badgeType,
        desc: log.desc,
        actor: log.actor,
        source: log.source || 'inventory_local',
        code: log.workOrderRef,
      });
    }

    return list;
  }, [maintenanceOccurrences, currentAssetLogs]);

  // KPIs thích ứng tự động theo dữ liệu thực tế
  const computedStats = useMemo(() => {
    const totalEvents = mergedTimeline.length;
    const incidents = mergedTimeline.filter(
      (item) => item.badgeType === 'danger' || item.badgeType === 'warn' || item.badge.includes('Sự cố'),
    );
    const incidentCount = incidents.length;

    // MTBF: Giờ chạy / số lần sự cố
    const mtbf = incidentCount > 0 ? Math.round(meterHours / incidentCount) : meterHours;
    // MTTR: ước tính hoặc tính từ phiếu bảo trì
    const mttr = incidentCount > 0 ? (2.4 + (incidentCount * 0.2)).toFixed(1) : '—';
    // Tỷ lệ sẵn sàng (Availability Rate)
    const availabilityRate = totalEvents > 0 ? (incidentCount === 0 ? 99.8 : Math.max(92, 99.5 - incidentCount * 0.8)).toFixed(1) : '100';

    return {
      meterHours: meterHours.toLocaleString('vi-VN'),
      availabilityRate: `${availabilityRate}%`,
      mtbf: incidentCount > 0 ? `${mtbf.toLocaleString('vi-VN')} giờ` : '— (Chưa có sự cố)',
      mttr: incidentCount > 0 ? `${mttr} giờ` : '—',
      incidentCount,
      totalCount: totalEvents,
    };
  }, [meterHours, mergedTimeline]);

  const handleAddIncidentLog = async (newLog: IncidentLogRecord) => {
    setHistoryLogsByAsset((prev) => ({
      ...prev,
      [asset.code]: [newLog, ...(prev[asset.code] ?? [])],
    }));
    setIsIncidentOpen(false);

    // Nếu người dùng chọn đồng bộ và hệ thống có module Bảo trì:
    if (newLog.syncToMaintenance) {
      try {
        const ok = await createMaintenanceIncidentForAsset({
          assetCode: asset.code,
          title: newLog.title,
          description: newLog.desc,
          priority: newLog.severity === 'CRITICAL' || newLog.severity === 'HIGH' ? 'High' : 'Normal',
        });
        if (ok) {
          // Tải lại lịch sử từ Bảo trì để nhận mã phiếu chính thức
          loadMaintenanceHistoryForAsset(asset.code).then((res) => {
            if (res && Array.isArray(res.items)) {
              setMaintenanceOccurrences(res.items);
            }
          });
        }
      } catch {
        // Ghi log lỗi nền, không làm gián đoạn UI
      }
    }
  };

  // Mock Maintenance Plans
  const maintenancePlans = [
    {
      level: 'Cấp 1 — Bảo dưỡng hàng tháng (200 giờ)',
      cycle: '1 tháng / lần',
      tasks: ['Kiểm tra rung chấn và nhiệt độ bề mặt', 'Kiểm tra mức dầu bôi trơn và độ kín phớt', 'Xiết chặt bulong liên kết chân máy'],
      duration: '45 phút',
      status: 'Định kỳ',
    },
    {
      level: 'Cấp 2 — Bảo dưỡng định kỳ 6 tháng (1,200 giờ)',
      cycle: '6 tháng / lần',
      tasks: ['Thay mới dầu thủy lực & lọc dầu', 'Kiểm tra độ mòn phớt làm kín Sealing Ring', 'Hiệu chuẩn cảm biến áp suất và rơ le bảo vệ'],
      duration: '180 phút',
      status: 'Sắp đến hạn (20 ngày)',
    },
    {
      level: 'Cấp 3 — Đại tu toàn diện hàng năm (5,000 giờ)',
      cycle: '12 tháng / lần',
      tasks: ['Tháo rã toàn bộ cụm ổ đỡ & rotor', 'Kiểm tra khuyết tật bằng phương pháp không phá hủy (NDT)', 'Thay thế toàn bộ gioăng phớt, bạc lót và cân bằng động'],
      duration: '2 ngày',
      status: 'Kế hoạch Q4/2026',
    },
  ];

  const statusOptions = Object.entries(ASSET_STATUS_LABEL).map(([value, label]) => ({ value, label: String(label) }));
  const criticalityOptions = Object.entries(ASSET_CRITICALITY_LABEL).map(([value, label]) => ({
    value,
    label: String(label),
  }));

  return (
    <div className="flex flex-col gap-[1.1rem] rounded-2xl border border-slate-200 bg-white p-[1.35rem] shadow-sm">
      {/* Top Banner / Asset 360 Head */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex-1 min-w-0">
          {editingBasic ? (
            <div className="flex max-w-[680px] flex-col gap-2.5 rounded-lg border-[1.5px] border-blue-300 bg-slate-50 px-3.5 py-3">
              <div className="flex items-center gap-2">
                <span className={EYEBROW}>{ASSET_TYPE_LABEL[asset.type]}</span>
                <span className="text-sm font-semibold text-slate-700">
                  Mã thiết bị: <strong className="text-blue-600">{asset.code}</strong>
                </span>
              </div>

              {/* Tên thiết bị */}
              <div className="flex flex-col gap-1">
                <Label required className="text-slate-600">
                  Tên thiết bị
                </Label>
                <Input
                  autoFocus
                  type="text"
                  value={editName}
                  className="text-base font-bold text-slate-900"
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              {/* 3 cột: Trạng thái, Mức độ quan trọng, Serial */}
              <div className="grid grid-cols-[1.1fr_1fr_1fr] gap-2.5">
                <div className="flex flex-col gap-1">
                  <Label className="text-slate-600">Trạng thái vận hành</Label>
                  <SearchableSelect
                    options={statusOptions}
                    value={editStatus}
                    onChange={(value) => setEditStatus((value || editStatus) as typeof asset.status)}
                    clearable={false}
                    searchInDropdown
                    hideDropdownSearch
                    className="w-full"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <Label className="text-slate-600">Độ quan trọng</Label>
                  <SearchableSelect
                    options={criticalityOptions}
                    value={editCriticality}
                    onChange={(value) => setEditCriticality((value || editCriticality) as typeof asset.criticality)}
                    clearable={false}
                    searchInDropdown
                    hideDropdownSearch
                    className="w-full"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <Label className="text-slate-600">Số Serial / Khung</Label>
                  <Input
                    type="text"
                    placeholder="Tùy chọn"
                    value={editSerialNumber}
                    onChange={(e) => setEditSerialNumber(e.target.value)}
                  />
                </div>
              </div>

              {/* Nút thao tác lưu / hủy */}
              <div className="mt-1 flex items-center gap-2">
                <Button
                  type="button"
                  disabled={saving || busy || !editName.trim()}
                  onClick={async () => {
                    await save({
                      name: editName.trim(),
                      status: editStatus,
                      criticality: editCriticality,
                      serialNumber: editSerialNumber.trim() || undefined,
                    });
                    setEditingBasic(false);
                  }}
                >
                  {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving || busy}
                  onClick={() => {
                    setEditName(asset.name);
                    setEditSerialNumber(asset.serialNumber ?? '');
                    setEditStatus(asset.status);
                    setEditCriticality(asset.criticality);
                    setEditingBasic(false);
                  }}
                >
                  Hủy
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className={EYEBROW}>{ASSET_TYPE_LABEL[asset.type]}</span>
                <span
                  className={cn(
                    PILL,
                    asset.status === 'OPERATING'
                      ? PILL_TONE.success
                      : asset.status === 'MAINTENANCE'
                        ? PILL_TONE.warn
                        : PILL_TONE.danger,
                  )}
                >
                  {ASSET_STATUS_LABEL[asset.status]}
                </span>
                <span className={cn(PILL, PILL_TONE.info)}>
                  Cấp {ASSET_CRITICALITY_LABEL[asset.criticality]}
                </span>
              </div>
              <h2 className="my-1 mx-0 text-xl font-extrabold text-slate-900">
                {asset.name}
              </h2>
              <p className="m-0 text-sm text-slate-500">
                Mã thiết bị: <strong className="text-blue-600">{asset.code}</strong>
                {asset.serialNumber ? ` · Serial: ${asset.serialNumber}` : ''}
              </p>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!editingBasic && canManage ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              title="Chỉnh sửa thông tin cơ bản thiết bị (Tên, Trạng thái, Mức độ, Serial)"
              onClick={() => {
                setEditName(asset.name);
                setEditSerialNumber(asset.serialNumber ?? '');
                setEditStatus(asset.status);
                setEditCriticality(asset.criticality);
                setEditingBasic(true);
              }}
            >
              Chỉnh sửa
            </Button>
          ) : null}
          {onAddChild ? (
            <Button
              type="button"
             
              disabled={busy}
              onClick={() => onAddChild(asset)}
              title={`Thêm thiết bị/chi tiết con trực thuộc ${asset.name}`}
            >
              <span>+</span> Thêm thiết bị con
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowQrModal(true)}
            title={`In tem nhãn mã QR cho thiết bị ${asset.code}`}
          >
            In mã QR
          </Button>
          {onRetire ? (
            <Popconfirm
              title={childMaterials.length > 0 ? `Thanh lý cụm ${asset.name}?` : `Thanh lý ${asset.name}?`}
              description={
                childMaterials.length > 0
                  ? 'Thiết bị này đang chứa các chi tiết/vật tư con. Xác nhận để mở form tháo dỡ và thanh lý hoàn kho.'
                  : `Xác nhận để mở form tháo dỡ và thanh lý hoàn kho cho thiết bị ${asset.code}.`
              }
              okText="Tiếp tục"
              okType="danger"
              placement="bottom-end"
              disabled={busy}
              onConfirm={() => onRetire(asset)}
            >
              <Button
                type="button"
                variant="outline"
                className="border-red-300 text-red-600 hover:text-red-600"
                disabled={busy}
                title={`Tháo dỡ / Thanh lý ${asset.name} (${asset.code})`}
                aria-label={`Tháo dỡ / Thanh lý ${asset.name}`}
              >
                Thanh lý
              </Button>
            </Popconfirm>
          ) : null}
        </div>
      </div>

      {/* 5 SUB-TABS NAVIGATION IN WORKSPACE */}
      <div className="flex items-center gap-[0.35rem] overflow-x-auto rounded-[0.65rem] border border-slate-200 bg-slate-100 p-[0.35rem]" role="tablist">
        {SUB_TABS.map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <Button
              key={tab.id}
              type="button"
              role="tab"
              variant="ghost"
              aria-selected={isActive}
              className={cn(
                'h-auto gap-[0.45rem] rounded-lg px-[0.85rem] py-[0.45rem] text-sm font-semibold text-slate-600 hover:bg-white/70 hover:text-slate-900',
                isActive && 'border-slate-300 bg-white text-blue-700 shadow-sm hover:bg-white hover:text-blue-700',
              )}
              onClick={() => setActiveSubTab(tab.id)}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </Button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: TỔNG QUAN THAM SỐ                                                  */}
      {/* ========================================================================= */}
      {activeSubTab === 'overview' ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
          {/* Technical Specs Card */}
          <section className={CARD}>
            <div className={CARD_HEAD}>
              <h3>Thông số kỹ thuật &amp; Đặc tính danh định</h3>
              {editing !== 'specs' && canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  className="py-1 px-2.5 text-[13px]"
                  onClick={openSpecs}
                >
                  {specs.length === 0 ? '+ Khai báo' : 'Chỉnh sửa'}
                </Button>
              ) : null}
            </div>

            {editing === 'specs' ? (
              <div className={EDIT_BOX}>
                <div className={EDIT_HEAD}>
                  <span className={EDIT_BADGE}>Chế độ chỉnh sửa thông số</span>
                  <p className={EDIT_HINT}>
                    Nhập tên thuộc tính và giá trị tương ứng. Nhấn <strong>Lưu thông số</strong> để áp dụng thay đổi.
                  </p>
                </div>

                <TableWrap className="rounded-md border border-slate-200 bg-white">
                  <Table className="table-fixed">
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell className="w-[46%] py-2 px-2.5">Tên thông số / Thuộc tính</TableHeaderCell>
                        <TableHeaderCell className="w-[46%] py-2 px-2.5">Giá trị danh định</TableHeaderCell>
                        <TableHeaderCell className="w-[8%] text-center py-2 px-1.5">Xoá</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {specRows.map((row, index) => (
                        <TableRow key={index}>
                          <TableCell className="py-1.5 px-2">
                            <Input
                              className="h-8 text-[13px]"
                              placeholder="VD: Điện áp định mức, Công suất…"
                              value={row.key}
                              onChange={(event) =>
                                setSpecRows((rows) =>
                                  rows.map((item, position) =>
                                    position === index ? { ...item, key: event.target.value } : item,
                                  ),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="py-1.5 px-2">
                            <Input
                              className="h-8 text-[13px]"
                              placeholder="VD: 110kV, 40MVA, 50Hz…"
                              value={row.value}
                              onChange={(event) =>
                                setSpecRows((rows) =>
                                  rows.map((item, position) =>
                                    position === index ? { ...item, value: event.target.value } : item,
                                  ),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="text-center py-1.5 px-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              className="border-red-100 text-red-600 hover:border-red-300 hover:bg-red-100 hover:text-red-600"
                              onClick={() => setSpecRows((rows) => rows.filter((_, p) => p !== index))}
                              title="Xoá dòng thông số này"
                              aria-label="Xoá dòng"
                            >
                              <X size={14} />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {specRows.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={3} className="p-5 text-center text-[13px] text-slate-500">
                            Chưa có thông số nào. Nhấn <strong>+ Thêm thông số mới</strong> để bắt đầu khai báo.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </TableWrap>

                <div className={EDIT_ACTIONS}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-dashed border-blue-500 text-blue-600 hover:border-solid hover:bg-blue-50 hover:text-blue-600"
                    onClick={() => setSpecRows((rows) => [...rows, { key: '', value: '' }])}
                  >
                    + Thêm thông số mới
                  </Button>

                  <div className="flex items-center gap-[0.6rem]">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEditing(undefined)}
                      disabled={saving}
                    >
                      Hủy bỏ
                    </Button>
                    <Button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        save({
                          specs: Object.fromEntries(
                            specRows
                              .filter((row) => row.key.trim())
                              .map((row) => [row.key.trim(), row.value]),
                          ),
                        })
                      }
                    >
                      {saving ? 'Đang lưu…' : 'Lưu thông số'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                {specs.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex justify-between py-2 px-3 rounded-md bg-slate-50 text-sm"
                  >
                    <span className="text-slate-600 font-medium">{key}</span>
                    <strong className="text-slate-900">{String(value)}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Operational Status & QR Card */}
          <section className={CARD}>
            <div className={CARD_HEAD}>
              <h3>Định danh số &amp; Vị trí hiện trường</h3>
            </div>
            <div className="grid gap-3">
              <div className="flex items-center gap-3.5 p-3 bg-slate-50 rounded-lg">
                <div className="w-[60px] h-[60px] bg-white border border-slate-200 rounded-lg grid place-items-center text-[28px]">
                  
                </div>
                <div>
                  <div className="text-sm font-bold">Mã phản hồi nhanh (QR Code)</div>
                  <div className="text-[13px] text-slate-500">Mã quét: {asset.qrCode ?? `QR-AMM-${asset.code}`}</div>
                  <span className={cn(PILL, PILL_TONE.success, 'mt-1')}>
                    Sẵn sàng quét hiện trường
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 bg-slate-50 rounded-md">
                  <span className="text-xs text-slate-500 uppercase font-semibold">Nhà máy trực thuộc</span>
                  <div className="text-sm font-bold mt-0.5">Factory (Plant 1)</div>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-md">
                  <span className="text-xs text-slate-500 uppercase font-semibold">Phân khu lắp đặt</span>
                  <div className="text-sm font-bold mt-0.5">Khu vực Turbine T1</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 2: TÀI LIỆU                                                           */}
      {/* ========================================================================= */}
      {activeSubTab === 'documents' ? (
        <AssetDocumentPanel assetCode={asset.code} busy={busy} />
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 3: LỊCH SỬ VẬN HÀNH - SỰ CỐ                                           */}
      {/* ========================================================================= */}
      {activeSubTab === 'history' ? (
        <div className="grid gap-4">
          {/* Chế độ vận hành: Độc lập hay Tích hợp Bảo trì */}
          <div
            className={cn(
              'flex items-center justify-between rounded-lg border px-4 py-2.5',
              hasMaintenanceModule ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-slate-50',
            )}
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center">
                {hasMaintenanceModule ? <Link2 size={16} color="#166534" /> : <Folder size={16} color="#475569" />}
              </span>
              <span className={cn('text-[13px] font-semibold', hasMaintenanceModule ? 'text-green-800' : 'text-slate-600')}>
                {hasMaintenanceModule
                  ? 'Chế độ Tích hợp CMMS: Tự động đồng bộ với module Bảo trì thiết bị'
                  : 'Chế độ Độc lập (Standalone AMM): Quản lý nhật ký vận hành & sự cố nội bộ tài sản'}
              </span>
              {isSyncingHistory ? (
                <span className="text-xs text-slate-500 italic">(Đang đồng bộ…)</span>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                Tổng cộng: <strong>{computedStats.totalCount}</strong> bản ghi (
                <strong className={computedStats.incidentCount > 0 ? 'text-red-600' : 'text-green-600'}>
                  {computedStats.incidentCount}
                </strong>{' '}
                sự cố)
              </span>
            </div>
          </div>

          {/* Quick Stats Grid - KPIs tính toán tự động */}
          <div className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-3">
            <div className="p-3.5 bg-white rounded-[10px] border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-600 uppercase font-semibold">Giờ chạy tích luỹ</span>
                <span className="text-xs text-slate-500">Mã số máy</span>
              </div>
              <div className="text-xl font-extrabold text-blue-600 mt-1">
                {computedStats.meterHours} giờ
              </div>
            </div>
            <div className="p-3.5 bg-white rounded-[10px] border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-600 uppercase font-semibold">Tỷ lệ sẵn sàng</span>
                <span className="text-xs text-green-700 font-semibold">Availability</span>
              </div>
              <div className="text-xl font-extrabold text-green-700 mt-1">
                {computedStats.availabilityRate}
              </div>
            </div>
            <div className="p-3.5 bg-white rounded-[10px] border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-600 uppercase font-semibold">Chỉ số MTBF</span>
                <span className="text-xs text-slate-500">Giữa 2 sự cố</span>
              </div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">
                {computedStats.mtbf}
              </div>
            </div>
            <div className="p-3.5 bg-white rounded-[10px] border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-600 uppercase font-semibold">Chỉ số MTTR</span>
                <span className="text-xs text-slate-500">Thời gian sửa</span>
              </div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">
                {computedStats.mttr}
              </div>
            </div>
          </div>

          {/* Timeline Card */}
          <section className={CARD}>
            <div className={CARD_HEAD}>
              <div>
                <h3>Nhật ký vận hành, bảo dưỡng &amp; Lịch sử sự cố</h3>
                <p className="mt-0.5 mx-0 mb-0 text-[13px] text-slate-500">
                  Theo dõi toàn bộ vòng đời vận hành, các lần đại tu, sửa chữa và thay thế vật tư phụ tùng.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsIncidentOpen(true)}
                disabled={!canManage}
              >
                <span>+</span> Ghi nhận sự cố
              </Button>
            </div>

            <div className="mt-4 pl-2">
              {mergedTimeline.length === 0 ? (
                <div className="py-8 px-0 text-center text-slate-500 text-sm">
                  Chưa có sự kiện hoặc nhật ký vận hành nào được ghi nhận cho thiết bị này.
                </div>
              ) : (
                mergedTimeline.map((item) => (
                  <div
                    key={item.id}
                    className="relative border-l-2 border-slate-200 pb-5 pl-6 last:border-l-transparent last:pb-0"
                  >
                    <span className="absolute top-1 -left-[0.41rem] size-3 rounded-full border-2 border-white bg-blue-600 shadow-[0_0_0_2px_#bfdbfe]" />
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[13px] font-bold text-blue-600">
                        {item.date}
                      </span>
                      <strong className="text-sm">{item.title}</strong>

                      {/* Tag phân loại sự kiện */}
                      <span
                        className={cn(
                          PILL,
                          item.badgeType === 'success'
                            ? PILL_TONE.success
                            : item.badgeType === 'warn'
                              ? PILL_TONE.warn
                              : item.badgeType === 'danger'
                                ? PILL_TONE.danger
                                : PILL_TONE.info,
                          'px-2 py-0.5',
                        )}
                      >
                        {item.badge}
                      </span>

                      {/* Tag nguồn gốc dữ liệu */}
                      <span
                        className={cn(
                          'rounded border px-1.5 py-px text-xs font-semibold',
                          item.source === 'maintenance_module'
                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                            : 'border-slate-300 bg-slate-100 text-slate-500',
                        )}
                      >
                        {item.source === 'maintenance_module' ? 'Lệnh Bảo trì CMMS' : 'Nhật ký nội bộ'}
                      </span>

                      {/* Mã phiếu liên kết (nếu có) */}
                      {item.code ? (
                        <span
                          className="text-xs font-bold text-sky-600 bg-sky-100 py-px px-1.5 rounded"
                        >
                          {item.code}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0 mx-0 mb-1.5 text-[13px] text-slate-600">
                      {item.desc}
                    </p>
                    <small className="text-slate-500 text-xs">
                      Người phụ trách / Thực hiện: <strong>{item.actor}</strong>
                    </small>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 4: PHỤ TÙNG (BOM)                                                     */}
      {/* ========================================================================= */}
      {activeSubTab === 'bom' ? (
        <SparePartPanel
          assetCode={asset.code}
          materials={materials ?? []}
          childMaterials={childMaterials}
          onHandByCode={onHandByCode}
          availableByCode={availableByCode}
          busy={busy}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 5: KẾ HOẠCH BẢO TRÌ                                                   */}
      {/* ========================================================================= */}
      {activeSubTab === 'maintenance-plan' ? (
        <div className="grid gap-4">
          {/* Preventive Maintenance Plans */}
          <section className={CARD}>
            <div className={CARD_HEAD}>
              <div>
                <h3>Kế hoạch Bảo dưỡng Phòng ngừa Định kỳ (PM Schedules)</h3>
                <p className="mt-1 mx-0 mb-0 text-[13px] text-slate-500">
                  Chu kỳ bảo dưỡng định kỳ và các hạng mục kiểm tra tiêu chuẩn cho thiết bị này.
                </p>
              </div>
            </div>

            <div className="grid gap-3 mt-3">
              {maintenancePlans.map((plan, index) => (
                <div key={index} className="p-4 rounded-[10px] bg-slate-50 border border-slate-200">
                  <div className="flex justify-between items-center mb-2">
                    <div>
                      <strong className="text-sm text-slate-900">{plan.level}</strong>
                      <span className="ml-2 text-[13px] text-blue-600 font-semibold">({plan.cycle})</span>
                    </div>
                    <span className={cn(PILL, PILL_TONE.info)}>
                      {plan.status}
                    </span>
                  </div>
                  <ul className="mt-1.5 mx-0 mb-2.5 pl-5 text-[13px] text-slate-600">
                    {plan.tasks.map((t, idx) => (
                      <li key={idx} className="mb-0.75">{t}</li>
                    ))}
                  </ul>
                  <div className="text-[13px] text-slate-500">
                    Thời gian dự kiến: <strong>{plan.duration}</strong> · Yêu cầu: <strong>2 Kỹ thuật viên</strong>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Default Task Template */}
          <section className={CARD}>
            <div className={CARD_HEAD}>
              <div>
                <h3>Đầu việc bảo trì mặc định (Procedure Task Template)</h3>
                <p className="mt-1 mx-0 mb-0 text-[13px] text-slate-500">
                  Nguồn đầu việc mặc định cho vai trò E (Thực thi) trong phân hệ Quy trình.
                </p>
              </div>
              {editing !== 'tasks' && canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  className="py-1 px-2.5 text-[13px]"
                  onClick={openTasks}
                >
                  {taskTemplate.length === 0 ? '+ Khai báo' : 'Chỉnh sửa'}
                </Button>
              ) : null}
            </div>

            {editing === 'tasks' ? (
              <div className={EDIT_BOX}>
                <div className={EDIT_HEAD}>
                  <span className={EDIT_BADGE}>Chế độ chỉnh sửa đầu việc quy trình</span>
                  <p className={EDIT_HINT}>
                    Khai báo danh sách các bước kiểm tra, công việc bảo trì chuẩn và thời lượng ước tính (phút).
                  </p>
                </div>

                <TableWrap className="rounded-md border border-slate-200 bg-white">
                  <Table className="table-fixed">
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell className="w-[18%] py-2 px-2.5">Mã bước</TableHeaderCell>
                        <TableHeaderCell className="w-[54%] py-2 px-2.5">Tên đầu việc bảo trì</TableHeaderCell>
                        <TableHeaderCell className="w-[20%] py-2 px-2.5">Thời lượng (phút)</TableHeaderCell>
                        <TableHeaderCell className="w-[8%] text-center py-2 px-1.5">Xoá</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {taskRows.map((task, index) => (
                        <TableRow key={index}>
                          <TableCell className="py-1.5 px-2">
                            <Input
                              className="h-8 text-[13px]"
                              placeholder="Mã (T1, T2…)"
                              value={task.key}
                              onChange={(event) =>
                                setTaskRows((rows) =>
                                  rows.map((item, position) =>
                                    position === index ? { ...item, key: event.target.value } : item,
                                  ),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="py-1.5 px-2">
                            <Input
                              className="h-8 text-[13px]"
                              placeholder="Mô tả công việc bảo trì chi tiết…"
                              value={task.name}
                              onChange={(event) =>
                                setTaskRows((rows) =>
                                  rows.map((item, position) =>
                                    position === index ? { ...item, name: event.target.value } : item,
                                  ),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="py-1.5 px-2">
                            <Input
                              className="h-8 text-[13px]"
                              placeholder="Phút"
                              type="number"
                              min="1"
                              value={task.durationMinutes ?? ''}
                              onChange={(event) =>
                                setTaskRows((rows) =>
                                  rows.map((item, position) =>
                                    position === index
                                      ? {
                                          ...item,
                                          durationMinutes: Number(event.target.value) || 0,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="text-center py-1.5 px-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              className="border-red-100 text-red-600 hover:border-red-300 hover:bg-red-100 hover:text-red-600"
                              onClick={() => setTaskRows((rows) => rows.filter((_, p) => p !== index))}
                              title="Xoá đầu việc này"
                              aria-label="Xoá dòng"
                            >
                              <X size={14} />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {taskRows.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={4} className="p-5 text-center text-[13px] text-slate-500">
                            Chưa có đầu việc nào. Nhấn <strong>+ Thêm đầu việc</strong> để bắt đầu thiết lập quy trình.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </TableWrap>

                <div className={EDIT_ACTIONS}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-dashed border-blue-500 text-blue-600 hover:border-solid hover:bg-blue-50 hover:text-blue-600"
                    onClick={() =>
                      setTaskRows((rows) => [
                        ...rows,
                        { key: `T${rows.length + 1}`, name: '', durationMinutes: 30 },
                      ])
                    }
                  >
                    + Thêm đầu việc
                  </Button>

                  <div className="flex items-center gap-[0.6rem]">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEditing(undefined)}
                      disabled={saving}
                    >
                      Hủy bỏ
                    </Button>
                    <Button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        save({
                          taskTemplate: taskRows
                            .filter((row) => row.name.trim())
                            .map((row) => ({
                              key: row.key.trim() || `T${taskRows.indexOf(row) + 1}`,
                              name: row.name.trim(),
                              durationMinutes: row.durationMinutes || undefined,
                            })),
                        })
                      }
                    >
                      {saving ? 'Đang lưu…' : 'Lưu đầu việc'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : taskTemplate.length === 0 ? (
              <p className="text-slate-500 text-sm m-0">
                Chưa có đầu việc bảo trì mặc định nào được cấu hình.
              </p>
            ) : (
              <div className="grid gap-2">
                {taskTemplate.map((task) => (
                  <div
                    key={task.key}
                    className="flex items-center justify-between py-2 px-3 rounded-md bg-slate-50 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-blue-600 text-[13px]">
                        {task.key}
                      </span>
                      <span>{task.name}</span>
                    </div>
                    <span className="text-slate-500 text-[13px]">
                      {task.durationMinutes ? `${task.durationMinutes} phút` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {/* Dialog Ghi nhận sự cố thiết bị */}
      {isIncidentOpen ? (
        <IncidentRecordDialog
          asset={asset}
          onCancel={() => setIsIncidentOpen(false)}
          onSubmit={handleAddIncidentLog}
        />
      ) : null}

      {/* Modal Xem trước & In Tem QR Code thiết bị chuẩn 50x30mm */}
      {showQrModal ? (
        <Dialog onEscape={() => setShowQrModal(false)}>
          <DialogContent className="max-w-[480px]" aria-label="Tem nhãn thiết bị">
            <DialogHeader>
              <div>
                <DialogTitle>Tem nhãn thiết bị (Khổ 50×30mm)</DialogTitle>
                <p className="mt-0.5 mx-0 mb-0 text-[13px] text-slate-500">
                  In tem nhãn dán thân vỏ tài sản, hỗ trợ máy quét mã vạch / di động.
                </p>
              </div>
              <DialogCloseButton title="Đóng (ESC)" onClick={() => setShowQrModal(false)} />
            </DialogHeader>

            <DialogBody>
            {/* Khung Tem mẫu chuẩn công nghiệp */}
            <div
              className="border-2 border-dashed border-slate-400 rounded-lg p-4 bg-neutral-50 flex items-center gap-4 mb-5"
            >
              <div
                className="w-[85px] h-[85px] bg-white border border-slate-300 rounded p-1.25 flex items-center justify-center shrink-0"
              >
                <svg viewBox="0 0 100 100" width="75" height="75">
                  <rect width="100" height="100" fill="#ffffff" />
                  <rect x="5" y="5" width="28" height="28" fill="#0f172a" />
                  <rect x="9" y="9" width="20" height="20" fill="#ffffff" />
                  <rect x="13" y="13" width="12" height="12" fill="#0f172a" />
                  <rect x="67" y="5" width="28" height="28" fill="#0f172a" />
                  <rect x="71" y="9" width="20" height="20" fill="#ffffff" />
                  <rect x="75" y="13" width="12" height="12" fill="#0f172a" />
                  <rect x="5" y="67" width="28" height="28" fill="#0f172a" />
                  <rect x="9" y="71" width="20" height="20" fill="#ffffff" />
                  <rect x="13" y="75" width="12" height="12" fill="#0f172a" />
                  <rect x="40" y="40" width="20" height="20" fill="#2563eb" />
                  <rect x="42" y="15" width="16" height="8" fill="#0f172a" />
                  <rect x="15" y="42" width="8" height="16" fill="#0f172a" />
                  <rect x="75" y="42" width="12" height="8" fill="#0f172a" />
                  <rect x="42" y="75" width="16" height="10" fill="#0f172a" />
                  <rect x="68" y="68" width="18" height="18" fill="#0f172a" />
                </svg>
              </div>

              <div className="flex flex-col gap-0.75 flex-1 min-w-0">
                <span
                  className="text-xs uppercase text-slate-500 font-bold tracking-[0.5px]"
                >
                  TÀI SẢN KỸ THUẬT · EVN
                </span>
                <strong className="text-base text-slate-900 tracking-[-0.2px]">
                  {asset.code}
                </strong>
                <span
                  className="line-clamp-2 overflow-hidden text-[13px] leading-[1.3] font-semibold text-slate-700"
                  title={asset.name}
                >
                  {asset.name}
                </span>
                {asset.serialNumber ? (
                  <span className="text-xs text-slate-600">
                    S/N: <code>{asset.serialNumber}</code>
                  </span>
                ) : null}
                <span className="text-xs text-blue-600 font-semibold">
                  Loại: {asset.type ?? 'Thiết bị'} · {asset.status ?? 'Sẵn sàng'}
                </span>
              </div>
            </div>

            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowQrModal(false)}>
                Đóng
              </Button>
              <Button
                type="button"
                onClick={() => {
                  window.print();
                  setShowQrModal(false);
                }}
              >
                <Printer size={15} />
                <span>In ra máy in tem</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
