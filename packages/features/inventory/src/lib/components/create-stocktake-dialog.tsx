'use client';

import type { CreateStocktakeRequest, StocktakeScopeType } from '@enterprise-platform/contracts-inventory';
import type { InventoryWorkspace } from '../inventory-api';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useState } from 'react';
import { X, ClipboardCheck, AlertCircle } from 'lucide-react';

export interface CreateStocktakeDialogProps {
  workspace: InventoryWorkspace;
  busy?: boolean;
  initialWarehouseCode?: string;
  onClose: () => void;
  onSubmit: (input: CreateStocktakeRequest) => Promise<void>;
}

export function CreateStocktakeDialog({
  workspace,
  busy = false,
  initialWarehouseCode,
  onClose,
  onSubmit,
}: CreateStocktakeDialogProps) {
  const currentYear = new Date().getFullYear();
  const [title, setTitle] = useState(`Kiểm kê kho định kỳ - Quý ${Math.floor(new Date().getMonth() / 3) + 1}/${currentYear}`);
  const [warehouseCode, setWarehouseCode] = useState(initialWarehouseCode || workspace.warehouses[0]?.code || 'WH-CENTRAL');
  const [scopeType, setScopeType] = useState<StocktakeScopeType>('ALL');
  const [leadAuditor, setLeadAuditor] = useState('Thủ kho trưởng');
  const [auditors, setAuditors] = useState('Nguyễn Văn An, Trần Thị Mai');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();

  const warehouseOptions = workspace.warehouses.map((w) => ({
    value: w.code,
    label: `${w.code} — ${w.name || 'Kho'}`,
    description: w.location,
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Vui lòng nhập tên đợt kiểm kê.');
      return;
    }
    if (!warehouseCode) {
      setError('Vui lòng chọn kho kiểm kê.');
      return;
    }

    try {
      const auditorList = auditors
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await onSubmit({
        title: title.trim(),
        warehouseCode,
        scopeType,
        leadAuditor: leadAuditor.trim() || undefined,
        auditors: auditorList,
        note: note.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể khởi tạo đợt kiểm kê.');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1060,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(4px)',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          width: '540px',
          maxWidth: '92vw',
          background: '#ffffff',
          borderRadius: '8px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ClipboardCheck size={20} color="#2563eb" />
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                Khởi tạo Đợt Kiểm kê Kho
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                Thiết lập thông tin đợt kiểm kê và phạm vi đối soát sổ sách.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: '32px',
              height: '32px',
              border: 'none',
              borderRadius: '6px',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {error ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 12px',
                background: '#fee2e2',
                border: '1px solid #fca5a5',
                borderRadius: '6px',
                color: '#b91c1c',
                fontSize: '12.5px',
              }}
            >
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          ) : null}

          {/* Tên đợt */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              Tên đợt kiểm kê <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Kiểm kê định kỳ Kho Trung tâm - Tháng 9/2026"
              style={{
                padding: '8px 12px',
                fontSize: '13.5px',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                outline: 'none',
              }}
              required
            />
          </div>

          {/* Kho hàng */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              Kho kiểm kê <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <SearchableSelect
              options={warehouseOptions}
              value={warehouseCode}
              onChange={(val) => setWarehouseCode(val)}
              placeholder="Tìm chọn kho hàng..."
              clearable={false}
            />
          </div>

          {/* Phạm vi */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              Phạm vi kiểm kê
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setScopeType('ALL')}
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: scopeType === 'ALL' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                  background: scopeType === 'ALL' ? '#eff6ff' : '#ffffff',
                  color: scopeType === 'ALL' ? '#1d4ed8' : '#475569',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '12.5px',
                }}
              >
                <div>Toàn bộ kho</div>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 400 }}>
                  Đối soát tất cả mặt hàng có tồn
                </span>
              </button>
              <button
                type="button"
                onClick={() => setScopeType('CATEGORY')}
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: scopeType === 'CATEGORY' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                  background: scopeType === 'CATEGORY' ? '#eff6ff' : '#ffffff',
                  color: scopeType === 'CATEGORY' ? '#1d4ed8' : '#475569',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '12.5px',
                }}
              >
                <div>Theo nhóm vật tư</div>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 400 }}>
                  Kiểm đếm chọn lọc theo phân loại
                </span>
              </button>
            </div>
          </div>

          {/* Tổ kiểm kê */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                Trưởng nhóm kiểm kê
              </label>
              <input
                type="text"
                value={leadAuditor}
                onChange={(e) => setLeadAuditor(e.target.value)}
                placeholder="Họ tên trưởng nhóm"
                style={{
                  padding: '8px 12px',
                  fontSize: '13px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                Thành viên tham gia
              </label>
              <input
                type="text"
                value={auditors}
                onChange={(e) => setAuditors(e.target.value)}
                placeholder="Phân cách bằng dấu phẩy"
                style={{
                  padding: '8px 12px',
                  fontSize: '13px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                }}
              />
            </div>
          </div>

          {/* Ghi chú */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              Mục đích &amp; Ghi chú đợt kiểm kê
            </label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: Kiểm kê định kỳ phục vụ kiểm toán tài chính quý 3..."
              style={{
                padding: '8px 12px',
                fontSize: '13px',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                resize: 'none',
              }}
            />
          </div>

          {/* Footer buttons */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              marginTop: '10px',
              paddingTop: '14px',
              borderTop: '1px solid #e2e8f0',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 600,
                background: 'transparent',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                color: '#475569',
                cursor: 'pointer',
              }}
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={busy}
              style={{
                padding: '8px 18px',
                fontSize: '13px',
                fontWeight: 700,
                background: '#2563eb',
                border: 'none',
                borderRadius: '4px',
                color: '#ffffff',
                cursor: 'pointer',
              }}
            >
              {busy ? 'Đang tạo...' : 'Tạo đợt kiểm kê'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
