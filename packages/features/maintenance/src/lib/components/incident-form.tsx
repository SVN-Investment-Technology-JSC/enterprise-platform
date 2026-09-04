'use client';

import type {
  CreateMaintenanceIncidentRequest,
  MaintenanceMatrixRow,
  MaintenancePriority,
  MaintenanceProcedureCatalogEntry,
} from '@enterprise-platform/contracts-maintenance';
import { useMemo, useState, type FormEvent } from 'react';
import styles from './maintenance-history.module.scss';

const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  High: 'Cao',
  Normal: 'Thường',
  Low: 'Thấp',
};

export function IncidentForm({
  assets,
  catalog,
  members,
  busy,
  onCancel,
  onSubmit,
}: {
  assets: readonly MaintenanceMatrixRow[];
  catalog: readonly MaintenanceProcedureCatalogEntry[];
  members: readonly { userId: string; displayName: string }[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateMaintenanceIncidentRequest) => void;
}) {
  const [assetCode, setAssetCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<MaintenancePriority>('High');
  const [procedureDefinitionId, setProcedureDefinitionId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  // Tra tên thiết bị ngay khi gõ mã, để người dùng xác nhận đúng máy (AC-INC-03).
  const asset = useMemo(
    () => assets.find((row) => row.asset.code.toLowerCase() === assetCode.trim().toLowerCase()),
    [assets, assetCode],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assetCode.trim() || !title.trim()) return;
    const member = members.find((item) => item.userId === assigneeId);
    onSubmit({
      assetCode: assetCode.trim(),
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      procedureDefinitionId: procedureDefinitionId || undefined,
      assigneeId: member?.userId,
      assigneeName: member?.displayName,
    });
  };

  return (
    <div
      className={styles.incidentOverlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className={styles.incidentForm}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-incident-title"
      >
      <header className={styles.incidentHeader}>
        <div>
          <span>Phát sinh ngoài kế hoạch</span>
          <h3 id="new-incident-title">Tạo sự cố bảo trì</h3>
          <p>Ghi nhận hỏng hóc đột xuất và tạo phiếu xử lý ngay khi cần.</p>
        </div>
        <button type="button" className={styles.incidentClose} onClick={onCancel} aria-label="Đóng form">
          
        </button>
      </header>

      <div className={styles.incidentGrid}>
        <label>
          Mã thiết bị *
          <input
            list="incident-assets"
            required
            placeholder="VD: MC-901"
            value={assetCode}
            onChange={(event) => setAssetCode(event.target.value)}
          />
          <datalist id="incident-assets">
            {assets.map((row) => (
              <option key={row.asset.code} value={row.asset.code}>
                {row.asset.name}
              </option>
            ))}
          </datalist>
          <small className={asset ? styles.assetOk : styles.assetUnknown}>
            {assetCode.trim()
              ? asset
                ? asset.asset.name
                : 'Chưa khớp thiết bị nào trong Kho'
              : 'Chọn hoặc gõ mã thiết bị'}
          </small>
        </label>

        <label>
          Mức ưu tiên
          <select value={priority} onChange={(event) => setPriority(event.target.value as MaintenancePriority)}>
            {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Tiêu đề sự cố *
        <input
          required
          placeholder="VD: Van AP-003 bị rò rỉ khí nén"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      <label>
        Mô tả chi tiết
        <textarea
          rows={3}
          placeholder="Hiện tượng, thông số đo được, thời điểm phát hiện…"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <div className={styles.incidentGrid}>
        <label>
          Người chịu trách nhiệm
          <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">— Chưa giao —</option>
            {members.map((member, index) => (
              <option key={`${member.userId}-${index}`} value={member.userId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>

        <label>
          Quy trình xử lý
          <select
            value={procedureDefinitionId}
            onChange={(event) => setProcedureDefinitionId(event.target.value)}
          >
            <option value="">— Chỉ ghi nhận, không mở workorder —</option>
            {catalog.map((entry, index) => (
              <option key={`${entry.definitionId}-${index}`} value={entry.definitionId}>
                {entry.code} — {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.incidentActions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? 'Đang ghi nhận…' : 'Tạo sự cố'}
        </button>
        <button type="button" className={styles.reset} onClick={onCancel}>
          Huỷ
        </button>
      </div>
      </form>
    </div>
  );
}
