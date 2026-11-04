'use client';

import type { Material, Warehouse } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, Search, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';
import { PAGE_SIZES, fold, paginate } from '../trade-items.model';
import { DrawerField, DrawerSection, MaterialHistorySection, MaterialStockSection, type StockRow } from './material-drawer-sections';
import { TablePager } from './table-pager';

type LevelFilter = '' | 'IN_STOCK' | 'LOW' | 'EMPTY';

const LEVEL_OPTIONS: readonly { value: Exclude<LevelFilter, ''>; label: string }[] = [
  { value: 'IN_STOCK', label: 'Còn hàng' },
  { value: 'LOW', label: 'Dưới mức tối thiểu' },
  { value: 'EMPTY', label: 'Hết hàng' },
];

/**
 * Giải thích bốn con số tồn (INV-07, mục 10 BRD). Không có cột "đang vận chuyển" ở MVP (quyết định Q2).
 */
const STOCK_HINT = {
  onHand: 'Tồn thực tế: số hàng đang nằm trong kho theo sổ, gồm cả phần đã giữ và hàng chưa Đạt.',
  reserved: 'Đã giữ: phần tồn đã giữ cho đơn bán hoặc lệnh công tác, chưa xuất kho.',
  blocked:
    'Chờ kiểm định/không đạt: hàng ở trạng thái Cách ly, Lỗi hoặc Chờ kiểm định; vẫn trong kho nhưng không được xuất.',
  available: 'Khả dụng = tồn thực tế − đã giữ − chờ kiểm định/không đạt; là số còn bán hoặc xuất được.',
} as const;

interface Row {
  readonly key: string;
  readonly stock: StockRow;
  readonly material: Material;
  readonly warehouse?: Warehouse;
}

/**
 * Tab Nhà kho của trang Kho hàng: tồn hiện có, mỗi dòng là một mặt hàng ở một kho.
 * Dịch vụ không có tồn nên không xuất hiện. Bấm một dòng mở drawer chi tiết (tồn theo kho, lịch sử xuất nhập).
 */
