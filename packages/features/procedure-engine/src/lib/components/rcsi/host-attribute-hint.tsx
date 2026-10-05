'use client';

import { groupHostAttributesByKind, hostAttributeSourceLabel } from '@enterprise-platform/contracts-procedure-engine';
import { Info } from 'lucide-react';
import { useState } from 'react';
import styles from './flow-editors.module.scss';

/** Huy hiệu nhỏ "Lấy từ đơn HRM: ..." — không hiển thị gì nếu mã không do HRM cấp. */
export function HostAttributeBadge({ code }: { code: string }) {
  const label = hostAttributeSourceLabel(code);
  if (!label) return null;
  return (
    <span className={styles.hostBadge} title="Giá trị thuộc tính này do HRM điền sẵn từ đơn khi khởi tạo hồ sơ.">
      {label}
    </span>
  );
}

/** Danh sách tham chiếu gọn: mã thuộc tính do HRM cấp và ý nghĩa, gom theo loại đơn. */
export function HostAttributeReference() {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.hostRef}>
      <button type="button" className={styles.linkButton} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Info size={13} aria-hidden="true" /> Thuộc tính do HRM cấp
      </button>
      {open ? (
        <div className={styles.hostRefPanel} role="region" aria-label="Thuộc tính do HRM cấp">
          <p className={styles.hint}>Đặt mã thuộc tính trùng một mã dưới đây thì HRM tự điền giá trị từ đơn.</p>
          {groupHostAttributesByKind().map((group) => (
            <div key={group.kind}>
              <strong className={styles.hostRefGroup}>{group.label}</strong>
              <ul className={styles.hostRefList}>
                {group.items.map((item) => (
                  <li key={item.code}>
                    <code>{item.code}</code> — {item.meaning}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
