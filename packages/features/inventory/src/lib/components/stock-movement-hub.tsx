'use client';

import {
  STOCK_DOCUMENT_STATUSES,
  STOCK_DOCUMENT_TYPES,
  type Material,
  type StockDocument,
  type StockDocumentStatus,
  type StockDocumentType,
  type StockMovementEntry,
  type StockMovementListQuery,
  type Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, formatDate } from '@enterprise-platform/shared-ui';
import { Drawer, Table, type TableColumnsType } from 'antd';
import { FilePlus2, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadStockDocument, loadStockMovements } from '../inventory-api';
import { formatDateTime, formatNumber } from '../inventory-labels';
import { useInventoryPermissions } from '../inventory-permissions';
import {
  STOCK_DOCUMENT_STATUS_LABEL,
  STOCK_DOCUMENT_TYPE_LABEL,
  documentToDraft,
  emptyDraft,
  sourceTypeLabel,
  type DocumentDraft,
} from '../stock-document.model';
import {
  MOVEMENT_SOURCE_OPTIONS,
  MOVEMENT_VIEWS,
  movementMaterialLabel,
  movementTypeLabel,
  movementWarehouseLabel,
  type MovementHashTarget,
  type MovementView,
} from '../stock-movement.model';
import { useUserLabel } from '../user-names';
import { IssueRequestPanel } from './issue-request-panel';
import { StockDocumentDetail } from './stock-document-detail';
import { StockDocumentForm } from './stock-document-form';
import { StockDocumentApproval } from './stock-document-list';
import { DocumentStatusBadge, errorMessage } from './stock-document-parts';
import { Button } from '../ui/button';
import { Card, CardHeader } from '../ui/card';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

const TYPE_OPTIONS = [
  { value: '', label: 'Mọi loại' },
  ...STOCK_DOCUMENT_TYPES.map((type) => ({ value: type, label: STOCK_DOCUMENT_TYPE_LABEL[type] })),
];
const STATUS_OPTIONS = [
  { value: '', label: 'Mọi trạng thái' },
  ...STOCK_DOCUMENT_STATUSES.map((status) => ({ value: status, label: STOCK_DOCUMENT_STATUS_LABEL[status] })),
];

const rowKey = (entry: StockMovementEntry) => `${entry.kind}:${entry.id}`;

/** Bút toán từ trước khi có chứng từ: chỉ xem, không có thao tác. */
function LegacyEntryDrawer({ entry, onClose }: { entry: StockMovementEntry; onClose: () => void }) {
  const userName = useUserLabel();
  return (
    <Drawer open onClose={onClose} size="min(560px, 96vw)" destroyOnHidden title={`Bút toán cũ ${entry.code}`}>
      <p className="my-[0.6rem] rounded-[0.55rem] border border-amber-200 bg-amber-50 px-[0.8rem] py-[0.6rem] text-[13px] text-amber-800">
        Bút toán này được ghi trước khi Kho dùng chứng từ nên không có chứng từ kèm theo. Dữ liệu chỉ để tra cứu,
        không sửa và không đảo được tại đây.
      </p>
      <div className="my-4 grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3 [&>div]:flex [&>div]:flex-col [&>div]:gap-[0.15rem] [&_span]:text-xs [&_span]:font-bold [&_span]:text-slate-500 [&_small]:break-all [&_small]:text-xs [&_small]:text-slate-500">
        <div>
          <span>Loại</span>
          <strong>{movementTypeLabel(entry)}</strong>
        </div>
        <div>
          <span>Kho</span>
          <strong>{entry.warehouseCode}</strong>
        </div>
        <div>
          <span>Thời điểm ghi</span>
          <strong>{formatDateTime(entry.occurredAt)}</strong>
        </div>
        <div>
          <span>Nguồn phát sinh</span>
          <strong>{sourceTypeLabel(entry.sourceType)}</strong>
        </div>
        <div>
          <span>Mặt hàng</span>
          <strong>{entry.materialCode ?? '—'}</strong>
          {entry.materialName ? <small>{entry.materialName}</small> : null}
        </div>
        <div>
          <span>Số lượng</span>
          <strong>{formatNumber(entry.quantityTotal)}</strong>
        </div>
        <div>
          <span>Người ghi</span>
          <strong>{userName(entry.createdBy)}</strong>
        </div>
      </div>
      {entry.note ? <p className="text-[13px] text-slate-500">Ghi chú: {entry.note}</p> : null}
    </Drawer>
  );
}

