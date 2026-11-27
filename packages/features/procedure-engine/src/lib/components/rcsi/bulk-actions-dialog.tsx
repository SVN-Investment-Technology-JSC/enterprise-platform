'use client';

import type { ProcedureDefinitionBulkActions } from '@enterprise-platform/contracts-procedure-engine';
import { MinimalPopupForm } from '@enterprise-platform/shared-ui';
import { useState } from 'react';
import styles from './flow-editors.module.scss';

/**
 * Cài đặt thao tác hàng loạt của một quy trình (bảng Hồ sơ xử lý): cho duyệt và / hoặc không duyệt (huỷ) nhiều hồ sơ
 * một lần. Lưu bằng route riêng nên đổi được cả khi quy trình đã công bố; áp ngay cho hồ sơ đang chạy.
 */
export function BulkActionsDialog({
  definitionName,
  value,
  busy,
  onClose,
  onSave,
}: {
  definitionName: string;
  value: ProcedureDefinitionBulkActions | undefined;
  busy?: boolean;
  onClose: () => void;
  onSave: (value: ProcedureDefinitionBulkActions) => void;
}) {
  const [approve, setApprove] = useState(value?.approve === true);
  const [reject, setReject] = useState(value?.reject === true);
  const unchanged = approve === (value?.approve === true) && reject === (value?.reject === true);

  return (
    <MinimalPopupForm
      isOpen
      title="Thao tác hàng loạt"
      subtitle={`Quy trình “${definitionName}”`}
      maxWidth="480px"
      onClose={onClose}
    >
      <div className={styles.editor}>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={approve} onChange={(event) => setApprove(event.target.checked)} />
          Cho phép duyệt hàng loạt
        </label>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={reject} onChange={(event) => setReject(event.target.checked)} />
          Cho phép không duyệt (huỷ) hàng loạt
        </label>
        <p className={styles.hint}>
          Người duyệt chọn nhiều hồ sơ ở Hồ sơ xử lý rồi bấm một lần. Mỗi hồ sơ vẫn chỉ được xử lý khi tới lượt
          người đó và bước không cần nhập thêm thông tin; không duyệt hàng loạt luôn bắt buộc lý do. Áp dụng ngay cho cả
          hồ sơ đang chạy.
        </p>
        <footer className={styles.footer}>
          <span />
          <div className={styles.footerRight}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>
              Huỷ
            </button>
            <button
              type="button"
              className={styles.submitButton}
              disabled={busy || unchanged}
              onClick={() => onSave({ approve, reject })}
            >
              Lưu
            </button>
          </div>
        </footer>
      </div>
    </MinimalPopupForm>
  );
}
