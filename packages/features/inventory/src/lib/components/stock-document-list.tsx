'use client';

import {
  STOCK_DOCUMENT_STATUSES,
  STOCK_DOCUMENT_TYPES,
  type Material,
  type StockDocument,
  type StockDocumentListQuery,
  type StockDocumentStatus,
  type StockDocumentType,
  type Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, formatDate } from '@enterprise-platform/shared-ui';
import { Table, type TableColumnsType } from 'antd';
import { FilePlus2, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadStockDocuments } from '../inventory-api';
import { formatNumber } from '../inventory-labels';
import { useInventoryPermissions } from '../inventory-permissions';
import {
  STOCK_DOCUMENT_STATUS_LABEL,
  STOCK_DOCUMENT_TYPE_LABEL,
  documentToDraft,
  emptyDraft,
  sourceTypeLabel,
  type DocumentDraft,
} from '../stock-document.model';
import { DocumentActionBar, StockDocumentDetail } from './stock-document-detail';
import { StockDocumentForm } from './stock-document-form';
import { DocumentStatusBadge, errorMessage } from './stock-document-parts';
import { Button } from '../ui/button';
import { Card, CardHeader } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const PAGE_SIZE = 20;

/** Tải một trang chứng từ theo bộ lọc; lỗi server hiện nguyên văn. */
function useDocumentPage(query: StockDocumentListQuery) {
  const [items, setItems] = useState<StockDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const key = JSON.stringify(query);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const page = await loadStockDocuments(JSON.parse(key) as StockDocumentListQuery);
      setItems([...page.items]);
      setTotal(page.total);
    } catch (cause) {
      setError(errorMessage(cause, 'Không tải được danh sách chứng từ.'));
    } finally {
      setLoading(false);
    }
  }, [key]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, total, loading, error, reload };
}

function baseColumns(): TableColumnsType<StockDocument> {
  return [
    {
      title: 'Số chứng từ',
      dataIndex: 'code',
      key: 'code',
      width: 150,
      render: (value: string) => <strong className="font-bold text-blue-600">{value}</strong>,
    },
    {
      title: 'Loại',
      dataIndex: 'docType',
      key: 'docType',
      width: 160,
      render: (value: StockDocumentType) => STOCK_DOCUMENT_TYPE_LABEL[value],
    },
    {
      title: 'Kho',
      key: 'warehouse',
      width: 170,
      render: (_value, document) =>
        document.targetWarehouseCode ? `${document.warehouseCode} → ${document.targetWarehouseCode}` : document.warehouseCode,
    },
    {
      title: 'Ngày',
      dataIndex: 'documentDate',
      key: 'documentDate',
      width: 110,
      render: (value: string) => formatDate(value),
    },
    {
      title: 'Dòng',
      key: 'lines',
      width: 90,
      align: 'right',
      render: (_value, document) =>
        `${document.lines.length} / ${formatNumber(document.lines.reduce((sum, line) => sum + line.quantity, 0))}`,
    },
    {
      title: 'Nguồn',
      dataIndex: 'sourceType',
      key: 'sourceType',
      width: 130,
      render: (value?: string) => sourceTypeLabel(value),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (value: StockDocumentStatus) => <DocumentStatusBadge status={value} />,
    },
  ];
}

const TYPE_OPTIONS = [
  { value: '', label: 'Mọi loại' },
  ...STOCK_DOCUMENT_TYPES.map((type) => ({ value: type, label: STOCK_DOCUMENT_TYPE_LABEL[type] })),
];
const STATUS_OPTIONS = [
  { value: '', label: 'Mọi trạng thái' },
  ...STOCK_DOCUMENT_STATUSES.map((status) => ({ value: status, label: STOCK_DOCUMENT_STATUS_LABEL[status] })),
];

/**
 * Danh sách chứng từ kho (T1-28): lọc theo loại, trạng thái, kho, khoảng ngày;
 * mở chi tiết để xem dòng, giá vốn, lô, serial, lịch sử và làm thao tác theo
 * trạng thái; lập chứng từ mới hoặc sửa nháp.
 */
