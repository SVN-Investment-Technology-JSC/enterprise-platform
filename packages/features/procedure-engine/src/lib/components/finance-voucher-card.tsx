'use client';

import type { ProcedureInstanceStep } from '@enterprise-platform/contracts-procedure-engine';
import { PROCEDURE_FINANCE_VOUCHER_KIND_LABELS } from '@enterprise-platform/contracts-procedure-engine';
import { ExternalLink, Landmark, PanelTopOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { financeVoucherCard, financeVoucherEmbedHref, financeVoucherHref } from './rcsi/finance-step';
import { FinanceVoucherPopup } from './finance-voucher-popup';
import { useFinanceAccess } from './use-finance-access';
import styles from './finance-voucher-card.module.scss';

/**
 * Tài chính báo về qua sự kiện nên bước của hồ sơ đổi chậm hơn thao tác một nhịp: khi đóng popup tải lại ngay, rồi thêm
 * hai lần ngắn để thấy trạng thái "Đã ghi sổ" mà người dùng không phải bấm làm mới.
 *
 * Không tải lại khi popup còn mở: hồ sơ vừa xong sẽ rời tab "Đang xử lý", bảng chuyển sang hồ sơ khác và gỡ luôn thẻ đang
 * giữ popup, người dùng chưa kịp xem kết quả thì popup đã biến mất.
 */
const REFRESH_FOLLOW_UPS_MS = [2_000, 5_000] as const;

const stopBubbling = (event: { stopPropagation: () => void }) => event.stopPropagation();

/**
 * Thẻ phiếu trên bước Tài chính của hồ sơ. Phiếu sống ở module Tài chính; ở đây hiện tiến trình mà Tài chính đã báo về,
 * lối mở phiếu bên đó, và "Mở nhanh" để thao tác ngay trong popup (trang phiếu nhúng của Tài chính, quyền do Tài chính quyết).
 */
export function FinanceVoucherCard({
  step,
  onRefresh,
}: {
  step: ProcedureInstanceStep;
  /** Tải lại hồ sơ sau khi thao tác trong popup; vắng thì thẻ vẫn mở được popup nhưng không tự làm mới. */
  onRefresh?: () => void | Promise<void>;
}) {
  const [popupOpen, setPopupOpen] = useState(false);
  // Chỉ hỏi quyền khi thẻ có phiếu để mở; người không dùng được Tài chính chỉ thấy dòng tiến trình, không có nút.
  const access = useFinanceAccess(step.integration?.module === 'finance' && Boolean(step.financeVoucher?.voucherId));
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  // Phiếu đã đổi trong lúc popup mở: chỉ tải lại hồ sơ khi đóng popup (xem `closePopup`).
  const changedWhileOpen = useRef(false);

  const refresh = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    void refreshRef.current?.();
    timers.current = REFRESH_FOLLOW_UPS_MS.map((delay) => setTimeout(() => void refreshRef.current?.(), delay));
  }, []);

  const closePopup = useCallback(() => {
    setPopupOpen(false);
    if (changedWhileOpen.current) {
      changedWhileOpen.current = false;
      refresh();
    }
  }, [refresh]);

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );

  const integration = step.integration;
  if (integration?.module !== 'finance') return null;
  const voucher = step.financeVoucher;
  const kindLabel = PROCEDURE_FINANCE_VOUCHER_KIND_LABELS[integration.voucherKind];
  const card = voucher ? financeVoucherCard(voucher) : { title: 'Chưa tới bước này', tone: 'waiting' as const };
  const voucherId = access === 'allowed' ? voucher?.voucherId : undefined;
  const href = voucherId ? financeVoucherHref(integration.voucherKind, voucherId) : undefined;

  return (
    <div className={`${styles.card} ${styles[card.tone]}`}>
      <Landmark size={16} aria-hidden="true" className={styles.icon} />
      <div className={styles.body}>
        <span className={styles.kind}>Bước Tài chính · {kindLabel}</span>
        <strong className={styles.title}>{card.title}</strong>
        {card.detail ? <span className={styles.detail}>{card.detail}</span> : null}
      </div>
      {voucherId ? (
        <button
          type="button"
          className={styles.open}
          title="Xem và thao tác phiếu ngay tại đây"
          onClick={() => setPopupOpen(true)}
        >
          <PanelTopOpen size={14} aria-hidden="true" />
          Mở nhanh
        </button>
      ) : null}
      {href ? (
        <a className={styles.open} href={href} title="Mở phiếu ở module Tài chính">
          <ExternalLink size={14} aria-hidden="true" />
          Mở phiếu
        </a>
      ) : null}
      {popupOpen && voucherId ? (
        // Popup vẽ bằng portal nhưng sự kiện React vẫn nổi bọt lên các thẻ cha: bấm nền để đóng popup sẽ bị dòng bước
        // (bấm để xem lại bước) hiểu là bấm vào nó và mở thêm hộp "Bước N". Chặn ở đây; thẻ này không có phần tử nào ở
        // ngoài portal nên `display: contents` không đổi bố cục.
        <div style={{ display: 'contents' }} onClick={stopBubbling} onKeyDown={stopBubbling}>
          <FinanceVoucherPopup
            src={financeVoucherEmbedHref(integration.voucherKind, voucherId)}
            title={`Bước ${step.order} · ${step.name}`}
            kindLabel={kindLabel}
            code={voucher?.code}
            onChanged={() => {
              changedWhileOpen.current = true;
            }}
            onClose={closePopup}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Ghi chú dưới thẻ phiếu ở khung thao tác của bước Tài chính đang chạy: bước này không có nút hoàn tất ở đây, việc xử lý
 * nằm trên phiếu. Chỉ chỉ người dùng tới "Mở nhanh" / "Mở phiếu" khi hai nút đó đang hiện (có phiếu và người dùng
 * dùng được Tài chính); không thì chỉ nói rằng ở đây chỉ gửi trao đổi.
 */
export function FinanceWaitingNote({ step }: { step: ProcedureInstanceStep }) {
  const hasVoucher = step.integration?.module === 'finance' && Boolean(step.financeVoucher?.voucherId);
  const access = useFinanceAccess(hasVoucher);
  const actionsShown = hasVoucher && access === 'allowed';
  return (
    <p className={styles.waitingNote}>
      Bước này đóng khi kế toán ghi sổ phiếu ở phân hệ Tài chính; kế toán trả hồ sơ thì hồ sơ tự quay về bước đã cấu
      hình.{' '}
      {actionsShown
        ? 'Người phụ trách xử lý phiếu bằng "Mở nhanh" hoặc "Mở phiếu" ở trên; ở đây chỉ gửi trao đổi.'
        : 'Ở đây chỉ gửi trao đổi.'}
    </p>
  );
}
