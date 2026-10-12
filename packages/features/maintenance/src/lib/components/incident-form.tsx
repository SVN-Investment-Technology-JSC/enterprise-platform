'use client';

import type {
  CreateMaintenanceIncidentRequest,
  MaintenanceMatrixRow,
  MaintenancePriority,
  MaintenanceProcedureCatalogEntry,
} from '@enterprise-platform/contracts-maintenance';
import { MinimalPopupForm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { Paperclip, Upload, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import styles from './maintenance-history.module.scss';

const PRIORITY_OPTIONS = [
  { value: 'High', label: 'Cao' },
  { value: 'Normal', label: 'Thường' },
  { value: 'Low', label: 'Thấp' },
];

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
  onSubmit: (input: CreateMaintenanceIncidentRequest, files?: File[]) => Promise<void> | void;
}) {
  const [assetCode, setAssetCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<MaintenancePriority>('High');
  const [procedureDefinitionId, setProcedureDefinitionId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [attachments, setAttachments] = useState<{ file: File; name: string; size: string }[]>([]);
  const [formError, setFormError] = useState<string>();

  // Tra tên thiết bị ngay khi chọn hoặc gõ mã
  const asset = useMemo(
    () => assets.find((row) => row.asset.code.toLowerCase() === assetCode.trim().toLowerCase()),
    [assets, assetCode],
  );

  // Danh mục thiết bị dạng SearchableSelectOption
  const assetOptions = useMemo(() => {
    return assets.map((row) => ({
      value: row.asset.code,
      label: `${row.asset.name} (${row.asset.code})`,
      description: row.asset.orgUnitId ? `Đơn vị: ${row.asset.orgUnitId}` : 'Kho thiết bị',
      badge: row.asset.code,
    }));
  }, [assets]);

  // Danh mục thành viên phụ trách dạng SearchableSelectOption
  const memberOptions = useMemo(() => {
    return members.map((member) => ({
      value: member.userId,
      label: member.displayName,
      description: member.userId,
    }));
  }, [members]);

  // Danh mục quy trình dạng SearchableSelectOption
  const procedureOptions = useMemo(() => {
    return catalog.map((entry) => ({
      value: entry.definitionId,
      label: `${entry.code} — ${entry.name}`,
      description: entry.code,
    }));
  }, [catalog]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assetCode.trim()) {
      setFormError('Vui lòng chọn thiết bị phát sinh sự cố');
      return;
    }
    if (!title.trim()) {
      setFormError('Vui lòng nhập tiêu đề sự cố');
      return;
    }
    setFormError(undefined);
    const member = members.find((item) => item.userId === assigneeId);
    onSubmit(
      {
        assetCode: assetCode.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        procedureDefinitionId: procedureDefinitionId || undefined,
        assigneeId: member?.userId,
        assigneeName: member?.displayName,
      },
      attachments.map((a) => a.file),
    );
  };

  return (
    <MinimalPopupForm
      isOpen
      title="Tạo sự cố bảo trì"
      subtitle="Ghi nhận hỏng hóc đột xuất và tạo phiếu xử lý ngay khi cần."
      onClose={onCancel}
    >
      <form className={styles.incidentForm} onSubmit={submit} noValidate>
        <div>
          <span className={styles.dangerBadge}>Phát sinh ngoài kế hoạch</span>
        </div>

        {formError ? (
          <p style={{ color: '#dc2626', fontSize: '13px', margin: 0 }}>{formError}</p>
        ) : null}

        <div className={styles.incidentGrid}>
          <div className={styles.formField}>
            <label htmlFor="incident-asset">Thiết bị gặp sự cố *</label>
            <SearchableSelect
              options={assetOptions}
              value={assetCode}
              placeholder="Tìm mã hoặc tên thiết bị…"
              clearable
              onChange={(val) => {
                setAssetCode(val);
                if (formError) setFormError(undefined);
              }}
            />
            {assetCode.trim() ? (
              <p className={asset ? styles.assetOk : styles.assetUnknown}>
                {asset ? asset.asset.name : 'Mã thiết bị chưa có trong danh mục'}
              </p>
            ) : (
              <p className={styles.assetUnknown}>Gõ mã hoặc tên để chọn nhanh thiết bị</p>
            )}
          </div>

          <div className={styles.formField}>
            <label htmlFor="incident-priority">Mức ưu tiên *</label>
            <SearchableSelect
              options={PRIORITY_OPTIONS}
              value={priority}
              clearable={false}
              placeholder="Chọn mức ưu tiên…"
              onChange={(val) => setPriority((val || 'High') as MaintenancePriority)}
            />
          </div>
        </div>

        <div className={styles.formField}>
          <label htmlFor="incident-title">Tiêu đề sự cố *</label>
          <input
            id="incident-title"
            required
            placeholder="VD: Van AP-003 bị rò rỉ khí nén, động cơ quá nhiệt…"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (formError) setFormError(undefined);
            }}
          />
        </div>

        <div className={styles.formField}>
          <label htmlFor="incident-desc">Mô tả chi tiết</label>
          <textarea
            id="incident-desc"
            rows={3}
            placeholder="Hiện tượng, thông số đo được, vị trí cụm máy, thời điểm phát hiện…"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        {/* Tệp đính kèm hiện trường sự cố */}
        <div className={styles.formField}>
          <label className={styles.actionLabel}>
            Tệp đính kèm hiện trường (Ảnh, tài liệu sự cố)
          </label>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '10px 12px',
              borderRadius: '6px',
              border: '1px dashed #cbd5e1',
              background: '#f8fafc',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label
                htmlFor="incident-file-upload"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '5px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#1e293b',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  transition: 'all 0.15s ease',
                }}
              >
                <Upload size={14} />
                <span>Tải tệp lên</span>
              </label>
              <input
                id="incident-file-upload"
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.mp4,.mov"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const files = event.target.files;
                  if (!files || files.length === 0) return;
                  const ALLOWED_EXTENSIONS = new Set([
                    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'
                  ]);
                  const MAX_BYTES = 25 * 1024 * 1024;
                  const validFiles: { file: File; name: string; size: string }[] = [];
                  const rejectedNames: string[] = [];

                  Array.from(files).forEach((file) => {
                    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
                    if (!ALLOWED_EXTENSIONS.has(ext)) {
                      rejectedNames.push(`${file.name} (định dạng không được hỗ trợ)`);
                      return;
                    }
                    if (file.size > MAX_BYTES) {
                      rejectedNames.push(`${file.name} (vượt quá 25MB)`);
                      return;
                    }
                    validFiles.push({
                      file,
                      name: file.name,
                      size:
                        file.size < 1024 * 1024
                          ? `${(file.size / 1024).toFixed(1)} KB`
                          : `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
                    });
                  });

                  if (rejectedNames.length > 0) {
                    alert(`Không thể tải lên các tệp sau:\n- ${rejectedNames.join('\n- ')}\n\nChỉ chấp nhận các tệp hình ảnh, tài liệu và video ngắn (.jpg, .png, .pdf, .doc, .xlsx, .mp4) dung lượng tối đa 25MB.`);
                  }

                  if (validFiles.length > 0) {
                    setAttachments((prev) => [...prev, ...validFiles]);
                  }
                  event.target.value = '';
                }}
              />
              <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                (Ảnh chụp hiện trường, biên bản, video ngắn - Tối đa 25MB)
              </span>
            </div>

            {/* Danh sách tệp đã thêm */}
            {attachments.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                {attachments.map((file, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                      <Paperclip size={13} style={{ color: '#2563eb', flexShrink: 0 }} />
                      <span
                        style={{
                          color: '#2563eb',
                          fontWeight: 500,
                          textOverflow: 'ellipsis',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {file.name}
                      </span>
                      <small style={{ color: '#94a3b8' }}>({file.size})</small>
                    </div>
                    <button
                      type="button"
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                      title="Gỡ tệp"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className={styles.incidentGrid}>
          <div className={styles.formField}>
            <label htmlFor="incident-assignee">Người chịu trách nhiệm</label>
            <SearchableSelect
              options={memberOptions}
              value={assigneeId}
              clearable
              placeholder="Tìm và giao nhân sự xử lý…"
              onChange={(val) => setAssigneeId(val)}
            />
          </div>

          <div className={styles.formField}>
            <label htmlFor="incident-procedure">Quy trình xử lý</label>
            <SearchableSelect
              options={procedureOptions}
              value={procedureDefinitionId}
              clearable
              placeholder="Chọn quy trình (hoặc bỏ trống để chỉ ghi nhận)…"
              onChange={(val) => setProcedureDefinitionId(val)}
            />
          </div>
        </div>

        <div className={styles.incidentActions}>
          <button
            type="button"
            className={styles.incidentCancelBtn}
            onClick={onCancel}
            disabled={busy}
          >
            Huỷ
          </button>
          <button
            type="submit"
            className={styles.incidentSubmitBtn}
            disabled={busy}
          >
            {busy ? 'Đang ghi nhận…' : 'Tạo sự cố'}
          </button>
        </div>
      </form>
    </MinimalPopupForm>
  );
}