/** Danh sách gộp: một dòng cho mỗi chứng từ và mỗi bút toán cũ, do server gộp và phân trang. */
function MovementList({
  warehouses,
  materials,
  initialDocumentKey,
  onPendingCount,
  onNotice,
  onStockChanged,
}: {
  warehouses: readonly Warehouse[];
  materials: readonly Material[];
  initialDocumentKey?: string;
  onPendingCount: (count: number) => void;
  onNotice: (message: string) => void;
  onStockChanged?: () => void;
}) {
  const permissions = useInventoryPermissions();
  const capabilities = {
    canWriteTransactions: permissions.canWriteTransactions,
    canApproveDocuments: permissions.canApproveDocuments,
  };
  const userName = useUserLabel();
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [docType, setDocType] = useState('');
  const [status, setStatus] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<StockMovementEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [opened, setOpened] = useState<StockDocument>();
  const [legacy, setLegacy] = useState<StockMovementEntry>();
  const [form, setForm] = useState<{ draft: DocumentDraft; id?: string; key: number }>();

  // Gõ xong mới tìm, để không gọi server theo từng phím.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const query = useMemo<StockMovementListQuery>(
    () => ({
      search: search || undefined,
      sourceType: sourceType || undefined,
      docType: (docType || undefined) as StockDocumentType | undefined,
      status: (status || undefined) as StockDocumentStatus | undefined,
      warehouseCode: warehouseCode || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [search, sourceType, docType, status, warehouseCode, fromDate, toDate, page],
  );
  const queryKey = JSON.stringify(query);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await loadStockMovements(JSON.parse(queryKey) as StockMovementListQuery);
      setRows([...(result.rows ?? [])]);
      setTotal(result.total ?? 0);
      onPendingCount(result.pendingCount ?? 0);
    } catch (cause) {
      // Không quay về ghép hai API cũ: hai đường cho ra hai kết quả khác nhau.
      setError(errorMessage(cause, 'Không tải được danh sách xuất/nhập kho.'));
    } finally {
      setLoading(false);
    }
  }, [queryKey, onPendingCount]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openDocument = useCallback(async (key: string) => {
    try {
      setOpened(await loadStockDocument(key));
    } catch (cause) {
      setError(errorMessage(cause, 'Không mở được chứng từ.'));
    }
  }, []);

  // Link cũ kiểu `#vouchers/<id>` hoặc `#stock/movements/<id>` mở thẳng chi tiết.
  useEffect(() => {
    if (initialDocumentKey) void openDocument(initialDocumentKey);
  }, [initialDocumentKey, openDocument]);

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

  const warehouseOptions = [
    { value: '', label: 'Mọi kho' },
    ...warehouses.map((item) => ({ value: item.code, label: `${item.code} - ${item.name}` })),
  ];

  const columns: TableColumnsType<StockMovementEntry> = [
    {
      title: 'Số chứng từ',
      key: 'code',
      width: 170,
      render: (_value, entry) => (
        <>
          <strong className="font-bold text-blue-600">{entry.code}</strong>
          {entry.kind === 'legacy' ? <span className="block text-xs text-slate-500">Bút toán cũ</span> : null}
        </>
      ),
    },
    { title: 'Loại', key: 'type', width: 150, render: (_value, entry) => movementTypeLabel(entry) },
    {
      title: 'Nguồn phát sinh',
      dataIndex: 'sourceType',
      key: 'sourceType',
      width: 140,
      render: (value: string) => sourceTypeLabel(value),
    },
    { title: 'Kho', key: 'warehouse', width: 150, render: (_value, entry) => movementWarehouseLabel(entry) },
    {
      title: 'Ngày',
      dataIndex: 'movementDate',
      key: 'movementDate',
      width: 105,
      render: (value: string) => formatDate(value),
    },
    { title: 'Mặt hàng', key: 'material', render: (_value, entry) => movementMaterialLabel(entry) },
    {
      title: 'Số lượng',
      dataIndex: 'quantityTotal',
      key: 'quantityTotal',
      width: 100,
      render: (value: number) => formatNumber(value),
    },
    {
      title: 'Người lập',
      dataIndex: 'createdBy',
      key: 'createdBy',
      width: 140,
      render: (value: string) => userName(value),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 125,
      render: (value: StockDocumentStatus) => <DocumentStatusBadge status={value} />,
    },
  ];

  return (
    <Card className="gap-0 rounded-2xl px-[clamp(1rem,2vw,1.5rem)] py-[1.2rem]">
      <CardHeader className="mb-4 flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-bold tracking-tight text-slate-900">Xuất/nhập kho</h2>
          <span className="text-[13px] tabular-nums text-slate-500">{formatNumber(total)} dòng</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void reload()} disabled={loading}>
            <RotateCw size={15} /> Tải lại
          </Button>
          {capabilities.canWriteTransactions ? (
            <Button
              type="button"
              onClick={() =>
                setForm({
                  draft: emptyDraft('RECEIPT_PURCHASE', warehouses.find((item) => item.isActive)?.code ?? ''),
                  key: Date.now(),
                })
              }
            >
              <FilePlus2 size={15} /> Lập chứng từ
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <div className="mb-[0.85rem] flex flex-wrap items-end gap-[0.7rem]">
        <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
          <span>Tìm kiếm</span>
          <Input
            className="font-normal"
            type="search"
            value={searchText}
            placeholder="Số chứng từ, mã hoặc tên mặt hàng"
            onChange={(event) => setSearchText(event.target.value)}
          />
        </Label>
        <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
          <span>Nguồn phát sinh</span>
          <SearchableSelect
            options={[...MOVEMENT_SOURCE_OPTIONS]}
            value={sourceType}
            height={36}
            onChange={(value) => filtersChanged(() => setSourceType(value))}
          />
        </Label>
        <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
          <span>Loại</span>
          <SearchableSelect
            options={TYPE_OPTIONS}
            value={docType}
            height={36}
            onChange={(value) => filtersChanged(() => setDocType(value))}
          />
        </Label>
        <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
          <span>Trạng thái</span>
          <SearchableSelect
            options={STATUS_OPTIONS}
            value={status}
            height={36}
            onChange={(value) => filtersChanged(() => setStatus(value))}
          />
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
          <Input
            className="font-normal"
            type="date"
            value={fromDate}
            onChange={(event) => filtersChanged(() => setFromDate(event.target.value))}
          />
        </Label>
        <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
          <span>Đến ngày</span>
          <Input className="font-normal" type="date" value={toDate} onChange={(event) => filtersChanged(() => setToDate(event.target.value))} />
        </Label>
      </div>

      {error ? (
        <p role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-[0.65rem] border border-red-200 bg-red-50 px-4 py-[0.8rem] text-red-800">
          {error}
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
            Thử lại
          </Button>
        </p>
      ) : null}

      <Table<StockMovementEntry>
        rowKey={rowKey}
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1280 }}
        onRow={(entry) => ({
          onClick: () => (entry.kind === 'document' ? void openDocument(entry.id) : setLegacy(entry)),
          style: { cursor: 'pointer' },
        })}
        locale={{ emptyText: 'Chưa có phát sinh nào khớp bộ lọc.' }}
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

      {legacy ? <LegacyEntryDrawer entry={legacy} onClose={() => setLegacy(undefined)} /> : null}

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
 * Tab "Xuất/nhập kho": một nơi theo dõi mọi lần xuất, nhập, thay cho ba mục
 * Chứng từ kho, Duyệt chứng từ, Yêu cầu xuất từ đơn bán. Góc nhìn Chờ duyệt và
 * Yêu cầu xuất dùng lại nguyên màn cũ, nên quyền và nghiệp vụ không đổi.
 */
