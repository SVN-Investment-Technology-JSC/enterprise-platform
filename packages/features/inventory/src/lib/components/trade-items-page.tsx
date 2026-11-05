'use client';

import type {
  CreateMaterialRequest,
  ImportConflictPolicy,
  ImportFailure,
  ImportMaterialRow,
  InventoryTradeCatalog,
  Material,
  UpdateMaterialRequest,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { Download, Plus, Search, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createMaterial,
  deleteMaterial,
  importMaterials,
  loadInventorySettings,
  loadTradeItems,
  saveInventorySetting,
  reactivateMaterial,
  retireMaterial,
  updateMaterial,
} from '../inventory-api';
import styles from '../inventory.module.scss';
import {
  EMPTY_FILTER,
  TRADE_STATUS_LABEL,
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
  type TradeFilter,
  type TradeGroup,
  type TradeStatus,
} from '../trade-items.model';
import type { StockRow } from './material-drawer-sections';
import { TablePager } from './table-pager';
import { TradeItemDrawer } from './trade-item-drawer';
import { TradeItemFormDialog } from './trade-item-form-dialog';
import { TradeStatusBadge } from './trade-status-badge';
import { TradeItemImportDialog } from './trade-item-import-dialog';
import type { CatalogAdditions } from '../trade-import.model';

/** Số dòng mỗi yêu cầu nhập Excel; 50 dòng dài nhất cũng còn xa mức 100 KB. */
const IMPORT_BATCH_SIZE = 50;

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
  units,
  onChanged,
  onCatalogChanged,
}: {
  canManage: boolean;
  warehouses: readonly Warehouse[];
  /** Tồn theo kho của mọi mặt hàng, để drawer hiện nhóm Tồn kho. */
  stock?: readonly StockRow[];
  /** Danh mục phân loại và sử dụng; chưa nạp xong thì các ô chọn tạm rỗng. */
  catalog?: InventoryTradeCatalog;
  /** Danh mục đơn vị tính khai ở Cài đặt, làm lựa chọn cho ô Đơn vị của form. */
  units?: readonly string[];
  /** Gọi sau khi tạo, sửa hoặc nhập xong, để tab Nhà kho nạp lại danh mục. */
  onChanged?: () => void;
  /** Gọi sau khi nhập Excel thêm mục vào danh mục Cài đặt, để màn hình tải lại danh mục. */
  onCatalogChanged?: () => void;
}) {
  const [items, setItems] = useState<readonly Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [filter, setFilter] = useState<TradeFilter>(EMPTY_FILTER);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [selectedCode, setSelectedCode] = useState<string>();
  const [dialog, setDialog] = useState<{ kind: 'form' } | { kind: 'import' }>();
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

  const change = (patch: Partial<TradeFilter>) => {
    setFilter((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const statusOptions = (Object.keys(TRADE_STATUS_LABEL) as TradeStatus[]).map((value) => ({
    value,
    label: TRADE_STATUS_LABEL[value],
  }));

  const groupOptions = (Object.keys(TRADE_GROUP_LABEL) as TradeGroup[]).map((value) => ({
    value,
    label: TRADE_GROUP_LABEL[value],
  }));

  /**
   * Ghi một thay đổi rồi nạp lại danh sách. Thất bại thì ném lại để form hoặc drawer đang mở
   * hiện lý do ngay trong khung của nó (thông báo ở đầu trang bị lớp phủ che mất).
   */
  const save = async (work: () => Promise<string | { title: string; description?: string }>) => {
    setSaving(true);
    try {
      const text = await work();
      await reload();
      onChanged?.();
      // Kết quả hiện bằng toast tự ẩn (như HRM), không để dải thông báo nằm lại trên trang.
      toast.success(text);
      setDialog(undefined);
    } finally {
      setSaving(false);
    }
  };

  /** Thêm vào Cài đặt các phân loại, cách sử dụng mới của tệp; đọc bản mới nhất để không ghi đè người khác vừa sửa. */
  const addToCatalog = async (additions: CatalogAdditions) => {
    if (additions.goodsCategories.length + additions.serviceCategories.length + additions.usageModes.length === 0) {
      return;
    }
    const settings = await loadInventorySettings();
    const entry = settings['catalog.trade'];
    const merge = (current: readonly string[], added: readonly string[]) => [
      ...current,
      ...added.filter((value) => !current.includes(value)),
    ];
    await saveInventorySetting(
      'catalog.trade',
      {
        ...entry.value,
        goodsCategories: merge(entry.value.goodsCategories, additions.goodsCategories),
        serviceCategories: merge(entry.value.serviceCategories, additions.serviceCategories),
        usageModes: merge(entry.value.usageModes, additions.usageModes),
      },
      entry.version,
    );
    onCatalogChanged?.();
  };

  const importRows = async (rows: ImportMaterialRow[], additions: CatalogAdditions, onConflict: ImportConflictPolicy) => {
    const failures: ImportFailure[] = [];
    const skipped: { line: number; message: string }[] = [];
    let created = 0;
    let updated = 0;
    try {
      await addToCatalog(additions);
    } catch (error) {
      // Không thêm được danh mục thì không nhập: dòng sẽ mang phân loại chưa khai báo.
      return {
        created,
        updated,
        skipped,
        failures: [{ line: 0, message: errorMessage(error, 'Không cập nhật được danh mục trong Cài đặt.') }],
      };
    }
    // Chia lô nhỏ: thân yêu cầu mặc định của máy chủ chỉ 100 KB, mà một dòng có thể dài vài trăm byte (tên, mô tả).
    for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
      const batch = rows.slice(start, start + IMPORT_BATCH_SIZE);
      try {
        const outcome = await importMaterials({ rows: batch, onConflict });
        created += outcome.created;
        updated += outcome.updated;
        skipped.push(...outcome.skipped);
        failures.push(...outcome.failures);
      } catch (error) {
        const message = errorMessage(error, 'Không nhập được lô này.');
        failures.push(...batch.map((row) => ({ line: row.line, message })));
      }
    }
    await reload();
    if (created + updated > 0) onChanged?.();
    return { created, updated, skipped, failures };
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
          <div style={{ width: '170px' }}>
            <SearchableSelect
              options={statusOptions}
              value={filter.status}
              placeholder="Trạng thái"
              onChange={(value) => change({ status: (value || 'ACTIVE') as TradeStatus })}
              clearable={false}
              height={34}
            />
          </div>
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
                <th className={styles.left}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((item) => (
                <tr
                  key={item.id}
                  tabIndex={0}
                  style={{
                    cursor: 'pointer',
                    ...(item.isActive ? {} : { background: '#f1f5f9', color: '#64748b' }),
                  }}
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
                  <td>
                    <TradeStatusBadge active={item.isActive} />
                  </td>
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
          key={selected.code}
          item={selected}
          warehouses={warehouses}
          stock={stock}
          canManage={canManage}
          busy={saving}
          onRetire={() =>
            save(async () => {
              const result = await retireMaterial(selected.code);
              setSelectedCode(undefined);
              // Lý do của Kho mở đầu bằng "Đã ngừng dùng." nên bỏ câu đó khỏi phần mô tả để tiêu đề không lặp lại.
              const reason = (result.reason ?? '').replace(/^Đã ngừng dùng[.,]?\s*/, '').trim();
              return { title: `Đã ngừng dùng ${selected.code}`, ...(reason ? { description: reason } : {}) };
            })
          }
          onReactivate={() =>
            save(async () => {
              await reactivateMaterial(selected.code);
              // Đang xem danh sách "Ngừng dùng" thì mã vừa dùng lại không còn trong danh sách: đóng drawer.
              if (filter.status === 'INACTIVE') setSelectedCode(undefined);
              return `Đã dùng lại ${selected.code}`;
            })
          }
          onDelete={() =>
            save(async () => {
              await deleteMaterial(selected.code);
              setSelectedCode(undefined);
              return `Đã xóa ${selected.code}`;
            })
          }
          onClose={() => setSelectedCode(undefined)}
          catalog={catalog}
          units={units}
          onSave={(patch: UpdateMaterialRequest) =>
            save(async () => `Đã cập nhật ${(await updateMaterial(selected.code, patch)).code}.`)
          }
        />
      ) : null}

      {dialog?.kind === 'form' ? (
        <TradeItemFormDialog
          catalog={catalog}
          units={units}
          busy={saving}
          onCancel={() => setDialog(undefined)}
          onCreate={(input: CreateMaterialRequest) =>
            save(async () => `Đã tạo ${(await createMaterial(input)).code}.`)
          }
        />
      ) : null}
      {dialog?.kind === 'import' ? (
        <TradeItemImportDialog catalog={catalog} existingCodes={items.map((item) => item.code)} onCancel={() => setDialog(undefined)} onImport={importRows} />
      ) : null}
    </section>
  );
}
