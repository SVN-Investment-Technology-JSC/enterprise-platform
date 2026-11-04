'use client';

import type {
  CreateMaterialRequest,
  InventoryTradeCatalog,
  Material,
  UpdateMaterialRequest,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Download, Plus, Search, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createMaterial, loadTradeItems, retireMaterial, updateMaterial } from '../inventory-api';
import styles from '../inventory.module.scss';
import {
  EMPTY_FILTER,
  PAGE_SIZES,
  TRADE_GROUP_LABEL,
  categoryChoices,
  exportTradeItems,
  filterTradeItems,
  formatSalePrice,
  paginate,
  tradeGroupOf,
  usageChoices,
  usageLabel,
  type ImportRow,
  type TradeFilter,
  type TradeGroup,
} from '../trade-items.model';
import type { StockRow } from './material-drawer-sections';
import { TablePager } from './table-pager';
import { TradeItemDrawer } from './trade-item-drawer';
import { TradeItemFormDialog } from './trade-item-form-dialog';
import { TradeItemImportDialog } from './trade-item-import-dialog';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Tab Hàng hóa của trang Kho hàng: danh mục mặt hàng (hàng hóa, dịch vụ) với phân loại, cách sử dụng và giá bán.
 * Phân loại và cách sử dụng chọn từ danh mục khai trong Cài đặt. Tab này không đổi tồn, chỉ xem, tạo, sửa,
 * nhập và xuất danh sách; tồn kho và lịch sử xuất nhập hiện ở drawer chi tiết.
 */
