'use client';

import type { CrmTaskApprovalTarget } from '@enterprise-platform/contracts-crm';
import { ClipboardCheck } from 'lucide-react';
import styles from '../sales.module.scss';
import { PROCEDURE_ACTION_LABEL, awaitingNoticeText, crmReturnPath, procedureHrefOf } from '../tasks/tasks.model';

/** `id` của khối PAKD trên màn báo giá, để mở và cuộn tới. */
export const BUSINESS_PLAN_SECTION_ID = 'quote-section-business-plan';

/** Mở khối PAKD (thẻ `details`) và cuộn tới. */
export function openBusinessPlanSection(): void {
  if (typeof document === 'undefined') return;
  const section = document.getElementById(BUSINESS_PLAN_SECTION_ID);
  if (!section) return;
  if (section instanceof HTMLDetailsElement) section.open = true;
  section.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
}

/** Đường dẫn CRM đang mở làm `returnTo`, để Quy trình duyệt xong quay lại đúng màn này. */
function currentReturnPath(quoteId: string): string {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  return crmReturnPath(hash, `#quotes/${quoteId}`);
}

/**
 * Dòng thông báo đầu cột trái khi báo giá (hoặc PAKD trình riêng) đang chờ chính người xem duyệt (D3-33). Qua Quy trình:
 * nút "Duyệt trên Quy trình" sang hồ sơ, Quy trình tự quay về màn này. Trực tiếp: chỉ tới nút Duyệt hoặc khối PAKD.
 */
export function AwaitingApprovalNotice({ quoteId, target }: { quoteId: string; target: CrmTaskApprovalTarget }) {
  const href = procedureHrefOf(target, currentReturnPath(quoteId));
  const plan = target.subject === 'BUSINESS_PLAN';
  return (
    <div className={styles.warning} role="status" aria-label="Đang chờ bạn duyệt">
      <p>
        <ClipboardCheck size={15} aria-hidden="true" /> <strong>{awaitingNoticeText(target)}</strong>
      </p>
      {href ? (
        <div className={styles.toolbar}>
          <a className={styles.buttonPrimary} href={href}>
            {PROCEDURE_ACTION_LABEL}
          </a>
          {target.procedureInstanceCode ? <span className={styles.muted}>Hồ sơ {target.procedureInstanceCode}</span> : null}
        </div>
      ) : target.mode === 'PROCEDURE' ? (
        <p>Hồ sơ Quy trình đang được tạo; vui lòng tải lại sau ít phút.</p>
      ) : plan ? (
        <div className={styles.toolbar}>
          <span>Duyệt hoặc từ chối ở khối Phương án kinh doanh (PAKD) bên dưới.</span>
          <button type="button" className={styles.buttonGhost} onClick={openBusinessPlanSection}>
            Mở khối PAKD
          </button>
        </div>
      ) : (
        <p>Dùng nút Duyệt hoặc Từ chối duyệt ở phần Thông tin chung bên dưới.</p>
      )}
    </div>
  );
}
