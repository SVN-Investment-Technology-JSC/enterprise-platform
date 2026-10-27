'use client';

import type { StockDocument, StockDocumentLine } from '@enterprise-platform/contracts-inventory';
import { Popconfirm, formatDate } from '@enterprise-platform/shared-ui';
import { Drawer, Table, type TableColumnsType } from 'antd';
import { useState } from 'react';
import {
  approveStockDocument,
  cancelStockDocument,
  postStockDocument,
  rejectStockDocument,
  reverseStockDocument,
  submitStockDocument,
} from '../inventory-api';
import { formatDateTime, formatNumber } from '../inventory-labels';
import {
  STOCK_DOCUMENT_ACTION_LABEL,
  STOCK_DOCUMENT_TYPE_LABEL,
  availableDocumentActions,
  sourceTypeLabel,
  type StockDocumentAction,
  type StockDocumentCapabilities,
} from '../stock-document.model';
import { DocumentStatusBadge, RejectReasonDialog, errorMessage } from './stock-document-parts';
import styles from '../inventory.module.scss';

/** Chạy một thao tác trạng thái trên server; trả chứng từ mới và câu thông báo. */
export async function runDocumentAction(
  action: Exclude<StockDocumentAction, 'edit' | 'reject'>,
  document: StockDocument,
): Promise<{ document: StockDocument; message: string }> {
  switch (action) {
    case 'submit':
      return { document: await submitStockDocument(document.id), message: `Đã gửi duyệt ${document.code}.` };
    case 'approve':
      return { document: await approveStockDocument(document.id), message: `Đã duyệt ${document.code}.` };
    case 'post':
      return { document: (await postStockDocument(document.id)).document, message: `Đã ghi sổ ${document.code}.` };
    case 'cancel':
      return { document: await cancelStockDocument(document.id), message: `Đã huỷ ${document.code}.` };
    case 'reverse': {
      const reversed = (await reverseStockDocument(document.id)).document;
      return { document: reversed, message: `Đã tạo và ghi sổ chứng từ đảo ${reversed.code} cho ${document.code}.` };
    }
  }
}

const CONFIRM: Partial<Record<StockDocumentAction, { title: string; description: string }>> = {
  post: {
    title: 'Ghi sổ chứng từ?',
    description: 'Tồn kho thay đổi ngay; chứng từ đã ghi sổ không sửa được, sai thì tạo chứng từ đảo.',
  },
  cancel: { title: 'Huỷ chứng từ?', description: 'Chứng từ chuyển sang Đã huỷ và không dùng lại được.' },
  reverse: {
    title: 'Tạo chứng từ đảo?',
    description: 'Hệ thống tạo chứng từ ngược chiều tham chiếu chứng từ này và ghi sổ ngay; chứng từ gốc giữ nguyên.',
  },
};

