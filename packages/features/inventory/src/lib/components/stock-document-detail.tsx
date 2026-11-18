'use client';

import type {
  StockDocument,
  StockDocumentLine,
} from '@enterprise-platform/contracts-inventory';
import { Popconfirm, formatDate, toast } from '@enterprise-platform/shared-ui';
import { Table, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { Button } from '../ui/button';
import { DialogCloseButton } from '../ui/dialog';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet';
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
import {
  DocumentStatusBadge,
  RejectReasonDialog,
  errorMessage,
} from './stock-document-parts';
import { useUserLabel } from '../user-names';

/** Chạy một thao tác trạng thái trên server; trả chứng từ mới và câu thông báo. */
export async function runDocumentAction(
  action: Exclude<StockDocumentAction, 'edit' | 'reject'>,
  document: StockDocument,
): Promise<{ document: StockDocument; message: string }> {
  switch (action) {
    case 'submit':
      return {
        document: await submitStockDocument(document.id),
        message: `Đã gửi duyệt ${document.code}.`,
      };
    case 'approve':
      return {
        document: await approveStockDocument(document.id),
        message: `Đã duyệt ${document.code}.`,
      };
    case 'post':
      return {
        document: (await postStockDocument(document.id)).document,
        message: `Đã ghi sổ ${document.code}.`,
      };
    case 'cancel':
      return {
        document: await cancelStockDocument(document.id),
        message: `Đã huỷ ${document.code}.`,
      };
    case 'reverse': {
      const reversed = (await reverseStockDocument(document.id)).document;
      return {
        document: reversed,
        message: `Đã tạo và ghi sổ chứng từ đảo ${reversed.code} cho ${document.code}.`,
      };
    }
  }
}

const CONFIRM: Partial<
  Record<StockDocumentAction, { title: string; description: string }>
> = {
  post: {
    title: 'Ghi sổ chứng từ?',
    description:
      'Tồn kho thay đổi ngay; chứng từ đã ghi sổ không sửa được, sai thì tạo chứng từ đảo.',
  },
  cancel: {
    title: 'Huỷ chứng từ?',
    description: 'Chứng từ chuyển sang Đã huỷ và không dùng lại được.',
  },
  reverse: {
    title: 'Tạo chứng từ đảo?',
    description:
      'Hệ thống tạo chứng từ ngược chiều tham chiếu chứng từ này và ghi sổ ngay; chứng từ gốc giữ nguyên.',
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

  const run = async (
    action: Exclude<StockDocumentAction, 'edit' | 'reject'>,
  ) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await runDocumentAction(action, document);
      onChanged(result.document, result.message);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thực hiện được thao tác.'));
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
      toast.error(errorMessage(cause, 'Không từ chối được chứng từ.'));
    } finally {
      setBusy(false);
    }
  };

  if (actions.length === 0 && !error) return null;
  return (
    <div className="flex flex-col items-end">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) => {
          const label = STOCK_DOCUMENT_ACTION_LABEL[action];
          const primary =
            action === 'post' || action === 'approve' || action === 'submit';
          const variant =
            action === 'reject' || action === 'cancel'
              ? 'destructive'
              : primary
                ? 'default'
                : 'outline';
          if (action === 'edit') {
            return (
              <Button
                key={action}
                type="button"
                variant={variant}
                disabled={busy}
                onClick={() => onEdit?.(document)}
              >
                {label}
              </Button>
            );
          }
          if (action === 'reject') {
            return (
              <Button
                key={action}
                type="button"
                variant={variant}
                disabled={busy}
                onClick={() => setRejecting(true)}
              >
                {label}
              </Button>
            );
          }
          const confirm = CONFIRM[action];
          const button = (
            <Button
              key={action}
              type="button"
              variant={variant}
              disabled={busy}
              onClick={confirm ? undefined : () => void run(action)}
            >
              {label}
            </Button>
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
        <p role="alert" className="mb-4 mt-2 rounded-[0.65rem] border border-red-200 bg-red-50 px-4 py-[0.8rem] text-red-800">
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

function audit(
  userName: (id?: string) => string,
  label: string,
  who?: string,
  when?: string,
) {
  if (!who && !when) return null;
  return (
    <div className="flex flex-col gap-[0.1rem] rounded-lg border border-slate-200 px-[0.65rem] py-2 text-[13px] [&_span]:text-xs [&_span]:font-bold [&_span]:text-slate-500 [&_small]:text-slate-500">
      <span>{label}</span>
      <strong>{formatDateTime(when)}</strong>
      {who ? <small title={who}>Người thực hiện: {userName(who)}</small> : null}
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
  const userName = useUserLabel();
  const posted = document.status === 'POSTED';
  const columns: TableColumnsType<StockDocumentLine> = [
    { title: '#', dataIndex: 'lineNo', key: 'lineNo', width: 44 },
    {
      title: 'Mặt hàng',
      key: 'material',
      render: (_value, line) => (
        <>
          <strong>{line.materialCode}</strong>
          <span className="mt-[0.2rem] block text-[13px] font-normal text-slate-500">{line.materialName}</span>
        </>
      ),
    },
    {
      title: 'Chiều',
      dataIndex: 'direction',
      key: 'direction',
      width: 70,
      render: (value: StockDocumentLine['direction']) =>
        value === 'IN' ? 'Nhập' : 'Xuất',
    },
    {
      title: 'Số lượng',
      key: 'quantity',
      width: 100,
      align: 'right',
      render: (_value, line) =>
        `${formatNumber(line.quantity)} ${line.unit ?? ''}`,
    },
    {
      title: 'Đơn giá',
      key: 'unitCost',
      width: 120,
      align: 'right',
      render: (_value, line) =>
        line.unitCost ? formatNumber(line.unitCost) : '—',
    },
    {
      title: 'Giá vốn dòng',
      key: 'costAmount',
      width: 130,
      align: 'right',
      render: (_value, line) =>
        posted && line.costAmount !== undefined ? (
          formatNumber(line.costAmount)
        ) : (
          <span className="my-[0.35rem] text-[13px] text-slate-500">Sau ghi sổ</span>
        ),
    },
    {
      title: 'Lô / hạn dùng',
      key: 'lot',
      width: 160,
      render: (_value, line) =>
        line.lotNo ? (
          <>
            <strong>{line.lotNo}</strong>
            {line.lotExpiresOn ? (
              <span className="mt-[0.2rem] block text-[13px] font-normal text-slate-500">
                HSD {formatDate(line.lotExpiresOn)}
              </span>
            ) : null}
          </>
        ) : (
          '—'
        ),
    },
    {
      title: 'Serial',
      key: 'serials',
      render: (_value, line) =>
        line.serials?.length ? (
          <span className="break-words font-mono text-[13px]">
            {line.serials.join(', ')}
          </span>
        ) : (
          '—'
        ),
    },
  ];
  const totalCost = document.lines.reduce(
    (sum, line) => sum + (line.costAmount ?? 0),
    0,
  );

  return (
    <Sheet onEscape={onClose} onBackdropClick={onClose}>
      <SheetContent
        className="max-w-[min(1080px,96vw)]"
        aria-label={`Chứng từ ${document.code}`}
      >
        <SheetHeader>
          <SheetTitle>
            <span className="inline-flex items-center gap-2.5">
              Chứng từ {document.code}{' '}
              <DocumentStatusBadge status={document.status} />
            </span>
          </SheetTitle>
          <DialogCloseButton onClick={onClose} />
        </SheetHeader>
        <SheetBody className="bg-white">
          <div className="mb-[0.85rem] grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3 [&>div]:flex [&>div]:flex-col [&>div]:gap-[0.15rem] [&_span]:text-xs [&_span]:font-bold [&_span]:text-slate-500 [&_small]:break-all [&_small]:text-xs [&_small]:text-slate-500">
            <div>
              <span>Loại</span>
              <strong>{STOCK_DOCUMENT_TYPE_LABEL[document.docType]}</strong>
            </div>
            <div>
              <span>
                {document.targetWarehouseCode ? 'Kho đi / kho đến' : 'Kho'}
              </span>
              <strong>
                {document.warehouseCode}
                {document.targetWarehouseCode
                  ? ` → ${document.targetWarehouseCode}`
                  : ''}
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
          {document.note ? (
            <p className="my-[0.35rem] text-[13px] text-slate-500">Ghi chú: {document.note}</p>
          ) : null}
          {document.rejectReason ? (
            <p className="my-[0.6rem] rounded-[0.55rem] border border-amber-200 bg-amber-50 px-[0.8rem] py-[0.6rem] text-[13px] text-amber-800">
              Lý do từ chối: {document.rejectReason}
            </p>
          ) : null}

          <Table<StockDocumentLine>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={[...document.lines]}
            pagination={false}
            scroll={{ x: 900 }}
          />

          <h4 className="mb-2 mt-4 text-sm font-bold text-slate-900">Lịch sử</h4>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-[0.6rem]">
            {audit(userName, 'Lập', document.createdBy, document.createdAt)}
            {audit(
              userName,
              'Gửi duyệt',
              document.submittedBy,
              document.submittedAt,
            )}
            {audit(userName, 'Duyệt', document.approvedBy, document.approvedAt)}
            {audit(
              userName,
              'Từ chối',
              document.rejectedBy,
              document.rejectedAt,
            )}
            {audit(userName, 'Ghi sổ', document.postedBy, document.postedAt)}
            {audit(userName, 'Huỷ', document.cancelledBy, document.cancelledAt)}
          </div>
        </SheetBody>
        <SheetFooter className="[&>div]:w-full">
          <DocumentActionBar
            document={document}
            capabilities={capabilities}
            onEdit={onEdit}
            onChanged={onChanged}
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
