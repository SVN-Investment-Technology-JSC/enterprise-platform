'use client';

import type { Asset, AssetTaskItem, UpdateAssetRequest } from '@enterprise-platform/contracts-inventory';
import { useState } from 'react';
import { updateAsset } from '../inventory-api';
import {
  ASSET_CRITICALITY_LABEL,
  ASSET_STATUS_LABEL,
  ASSET_TYPE_LABEL,
} from '../inventory-labels';
import styles from '../inventory.module.scss';

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
  busy,
  onSaved,
  onRetire,
}: {
  asset: Asset;
  busy?: boolean;
  onSaved: () => void;
  onRetire?: (asset: Asset) => void;
}) {
  const [activeSubTab, setActiveSubTab] = useState<AssetSubTab>('overview');
  const [editing, setEditing] = useState<'specs' | 'tasks'>();
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

  // Mock Technical Documents
  const documents = [
    { id: 'doc-1', name: 'Huong_dan_van_hanh_su_dung_O&M.pdf', size: '12.4 MB', date: '15/01/2024', type: 'PDF' },
    { id: 'doc-2', name: 'So_do_ban_ve_thiet_ke_CAD_3D.dwg', size: '8.6 MB', date: '20/02/2024', type: 'DWG' },
    { id: 'doc-3', name: 'Chung_chi_chat_luong_xuat_xu_CO_CQ.pdf', size: '2.1 MB', date: '10/01/2024', type: 'PDF' },
    { id: 'doc-4', name: 'Bien_ban_nghiem_thu_chay_thu_Plant1.pdf', size: '4.5 MB', date: '01/03/2024', type: 'PDF' },
    { id: 'doc-5', name: 'Quy_trinh_an_toan_dien_va_co_khi.pdf', size: '1.8 MB', date: '05/01/2024', type: 'PDF' },
  ];

  // Mock Operational History & Incidents
  const historyLogs = [
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
  ];

  // Mock Spare Parts BOM
  const bomItems = [
    { code: 'SKU-MTR-001', name: 'Vòng đệm làm kín Sealing Ring FKM 120mm', stdQty: '02 Cái', isCritical: true, stockQty: 8, status: 'Đủ tồn kho' },
    { code: 'SKU-VLV-045', name: 'Van điều khiển tiết lưu áp suất 10 Bar', stdQty: '01 Cái', isCritical: true, stockQty: 2, status: 'Đủ tồn kho' },
    { code: 'SKU-OIL-102', name: 'Dầu thủy lực bôi trơn ISO VG 46', stdQty: '20 Lít', isCritical: false, stockQty: 150, status: 'Đủ tồn kho' },
    { code: 'SKU-FLG-088', name: 'Gioăng mặt bích chịu nhiệt Graphite', stdQty: '04 Bộ', isCritical: false, stockQty: 1, status: 'Sắp hết' },
  ];

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
    <div style={{ display: 'grid', gap: '16px' }}>
      {/* Top Banner / Asset 360 Head */}
      <div className={styles.card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span className={styles.eyebrow}>
                {ASSET_TYPE_LABEL[asset.type]}
              </span>
              <span className={`${styles.statusPill} ${styles.statusPillSuccess}`}>
                {ASSET_STATUS_LABEL[asset.status]}
              </span>
              <span className={`${styles.statusPill} ${styles.statusPillInfo}`}>
                Cấp {ASSET_CRITICALITY_LABEL[asset.criticality]}
              </span>
            </div>
            <h2 style={{ margin: '4px 0', fontSize: '20px', fontWeight: 800 }}>
              {asset.name}
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--pe-text-muted)' }}>
              Mã thiết bị: <strong style={{ color: 'var(--pe-primary-600)' }}>{asset.code}</strong>
              {asset.serialNumber ? ` · Serial: ${asset.serialNumber}` : ''}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
      </div>

      {error ? (
        <div className={styles.alert}>
          {error}
        </div>
      ) : null}

      {/* 5 SUB-TABS NAVIGATION */}
      <div className={styles.subTabNav}>
        {SUB_TABS.map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
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
              <div style={{ display: 'grid', gap: '10px' }}>
                {specRows.map((row, index) => (
                  <div key={index} style={{ display: 'flex', gap: '8px' }}>
                    <input
                      style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--pe-border-subtle)', borderRadius: '6px', fontSize: '12.5px' }}
                      placeholder="Tên thông số"
                      value={row.key}
                      onChange={(event) =>
                        setSpecRows((rows) =>
                          rows.map((item, position) =>
                            position === index ? { ...item, key: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <input
                      style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--pe-border-subtle)', borderRadius: '6px', fontSize: '12.5px' }}
                      placeholder="Giá trị"
                      value={row.value}
                      onChange={(event) =>
                        setSpecRows((rows) =>
                          rows.map((item, position) =>
                            position === index ? { ...item, value: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
                      onClick={() => setSpecRows((rows) => rows.filter((_, p) => p !== index))}
                      aria-label="Xoá dòng"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={styles.btnSecondary}
                  style={{ width: 'fit-content', padding: '4px 10px', fontSize: '12px' }}
                  onClick={() => setSpecRows((rows) => [...rows, { key: '', value: '' }])}
                >
                  + Thêm dòng
                </button>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    type="button"
                    className={styles.btnPrimary}
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
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setEditing(undefined)}
                  >
                    Huỷ
                  </button>
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
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h3>Hồ sơ tài liệu kỹ thuật &amp; Bản vẽ ({documents.length})</h3>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--pe-text-muted)' }}>
                Tài liệu hướng dẫn vận hành, bản vẽ mạch điện - cơ khí, chứng chỉ CO/CQ và biên bản nghiệm thu.
              </p>
            </div>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => window.alert('Đang mở hộp thoại đính kèm tài liệu mới…')}
            >
              <span>+</span> Đính kèm tài liệu
            </button>
          </div>

          <div style={{ display: 'grid', gap: '10px', marginTop: '12px' }}>
            {documents.map((doc) => (
              <div key={doc.id} className={styles.docCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      background: doc.type === 'PDF' ? '#fee2e2' : '#dbeafe',
                      color: doc.type === 'PDF' ? '#b91c1c' : '#1d4ed8',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: '11px',
                      fontWeight: 800,
                    }}
                  >
                    {doc.type}
                  </div>
                  <div>
                    <strong style={{ fontSize: '13px' }}>{doc.name}</strong>
                    <div style={{ fontSize: '11.5px', color: 'var(--pe-text-muted)' }}>
                      Dung lượng: {doc.size} · Cập nhật ngày: {doc.date}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    style={{ padding: '4px 10px', fontSize: '12px' }}
                    onClick={() => window.alert(`Đang mở xem trước tài liệu ${doc.name}…`)}
                  >
                    👁 Xem
                  </button>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    style={{ padding: '4px 10px', fontSize: '12px' }}
                    onClick={() => window.alert(`Bắt đầu tải xuống ${doc.name}…`)}
                  >
                    ⬇ Tải về
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
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
                onClick={() => window.alert('Đang mở form ghi nhận sự cố / nhật ký…')}
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
        <div style={{ display: 'grid', gap: '16px' }}>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h3>Danh mục Phụ tùng Định mức (Bill of Materials - BOM)</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--pe-text-muted)' }}>
                  Danh sách phụ tùng tiêu chuẩn dùng cho lắp ráp, thay thế và bảo dưỡng định kỳ của {asset.name}.
                </p>
              </div>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => window.alert('Đang mở màn hình lập phiếu xuất kho theo BOM…')}
              >
                <span>↗</span> Xuất vật tư theo BOM
              </button>
            </div>

            <div className={styles.tableWrap} style={{ marginTop: '12px' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Mã phụ tùng (SKU)</th>
                    <th>Tên phụ tùng thay thế</th>
                    <th style={{ textAlign: 'center' }}>Định mức</th>
                    <th>Phân loại</th>
                    <th style={{ textAlign: 'right' }}>Tồn khả dụng</th>
                    <th>Trạng thái tồn</th>
                  </tr>
                </thead>
                <tbody>
                  {bomItems.map((item) => (
                    <tr key={item.code}>
                      <td style={{ fontWeight: 700, color: 'var(--pe-primary-600)' }}>
                        {item.code}
                      </td>
                      <td>
                        <strong>{item.name}</strong>
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600 }}>
                        {item.stdQty}
                      </td>
                      <td>
                        {item.isCritical ? (
                          <span className={`${styles.statusPill} ${styles.statusPillDanger}`} style={{ fontSize: '11px' }}>
                            ★ Trọng yếu (Critical Spare)
                          </span>
                        ) : (
                          <span className={`${styles.statusPill} ${styles.statusPillInfo}`} style={{ fontSize: '11px' }}>
                            Tiêu chuẩn
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>
                        {item.stockQty}
                      </td>
                      <td>
                        <span className={item.stockQty > 2 ? `${styles.statusPill} ${styles.statusPillSuccess}` : `${styles.statusPill} ${styles.statusPillWarn}`}>
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Cross-Plant Spare Parts Buffer */}
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>🏭</span>
                <div>
                  <strong style={{ fontSize: '13.5px', color: '#1e40af' }}>
                    Dự phòng liên nhà máy (Cross-Plant Spare Parts Buffer)
                  </strong>
                  <div style={{ fontSize: '12px', color: '#3b82f6', marginTop: '2px' }}>
                    Phát hiện 01 cụm phụ tùng tương thích đang có sẵn tại Phân xưởng 2 (Plant 2 - SB-HN-T-Sh-Ro-02).
                  </div>
                </div>
              </div>
              <button
                type="button"
                className={styles.btnSecondary}
                style={{ fontSize: '12.5px', padding: '6px 14px' }}
                onClick={() => window.alert('Đang mở yêu cầu điều chuyển phụ tùng từ Plant 2…')}
              >
                Yêu cầu điều chuyển
              </button>
            </div>
          </div>
        </div>
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
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => window.alert('Đang mở giao diện lập kế hoạch bảo dưỡng mới…')}
              >
                <span>+</span> Tạo lịch bảo dưỡng
              </button>
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
              <div style={{ display: 'grid', gap: '10px' }}>
                {taskRows.map((task, index) => (
                  <div key={index} style={{ display: 'flex', gap: '6px' }}>
                    <input
                      placeholder="Mã"
                      style={{ width: '70px', padding: '6px', border: '1px solid var(--pe-border-subtle)', borderRadius: '6px', fontSize: '12px' }}
                      value={task.key}
                      onChange={(event) =>
                        setTaskRows((rows) =>
                          rows.map((item, position) =>
                            position === index ? { ...item, key: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <input
                      placeholder="Tên đầu việc"
                      style={{ flex: 1, padding: '6px', border: '1px solid var(--pe-border-subtle)', borderRadius: '6px', fontSize: '12px' }}
                      value={task.name}
                      onChange={(event) =>
                        setTaskRows((rows) =>
                          rows.map((item, position) =>
                            position === index ? { ...item, name: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <input
                      placeholder="Phút"
                      type="number"
                      style={{ width: '60px', padding: '6px', border: '1px solid var(--pe-border-subtle)', borderRadius: '6px', fontSize: '12px' }}
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
                    <button
                      type="button"
                      style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
                      onClick={() => setTaskRows((rows) => rows.filter((_, p) => p !== index))}
                      aria-label="Xoá dòng"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={styles.btnSecondary}
                  style={{ width: 'fit-content', padding: '4px 10px', fontSize: '12px' }}
                  onClick={() =>
                    setTaskRows((rows) => [
                      ...rows,
                      { key: `T${rows.length + 1}`, name: '', durationMinutes: 30 },
                    ])
                  }
                >
                  + Thêm đầu việc
                </button>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    disabled={saving}
                    onClick={() =>
                      save({
                        taskTemplate: taskRows.filter((task) => task.name.trim()),
                      })
                    }
                  >
                    {saving ? 'Đang lưu…' : 'Lưu đầu việc'}
                  </button>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setEditing(undefined)}
                  >
                    Huỷ
                  </button>
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
    </div>
  );
}
