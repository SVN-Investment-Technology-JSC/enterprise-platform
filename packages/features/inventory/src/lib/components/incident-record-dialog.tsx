'use client';

import type { Asset } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import styles from '../inventory.module.scss';

export interface IncidentLogRecord {
  id: string;
  date: string;
  title: string;
  badge: string;
  badgeType: 'success' | 'warn' | 'info' | 'danger';
  desc: string;
  actor: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  workOrderRef?: string;
  source?: 'inventory_local' | 'maintenance_module';
  syncToMaintenance?: boolean;
}

export function IncidentRecordDialog({
  asset,
  onCancel,
  onSubmit,
}: {
  asset: Asset;
  onCancel: () => void;
  onSubmit: (log: IncidentLogRecord) => void;
}) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('MEDIUM');
  const [category, setCategory] = useState('Hỏng hóc / Kẹt cơ khí');
  const [description, setDescription] = useState('');
  const [reporter, setReporter] = useState('KTV. Vận hành');
  const [syncToMaintenance, setSyncToMaintenance] = useState(true);

  const isFormValid = title.trim().length > 0 && description.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;

    const now = new Date();
    const formattedDate = `${String(now.getDate()).padStart(2, '0')}/${String(
      now.getMonth() + 1,
    ).padStart(2, '0')}/${now.getFullYear()}`;

    const severityLabels: Record<string, { badge: string; badgeType: 'info' | 'warn' | 'danger' }> = {
      LOW: { badge: 'Sự cố Nhẹ (P4)', badgeType: 'info' },
      MEDIUM: { badge: 'Sự cố Vừa (P3)', badgeType: 'warn' },
      HIGH: { badge: 'Sự cố Nghiêm trọng (P2)', badgeType: 'danger' },
      CRITICAL: { badge: 'Khẩn cấp / Dừng máy (P1)', badgeType: 'danger' },
    };

    const config = severityLabels[severity] || { badge: 'Sự cố', badgeType: 'warn' };
    const simulatedWoNumber = `INC-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newLog: IncidentLogRecord = {
      id: `incident-${Date.now()}`,
      date: formattedDate,
      title: `[${category}] ${title.trim()}`,
      badge: config.badge,
      badgeType: config.badgeType,
      desc: description.trim(),
      actor: reporter.trim() || 'KTV. Vận hành',
      severity,
      workOrderRef: simulatedWoNumber,
      source: 'inventory_local',
      syncToMaintenance,
    };

    onSubmit(newLog);
  };

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        className={styles.modalDialog}
        style={{
          maxWidth: '580px',
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          border: '1px solid #e2e8f0',
          padding: '24px',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: '18px',
            borderBottom: '1px solid #f1f5f9',
            paddingBottom: '14px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={20} color="#dc2626" />
              <h2
                style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: 700,
                  color: '#0f172a',
                }}
              >
                Ghi nhận sự cố thiết bị
              </h2>
            </div>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: '13px',
                color: '#64748b',
              }}
            >
              Thiết bị: <strong>{asset.name}</strong> ({asset.code})
            </p>
          </div>
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              padding: 0,
              border: 'none',
              borderRadius: '6px',
              background: '#f1f5f9',
              color: '#64748b',
              fontSize: '14px',
              cursor: 'pointer',
            }}
            onClick={onCancel}
            title="Đóng (ESC)"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
          {/* Mức độ ưu tiên / Nghiêm trọng */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 600,
                color: '#334155',
                marginBottom: '6px',
              }}
            >
              Mức độ sự cố / Mức độ ưu tiên <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              {(
                [
                  { id: 'LOW', label: 'Thấp (P4)', color: '#64748b', bg: '#f8fafc', border: '#cbd5e1' },
                  { id: 'MEDIUM', label: 'Trung bình (P3)', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
                  { id: 'HIGH', label: 'Cao (P2)', color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' },
                  { id: 'CRITICAL', label: 'Khẩn cấp (P1)', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
                ] as const
              ).map((lvl) => {
                const isSelected = severity === lvl.id;
                return (
                  <button
                    key={lvl.id}
                    type="button"
                    onClick={() => setSeverity(lvl.id)}
                    style={{
                      padding: '8px 4px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: isSelected ? 700 : 500,
                      textAlign: 'center',
                      border: isSelected ? `2px solid ${lvl.color}` : `1px solid ${lvl.border}`,
                      background: isSelected ? lvl.bg : '#ffffff',
                      color: isSelected ? lvl.color : '#475569',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {lvl.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Phân loại sự cố & Người báo cáo */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#334155',
                  marginBottom: '6px',
                }}
              >
                Phân loại sự cố
              </label>
              <SearchableSelect
                options={[
                  { value: 'Hỏng hóc / Kẹt cơ khí', label: 'Hỏng hóc / Kẹt cơ khí' },
                  { value: 'Sự cố điện / Chập cháy / Điều khiển', label: 'Sự cố điện / Chập cháy / Điều khiển' },
                  { value: 'Rò rỉ dầu / Khí / Áp suất', label: 'Rò rỉ dầu / Khí / Áp suất' },
                  { value: 'Nhiệt độ / Rung động bất thường', label: 'Nhiệt độ / Rung động cao' },
                  { value: 'Lỗi phần mềm / Cảm biến SCADA', label: 'Lỗi cảm biến / SCADA' },
                  { value: 'Khác', label: 'Khác' },
                ]}
                value={category}
                onChange={(val) => setCategory(val)}
                placeholder="Tìm hoặc chọn phân loại sự cố…"
                emptyText="Không tìm thấy phân loại phù hợp"
                clearable={false}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#334155',
                  marginBottom: '6px',
                }}
              >
                Người ghi nhận / Báo cáo
              </label>
              <input
                type="text"
                value={reporter}
                onChange={(e) => setReporter(e.target.value)}
                placeholder="VD: KTV. Nguyễn Văn A"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Tiêu đề tóm tắt sự cố */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 600,
                color: '#334155',
                marginBottom: '6px',
              }}
            >
              Tiêu đề tóm tắt sự cố <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Phát hiện tiếng ồn lạ và nhiệt độ thân bơm tăng cao"
              required
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Chi tiết mô tả */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 600,
                color: '#334155',
                marginBottom: '6px',
              }}
            >
              Mô tả chi tiết hiện trường & Triệu chứng <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả cụ thể biểu hiện lúc xảy ra sự cố, tác động tới dây chuyền, các biện pháp sơ bộ đã thực hiện..."
              required
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                resize: 'vertical',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Checkbox đồng bộ sang module Bảo trì nếu có */}
          <div style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#334155', cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={syncToMaintenance}
                onChange={(e) => setSyncToMaintenance(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>
                <strong>Đồng bộ sang Module Bảo trì (CMMS):</strong> Tự động tạo phiếu sự cố khẩn cấp (Incident Ticket) nếu đơn vị có kích hoạt module Bảo trì.
              </span>
            </label>
          </div>

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '10px',
              paddingTop: '12px',
              borderTop: '1px solid #f1f5f9',
              marginTop: '4px',
            }}
          >
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontSize: '13.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={!isFormValid}
              style={{
                padding: '8px 20px',
                borderRadius: '6px',
                border: 'none',
                background: !isFormValid ? '#93c5fd' : '#2563eb',
                color: '#ffffff',
                fontSize: '13.5px',
                fontWeight: 600,
                cursor: !isFormValid ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s ease',
              }}
            >
              Lưu &amp; Ghi nhận nhật ký
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