export function TradeItemsPage({
  canManage,
  warehouses,
  stock = [],
  catalog,
  onChanged,
}: {
  canManage: boolean;
  warehouses: readonly Warehouse[];
  /** Tồn theo kho của mọi mặt hàng, để drawer hiện nhóm Tồn kho. */
  stock?: readonly StockRow[];
  /** Danh mục phân loại và sử dụng; chưa nạp xong thì các ô chọn tạm rỗng. */
  catalog?: InventoryTradeCatalog;
  /** Gọi sau khi tạo, sửa hoặc nhập xong, để tab Nhà kho nạp lại danh mục. */
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<readonly Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [filter, setFilter] = useState<TradeFilter>(EMPTY_FILTER);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [selectedCode, setSelectedCode] = useState<string>();
  const [dialog, setDialog] = useState<{ kind: 'form'; code?: string } | { kind: 'import' }>();
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      setItems(await loadTradeItems());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(errorMessage(error, 'Không tải được danh sách hàng hóa.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const categoryOptions = useMemo(
    () => categoryChoices(items, catalog, filter.group),
    [items, catalog, filter.group],
  );
  const usageOptions = useMemo(() => usageChoices(items, catalog), [items, catalog]);
  const filtered = useMemo(() => filterTradeItems(items, filter), [items, filter]);
  const view = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize]);
  const selected = items.find((item) => item.code === selectedCode);
  const editing = dialog?.kind === 'form' && dialog.code ? items.find((item) => item.code === dialog.code) : undefined;

  const change = (patch: Partial<TradeFilter>) => {
    setFilter((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const groupOptions = (Object.keys(TRADE_GROUP_LABEL) as TradeGroup[]).map((value) => ({
    value,
    label: TRADE_GROUP_LABEL[value],
  }));

  const save = async (work: () => Promise<string>) => {
    setSaving(true);
    try {
      const text = await work();
      await reload();
      onChanged?.();
      setNotice({ tone: 'ok', text });
      setDialog(undefined);
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error, 'Không lưu được hàng hóa.') });
    } finally {
      setSaving(false);
    }
  };

  const importRows = async (rows: ImportRow[]) => {
    const failures: { line: number; message: string }[] = [];
    let created = 0;
    for (const row of rows) {
      if (!row.input) continue;
      try {
        await createMaterial(row.input);
        created += 1;
      } catch (error) {
        failures.push({ line: row.line, message: errorMessage(error, 'Không tạo được.') });
      }
    }
    await reload();
    if (created > 0) onChanged?.();
    return { created, failures };
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', flex: '1 1 480px' }}>
          <div className={styles.tableSearchBox} style={{ flex: '0 1 280px' }}>
            <Search size={14} className={styles.tableSearchIcon} style={{ position: 'absolute', left: '0.65rem' }} />
            <input
              value={filter.search}
              placeholder="Tìm mã, tên hoặc barcode…"
              aria-label="Tìm hàng hóa"
              onChange={(event) => change({ search: event.target.value })}
            />
          </div>
          <div style={{ width: '150px' }}>
            <SearchableSelect
              options={groupOptions}
              value={filter.group}
              placeholder="Nhóm"
              onChange={(value) =>
                // Phân loại thuộc danh sách của từng nhóm: đổi nhóm thì bỏ phân loại đang lọc.
                change({ group: (value || '') as TradeGroup | '', category: '' })
              }
              clearable
              height={34}
            />
          </div>
          <div style={{ width: '190px' }}>
            <SearchableSelect
              options={categoryOptions}
              value={filter.category}
              placeholder="Phân loại"
              onChange={(value) => change({ category: value || '' })}
              clearable
              height={34}
            />
          </div>
          <div style={{ width: '170px' }}>
            <SearchableSelect
              options={usageOptions}
              value={filter.usage}
              placeholder="Sử dụng"
              onChange={(value) => change({ usage: value || '' })}
              clearable
              height={34}
            />
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#475569' }}>
            <input
              type="checkbox"
              checked={filter.includeInactive}
              onChange={(event) => change({ includeInactive: event.target.checked })}
            />
            Hiện cả mã đã ngừng dùng
          </label>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {canManage ? (
            <button type="button" className={styles.btnSecondary} style={{ whiteSpace: 'nowrap' }} onClick={() => setDialog({ kind: 'import' })}>
              <Upload size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
              Nhập Excel
            </button>
          ) : null}
          <button
            type="button"
            className={styles.btnSecondary}
            style={{ whiteSpace: 'nowrap' }}
            disabled={filtered.length === 0}
            onClick={() => exportTradeItems(filtered)}
          >
            <Download size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            Xuất Excel
          </button>
          {canManage ? (
            <button type="button" className={styles.btnPrimary} style={{ whiteSpace: 'nowrap' }} onClick={() => setDialog({ kind: 'form' })}>
              <Plus size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
              Tạo mới
            </button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          style={{ margin: 0, fontSize: '14px', color: notice.tone === 'error' ? '#b91c1c' : '#15803d' }}
        >
          {notice.text}
        </p>
      ) : null}

      {view.total === 0 ? (
        <p className={styles.empty} role={loadError ? 'alert' : undefined}>
          {loading
            ? 'Đang tải…'
            : (loadError ?? (items.length === 0 ? 'Chưa có hàng hóa nào.' : 'Không có hàng hóa phù hợp bộ lọc.'))}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.left}>Mã</th>
                <th className={styles.left}>Tên</th>
                <th className={styles.left}>Nhóm</th>
                <th className={styles.left}>Phân loại</th>
                <th className={styles.left}>Đơn vị</th>
                <th className={styles.left}>Sử dụng</th>
                <th className={styles.right}>Giá</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((item) => (
                <tr
                  key={item.id}
                  tabIndex={0}
                  style={{ cursor: 'pointer', opacity: item.isActive ? 1 : 0.55 }}
                  onClick={() => setSelectedCode(item.code)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setSelectedCode(item.code);
                  }}
                >
                  <td>{item.code}</td>
                  <td>{item.name}</td>
                  <td>{TRADE_GROUP_LABEL[tradeGroupOf(item)]}</td>
                  <td>{item.tradeCategory || '—'}</td>
                  <td>{item.unit}</td>
                  <td>{usageLabel(item.tradeMode) || '—'}</td>
                  <td className={styles.right}>{formatSalePrice(item.salePrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TablePager
        view={view}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onPageChange={setPage}
      />

      {selected ? (
        <TradeItemDrawer
          item={selected}
          warehouses={warehouses}
          stock={stock}
          canManage={canManage}
          busy={saving}
          onRetire={() =>
            void save(async () => {
              const result = await retireMaterial(selected.code);
              setSelectedCode(undefined);
              return `Đã ngừng dùng ${selected.code}. ${result.reason ?? ''}`.trim();
            })
          }
          onClose={() => setSelectedCode(undefined)}
          onEdit={() => setDialog({ kind: 'form', code: selected.code })}
        />
      ) : null}

      {dialog?.kind === 'form' ? (
        <TradeItemFormDialog
          item={editing}
          catalog={catalog}
          busy={saving}
          onCancel={() => setDialog(undefined)}
          onCreate={(input: CreateMaterialRequest) =>
            void save(async () => `Đã tạo ${(await createMaterial(input)).code}.`)
          }
          onUpdate={(code: string, patch: UpdateMaterialRequest) =>
            void save(async () => `Đã cập nhật ${(await updateMaterial(code, patch)).code}.`)
          }
        />
      ) : null}
      {dialog?.kind === 'import' ? (
        <TradeItemImportDialog catalog={catalog} onCancel={() => setDialog(undefined)} onImport={importRows} />
      ) : null}
    </section>
  );
}