/** Nút thao tác của một chứng từ theo trạng thái và quyền; lỗi server hiện nguyên văn. */
export function DocumentActionBar({
  document,
  capabilities,
  exclude = [],
  onEdit,
  onChanged,
}: {
  document: StockDocument;
  capabilities: StockDocumentCapabilities;
  exclude?: readonly StockDocumentAction[];
  onEdit?: (document: StockDocument) => void;
  onChanged: (document: StockDocument, message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [rejecting, setRejecting] = useState(false);
  const actions = availableDocumentActions(document, capabilities).filter(
    (action) => !exclude.includes(action) && (action !== 'edit' || onEdit),
  );

  const run = async (action: Exclude<StockDocumentAction, 'edit' | 'reject'>) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await runDocumentAction(action, document);
      onChanged(result.document, result.message);
    } catch (cause) {
      setError(errorMessage(cause, 'Không thực hiện được thao tác.'));
    } finally {
      setBusy(false);
    }
  };

  const reject = async (reason: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const rejected = await rejectStockDocument(document.id, reason);
      setRejecting(false);
      onChanged(rejected, `Đã từ chối ${document.code}.`);
    } catch (cause) {
      setError(errorMessage(cause, 'Không từ chối được chứng từ.'));
    } finally {
      setBusy(false);
    }
  };

  if (actions.length === 0 && !error) return null;
  return (
    <div className={styles.docActionBlock}>
      <div className={styles.docActions}>
        {actions.map((action) => {
          const label = STOCK_DOCUMENT_ACTION_LABEL[action];
          const primary = action === 'post' || action === 'approve' || action === 'submit';
          const className = action === 'reject' || action === 'cancel' ? styles.btnDanger : primary ? styles.btnPrimary : styles.btnSecondary;
          if (action === 'edit') {
            return (
              <button key={action} type="button" className={className} disabled={busy} onClick={() => onEdit?.(document)}>
                {label}
              </button>
            );
          }
          if (action === 'reject') {
            return (
              <button key={action} type="button" className={className} disabled={busy} onClick={() => setRejecting(true)}>
                {label}
              </button>
            );
          }
          const confirm = CONFIRM[action];
          const button = (
            <button
              key={action}
              type="button"
              className={className}
              disabled={busy}
              onClick={confirm ? undefined : () => void run(action)}
            >
              {label}
            </button>
          );
          return confirm ? (
            <Popconfirm
              key={action}
              title={confirm.title}
              description={confirm.description}
              okText={label}
              cancelText="Huỷ"
              okType={action === 'post' ? 'primary' : 'danger'}
              disabled={busy}
              onConfirm={() => run(action)}
            >
              {button}
            </Popconfirm>
          ) : (
            button
          );
        })}
      </div>
      {error ? (
        <p role="alert" className={styles.alert} style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
      <RejectReasonDialog
        open={rejecting}
        documentCode={document.code}
        busy={busy}
        onCancel={() => setRejecting(false)}
        onConfirm={(reason) => void reject(reason)}
      />
    </div>
  );
}

function audit(label: string, who?: string, when?: string) {
  if (!who && !when) return null;
  return (
    <div className={styles.docAuditItem}>
      <span>{label}</span>
      <strong>{formatDateTime(when)}</strong>
      {who ? <small title={who}>Người thực hiện: {who.slice(0, 8)}</small> : null}
    </div>
  );
}

/**
 * Chi tiết chứng từ: phần đầu, dòng (lô, hạn dùng, serial, giá vốn sau ghi sổ),
 * lịch sử lập, gửi, duyệt, từ chối, ghi sổ, huỷ và các nút theo trạng thái.
 */
export function StockDocumentDetail({
  document,
  capabilities,
  onEdit,
  onChanged,
  onClose,
}: {
  document: StockDocument;
  capabilities: StockDocumentCapabilities;
  onEdit?: (document: StockDocument) => void;
  onChanged: (document: StockDocument, message: string) => void;
  onClose: () => void;
}) {
  const posted = document.status === 'POSTED';
  const columns: TableColumnsType<StockDocumentLine> = [
    { title: '#', dataIndex: 'lineNo', key: 'lineNo', width: 44 },
    {
      title: 'Mặt hàng',
      key: 'material',
      render: (_value, line) => (
        <>
          <strong>{line.materialCode}</strong>
          <span className={styles.sub}>{line.materialName}</span>
        </>
      ),
    },
    {
      title: 'Chiều',
      dataIndex: 'direction',
      key: 'direction',
      width: 70,
      render: (value: StockDocumentLine['direction']) => (value === 'IN' ? 'Nhập' : 'Xuất'),
    },
    {
      title: 'Số lượng',
      key: 'quantity',
      width: 100,
      align: 'right',
      render: (_value, line) => `${formatNumber(line.quantity)} ${line.unit ?? ''}`,
    },
    {
      title: 'Đơn giá',
      key: 'unitCost',
      width: 120,
      align: 'right',
      render: (_value, line) => (line.unitCost ? formatNumber(line.unitCost) : '—'),
    },
    {
      title: 'Giá vốn dòng',
      key: 'costAmount',
      width: 130,
      align: 'right',
      render: (_value, line) =>
        posted && line.costAmount !== undefined ? formatNumber(line.costAmount) : <span className={styles.docHint}>Sau ghi sổ</span>,
    },
    {
      title: 'Lô / hạn dùng',
      key: 'lot',
      width: 160,
      render: (_value, line) =>
        line.lotNo ? (
          <>
            <strong>{line.lotNo}</strong>
            {line.lotExpiresOn ? <span className={styles.sub}>HSD {formatDate(line.lotExpiresOn)}</span> : null}
          </>
        ) : (
          '—'
        ),
    },
    {
      title: 'Serial',
      key: 'serials',
      render: (_value, line) =>
        line.serials?.length ? <span className={styles.docSerialText}>{line.serials.join(', ')}</span> : '—',
    },
  ];
  const totalCost = document.lines.reduce((sum, line) => sum + (line.costAmount ?? 0), 0);

  return (
    <Drawer
      open
      onClose={onClose}
      size="min(1080px, 96vw)"
      destroyOnHidden
      title={
        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
          Chứng từ {document.code} <DocumentStatusBadge status={document.status} />
        </span>
      }
      footer={
        <DocumentActionBar document={document} capabilities={capabilities} onEdit={onEdit} onChanged={onChanged} />
      }
    >
      <div className={styles.docInfoGrid}>
        <div>
          <span>Loại</span>
          <strong>{STOCK_DOCUMENT_TYPE_LABEL[document.docType]}</strong>
        </div>
        <div>
          <span>{document.targetWarehouseCode ? 'Kho đi / kho đến' : 'Kho'}</span>
          <strong>
            {document.warehouseCode}
            {document.targetWarehouseCode ? ` → ${document.targetWarehouseCode}` : ''}
          </strong>
        </div>
        <div>
          <span>Ngày chứng từ</span>
          <strong>{formatDate(document.documentDate)}</strong>
        </div>
        <div>
          <span>Nguồn</span>
          <strong>{sourceTypeLabel(document.sourceType)}</strong>
          {document.sourceId ? <small>{document.sourceId}</small> : null}
        </div>
        {document.reversesDocumentId ? (
          <div>
            <span>Đảo của chứng từ</span>
            <strong>{document.reversesDocumentId.slice(0, 8)}</strong>
          </div>
        ) : null}
        {posted ? (
          <div>
            <span>Tổng giá vốn</span>
            <strong>{formatNumber(totalCost)}</strong>
          </div>
        ) : null}
      </div>
      {document.note ? <p className={styles.docHint}>Ghi chú: {document.note}</p> : null}
      {document.rejectReason ? (
        <p className={styles.docWarn}>Lý do từ chối: {document.rejectReason}</p>
      ) : null}

      <Table<StockDocumentLine>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={[...document.lines]}
        pagination={false}
        scroll={{ x: 900 }}
      />

      <h4 className={styles.docSubTitle}>Lịch sử</h4>
      <div className={styles.docAuditGrid}>
        {audit('Lập', document.createdBy, document.createdAt)}
        {audit('Gửi duyệt', document.submittedBy, document.submittedAt)}
        {audit('Duyệt', document.approvedBy, document.approvedAt)}
        {audit('Từ chối', document.rejectedBy, document.rejectedAt)}
        {audit('Ghi sổ', document.postedBy, document.postedAt)}
        {audit('Huỷ', document.cancelledBy, document.cancelledAt)}
      </div>
    </Drawer>
  );
}