export function StockDocumentList({
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
  const permissions = useInventoryPermissions();
  const capabilities = {
    canWriteTransactions: permissions.canWriteTransactions,
    canApproveDocuments: permissions.canApproveDocuments,
  };
  const [docType, setDocType] = useState('');
  const [status, setStatus] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const query = useMemo<StockDocumentListQuery>(
    () => ({
      docType: (docType || undefined) as StockDocumentType | undefined,
      status: (status || undefined) as StockDocumentStatus | undefined,
      warehouseCode: warehouseCode || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [docType, status, warehouseCode, fromDate, toDate, page],
  );
  const { items, total, loading, error, reload } = useDocumentPage(query);
  const [opened, setOpened] = useState<StockDocument>();
  const [form, setForm] = useState<{ draft: DocumentDraft; id?: string; key: number }>();

  const warehouseOptions = [
    { value: '', label: 'Mọi kho' },
    ...warehouses.map((item) => ({ value: item.code, label: `${item.code} - ${item.name}` })),
  ];

  const changed = (document: StockDocument, message: string) => {
    onNotice(message);
    setOpened(document);
    void reload();
    if (document.status === 'POSTED') onStockChanged?.();
  };

  const filtersChanged = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <Card className="gap-0 rounded-2xl px-[clamp(1rem,2vw,1.5rem)] py-[1.2rem]">
      <CardHeader className="mb-4 flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-bold tracking-tight text-slate-900">Chứng từ kho</h2>
          <span className="text-[13px] tabular-nums text-slate-500">{formatNumber(total)} chứng từ</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void reload()} disabled={loading}>
            <RotateCw size={15} /> Tải lại
          </Button>
          {capabilities.canWriteTransactions ? (
            <Button
              type="button"
             
              onClick={() =>
                setForm({ draft: emptyDraft('RECEIPT_PURCHASE', warehouses.find((item) => item.isActive)?.code ?? ''), key: Date.now() })
              }
            >
              <FilePlus2 size={15} /> Lập chứng từ
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <div className="mb-[0.85rem] flex flex-wrap items-end gap-[0.7rem]">
        <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
          <span>Loại</span>
          <SearchableSelect options={TYPE_OPTIONS} value={docType} height={36} onChange={(value) => filtersChanged(() => setDocType(value))} />
        </Label>
        <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
          <span>Trạng thái</span>
          <SearchableSelect options={STATUS_OPTIONS} value={status} height={36} onChange={(value) => filtersChanged(() => setStatus(value))} />
        </Label>
        <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
          <span>Kho</span>
          <SearchableSelect
            options={warehouseOptions}
            value={warehouseCode}
            height={36}
            onChange={(value) => filtersChanged(() => setWarehouseCode(value))}
          />
        </Label>
        <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
          <span>Từ ngày</span>
          <Input className="font-normal" type="date" value={fromDate} onChange={(event) => filtersChanged(() => setFromDate(event.target.value))} />
        </Label>
        <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
          <span>Đến ngày</span>
          <Input className="font-normal" type="date" value={toDate} onChange={(event) => filtersChanged(() => setToDate(event.target.value))} />
        </Label>
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-[0.65rem] border border-red-200 bg-red-50 px-4 py-[0.8rem] text-red-800">
          {error}
        </p>
      ) : null}

      <Table<StockDocument>
        rowKey="id"
        size="small"
        loading={loading}
        columns={baseColumns()}
        dataSource={items}
        scroll={{ x: 960 }}
        onRow={(document) => ({ onClick: () => setOpened(document), style: { cursor: 'pointer' } })}
        locale={{ emptyText: 'Chưa có chứng từ nào khớp bộ lọc.' }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          onChange: (next) => setPage(next),
        }}
      />

      {opened ? (
        <StockDocumentDetail
          document={opened}
          capabilities={capabilities}
          onEdit={(document) => {
            setOpened(undefined);
            setForm({ draft: documentToDraft(document), id: document.id, key: Date.now() });
          }}
          onChanged={changed}
          onClose={() => setOpened(undefined)}
        />
      ) : null}

      {form ? (
        <StockDocumentForm
          key={form.key}
          open
          documentId={form.id}
          initial={form.draft}
          warehouses={warehouses}
          materials={materials}
          onSaved={(document, message) => {
            setForm(undefined);
            changed(document, message);
          }}
          onClose={() => setForm(undefined)}
        />
      ) : null}
    </Card>
  );
}

