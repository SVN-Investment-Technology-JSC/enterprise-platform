'use client';

import type { Material } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import type { AuditorCandidate } from '../inventory-api';
import { FormError, useFormSubmit } from './form-error';
import styles from '../inventory.module.scss';

/**
 * Form cấp phát tài sản cho nhân viên. Hai trường nằm trong form, không để ngoài màn hình:
 * chỉ tài sản đang tồn kho (chưa có người nhận, không bảo trì) mới chọn được.
 */
export function CustodyAssignDialog({
  assets,
  employees,
  initialCode,
  busy,
  onCancel,
  onSubmit,
}: {
  /** Tài sản chưa cấp phát. */
  assets: readonly Material[];
  employees: readonly AuditorCandidate[];
  initialCode?: string;
  busy?: boolean;
  onCancel: () => void;
  /** Từ chối (reject) khi Kho báo lỗi để form hiện lý do và giữ lựa chọn. */
  onSubmit: (asset: Material, employeeId: string) => Promise<void> | void;
}) {
  const [assetCode, setAssetCode] = useState(initialCode ?? '');
  const [employeeId, setEmployeeId] = useState('');
  const { error, submit: send } = useFormSubmit('Không cấp phát được tài sản.');

  const assetOptions = useMemo(
    () => assets.map((a) => ({ value: a.code, label: a.name, badge: a.code })),
    [assets],
  );
  const employeeOptions = useMemo(
    () => employees.map((e) => ({ value: e.id, label: e.name, badge: e.code })),
    [employees],
  );

  const target = assets.find((a) => a.code === assetCode);
  const ready = Boolean(target) && employeeId !== '';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || !employeeId) return;
    void send(() => onSubmit(target, employeeId));
  };

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        className={styles.modalDialog}
        style={{ maxWidth: '520px' }}
        role="dialog"
        aria-modal="true"
        aria-label="Cấp phát tài sản"
        onClick={(event) => event.stopPropagation()}
      >
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className={styles.modalHead}>
            <div>
              <h2>Cấp phát tài sản</h2>
              <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#64748b' }}>
                Chọn tài sản đang tồn kho và nhân viên nhận.
              </p>
            </div>
            <button type="button" className={styles.closeButton} onClick={onCancel} title="Đóng" aria-label="Đóng">
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          <div className={styles.modalBody} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
            <div className={styles.formGroup}>
              <label>
                Tài sản chưa cấp phát <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <SearchableSelect
                options={assetOptions}
                value={assetCode}
                placeholder="— Chọn tài sản —"
                searchPlaceholder="Tìm mã hoặc tên tài sản…"
                emptyText="Không còn tài sản chưa cấp phát"
                onChange={setAssetCode}
                clearable
                height={42}
                style={{ width: '100%' }}
              />
            </div>
            <div className={styles.formGroup}>
              <label>
                Nhân viên nhận <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <SearchableSelect
                options={employeeOptions}
                value={employeeId}
                placeholder="— Chọn nhân viên —"
                searchPlaceholder="Tìm tên hoặc mã nhân viên…"
                emptyText="Không tìm thấy nhân viên"
                onChange={setEmployeeId}
                clearable
                height={42}
                style={{ width: '100%' }}
              />
            </div>
            <FormError error={error} />
          </div>

          <div className={styles.modalFoot}>
            <button
              type="button"
              className={`${styles.action} ${styles.actionGhost}`}
              onClick={onCancel}
              disabled={busy}
            >
              Huỷ
            </button>
            <button
              type="submit"
              className={`${styles.action} ${styles.actionPrimary}`}
              disabled={busy || !ready}
            >
              {busy ? 'Đang lưu…' : 'Cấp phát'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
