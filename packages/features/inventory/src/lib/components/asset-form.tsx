'use client';

import type {
  Asset,
  AssetCriticality,
  AssetType,
  CreateAssetRequest,
  Material,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useState, useMemo, type FormEvent } from 'react';
import { ASSET_CRITICALITY_LABEL } from '../inventory-labels';
import styles from '../inventory.module.scss';

export function AssetForm({
  assets,
  materials = [],
  defaultParentCode,
  isRootOnly = false,
  busy,
  onCancel,
  onSubmit,
}: {
  assets: readonly Asset[];
  materials?: readonly Material[];
  defaultParentCode?: string;
  isRootOnly?: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateAssetRequest) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isCustomCode, setIsCustomCode] = useState(false);
  const type: AssetType = 'EQUIPMENT';
  const [criticality, setCriticality] = useState<AssetCriticality>('HIGH');
  const [parentCode, setParentCode] = useState(isRootOnly ? '' : defaultParentCode ?? '');
  const [serialNumber, setSerialNumber] = useState('');

  const materialOptions = useMemo(
    () =>
      materials.map((mat) => ({
        value: mat.code,
        label: `${mat.code} — ${mat.name}`,
        badge: mat.category,
      })),
    [materials],
  );

  const parentOptions = useMemo(
    () => [
      { value: '', label: '— Là node gốc (Cấp cao nhất) —' },
      ...assets.map((a) => ({
        value: a.code,
        label: `${a.code} — ${a.name}`,
        badge: a.code,
      })),
    ],
    [assets],
  );

  const criticalityOptions = useMemo(
    () =>
      (Object.keys(ASSET_CRITICALITY_LABEL) as AssetCriticality[]).map((c) => ({
        value: c,
        label: ASSET_CRITICALITY_LABEL[c],
      })),
    [],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!code.trim() || !name.trim()) return;
    onSubmit({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      type,
      criticality,
      parentCode: isRootOnly ? undefined : parentCode || undefined,
      serialNumber: serialNumber.trim() || undefined,
    });
  };

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        className={styles.modalDialog}
        style={{
          maxWidth: '520px',
          background: '#f5f5f5',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
          padding: '24px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header theo quy chuẩn Typography & Close Button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: '16px',
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 700,
                color: '#333333',
                lineHeight: 1.25,
              }}
            >
              {isRootOnly ? 'Tạo Thiết bị / Cụm gốc' : 'Thêm vật tư lắp đặt'}
            </h2>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: '13.5px',
                color: '#666666',
                lineHeight: 1.4,
              }}
            >
              {isRootOnly
                ? 'Thiết bị hoặc công trình cấp cao nhất (Root Node) trên cây tài sản 360.'
                : 'Khai báo thiết bị và phân bổ vào cây cấu trúc tài sản.'}
            </p>
          </div>
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              padding: 0,
              border: 'none',
              borderRadius: '4px',
              background: 'transparent',
              color: '#666666',
              fontSize: '16px',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
            }}
            onClick={onCancel}
            title="Đóng (ESC)"
          >
            
          </button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Trường Thiết bị / Mã thiết bị */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
                Thiết bị / Vật tư trong kho <span style={{ color: '#dc2626' }}>*</span>
              </label>
              {materials.length > 0 && (
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    fontSize: '12.5px',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                  onClick={() => {
                    setIsCustomCode((prev) => !prev);
                  }}
                >
                  {isCustomCode ? 'Chọn từ danh mục kho' : 'Nhập mã tuỳ biến'}
                </button>
              )}
            </div>

            {materials.length > 0 && !isCustomCode ? (
              <SearchableSelect
                options={materialOptions}
                value={code}
                placeholder="Tìm mã hoặc tên vật tư / thiết bị từ kho…"
                emptyText="Không tìm thấy vật tư phù hợp"
                onChange={(selectedCode) => {
                  setCode(selectedCode);
                  const selectedMat = materials.find((m) => m.code === selectedCode);
                  if (selectedMat) {
                    setName(selectedMat.name);
                  }
                }}
                clearable
                style={{ width: '100%' }}
              />
            ) : (
              <input
                style={{
                  padding: '10px 12px',
                  borderRadius: '4px',
                  border: '1px solid #e0e0e0',
                  background: '#ffffff',
                  fontSize: '15px',
                  color: '#333333',
                  outline: 'none',
                }}
                required
                placeholder="VD: TBA-220, NM-SAVINA, TR-01…"
                value={code}
                autoFocus
                onChange={(event) => setCode(event.target.value)}
              />
            )}
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {materials.length > 0 && !isCustomCode
                ? 'Chọn thiết bị/vật tư đã được khai báo trong danh mục vật tư kho.'
                : 'Mã định danh viết hoa duy nhất dùng trong quản trị và vận hành.'}
            </span>
          </div>

          {/* Tên thiết bị */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
              Tên thiết bị / Cụm tài sản <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              style={{
                padding: '10px 12px',
                borderRadius: '4px',
                border: '1px solid #e0e0e0',
                background: '#ffffff',
                fontSize: '15px',
                color: '#333333',
                outline: 'none',
              }}
              required
              placeholder="VD: Trạm biến áp 220kV Savina, Dây chuyền sản xuất 1…"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {/* Vị trí phân cấp / Node cha */}
          {!isRootOnly ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
                Thuộc thiết bị cha
              </label>
              <SearchableSelect
                options={parentOptions}
                value={parentCode}
                placeholder="— Là node gốc (Cấp cao nhất) —"
                emptyText="Không tìm thấy thiết bị cha phù hợp"
                onChange={(val) => setParentCode(val)}
                clearable
                style={{ width: '100%' }}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
                Vị trí phân cấp
              </label>
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: '4px',
                  background: '#ffffff',
                  border: '1px solid #e0e0e0',
                  fontSize: '14px',
                  color: '#1e293b',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span style={{ fontSize: '16px' }}></span>
                <span>
                  <strong>Cấp 0 (Node gốc)</strong> — Cụm tài sản độc lập cao nhất trên cây
                </span>
              </div>
            </div>
          )}

          {/* Hàng 2 cột: Mức độ quan trọng & Serial */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
                Mức độ quan trọng
              </label>
              <SearchableSelect
                options={criticalityOptions}
                value={criticality}
                placeholder="Chọn mức độ quan trọng…"
                emptyText="Không tìm thấy mức độ phù hợp"
                clearable={false}
                onChange={(val) => setCriticality(val as AssetCriticality)}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
                Số Serial / Khung
              </label>
              <input
                style={{
                  padding: '9px 12px',
                  borderRadius: '4px',
                  border: '1px solid #e0e0e0',
                  background: '#ffffff',
                  fontSize: '14.5px',
                  color: '#333333',
                  outline: 'none',
                }}
                placeholder="Tùy chọn"
                value={serialNumber}
                onChange={(event) => setSerialNumber(event.target.value)}
              />
            </div>
          </div>

          {/* Footer Actions theo đúng Spacing và Màu sắc chuẩn */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '12px',
              marginTop: '18px',
              paddingTop: '16px',
              borderTop: '1px solid #e5e7eb',
            }}
          >
            <button
              type="button"
              style={{
                padding: '9px 16px',
                borderRadius: '4px',
                border: '1px solid #d1d5db',
                background: 'transparent',
                color: '#4b5563',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              disabled={busy}
              onClick={onCancel}
            >
              Huỷ
            </button>
            <button
              type="submit"
              style={{
                padding: '9px 20px',
                borderRadius: '4px',
                border: 'none',
                background: busy || !code.trim() || !name.trim() ? '#93c5fd' : '#2563eb',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: 700,
                cursor: busy || !code.trim() || !name.trim() ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s ease',
              }}
              disabled={busy || !code.trim() || !name.trim()}
            >
              {busy ? 'Đang tạo…' : isRootOnly ? 'Xác nhận tạo gốc' : 'Lưu thiết bị'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
