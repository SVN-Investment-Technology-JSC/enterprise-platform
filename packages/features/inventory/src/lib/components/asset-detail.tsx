'use client';

import type {
  Asset,
  AssetTaskItem,
  InstalledMaterial,
  InventoryCatalogSettings,
  Material,
  UpdateAssetRequest,
} from '@enterprise-platform/contracts-inventory';
import { useState } from 'react';
import { updateAsset } from '../inventory-api';
import {
  ASSET_CRITICALITY_LABEL,
  ASSET_STATUS_LABEL,
  ASSET_TYPE_LABEL,
} from '../inventory-labels';
import styles from '../inventory.module.scss';
import { AssetDocumentPanel } from './asset-document-panel';
import { IncidentRecordDialog, type IncidentLogRecord } from './incident-record-dialog';
import { SparePartPanel } from './spare-part-panel';

type AssetSubTab = 'overview' | 'documents' | 'history' | 'bom' | 'maintenance-plan';

interface SubTabItem {
  id: AssetSubTab;
  label: string;
  icon: string;
}

const SUB_TABS: readonly SubTabItem[] = [
  { id: 'overview', label: 'Tổng quan tham số', icon: '📊' },
  { id: 'documents', label: 'Tài liệu', icon: '📁' },
  { id: 'history', label: 'Lịch sử vận hành - sự cố', icon: '🕒' },
  { id: 'bom', label: 'Phụ tùng (BOM)', icon: '🔩' },
  { id: 'maintenance-plan', label: 'Kế hoạch bảo trì', icon: '📅' },
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

  // Operational History & Incidents state
  const [historyLogs, setHistoryLogs] = useState<IncidentLogRecord[]>([
    {
      id: 'log-1',
      date: '10/08/2026',
      title: 'Hoàn thành Đại tu định kỳ Cấp 2',
      badge: 'Bảo trì thành công',
      badgeType: 'success',
      desc: 'Thực hiện theo Lệnh sửa chữa WO-2026-0412. Đã thay thế phớt chắn dầu, bơm dầu bôi trơn mới và cân chỉnh độ đồng tâm trục.',
      actor: 'KTV. Nguyễn Văn A (Đội Cơ điện 1)',
    },
    {
      id: 'log-2',
      date: '15/06/2026',
      title: 'Cảnh báo nhiệt độ ổ trục tăng nhẹ (+3°C)',
      badge: 'Cảnh báo',
      badgeType: 'warn',
      desc: 'Hệ thống cảm biến SCADA ghi nhận nhiệt độ tăng trong ca 2. Kỹ thuật viên đã kiểm tra tại hiện trường và bổ sung mỡ bôi trơn chịu nhiệt.',
      actor: 'KTV. Trần Văn B',
    },
    {
      id: 'log-3',
      date: '20/03/2026',
      title: 'Thay thế định kỳ phớt làm kín Sealing Ring',
      badge: 'Thay thế phụ tùng',
      badgeType: 'info',
      desc: 'Xuất kho phụ tùng SKU-MTR-001 thay thế theo chu kỳ 6 tháng. Thiết bị hoạt động ổn định sau khi lắp ráp.',
      actor: 'KTV. Lê Hoàng C',
    },
    {
      id: 'log-4',
      date: '01/11/2025',
      title: 'Đưa vào vận hành chính thức (Commissioning)',
      badge: 'Khởi tạo',
      badgeType: 'info',
      desc: 'Nghiệm thu đóng điện và chạy tải 72 giờ không sự cố tại Phân xưởng 1 (Factory Plant 1).',
      actor: 'Hội đồng Nghiệm thu Kỹ thuật',
    },
  ]);

  const [isIncidentOpen, setIsIncidentOpen] = useState(false);

  const handleAddIncidentLog = (newLog: IncidentLogRecord) => {
    setHistoryLogs((prev) => [newLog, ...prev]);
    setIsIncidentOpen(false);
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
                  {saving ? 'Đang lưu…' : '✓ Lưu thay đổi'}
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
                  ✕ Hủy
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
              ✎ Chỉnh sửa
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
            onClick={() => window.alert(`Đang in nhãn QR Code cho thiết bị ${asset.code}…`)}
          >
            📷 In mã QR
          </button>
          {onRetire ? (
            <button
              type="button"
              className={styles.btnSecondary}
              style={{ color: '#dc2626', borderColor: '#fca5a5' }}
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Xác nhận thanh lý thiết bị ${asset.code} (${asset.name})?`)) {
                  onRetire(asset);
                }
              }}
            >
              ✕ Thanh lý
            </button>
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
                  {specs.length === 0 ? '+ Khai báo' : '✎ Chỉnh sửa'}
                </button>
              ) : null}
            </div>

            {editing === 'specs' ? (
              <div className={styles.inlineEditContainer}>
                <div className={styles.inlineEditHeader}>
                  <span className={styles.inlineEditBadge}>✏️ Chế độ chỉnh sửa thông số</span>
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
                              🗑️
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
                      {saving ? 'Đang lưu…' : '✓ Lưu thông số'}
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
                  📱
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700 }}>Mã phản hồi nhanh (QR Code)</div>
                  <div style={{ fontSize: '12px', color: 'var(--pe-text-muted)' }}>Mã quét: {asset.qrCode ?? `QR-AMM-${asset.code}`}</div>
                  <span className={`${styles.statusPill} ${styles.statusPillSuccess}`} style={{ marginTop: '4px' }}>
                    ✓ Sẵn sàng quét hiện trường
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
          {/* Quick Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px' }}>
            <div style={{ padding: '14px', background: '#ffffff', borderRadius: '10px', border: '1px solid var(--pe-border-subtle)', boxShadow: 'var(--pe-shadow-sm)' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--pe-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Giờ chạy tích luỹ</span>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--pe-primary-600)', marginTop: '4px' }}>8,420 giờ</div>
            </div>
            <div style={{ padding: '14px', background: '#ffffff', borderRadius: '10px', border: '1px solid var(--pe-border-subtle)', boxShadow: 'var(--pe-shadow-sm)' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--pe-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Tỷ lệ sẵn sàng</span>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>98.5%</div>
            </div>
            <div style={{ padding: '14px', background: '#ffffff', borderRadius: '10px', border: '1px solid var(--pe-border-subtle)', boxShadow: 'var(--pe-shadow-sm)' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--pe-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Chỉ số MTBF</span>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--pe-text-primary)', marginTop: '4px' }}>720 giờ</div>
            </div>
            <div style={{ padding: '14px', background: '#ffffff', borderRadius: '10px', border: '1px solid var(--pe-border-subtle)', boxShadow: 'var(--pe-shadow-sm)' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--pe-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Chỉ số MTTR</span>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--pe-text-primary)', marginTop: '4px' }}>2.4 giờ</div>
            </div>
          </div>

          {/* Timeline Card */}
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h3>Nhật ký vận hành, bảo dưỡng &amp; Lịch sử sự cố</h3>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setIsIncidentOpen(true)}
              >
                <span>+</span> Ghi nhận sự cố
              </button>
            </div>

            <div style={{ marginTop: '16px', paddingLeft: '8px' }}>
              {historyLogs.map((item) => (
                <div key={item.id} className={styles.timelineItem}>
                  <span className={styles.timelineDot} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--pe-primary-600)' }}>
                      {item.date}
                    </span>
                    <strong style={{ fontSize: '13.5px' }}>{item.title}</strong>
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
                  </div>
                  <p style={{ margin: '0 0 6px', fontSize: '12.5px', color: 'var(--pe-text-secondary)' }}>
                    {item.desc}
                  </p>
                  <small style={{ color: 'var(--pe-text-muted)', fontSize: '11.5px' }}>
                    Người thực hiện: <strong>{item.actor}</strong>
                  </small>
                </div>
              ))}
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
                  {taskTemplate.length === 0 ? '+ Khai báo' : '✎ Chỉnh sửa'}
                </button>
              ) : null}
            </div>

            {editing === 'tasks' ? (
              <div className={styles.inlineEditContainer}>
                <div className={styles.inlineEditHeader}>
                  <span className={styles.inlineEditBadge}>✏️ Chế độ chỉnh sửa đầu việc quy trình</span>
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
                              🗑️
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
                      {saving ? 'Đang lưu…' : '✓ Lưu đầu việc'}
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
    </div>
  );
}
