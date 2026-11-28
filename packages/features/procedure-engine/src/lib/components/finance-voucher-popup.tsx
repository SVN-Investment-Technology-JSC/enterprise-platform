'use client';

import { MODULE_EMBED_MESSAGE, listenModuleEmbed, type ModuleEmbedSummary } from '@enterprise-platform/feature-module-shell';
import { MinimalPopupForm } from '@enterprise-platform/shared-ui';
import { useEffect, useRef, useState } from 'react';
import styles from './finance-voucher-popup.module.scss';

export interface FinanceVoucherPopupProps {
  /** Đường dẫn trang phiếu nhúng của Tài chính (`financeVoucherEmbedHref`). */
  readonly src: string;
  /** Tiêu đề popup, ví dụ "Bước 3 · Kế toán chi tiền". */
  readonly title: string;
  /** Loại và mã phiếu ban đầu ("Phiếu chi", "NHAP_PC_…"); mã và trạng thái hiện tại do trang phiếu báo về và thay thế. */
  readonly kindLabel: string;
  readonly code?: string;
  /** Đóng popup. */
  readonly onClose: () => void;
  /** Tài chính báo phiếu vừa có thay đổi (ghi sổ, trả hồ sơ…): tải lại hồ sơ. */
  readonly onChanged: () => void;
}

/**
 * Phiếu Tài chính ngay trong hồ sơ: cùng trang với "Mở phiếu" nhưng nằm trong iframe cùng tên miền, nên người có quyền
 * thao tác trực tiếp mà không rời hồ sơ. Quy trình không import code hay hợp đồng của Tài chính và không gọi API ghi của
 * nó: mọi thao tác chạy trong trang của Tài chính với quyền của chính người dùng, Quy trình chỉ nghe tin "đã đổi" qua
 * `postMessage` (kiểm origin và đúng cửa sổ con) để tải lại bước.
 */
export function FinanceVoucherPopup({ src, title, kindLabel, code, onClose, onChanged }: FinanceVoucherPopupProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  // Mã và trạng thái phiếu do trang nhúng báo về: hiện ở tiêu đề popup để trang không phải lặp lại.
  const [summary, setSummary] = useState<ModuleEmbedSummary>();
  // Giữ bản mới nhất của hai hàm gọi lại để không phải nghe lại mỗi lần cha dựng lại.
  const callbacks = useRef({ onClose, onChanged });
  callbacks.current = { onClose, onChanged };

  useEffect(
    () =>
      listenModuleEmbed(
        () => frame.current?.contentWindow,
        (message) => {
          if (message.type === MODULE_EMBED_MESSAGE.changed) callbacks.current.onChanged();
          if (message.type === MODULE_EMBED_MESSAGE.close) callbacks.current.onClose();
          if (message.type === MODULE_EMBED_MESSAGE.summary) setSummary(message);
        },
      ),
    [],
  );

  const subtitle = (
    <span className={styles.subtitleRow}>
      <span>
        {kindLabel}
        {summary?.code ?? code ? ` ${summary?.code ?? code}` : ''}
        {summary?.note ? ` · ${summary.note}` : ''}
      </span>
      {summary?.badges?.map((badge) => (
        <span key={badge.label} className={`${styles.badge} ${styles[badge.tone]}`}>
          {badge.label}
        </span>
      ))}
    </span>
  );

  return (
    <MinimalPopupForm isOpen title={title} subtitle={subtitle} popupClassName={styles.dialog} onClose={onClose}>
      <div className={styles.frameWrap}>
        {loaded ? null : (
          <p role="status" className={styles.loading}>
            Đang mở phiếu…
          </p>
        )}
        <iframe
          ref={frame}
          className={styles.frame}
          src={src}
          title={title}
          referrerPolicy="same-origin"
          onLoad={() => setLoaded(true)}
        />
      </div>
    </MinimalPopupForm>
  );
}