export function StockMovementHub({
  warehouses,
  materials,
  target,
  onNotice,
  onStockChanged,
}: {
  warehouses: readonly Warehouse[];
  materials: readonly Material[];
  /** Góc nhìn và chứng từ cần mở, phân giải từ hash (link cũ hoặc thông báo). */
  target?: MovementHashTarget;
  onNotice: (message: string) => void;
  onStockChanged?: () => void;
}) {
  const [view, setView] = useState<MovementView>(target?.view ?? 'all');
  const [pendingCount, setPendingCount] = useState<number>();

  useEffect(() => {
    if (target) setView(target.view);
  }, [target]);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-[0.35rem]" role="tablist" aria-label="Góc nhìn xuất/nhập kho">
        {MOVEMENT_VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            className={cn(
              'cursor-pointer rounded-[0.65rem] border-0 px-[0.95rem] py-2 text-sm font-semibold',
              view === item.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )}
            onClick={() => setView(item.id)}
          >
            {item.label}
            {item.id === 'pending' && pendingCount ? ` (${formatNumber(pendingCount)})` : ''}
          </button>
        ))}
      </div>

      {view === 'all' ? (
        <MovementList
          warehouses={warehouses}
          materials={materials}
          initialDocumentKey={target?.view === 'all' ? target.documentKey : undefined}
          onPendingCount={setPendingCount}
          onNotice={onNotice}
          onStockChanged={onStockChanged}
        />
      ) : null}

      {view === 'pending' ? (
        <StockDocumentApproval warehouses={warehouses} onNotice={onNotice} onStockChanged={onStockChanged} />
      ) : null}

      {view === 'requests' ? (
        <IssueRequestPanel
          warehouses={warehouses}
          materials={materials}
          onNotice={onNotice}
          onStockChanged={onStockChanged}
        />
      ) : null}
    </>
  );
}
