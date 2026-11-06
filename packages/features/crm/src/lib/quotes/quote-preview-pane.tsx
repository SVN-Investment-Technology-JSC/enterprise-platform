'use client';

/**
 * Khung xem trước bên phải màn báo giá (plan 9.4, task P3C4-03, P3C4-07). Chọn bố cục theo trạng thái phiên bản: đã gửi
 * trở đi mà có bản chụp thì dùng bản chụp, còn lại dùng bố cục hiện tại của mẫu đang chọn trên form (đổi mẫu là đổi
 * ngay, chưa cần Lưu). Nút Xuất dùng đúng bố cục đang hiện; người chỉ đọc cũng xuất được.
 */
import type { QuoteLayout, QuoteStatus, QuoteVersion } from '@enterprise-platform/contracts-crm';
import { RotateCw } from 'lucide-react';
import { ExportMenu } from '../quote-layout/export-menu';
import { QuoteLayoutView } from '../quote-layout/quote-layout-view';
import type { QuoteLayoutData } from '../quote-layout/quote-layout.data';
import { TEMPLATE_LAYOUT_LOAD_ERROR, useTemplateLayout } from '../quote-layout/use-template-layout';
import styles from './quote-workspace.module.scss';

/** Phiên bản ở các trạng thái này in theo bản chụp bố cục lúc gửi khách (D3-5). */
export const SNAPSHOT_STATUSES: readonly QuoteStatus[] = ['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED'];

export const MISSING_SNAPSHOT_NOTE = 'Báo giá gửi trước khi có bản chụp bố cục; đang hiển thị theo mẫu hiện tại.';

export interface PreviewLayoutChoice {
  /** Bản chụp dùng để dựng; rỗng là dùng bố cục hiện tại của mẫu. */
  readonly snapshot: QuoteLayout | null;
  /** Đã gửi khách nhưng không có bản chụp (gửi trước phase 3): hiện ghi chú. */
  readonly missingSnapshot: boolean;
}

/** Chọn bố cục theo trạng thái (plan 9.4). Phiên bản chưa gửi lần nào (`sentAt` rỗng) không cần ghi chú. */
export function previewLayoutChoice(version: Pick<QuoteVersion, 'status' | 'layoutSnapshot' | 'sentAt'> | undefined): PreviewLayoutChoice {
  if (!version || !SNAPSHOT_STATUSES.includes(version.status)) return { snapshot: null, missingSnapshot: false };
  if (version.layoutSnapshot) return { snapshot: version.layoutSnapshot, missingSnapshot: false };
  return { snapshot: null, missingSnapshot: Boolean(version.sentAt) };
}

export function QuotePreviewPane({
  choice,
  templateId,
  templateName,
  templateHasLayout,
  data,
  fileName,
}: {
  choice: PreviewLayoutChoice;
  /** Mẫu đang chọn trên form (chưa lưu cũng được). */
  templateId: string | null | undefined;
  templateName?: string | null;
  /** Biết từ danh sách mẫu: `false` thì dùng bố cục mặc định, không gọi API. */
  templateHasLayout?: boolean;
  data: QuoteLayoutData;
  /** Tên file xuất không có đuôi (`<mã>_v<phiên bản>`). */
  fileName: string;
}) {
  const template = useTemplateLayout(choice.snapshot ? null : templateId, templateHasLayout);
  const layout = choice.snapshot ?? template.layout;
  const loading = !choice.snapshot && template.status === 'loading';
  const failed = !choice.snapshot && template.status === 'error';

  return (
    <section className={styles.previewPane} aria-label="Xem trước báo giá">
      <div className={styles.previewHead}>
        <h3 className={styles.previewTitle}>Xem trước</h3>
        <span className={styles.previewTemplate}>
          {choice.snapshot ? 'Bản chụp lúc gửi khách' : `Mẫu: ${templateName || 'Mẫu mặc định'}`}
        </span>
        <ExportMenu layout={layout} data={data} fileName={fileName} disabled={loading} />
      </div>
      {choice.missingSnapshot ? (
        <p className={styles.previewNote} role="note">
          {MISSING_SNAPSHOT_NOTE}
        </p>
      ) : null}
      {failed ? (
        <div className={styles.previewError} role="alert">
          <span>{TEMPLATE_LAYOUT_LOAD_ERROR}</span>
          <button type="button" className={styles.previewRetry} onClick={template.retry}>
            <RotateCw size={14} /> Thử lại
          </button>
        </div>
      ) : null}
      <div className={styles.previewFrame}>
        {loading ? (
          <div className={styles.previewLoading} role="status">
            Đang tải mẫu…
          </div>
        ) : (
          <QuoteLayoutView layout={layout} data={data} mode="preview" />
        )}
      </div>
    </section>
  );
}
