'use client';

import type {
  Material,
  Reservation,
  StockDocument,
  StockDocumentLine,
  StockDocumentType,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { Popconfirm, SearchableSelect, formatDate } from '@enterprise-platform/shared-ui';
import { Table, type TableColumnsType } from 'antd';
import { PackageCheck, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelStockDocument,
  loadReservations,
  loadStockDocuments,
  postStockDocument,
  updateStockDocument,
} from '../inventory-api';
import { RESERVATION_STATUS_LABEL, formatNumber } from '../inventory-labels';
import { useInventoryPermissions } from '../inventory-permissions';
import {
  ISSUE_REQUEST_TYPES,
  STOCK_DOCUMENT_TYPE_LABEL,
  documentToDraft,
  draftLineToInput,
  issueLineProgress,
  issueReadiness,
  sourceTypeLabel,
  splitLineByLots,
  validateDraft,
  validationMessages,
  type DocumentDraft,
  type DraftLine,
} from '../stock-document.model';
import { DocumentStatusBadge, LotPickerDrawer, SerialPickerDrawer, errorMessage } from './stock-document-parts';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Label } from '../ui/label';

const TYPE_OPTIONS = [
  { value: '', label: 'Xuất bán và xuất bảo hành' },
  ...ISSUE_REQUEST_TYPES.map((type) => ({ value: type, label: STOCK_DOCUMENT_TYPE_LABEL[type] })),
];

/**
 * Thủ kho xử lý yêu cầu xuất từ đơn bán (T1-31). Bán hàng tạo chứng từ xuất
 * NHÁP (xuất bán, xuất bảo hành) gắn giữ hàng; ở đây thủ kho xem giữ hàng còn
 * bao nhiêu chưa xuất, chọn lô theo FEFO, quét serial rồi ghi sổ. Xuất theo đơn
 * đã duyệt nên ghi sổ thẳng từ Nháp, không qua Chờ duyệt.
 */