/**
 * Danh sách chứng từ Chờ duyệt (T1-29): nhập khác, xuất khác, điều chỉnh. Nút
 * Duyệt, Từ chối chỉ hiện khi có quyền duyệt chứng từ; server vẫn kiểm quyền và
 * chặn người lập tự duyệt, lỗi trả về hiện nguyên văn.
 */
export function StockDocumentApproval({
  warehouses,
  onNotice,
  onStockChanged,
}: {
  warehouses: readonly Warehouse[];
  onNotice: (message: string) => void;
  onStockChanged?: () => void;
}) {
  const permissions = useInventoryPermissions();
  const capabilities = {
    canWriteTransactions: permissions.canWriteTransactions,
    canApproveDocuments: permissions.canApproveDocuments,
  };
  const [docType, setDocType] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const query = useMemo<StockDocumentListQuery>(
    () => ({
      status: 'PENDING',
      docType: (docType || undefined) as StockDocumentType | undefined,
      warehouseCode: warehouseCode || undefined,
      limit: 100,
    }),
    [docType, warehouseCode],
  );
  const { items, total, loading, error, reload } = useDocumentPage(query);
  const [opened, setOpened] = useState<StockDocument>();

  const changed = (document: StockDocument, message: string) => {
    onNotice(message);
    setOpened(undefined);
    void reload();
    if (document.status === 'POSTED') onStockChanged?.();
  };

  const columns: TableColumnsType<StockDocument> = [
    ...baseColumns().filter((column) => column.key !== 'status' && column.key !== 'sourceType'),
    {
      title: 'Ghi chú',
      dataIndex: 'note',
      key: 'note',
      render: (value?: string) => value ?? '—',
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 300,
      render: (_value, document) => (
        <div onClick={(event) => event.stopPropagation()}>
          <DocumentActionBar
            document={document}
            capabilities={capabilities}
            exclude={['cancel', 'edit']}
            onChanged={changed}
          />
        </div>
      ),
    },
  ];

  return (
    <Card className="gap-0 rounded-2xl px-[clamp(1rem,2vw,1.5rem)] py-[1.2rem]">
      <CardHeader className="mb-4 flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-bold tracking-tight text-slate-900">Chứng từ chờ duyệt</h2>
          <span className="text-[13px] tabular-nums text-slate-500">{formatNumber(total)} chứng từ đang chờ</span>
        </div>
        <Button type="button" variant="outline" onClick={() => void reload()} disabled={loading}>
          <RotateCw size={15} /> Tải lại
        </Button>
      </CardHeader>
      {capabilities.canApproveDocuments ? null : (
        <p className="my-[0.6rem] rounded-[0.55rem] border border-amber-200 bg-amber-50 px-[0.8rem] py-[0.6rem] text-[13px] text-amber-800">
          Bạn chỉ xem được danh sách; duyệt hoặc từ chối cần quyền "Duyệt chứng từ kho".
        </p>
      )}
      <div className="mb-[0.85rem] flex flex-wrap items-end gap-[0.7rem]">
        <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
          <span>Loại</span>
          <SearchableSelect options={TYPE_OPTIONS} value={docType} height={36} onChange={setDocType} />
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
        <p role="alert" className="mb-4 rounded-[0.65rem] border border-red-200 bg-red-50 px-4 py-[0.8rem] text-red-800">
          {error}
        </p>
      ) : null}
      <Table<StockDocument>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={items}
        scroll={{ x: 1100 }}
        pagination={false}
        onRow={(document) => ({ onClick: () => setOpened(document), style: { cursor: 'pointer' } })}
        locale={{ emptyText: 'Không có chứng từ nào chờ duyệt.' }}
      />
      {opened ? (
        <StockDocumentDetail
          document={opened}
          capabilities={capabilities}
          onChanged={changed}
          onClose={() => setOpened(undefined)}
        />
      ) : null}
    </Card>
  );
}
