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
import styles from '../inventory.module.scss';
import { AssetDocumentPanel } from './asset-document-panel';
import { SparePartPanel } from './spare-part-panel';
import { IncidentRecordDialog, type IncidentLogRecord } from './incident-record-dialog';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { Folder, Link2, Printer, X } from 'lucide-react';

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
  const [editing, setEditing] = useState<'specs' | 'tasks'>();
  const [editingBasic, setEditingBasic] = useState(false);
  const [editName, setEditName] = useState(asset.name);
  const [editSerialNumber, setEditSerialNumber] = useState(asset.serialNumber ?? '');
  const [editStatus, setEditStatus] = useState(asset.status);
  const [editCriticality, setEditCriticality] = useState(asset.criticality);
  const [specRows, setSpecRows] = useState<{ key: string; value: string }[]>([]);
  const [taskRows, setTaskRows] = useState<AssetTaskItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
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
    setError(undefined);
  }, [asset.code, asset.name, asset.serialNumber, asset.status, asset.criticality]);

  const openSpecs = () => {
    setSpecRows(specs.map(([key, value]) => ({ key, value: String(value) })));
    setError(undefined);
    setEditing('specs');
  };

  const openTasks = () => {
    setTaskRows(taskTemplate.map((task) => ({ ...task })));
    setError(undefined);
    setEditing('tasks');
  };

  const save = async (patch: UpdateAssetRequest) => {
    setSaving(true);
    setError(undefined);
    try {
      await updateAsset(asset.code, patch);
      setEditing(undefined);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được.');
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
        ? new Date(occ.completedAt).toLocaleDateString('vi-VN')
        : occ.dueAt
        ? new Date(occ.dueAt).toLocaleDateString('vi-VN')
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

  return (
    <div className={styles.assetWorkspaceCard}>
      {/* Top Banner / Asset 360 Head */}
      <div className={styles.assetWorkspaceHead}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editingBasic ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '12px 14px',
                borderRadius: '8px',
                background: '#f8fafc',
                border: '1.5px solid #93c5fd',
                maxWidth: '680px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className={styles.eyebrow}>{ASSET_TYPE_LABEL[asset.type]}</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Mã thiết bị: <strong style={{ color: '#2563eb' }}>{asset.code}</strong>
                </span>
              </div>

              {/* Tên thiết bị */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#475569' }}>
                  Tên thiết bị <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  autoFocus
                  type="text"
                  value={editName}
                  style={{
                    fontSize: '15px',
                    fontWeight: 700,
                    color: '#0f172a',
                    padding: '6px 10px',
                    borderRadius: '5px',
                    border: '1px solid #cbd5e1',
                    outline: 'none',
                    background: '#ffffff',
                  }}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              {/* 3 cột: Trạng thái, Mức độ quan trọng, Serial */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                    Trạng thái vận hành
                  </label>
                  <select
                    style={{
                      fontSize: '13px',
                      padding: '5px 8px',
                      borderRadius: '5px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      outline: 'none',
                    }}
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as typeof asset.status)}
                  >
                    {Object.entries(ASSET_STATUS_LABEL).map(([val, lbl]) => (
                      <option key={val} value={val}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                    Độ quan trọng
                  </label>
                  <select
                    style={{
                      fontSize: '13px',
                      padding: '5px 8px',
                      borderRadius: '5px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      outline: 'none',
                    }}
                    value={editCriticality}
                    onChange={(e) => setEditCriticality(e.target.value as typeof asset.criticality)}
                  >
                    {Object.entries(ASSET_CRITICALITY_LABEL).map(([val, lbl]) => (
                      <option key={val} value={val}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                    Số Serial / Khung
                  </label>
                  <input
                    type="text"
                    placeholder="Tùy chọn"
                    style={{
                      fontSize: '13px',
                      padding: '5px 8px',
                      borderRadius: '5px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      outline: 'none',
                    }}
                    value={editSerialNumber}
                    onChange={(e) => setEditSerialNumber(e.target.value)}
                  />
                </div>
              </div>

              {/* Nút thao tác lưu / hủy */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  style={{ padding: '6px 14px', fontSize: '13px' }}
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
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  style={{ padding: '6px 12px', fontSize: '13px' }}
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
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span className={styles.eyebrow}>{ASSET_TYPE_LABEL[asset.type]}</span>
                <span
                  className={`${styles.statusPill} ${
                    asset.status === 'OPERATING'
                      ? styles.statusPillSuccess
                      : asset.status === 'MAINTENANCE'
                      ? styles.statusPillWarning
                      : styles.statusPillDanger
                  }`}
                >
                  {ASSET_STATUS_LABEL[asset.status]}
                </span>
                <span className={`${styles.statusPill} ${styles.statusPillInfo}`}>
                  Cấp {ASSET_CRITICALITY_LABEL[asset.criticality]}
                </span>
              </div>
              <h2 style={{ margin: '4px 0', fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
                {asset.name}
              </h2>
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                Mã thiết bị: <strong style={{ color: '#2563eb' }}>{asset.code}</strong>
                {asset.serialNumber ? ` · Serial: ${asset.serialNumber}` : ''}
              </p>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {!editingBasic ? (
            <button
              type="button"
              className={styles.btnSecondary}
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
            </button>
          ) : null}
          {onAddChild ? (
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={busy}
              onClick={() => onAddChild(asset)}
              title={`Thêm thiết bị/chi tiết con trực thuộc ${asset.name}`}
            >
              <span>+</span> Thêm thiết bị con
            </button>
          ) : null}
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setShowQrModal(true)}
            title={`In tem nhãn mã QR cho thiết bị ${asset.code}`}
          >
            In mã QR
          </button>
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
              <button
                type="button"
                className={styles.btnSecondary}
                style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                disabled={busy}
                title={`Tháo dỡ / Thanh lý ${asset.name} (${asset.code})`}
                aria-label={`Tháo dỡ / Thanh lý ${asset.name}`}
              >
                Thanh lý
              </button>
            </Popconfirm>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className={styles.alert}>
          {error}
        </div>
      ) : null}

      {/* 5 SUB-TABS NAVIGATION IN WORKSPACE */}
      <div className={styles.subTabNav} role="tablist">
        {SUB_TABS.map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`${styles.subTabBtn} ${isActive ? styles.subTabBtnActive : ''}`}
              onClick={() => setActiveSubTab(tab.id)}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: TỔNG QUAN THAM SỐ                                                  */}
      {/* ========================================================================= */}
      {activeSubTab === 'overview' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          {/* Technical Specs Card */}
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h3>Thông số kỹ thuật &amp; Đặc tính danh định</h3>
              {editing !== 'specs' ? (
                <button
                  type="button"
                  className={styles.btnSecondary}
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={openSpecs}
                >
                  {specs.length === 0 ? '+ Khai báo' : 'Chỉnh sửa'}
                </button>
              ) : null}
            </div>

            {editing === 'specs' ? (
              <div className={styles.inlineEditContainer}>
                <div className={styles.inlineEditHeader}>
                  <span className={styles.inlineEditBadge}>Chế độ chỉnh sửa thông số</span>
                  <p className={styles.inlineEditHint}>
                    Nhập tên thuộc tính và giá trị tương ứng. Nhấn <strong>Lưu thông số</strong> để áp dụng thay đổi.
                  </p>
                </div>

                <div className={styles.inlineEditTableWrap}>
                  <table className={styles.inlineEditTable} style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '46%', padding: '8px 10px' }}>Tên thông số / Thuộc tính</th>
                        <th style={{ width: '46%', padding: '8px 10px' }}>Giá trị danh định</th>
                        <th style={{ width: '8%', textAlign: 'center', padding: '8px 6px' }}>Xoá</th>
                      </tr>
                    </thead>
                    <tbody>
                      {specRows.map((row, index) => (
                        <tr key={index}>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              className={styles.inlineEditInput}
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
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              className={styles.inlineEditInput}
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
                          </td>
                          <td style={{ textAlign: 'center', padding: '6px 4px' }}>
                            <button
                              type="button"
                              className={styles.inlineDeleteBtn}
                              onClick={() => setSpecRows((rows) => rows.filter((_, p) => p !== index))}
                              title="Xoá dòng thông số này"
                              aria-label="Xoá dòng"
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {specRows.length === 0 ? (
                        <tr>
                          <td colSpan={3} className={styles.inlineEmptyCell}>
                            Chưa có thông số nào. Nhấn <strong>+ Thêm thông số mới</strong> để bắt đầu khai báo.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <div className={styles.inlineActionRow}>
                  <button
                    type="button"
                    className={styles.inlineAddRowBtn}
                    onClick={() => setSpecRows((rows) => [...rows, { key: '', value: '' }])}
                  >
                    + Thêm thông số mới
                  </button>

                  <div className={styles.inlineSaveGroup}>
                    <button
                      type="button"
                      className={styles.modalCancelBtn}
                      onClick={() => setEditing(undefined)}
                      disabled={saving}
                    >
                      Hủy bỏ
                    </button>
                    <button
                      type="button"
                      className={styles.modalSaveBtn}
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
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {specs.map(([key, value]) => (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: '#f8fafc',
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ color: 'var(--pe-text-secondary)', fontWeight: 500 }}>{key}</span>
                    <strong style={{ color: 'var(--pe-text-primary)' }}>{String(value)}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Operational Status & QR Card */}
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h3>Định danh số &amp; Vị trí hiện trường</h3>
            </div>
            <div style={{ display: 'grid', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                <div style={{ width: '60px', height: '60px', background: '#ffffff', border: '1px solid var(--pe-border-subtle)', borderRadius: '8px', display: 'grid', placeItems: 'center', fontSize: '28px' }}>
                  
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700 }}>Mã phản hồi nhanh (QR Code)</div>
                  <div style={{ fontSize: '12px', color: 'var(--pe-text-muted)' }}>Mã quét: {asset.qrCode ?? `QR-AMM-${asset.code}`}</div>
                  <span className={`${styles.statusPill} ${styles.statusPillSuccess}`} style={{ marginTop: '4px' }}>
                    Sẵn sàng quét hiện trường
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--pe-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Nhà máy trực thuộc</span>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px' }}>Factory (Plant 1)</div>
                </div>
                <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--pe-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Phân khu lắp đặt</span>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px' }}>Khu vực Turbine T1</div>
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
        <div style={{ display: 'grid', gap: '16px' }}>
          {/* Chế độ vận hành: Độc lập hay Tích hợp Bảo trì */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              borderRadius: '8px',
              background: hasMaintenanceModule ? '#f0fdf4' : '#f8fafc',
              border: `1px solid ${hasMaintenanceModule ? '#bbf7d0' : '#e2e8f0'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                {hasMaintenanceModule ? <Link2 size={16} color="#166534" /> : <Folder size={16} color="#475569" />}
              </span>
              <span style={{ fontSize: '12.5px', color: hasMaintenanceModule ? '#166534' : '#475569', fontWeight: 600 }}>
                {hasMaintenanceModule
                  ? 'Chế độ Tích hợp CMMS: Tự động đồng bộ với module Bảo trì thiết bị'
                  : 'Chế độ Độc lập (Standalone AMM): Quản lý nhật ký vận hành & sự cố nội bộ tài sản'}
              </span>
              {isSyncingHistory ? (
                <span style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>(Đang đồng bộ…)</span>
              ) : null}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                Tổng cộng: <strong>{computedStats.totalCount}</strong> bản ghi (
                <strong style={{ color: computedStats.incidentCount > 0 ? '#dc2626' : '#16a34a' }}>
                  {computedStats.incidentCount}
                </strong>{' '}
                sự cố)
              </span>
            </div>
          </div>

          {/* Quick Stats Grid - KPIs tính toán tự động */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px' }}>
            <div style={{ padding: '14px', background: '#ffffff', borderRadius: '10px', border: '1px solid var(--pe-border-subtle)', boxShadow: 'var(--pe-shadow-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--pe-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Giờ chạy tích luỹ</span>
                <span style={{ fontSize: '11px', color: 'var(--pe-text-muted)' }}>Mã số máy</span>
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--pe-primary-600)', marginTop: '4px' }}>
                {computedStats.meterHours} giờ
              </div>
            </div>
            <div style={{ padding: '14px', background: '#ffffff', borderRadius: '10px', border: '1px solid var(--pe-border-subtle)', boxShadow: 'var(--pe-shadow-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--pe-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Tỷ lệ sẵn sàng</span>
                <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 600 }}>Availability</span>
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                {computedStats.availabilityRate}
              </div>
            </div>
            <div style={{ padding: '14px', background: '#ffffff', borderRadius: '10px', border: '1px solid var(--pe-border-subtle)', boxShadow: 'var(--pe-shadow-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--pe-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Chỉ số MTBF</span>
                <span style={{ fontSize: '11px', color: 'var(--pe-text-muted)' }}>Giữa 2 sự cố</span>
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--pe-text-primary)', marginTop: '4px' }}>
                {computedStats.mtbf}
              </div>
            </div>
            <div style={{ padding: '14px', background: '#ffffff', borderRadius: '10px', border: '1px solid var(--pe-border-subtle)', boxShadow: 'var(--pe-shadow-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--pe-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Chỉ số MTTR</span>
                <span style={{ fontSize: '11px', color: 'var(--pe-text-muted)' }}>Thời gian sửa</span>
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--pe-text-primary)', marginTop: '4px' }}>
                {computedStats.mttr}
              </div>
            </div>
          </div>

          {/* Timeline Card */}
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h3>Nhật ký vận hành, bảo dưỡng &amp; Lịch sử sự cố</h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--pe-text-muted)' }}>
                  Theo dõi toàn bộ vòng đời vận hành, các lần đại tu, sửa chữa và thay thế vật tư phụ tùng.
                </p>
              </div>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setIsIncidentOpen(true)}
              >
                <span>+</span> Ghi nhận sự cố
              </button>
            </div>

            <div style={{ marginTop: '16px', paddingLeft: '8px' }}>
              {mergedTimeline.length === 0 ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  Chưa có sự kiện hoặc nhật ký vận hành nào được ghi nhận cho thiết bị này.
                </div>
              ) : (
                mergedTimeline.map((item) => (
                  <div key={item.id} className={styles.timelineItem}>
                    <span className={styles.timelineDot} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--pe-primary-600)' }}>
                        {item.date}
                      </span>
                      <strong style={{ fontSize: '13.5px' }}>{item.title}</strong>

                      {/* Tag phân loại sự kiện */}
                      <span
                        className={
                          item.badgeType === 'success'
                            ? `${styles.statusPill} ${styles.statusPillSuccess}`
                            : item.badgeType === 'warn'
                            ? `${styles.statusPill} ${styles.statusPillWarn}`
                            : item.badgeType === 'danger'
                            ? `${styles.statusPill} ${styles.statusPillDanger || styles.statusPillWarn}`
                            : `${styles.statusPill} ${styles.statusPillInfo}`
                        }
                        style={{ fontSize: '11px', padding: '2px 8px' }}
                      >
                        {item.badge}
                      </span>

                      {/* Tag nguồn gốc dữ liệu */}
                      <span
                        style={{
                          fontSize: '10.5px',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: item.source === 'maintenance_module' ? '#eff6ff' : '#f1f5f9',
                          color: item.source === 'maintenance_module' ? '#1d4ed8' : '#64748b',
                          border: `1px solid ${item.source === 'maintenance_module' ? '#bfdbfe' : '#cbd5e1'}`,
                          fontWeight: 600,
                        }}
                      >
                        {item.source === 'maintenance_module' ? 'Lệnh Bảo trì CMMS' : 'Nhật ký nội bộ'}
                      </span>

                      {/* Mã phiếu liên kết (nếu có) */}
                      {item.code ? (
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: '#0284c7',
                            background: '#e0f2fe',
                            padding: '1px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          {item.code}
                        </span>
                      ) : null}
                    </div>
                    <p style={{ margin: '0 0 6px', fontSize: '12.5px', color: 'var(--pe-text-secondary)' }}>
                      {item.desc}
                    </p>
                    <small style={{ color: 'var(--pe-text-muted)', fontSize: '11.5px' }}>
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
        <div style={{ display: 'grid', gap: '16px' }}>
          {/* Preventive Maintenance Plans */}
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h3>Kế hoạch Bảo dưỡng Phòng ngừa Định kỳ (PM Schedules)</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--pe-text-muted)' }}>
                  Chu kỳ bảo dưỡng định kỳ và các hạng mục kiểm tra tiêu chuẩn cho thiết bị này.
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gap: '12px', marginTop: '12px' }}>
              {maintenancePlans.map((plan, index) => (
                <div key={index} style={{ padding: '16px', borderRadius: '10px', background: '#f8fafc', border: '1px solid var(--pe-border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div>
                      <strong style={{ fontSize: '14px', color: 'var(--pe-text-primary)' }}>{plan.level}</strong>
                      <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--pe-primary-600)', fontWeight: 600 }}>({plan.cycle})</span>
                    </div>
                    <span className={`${styles.statusPill} ${styles.statusPillInfo}`} style={{ fontSize: '11.5px' }}>
                      {plan.status}
                    </span>
                  </div>
                  <ul style={{ margin: '6px 0 10px', paddingLeft: '20px', fontSize: '12.5px', color: 'var(--pe-text-secondary)' }}>
                    {plan.tasks.map((t, idx) => (
                      <li key={idx} style={{ marginBottom: '3px' }}>{t}</li>
                    ))}
                  </ul>
                  <div style={{ fontSize: '12px', color: 'var(--pe-text-muted)' }}>
                    Thời gian dự kiến: <strong>{plan.duration}</strong> · Yêu cầu: <strong>2 Kỹ thuật viên</strong>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Default Task Template */}
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h3>Đầu việc bảo trì mặc định (Procedure Task Template)</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--pe-text-muted)' }}>
                  Nguồn đầu việc mặc định cho vai trò E (Thực thi) trong phân hệ Quy trình.
                </p>
              </div>
              {editing !== 'tasks' ? (
                <button
                  type="button"
                  className={styles.btnSecondary}
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={openTasks}
                >
                  {taskTemplate.length === 0 ? '+ Khai báo' : 'Chỉnh sửa'}
                </button>
              ) : null}
            </div>

            {editing === 'tasks' ? (
              <div className={styles.inlineEditContainer}>
                <div className={styles.inlineEditHeader}>
                  <span className={styles.inlineEditBadge}>Chế độ chỉnh sửa đầu việc quy trình</span>
                  <p className={styles.inlineEditHint}>
                    Khai báo danh sách các bước kiểm tra, công việc bảo trì chuẩn và thời lượng ước tính (phút).
                  </p>
                </div>

                <div className={styles.inlineEditTableWrap}>
                  <table className={styles.inlineEditTable} style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '18%', padding: '8px 10px' }}>Mã bước</th>
                        <th style={{ width: '54%', padding: '8px 10px' }}>Tên đầu việc bảo trì</th>
                        <th style={{ width: '20%', padding: '8px 10px' }}>Thời lượng (phút)</th>
                        <th style={{ width: '8%', textAlign: 'center', padding: '8px 6px' }}>Xoá</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taskRows.map((task, index) => (
                        <tr key={index}>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              className={styles.inlineEditInput}
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
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              className={styles.inlineEditInput}
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
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              className={styles.inlineEditInput}
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
                          </td>
                          <td style={{ textAlign: 'center', padding: '6px 4px' }}>
                            <button
                              type="button"
                              className={styles.inlineDeleteBtn}
                              onClick={() => setTaskRows((rows) => rows.filter((_, p) => p !== index))}
                              title="Xoá đầu việc này"
                              aria-label="Xoá dòng"
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {taskRows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className={styles.inlineEmptyCell}>
                            Chưa có đầu việc nào. Nhấn <strong>+ Thêm đầu việc</strong> để bắt đầu thiết lập quy trình.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <div className={styles.inlineActionRow}>
                  <button
                    type="button"
                    className={styles.inlineAddRowBtn}
                    onClick={() =>
                      setTaskRows((rows) => [
                        ...rows,
                        { key: `T${rows.length + 1}`, name: '', durationMinutes: 30 },
                      ])
                    }
                  >
                    + Thêm đầu việc
                  </button>

                  <div className={styles.inlineSaveGroup}>
                    <button
                      type="button"
                      className={styles.modalCancelBtn}
                      onClick={() => setEditing(undefined)}
                      disabled={saving}
                    >
                      Hủy bỏ
                    </button>
                    <button
                      type="button"
                      className={styles.modalSaveBtn}
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
                    </button>
                  </div>
                </div>
              </div>
            ) : taskTemplate.length === 0 ? (
              <p style={{ color: 'var(--pe-text-muted)', fontSize: '13px', margin: 0 }}>
                Chưa có đầu việc bảo trì mặc định nào được cấu hình.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {taskTemplate.map((task) => (
                  <div
                    key={task.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: '#f8fafc',
                      fontSize: '13px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--pe-primary-600)', fontSize: '12px' }}>
                        {task.key}
                      </span>
                      <span>{task.name}</span>
                    </div>
                    <span style={{ color: 'var(--pe-text-muted)', fontSize: '12px' }}>
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
        <div className={styles.modalOverlay} onClick={() => setShowQrModal(false)}>
          <div
            className={styles.modalDialog}
            style={{
              maxWidth: '480px',
              background: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
              padding: '24px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                  Tem nhãn thiết bị (Khổ 50×30mm)
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                  In tem nhãn dán thân vỏ tài sản, hỗ trợ máy quét mã vạch / di động.
                </p>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setShowQrModal(false)}
                title="Đóng (ESC)"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            {/* Khung Tem mẫu chuẩn công nghiệp */}
            <div
              style={{
                border: '2px dashed #94a3b8',
                borderRadius: '8px',
                padding: '16px',
                background: '#fafafa',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                marginBottom: '20px',
              }}
            >
              <div
                style={{
                  width: '85px',
                  height: '85px',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  padding: '5px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: '10px',
                    textTransform: 'uppercase',
                    color: '#64748b',
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                  }}
                >
                  TÀI SẢN KỸ THUẬT · EVN
                </span>
                <strong style={{ fontSize: '15px', color: '#0f172a', letterSpacing: '-0.2px' }}>
                  {asset.code}
                </strong>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#334155',
                    fontWeight: 600,
                    lineHeight: 1.3,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                  title={asset.name}
                >
                  {asset.name}
                </span>
                {asset.serialNumber ? (
                  <span style={{ fontSize: '11px', color: '#475569' }}>
                    S/N: <code>{asset.serialNumber}</code>
                  </span>
                ) : null}
                <span style={{ fontSize: '11px', color: '#2563eb', fontWeight: 600 }}>
                  Loại: {asset.type ?? 'Thiết bị'} · {asset.status ?? 'Sẵn sàng'}
                </span>
              </div>
            </div>

            {/* Nút thao tác */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                onClick={() => setShowQrModal(false)}
              >
                Đóng
              </button>
              <button
                type="button"
                className={`${styles.drawerActionBtn} ${styles.drawerActionBtnPrimary}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={() => {
                  window.print();
                  setShowQrModal(false);
                }}
              >
                <Printer size={15} />
                <span>In ra máy in tem</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