export function IssueRequestPanel({
  warehouses,
  materials,
  onNotice,
  onStockChanged,
}: {
  warehouses: readonly Warehouse[];
  materials: readonly Material[];
  onNotice: (message: string) => void;
  onStockChanged?: () => void;
}) {
  const { canWriteTransactions } = useInventoryPermissions();
  const [docType, setDocType] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [documents, setDocuments] = useState<StockDocument[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [page, reservationRows] = await Promise.all([
        loadStockDocuments({
          docTypes: docType ? [docType as StockDocumentType] : ISSUE_REQUEST_TYPES,
          status: 'DRAFT',
          warehouseCode: warehouseCode || undefined,
          limit: 200,
        }),
        loadReservations(),
      ]);
      setDocuments([...page.items]);
      setReservations(reservationRows);
    } catch (cause) {
      setError(errorMessage(cause, 'Không tải được yêu cầu xuất.'));
    } finally {
      setLoading(false);
    }
  }, [docType, warehouseCode]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Lọc nguồn ở client: danh sách nguồn lấy từ chính các yêu cầu đang có. */
  const sourceOptions = useMemo(() => {
    const values = [...new Set(documents.map((item) => item.sourceType ?? ''))];
    return [
      { value: '', label: 'Mọi nguồn' },
      ...values.filter(Boolean).map((value) => ({ value, label: sourceTypeLabel(value), description: value })),
    ];
  }, [documents]);
  const visible = documents.filter((item) => !sourceType || item.sourceType === sourceType);
  const selected = documents.find((item) => item.id === selectedId);

  const columns: TableColumnsType<StockDocument> = [
    {
      title: 'Chứng từ',
      key: 'code',
      render: (_value, document) => (
        <>
          <strong className="font-bold text-blue-600">{document.code}</strong>
          <span className="mt-[0.2rem] block text-[13px] font-normal text-slate-500">
            {STOCK_DOCUMENT_TYPE_LABEL[document.docType]} · {formatDate(document.documentDate)}
          </span>
        </>
      ),
    },
    { title: 'Kho', dataIndex: 'warehouseCode', key: 'warehouse', width: 110 },
    {
      title: 'Nguồn',
      key: 'source',
      width: 150,
      render: (_value, document) => (
        <>
          {sourceTypeLabel(document.sourceType)}
          {document.sourceId ? <span className="mt-[0.2rem] block text-[13px] font-normal text-slate-500">{document.sourceId.slice(0, 8)}</span> : null}
        </>
      ),
    },
    {
      title: 'Số lượng',
      key: 'qty',
      width: 90,
      align: 'right',
      render: (_value, document) => formatNumber(document.lines.reduce((sum, line) => sum + line.quantity, 0)),
    },
  ];

  return (
    <div className="grid grid-cols-1 items-start gap-4 min-[1201px]:grid-cols-[minmax(0,42fr)_minmax(0,58fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white p-[clamp(1rem,2vw,1.5rem)] shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-bold tracking-[-0.02em] text-slate-900">Yêu cầu xuất từ đơn bán</h2>
            <span className="text-[13px] tabular-nums text-slate-500">{visible.length} chứng từ nháp chờ xuất</span>
          </div>
          <Button type="button" variant="outline" onClick={() => void reload()} disabled={loading}>
            <RotateCw size={15} /> Tải lại
          </Button>
        </div>
        <div className="mb-[0.85rem] flex flex-wrap items-end gap-[0.7rem]">
          <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
            <span>Loại</span>
            <SearchableSelect options={TYPE_OPTIONS} value={docType} height={36} onChange={setDocType} />
          </Label>
          <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
            <span>Nguồn</span>
            <SearchableSelect options={sourceOptions} value={sourceType} height={36} onChange={setSourceType} />
          </Label>
          <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
            <span>Kho</span>
            <SearchableSelect
              options={[{ value: '', label: 'Mọi kho' }, ...warehouses.map((item) => ({ value: item.code, label: `${item.code} - ${item.name}` }))]}
              value={warehouseCode}
              height={36}
              onChange={setWarehouseCode}
            />
          </Label>
        </div>
        {error ? (
          <p role="alert" className="mb-4 rounded-[0.65rem] border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            {error}
          </p>
        ) : null}
        <Table<StockDocument>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={visible}
          pagination={{ pageSize: 15, showSizeChanger: false, hideOnSinglePage: true }}
          rowClassName={(document) => (document.id === selectedId ? 'bg-blue-50!' : '')}
          onRow={(document) => ({ onClick: () => setSelectedId(document.id), style: { cursor: 'pointer' } })}
          locale={{ emptyText: 'Không có yêu cầu xuất nào đang chờ.' }}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-[clamp(1rem,2vw,1.5rem)] shadow-sm">
        {selected ? (
          <IssueRequestWorkbench
            key={`${selected.id}:${selected.updatedAt}`}
            document={selected}
            reservations={reservations}
            warehouses={warehouses}
            materials={materials}
            canWrite={canWriteTransactions}
            onSaved={(document, message) => {
              onNotice(message);
              if (document.status !== 'DRAFT') setSelectedId(undefined);
              if (document.status === 'POSTED') onStockChanged?.();
              void reload();
            }}
          />
        ) : (
          <p className="m-0 py-8 text-center text-slate-500">Chọn một yêu cầu xuất ở danh sách bên trái để chọn lô, serial và ghi sổ.</p>
        )}
      </section>
    </div>
  );
}

