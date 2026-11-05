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
import styles from '../inventory.module.scss';

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
      render: (value: string) => <strong className={styles.code}>{value}</strong>,
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
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>Chứng từ kho</h2>
          <span className={styles.countHint}>{formatNumber(total)} chứng từ</span>
        </div>
        <div className={styles.docActions}>
          <button type="button" className={styles.btnSecondary} onClick={() => void reload()} disabled={loading}>
            <RotateCw size={15} /> Tải lại
          </button>
          {capabilities.canWriteTransactions ? (
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() =>
                setForm({ draft: emptyDraft('RECEIPT_PURCHASE', warehouses.find((item) => item.isActive)?.code ?? ''), key: Date.now() })
              }
            >
              <FilePlus2 size={15} /> Lập chứng từ
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.docFilterRow}>
        <label className={styles.docField}>
          <span>Loại</span>
          <SearchableSelect options={TYPE_OPTIONS} value={docType} height={36} onChange={(value) => filtersChanged(() => setDocType(value))} />
        </label>
        <label className={styles.docField}>
          <span>Trạng thái</span>
          <SearchableSelect options={STATUS_OPTIONS} value={status} height={36} onChange={(value) => filtersChanged(() => setStatus(value))} />
        </label>
        <label className={styles.docField}>
          <span>Kho</span>
          <SearchableSelect
            options={warehouseOptions}
            value={warehouseCode}
            height={36}
            onChange={(value) => filtersChanged(() => setWarehouseCode(value))}
          />
        </label>
        <label className={styles.docField}>
          <span>Từ ngày</span>
          <input type="date" value={fromDate} onChange={(event) => filtersChanged(() => setFromDate(event.target.value))} />
        </label>
        <label className={styles.docField}>
          <span>Đến ngày</span>
          <input type="date" value={toDate} onChange={(event) => filtersChanged(() => setToDate(event.target.value))} />
        </label>
      </div>

      {error ? (
        <p role="alert" className={styles.alert}>
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
    </section>
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
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>Chứng từ chờ duyệt</h2>
          <span className={styles.countHint}>{formatNumber(total)} chứng từ đang chờ</span>
        </div>
        <button type="button" className={styles.btnSecondary} onClick={() => void reload()} disabled={loading}>
          <RotateCw size={15} /> Tải lại
        </button>
      </div>
      {capabilities.canApproveDocuments ? null : (
        <p className={styles.docWarn}>
          Bạn chỉ xem được danh sách; duyệt hoặc từ chối cần quyền "Duyệt chứng từ kho".
        </p>
      )}
      <div className={styles.docFilterRow}>
        <label className={styles.docField}>
          <span>Loại</span>
          <SearchableSelect options={TYPE_OPTIONS} value={docType} height={36} onChange={setDocType} />
        </label>
        <label className={styles.docField}>
          <span>Kho</span>
          <SearchableSelect
            options={[{ value: '', label: 'Mọi kho' }, ...warehouses.map((item) => ({ value: item.code, label: `${item.code} - ${item.name}` }))]}
            value={warehouseCode}
            height={36}
            onChange={setWarehouseCode}
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className={styles.alert}>
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
    </section>
  );
}