export function WarehouseStockTab({
  materials,
  warehouses,
  stock,
  onOpenMovement,
  onOpenStocktake,
  onOpenBulkImport,
}: {
  materials: readonly Material[];
  warehouses: readonly Warehouse[];
  stock: readonly StockRow[];
  /** Có quyền ghi giao dịch kho mới truyền; mở form nhập/xuất sẵn mã vật tư. */
  onOpenMovement?: (init: { kind: 'receipt' | 'issue'; materialCode?: string }) => void;
  onOpenStocktake?: (init?: { warehouseCode?: string }) => void;
  onOpenBulkImport?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [level, setLevel] = useState<LevelFilter>('');
  const [showEmpty, setShowEmpty] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [selectedKey, setSelectedKey] = useState<string>();

  const rows = useMemo<Row[]>(() => {
    const materialById = new Map(materials.map((material) => [material.id, material]));
    const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
    const result: Row[] = [];
    for (const row of stock) {
      const material = materialById.get(row.materialId);
      if (!material || material.kind === 'SERVICE') continue;
      result.push({ key: row.id, stock: row, material, warehouse: warehouseById.get(row.warehouseId) });
    }
    return result.sort(
      (a, b) =>
        a.material.code.localeCompare(b.material.code) ||
        (a.warehouse?.name ?? '').localeCompare(b.warehouse?.name ?? ''),
    );
  }, [materials, warehouses, stock]);

  /** Khả dụng gộp mọi kho của từng mã, để so với mức tồn tối thiểu của mã đó. */
  const availableByMaterial = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stock) map.set(row.materialId, (map.get(row.materialId) ?? 0) + row.available);
    return map;
  }, [stock]);

  const filtered = useMemo(() => {
    const term = fold(search.trim());
    return rows.filter(({ stock: line, material }) => {
      if (warehouseId && line.warehouseId !== warehouseId) return false;
      const empty = line.quantity <= 0;
      // Chọn mức tồn cụ thể thì mức đó quyết định; không chọn thì ẩn dòng hết hàng trừ khi bật ô "Hiện cả".
      if (level === 'EMPTY') {
        if (!empty) return false;
      } else if (level === 'IN_STOCK') {
        if (empty) return false;
      } else if (level === 'LOW') {
        const available = availableByMaterial.get(material.id) ?? 0;
        if (material.minStock <= 0 || available >= material.minStock) return false;
      } else if (empty && !showEmpty) {
        return false;
      }
      if (!term) return true;
      return [material.code, material.name].some((value) => fold(value).includes(term));
    });
  }, [rows, search, warehouseId, level, showEmpty, availableByMaterial]);

  const view = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize]);
  const selected = rows.find((row) => row.key === selectedKey);

  const warehouseOptions = warehouses.map((warehouse) => ({
    value: warehouse.id,
    label: warehouse.name ? `${warehouse.name} (${warehouse.code})` : warehouse.code,
  }));

  const reset = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', flex: '1 1 480px' }}>
          <div className={styles.tableSearchBox} style={{ flex: '0 1 280px' }}>
            <Search size={14} className={styles.tableSearchIcon} style={{ position: 'absolute', left: '0.65rem' }} />
            <input
              value={search}
              placeholder="Tìm mã hoặc tên…"
              aria-label="Tìm trong kho"
              onChange={(event) => reset(() => setSearch(event.target.value))}
            />
          </div>
          <div style={{ width: '220px' }}>
            <SearchableSelect
              options={warehouseOptions}
              value={warehouseId}
              placeholder="Kho"
              onChange={(value) => reset(() => setWarehouseId(value || ''))}
              clearable
              height={34}
            />
          </div>
          <div style={{ width: '200px' }}>
            <SearchableSelect
              options={LEVEL_OPTIONS.map((option) => ({ ...option }))}
              value={level}
              placeholder="Mức tồn"
              onChange={(value) => reset(() => setLevel((value || '') as LevelFilter))}
              clearable
              height={34}
            />
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#475569' }}>
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(event) => reset(() => setShowEmpty(event.target.checked))}
            />
            Hiện cả dòng hết hàng
          </label>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {onOpenBulkImport ? (
            <button type="button" className={styles.btnSecondary} style={{ whiteSpace: 'nowrap' }} onClick={onOpenBulkImport}>
              <Upload size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
              Nhập Excel
            </button>
          ) : null}
          {onOpenStocktake ? (
            <button
              type="button"
              className={styles.btnSecondary}
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => onOpenStocktake(warehouseId ? { warehouseCode: warehouses.find((w) => w.id === warehouseId)?.code } : undefined)}
            >
              <ClipboardCheck size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
              Tạo đợt kiểm kê
            </button>
          ) : null}
          {onOpenMovement ? (
            <>
              <button type="button" className={styles.btnSecondary} style={{ whiteSpace: 'nowrap' }} onClick={() => onOpenMovement({ kind: 'issue' })}>
                <ArrowUpFromLine size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
                Xuất kho
              </button>
              <button type="button" className={styles.btnPrimary} style={{ whiteSpace: 'nowrap' }} onClick={() => onOpenMovement({ kind: 'receipt' })}>
                <ArrowDownToLine size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
                Nhập kho
              </button>
            </>
          ) : null}
        </div>
      </div>

      {view.total === 0 ? (
        <p className={styles.empty}>
          {rows.length === 0 ? 'Chưa có tồn kho nào.' : 'Không có dòng tồn phù hợp bộ lọc.'}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.left}>Mã</th>
                <th className={styles.left}>Tên</th>
                <th className={styles.left}>Kho</th>
                <th className={styles.left}>Đơn vị</th>
                <th className={styles.right}>Số lượng</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map(({ key, stock: line, material, warehouse }) => (
                <tr
                  key={key}
                  tabIndex={0}
                  style={{ cursor: 'pointer', opacity: material.isActive ? 1 : 0.55 }}
                  onClick={() => setSelectedKey(key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setSelectedKey(key);
                  }}
                >
                  <td>{material.code}</td>
                  <td>{material.name}</td>
                  <td>{warehouse?.name ?? '—'}</td>
                  <td>{material.unit}</td>
                  <td className={styles.right}>{formatNumber(line.quantity)}</td>
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
        <>
          <div className={styles.drawerBackdrop} onClick={() => setSelectedKey(undefined)} />
          <aside
            className={styles.drawerPanel}
            role="dialog"
            aria-modal="true"
            aria-label={`Tồn ${selected.material.code}`}
          >
            <div className={styles.drawerHead}>
              <div className={styles.drawerHeadInfo}>
                <span className={styles.drawerEyebrow}>{selected.warehouse?.name ?? 'Kho'}</span>
                <h2 className={styles.drawerTitle}>{selected.material.name}</h2>
                <p className={styles.drawerSubtitle}>
                  <code>{selected.material.code}</code>
                  {!selected.material.isActive ? <span>Đã ngừng dùng</span> : null}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {onOpenMovement ? (
                  <>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      onClick={() => onOpenMovement({ kind: 'issue', materialCode: selected.material.code })}
                    >
                      Xuất kho
                    </button>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      onClick={() => onOpenMovement({ kind: 'receipt', materialCode: selected.material.code })}
                    >
                      Nhập kho
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className={styles.drawerCloseBtn}
                  onClick={() => setSelectedKey(undefined)}
                  aria-label="Đóng"
                  title="Đóng"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.6rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <DrawerSection title="Thông tin tồn kho">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px 20px' }}>
                  <DrawerField label="Mã">{selected.material.code}</DrawerField>
                  <DrawerField label="Tên">{selected.material.name}</DrawerField>
                  <DrawerField label="Kho">{selected.warehouse?.name}</DrawerField>
                  <DrawerField label="Đơn vị">{selected.material.unit}</DrawerField>
                  <DrawerField label="Tồn thực tế" hint={STOCK_HINT.onHand}>
                    {formatNumber(selected.stock.quantity)}
                  </DrawerField>
                  <DrawerField label="Đã giữ" hint={STOCK_HINT.reserved}>
                    {formatNumber(selected.stock.quantityReserved)}
                  </DrawerField>
                  <DrawerField label="Chờ kiểm định/không đạt" hint={STOCK_HINT.blocked}>
                    {formatNumber(selected.stock.quantityBlocked ?? 0)}
                  </DrawerField>
                  <DrawerField label="Khả dụng" hint={STOCK_HINT.available}>
                    {formatNumber(selected.stock.available)}
                  </DrawerField>
                  <DrawerField label="Tồn tối thiểu">{selected.material.minStock > 0 ? formatNumber(selected.material.minStock) : ''}</DrawerField>
                  <DrawerField label="Tồn tối đa">{selected.material.maxStock > 0 ? formatNumber(selected.material.maxStock) : ''}</DrawerField>
                </div>
              </DrawerSection>

              <DrawerSection title="Lịch sử xuất nhập tại kho này">
                <MaterialHistorySection
                  material={selected.material}
                  warehouses={warehouses}
                  warehouseId={selected.stock.warehouseId}
                />
              </DrawerSection>

              <DrawerSection title="Tồn theo kho">
                <MaterialStockSection material={selected.material} stock={stock} warehouses={warehouses} />
              </DrawerSection>
            </div>
          </aside>
        </>
      ) : null}
    </section>
  );
}