function IssueRequestWorkbench({
  document,
  reservations,
  warehouses,
  materials,
  canWrite,
  onSaved,
}: {
  document: StockDocument;
  reservations: readonly Reservation[];
  warehouses: readonly Warehouse[];
  materials: readonly Material[];
  canWrite: boolean;
  onSaved: (document: StockDocument, message: string) => void;
}) {
  const [draft, setDraft] = useState<DocumentDraft>(() => documentToDraft(document));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [showErrors, setShowErrors] = useState(false);
  const [serialLine, setSerialLine] = useState<string>();
  const [lotLine, setLotLine] = useState<string>();

  const materialByCode = useMemo(() => new Map(materials.map((item) => [item.code, item])), [materials]);
  const serializedCodes = useMemo(
    () => new Set(materials.filter((item) => item.isSerialized).map((item) => item.code)),
    [materials],
  );
  const warehouse = warehouses.find((item) => item.code === document.warehouseCode);

  /** Dòng đang sửa đổi thành dạng dòng chứng từ để tính tiến độ trên lựa chọn chưa lưu. */
  const workingLines: StockDocumentLine[] = draft.lines.map((line, index) => ({
    id: line.key,
    lineNo: index + 1,
    materialId: materialByCode.get(line.materialCode)?.id ?? '',
    materialCode: line.materialCode,
    materialName: materialByCode.get(line.materialCode)?.name ?? line.materialCode,
    unit: materialByCode.get(line.materialCode)?.unit,
    quantity: line.quantity,
    direction: 'OUT',
    unitCost: 0,
    reservationId: line.reservationId,
    lotNo: line.lotNo,
    lotExpiresOn: line.lotExpiresOn,
    serials: line.serials,
  }));
  const progress = issueLineProgress({ warehouseId: document.warehouseId, lines: workingLines }, reservations, serializedCodes);
  const problems = issueReadiness(progress);
  const validation = validateDraft(draft, materialByCode, { forPosting: true });
  const messages = showErrors ? [...validationMessages(validation), ...problems] : [];

  const linked = [...new Set(draft.lines.map((line) => line.reservationId).filter(Boolean))]
    .map((id) => reservations.find((item) => item.id === id))
    .filter((item): item is Reservation => Boolean(item));

  const patchLine = (key: string, next: Partial<DraftLine>) =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...next } : line)),
    }));

  const save = async (post: boolean) => {
    setShowErrors(true);
    const check = validateDraft(draft, materialByCode, { forPosting: post });
    if (!check.valid || (post && problems.length > 0)) return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await updateStockDocument(document.id, {
        lines: draft.lines.map((line) => draftLineToInput(document.docType, line)),
      });
      if (!post) {
        onSaved(saved, `Đã lưu lựa chọn lô, serial cho ${saved.code}.`);
        return;
      }
      const posted = await postStockDocument(saved.id);
      onSaved(posted.document, `Đã ghi sổ ${posted.document.code}; CRM sẽ nhận số đã giao và serial.`);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được chứng từ.'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const cancelled = await cancelStockDocument(document.id);
      onSaved(cancelled, `Đã huỷ ${cancelled.code}.`);
    } catch (cause) {
      setError(errorMessage(cause, 'Không huỷ được chứng từ.'));
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumnsType<StockDocumentLine> = [
    { title: '#', dataIndex: 'lineNo', key: 'lineNo', width: 40 },
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
      title: 'Xuất',
      key: 'quantity',
      width: 80,
      align: 'right',
      render: (_value, line) => `${formatNumber(line.quantity)} ${line.unit ?? ''}`,
    },
    {
      title: 'Giữ hàng / còn chưa xuất',
      key: 'reservation',
      width: 190,
      render: (_value, line, index) => {
        const item = progress[index];
        if (!line.reservationId) return <span className="my-[0.35rem] text-[13px] text-slate-500">Không gắn giữ hàng</span>;
        return (
          <>
            <strong>{item?.reservationCode ?? line.reservationId.slice(0, 8)}</strong>
            {item?.outstanding !== undefined ? (
              <span className="mt-[0.2rem] block text-[13px] font-normal text-slate-500">
                Giữ {formatNumber(item.reserved ?? 0)}, đã xuất {formatNumber(item.issued ?? 0)}, còn{' '}
                {formatNumber(item.outstanding)}
              </span>
            ) : null}
          </>
        );
      },
    },
    {
      title: 'Lô',
      key: 'lot',
      width: 170,
      render: (_value, line) => {
        if (serializedCodes.has(line.materialCode)) return <span className="my-[0.35rem] text-[13px] text-slate-500">Theo serial</span>;
        return (
          <Button type="button" variant="outline" size="xs" className="h-auto whitespace-nowrap border-dashed border-blue-300 bg-blue-50 px-[0.55rem] py-1 text-[13px] font-normal text-blue-700 hover:bg-blue-100" disabled={!canWrite} onClick={() => setLotLine(line.id)}>
            {line.lotNo ? `${line.lotNo}${line.lotExpiresOn ? ` · HSD ${formatDate(line.lotExpiresOn)}` : ''}` : 'Chọn lô (FEFO)'}
          </Button>
        );
      },
    },
    {
      title: 'Serial',
      key: 'serial',
      width: 130,
      render: (_value, line, index) => {
        if (!serializedCodes.has(line.materialCode)) return <span className="my-[0.35rem] text-[13px] text-slate-500">—</span>;
        const missing = progress[index]?.missingSerials ?? 0;
        return (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className={cn('h-auto whitespace-nowrap border-dashed border-blue-300 bg-blue-50 px-[0.55rem] py-1 text-[13px] font-normal text-blue-700 hover:bg-blue-100', missing > 0 && 'border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100')}
            disabled={!canWrite}
            onClick={() => setSerialLine(line.id)}
          >
            {line.serials?.length ?? 0}/{Math.trunc(line.quantity)} serial
          </Button>
        );
      },
    },
  ];

  const serialTarget = draft.lines.find((line) => line.key === serialLine);
  const lotTarget = draft.lines.find((line) => line.key === lotLine);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-base font-bold tracking-[-0.02em] text-slate-900">
            {document.code} <DocumentStatusBadge status={document.status} />
          </h3>
          <span className="text-[13px] tabular-nums text-slate-500">
            {STOCK_DOCUMENT_TYPE_LABEL[document.docType]} · kho {document.warehouseCode} · {formatDate(document.documentDate)}
          </span>
        </div>
      </div>
      <div className="mb-[0.85rem] grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3 [&>div]:flex [&>div]:flex-col [&>div]:gap-[0.15rem] [&_span]:text-xs [&_span]:font-bold [&_span]:text-slate-500 [&_small]:break-all [&_small]:text-xs [&_small]:text-slate-500">
        <div>
          <span>Nguồn</span>
          <strong>{sourceTypeLabel(document.sourceType)}</strong>
          {document.sourceId ? <small>{document.sourceId}</small> : null}
        </div>
        {linked.map((reservation) => (
          <div key={reservation.id}>
            <span>Giữ hàng</span>
            <strong>
              {reservation.reservationCode} · {RESERVATION_STATUS_LABEL[reservation.status]}
            </strong>
            {reservation.expiresAt ? <small>Hết hạn giữ {formatDate(reservation.expiresAt)}</small> : null}
          </div>
        ))}
      </div>
      {document.note ? <p className="my-[0.35rem] text-[13px] text-slate-500">Ghi chú: {document.note}</p> : null}

      <Table<StockDocumentLine>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={workingLines}
        pagination={false}
        scroll={{ x: 820 }}
      />

      {problems.length && !showErrors ? (
        <p className="my-[0.6rem] rounded-lg border border-amber-200 bg-amber-50 px-[0.8rem] py-[0.6rem] text-[13px] text-amber-800">{problems.join(' ')}</p>
      ) : null}
      {messages.length || error ? (
        <div role="alert" className="mt-3 rounded-[0.65rem] border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error ? <div>{error}</div> : null}
          {messages.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}

      {canWrite ? (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Popconfirm
            title="Huỷ yêu cầu xuất?"
            description="Chứng từ chuyển sang Đã huỷ; giữ hàng của đơn vẫn còn đến khi CRM nhả."
            okText="Huỷ chứng từ"
            cancelText="Không"
            disabled={busy}
            onConfirm={cancel}
          >
            <Button type="button" variant="destructive" disabled={busy}>
              Huỷ chứng từ
            </Button>
          </Popconfirm>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void save(false)}>
            Lưu lựa chọn
          </Button>
          <Popconfirm
            title="Ghi sổ xuất kho?"
            description="Tồn và phần đã giữ giảm ngay; CRM nhận số đã giao, serial và giá vốn."
            okText="Ghi sổ"
            cancelText="Huỷ"
            okType="primary"
            disabled={busy || problems.length > 0 || !validation.valid}
            onConfirm={() => save(true)}
          >
            <Button
              type="button"
             
              disabled={busy}
              onClick={problems.length > 0 || !validation.valid ? () => setShowErrors(true) : undefined}
            >
              <PackageCheck size={15} /> Ghi sổ
            </Button>
          </Popconfirm>
        </div>
      ) : (
        <p className="my-[0.35rem] text-[13px] text-slate-500">Cần quyền ghi phát sinh tồn kho để xử lý yêu cầu xuất.</p>
      )}

      {serialTarget ? (
        <SerialPickerDrawer
          open
          materialCode={serialTarget.materialCode}
          materialName={materialByCode.get(serialTarget.materialCode)?.name}
          warehouse={warehouse}
          quantity={serialTarget.quantity}
          value={serialTarget.serials}
          inbound={false}
          onApply={(serials) => {
            patchLine(serialTarget.key, { serials });
            setSerialLine(undefined);
          }}
          onClose={() => setSerialLine(undefined)}
        />
      ) : null}
      {lotTarget ? (
        <LotPickerDrawer
          open
          materialCode={lotTarget.materialCode}
          warehouseCode={document.warehouseCode}
          quantity={lotTarget.quantity}
          unit={materialByCode.get(lotTarget.materialCode)?.unit}
          current={lotTarget.lotNo}
          onApply={(allocations) => {
            setDraft((current) => ({
              ...current,
              lines: current.lines.flatMap((line) =>
                line.key === lotTarget.key ? splitLineByLots(lotTarget, allocations) : [line],
              ),
            }));
            setLotLine(undefined);
          }}
          onClose={() => setLotLine(undefined)}
        />
      ) : null}
    </>
  );
}
