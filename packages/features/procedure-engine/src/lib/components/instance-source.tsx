import {
  isInternalPath,
  type ProcedureInstance,
  type ProcedureInstanceSourceType,
  type ProcedureSourceSummary,
} from '@enterprise-platform/contracts-procedure-engine';
import { FileText } from 'lucide-react';
import styles from './instance-source.module.scss';

/** Nhãn hàng "Nguồn" cho hồ sơ do Bán hàng mở (CRM phase 3, plan mục 17.1). */
export const CRM_SOURCE_LABEL: Partial<Record<ProcedureInstanceSourceType, string>> = {
  crm_quote: 'Bán hàng: Báo giá',
  crm_business_plan: 'Bán hàng: Phương án kinh doanh',
  crm_order_credit: 'Bán hàng: Đơn bán vượt hạn mức',
  crm_tender_plan: 'Bán hàng: Phương án chào thầu',
};

const DEFAULT_URL_LABEL = 'Mở chứng từ gốc';

/** Đường dẫn về chứng từ gốc, chỉ khi là đường dẫn nội bộ (phía server đã kiểm, kiểm lại cho chắc). */
export function sourceSummaryHref(summary: ProcedureSourceSummary | null | undefined): string | undefined {
  const url = summary?.url?.trim();
  return url && isInternalPath(url) ? url : undefined;
}

/** Giá trị hàng "Nguồn" trên màn hồ sơ. */
export function InstanceSourceValue({ instance }: { instance: ProcedureInstance }) {
  if (instance.sourceType === 'hrm_request') {
    return (
      <a
        className="text-blue-600 underline"
        href={`/modules/hrm/approvals?workflow=${encodeURIComponent(instance.sourceId || '')}`}
      >
        Đơn HRM · Xem nội dung và chứng từ
      </a>
    );
  }
  if (instance.sourceType === 'finance_voucher') {
    return (
      <a className="text-blue-600 underline" href={`/modules/finance/open/${encodeURIComponent(instance.sourceId || '')}`}>
        Phiếu tài chính · Xem nội dung và chứng từ
      </a>
    );
  }
  const crm = instance.sourceType ? CRM_SOURCE_LABEL[instance.sourceType] : undefined;
  if (crm) {
    const href = sourceSummaryHref(instance.sourceSummary);
    return href ? (
      <a className="text-blue-600 underline" href={href}>
        {crm}
      </a>
    ) : (
      crm
    );
  }
  if (instance.sourceType === 'maintenance_occurrence') return 'Lịch bảo trì';
  return 'Tạo thủ công';
}

/**
 * Khối "Thông tin cần duyệt" ở đầu màn hồ sơ: tóm tắt chứng từ gốc do module nguồn gửi (D3-31). Chỉ chữ thuần qua
 * React (tự thoát ký tự), không bao giờ hiểu giá trị là HTML; nút mở chứng từ đi cùng tab.
 */
export function SourceSummaryCard({ summary }: { summary: ProcedureSourceSummary | null | undefined }) {
  if (!summary) return null;
  const href = sourceSummaryHref(summary);
  if (!summary.title && !summary.items.length && !href) return null;
  return (
    <section className={styles.card} aria-label="Thông tin cần duyệt">
      <header className={styles.header}>
        <span className={styles.kind}>Thông tin cần duyệt</span>
        {summary.title ? <h3 className={styles.title}>{summary.title}</h3> : null}
      </header>
      {summary.items.length ? (
        <dl className={styles.items}>
          {summary.items.map((item, index) => (
            <div key={`${index}:${item.label}`} className={styles.item}>
              <dt>{item.label}</dt>
              <dd>{item.value || '—'}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {href ? (
        <a className={styles.open} href={href}>
          <FileText size={14} aria-hidden="true" />
          {summary.urlLabel || DEFAULT_URL_LABEL}
        </a>
      ) : null}
    </section>
  );
}
