import type { ProjectRequestDetail } from '@enterprise-platform/contracts-workspace';
import styles from '../workspace.module.scss';

/**
 * Danh sách "nhãn – giá trị" chi tiết của một đơn từ gắn dự án (module nguồn dịch sẵn nhãn). Dùng chung cho hộp chi
 * tiết đơn công tác trên lịch và ngăn Đơn từ, để hai nơi luôn hiện cùng một nội dung.
 */
export function RequestDetailList({ details }: { readonly details: readonly ProjectRequestDetail[] }) {
  return (
    <dl className={styles.detailGrid}>
      {details.map((detail, index) => (
        <div key={`${detail.label}:${index}`} className={styles.detailRow}>
          <dt>{detail.label}</dt>
          <dd>{detail.value}</dd>
        </div>
      ))}
    </dl>
  );
}
