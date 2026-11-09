'use client';

import type { Material, Warehouse } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, Search, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatNumber } from '../inventory-labels';
import { PAGE_SIZES, fold, paginate } from '../trade-items.model';
import { DrawerField, DrawerSection, MaterialHistorySection, MaterialStockSection, type StockRow } from './material-drawer-sections';
import { TablePager } from './table-pager';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { DialogCloseButton } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';
import { Sheet, SheetBody, SheetContent, SheetHeader } from '../ui/sheet';

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
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-[1_1_480px] flex-wrap items-center gap-2">
          <div className="relative flex min-w-[180px] flex-[0_1_280px] items-center">
            <Search size={14} className="pointer-events-none absolute left-[0.65rem] text-slate-400" />
            <Input
              className="pl-8"
              value={search}
              placeholder="Tìm mã hoặc tên…"
              aria-label="Tìm trong kho"
              onChange={(event) => reset(() => setSearch(event.target.value))}
            />
          </div>
          <div className="w-[220px]">
            <SearchableSelect
              options={warehouseOptions}
              value={warehouseId}
              placeholder="Kho"
              onChange={(value) => reset(() => setWarehouseId(value || ''))}
              clearable
              height={36}
            />
          </div>
          <div className="w-[200px]">
            <SearchableSelect
              options={LEVEL_OPTIONS.map((option) => ({ ...option }))}
              value={level}
              placeholder="Mức tồn"
              onChange={(value) => reset(() => setLevel((value || '') as LevelFilter))}
              clearable
              height={36}
            />
          </div>
          <Label className="inline-flex items-center gap-1.5 font-normal text-slate-600">
            <input
              type="checkbox"
              className="accent-primary"
              checked={showEmpty}
              onChange={(event) => reset(() => setShowEmpty(event.target.checked))}
            />
            Hiện cả dòng hết hàng
          </Label>
        </div>
        <div className="flex items-center gap-2">
          {onOpenBulkImport ? (
            <Button type="button" variant="outline" className="whitespace-nowrap" onClick={onOpenBulkImport}>
              <Upload size={14} className="mr-1.5 -mt-px" />
              Nhập Excel
            </Button>
          ) : null}
          {onOpenStocktake ? (
            <Button
              type="button"
              variant="outline"
              className="whitespace-nowrap"
              onClick={() => onOpenStocktake(warehouseId ? { warehouseCode: warehouses.find((w) => w.id === warehouseId)?.code } : undefined)}
            >
              <ClipboardCheck size={14} className="mr-1.5 -mt-px" />
              Tạo đợt kiểm kê
            </Button>
          ) : null}
          {onOpenMovement ? (
            <>
              <Button type="button" variant="outline" className="whitespace-nowrap" onClick={() => onOpenMovement({ kind: 'issue' })}>
                <ArrowUpFromLine size={14} className="mr-1.5 -mt-px" />
                Xuất kho
              </Button>
              <Button type="button" className="whitespace-nowrap" onClick={() => onOpenMovement({ kind: 'receipt' })}>
                <ArrowDownToLine size={14} className="mr-1.5 -mt-px" />
                Nhập kho
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {view.total === 0 ? (
        <p className="m-0 py-8 text-center text-slate-500">
          {rows.length === 0 ? 'Chưa có tồn kho nào.' : 'Không có dòng tồn phù hợp bộ lọc.'}
        </p>
      ) : (
        <TableWrap className="rounded-xl border border-slate-200 bg-white">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Mã</TableHeaderCell>
                <TableHeaderCell>Tên</TableHeaderCell>
                <TableHeaderCell>Kho</TableHeaderCell>
                <TableHeaderCell>Đơn vị</TableHeaderCell>
                <TableHeaderCell className="text-right">Số lượng</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {view.rows.map(({ key, stock: line, material, warehouse }) => (
                <TableRow
                  key={key}
                  tabIndex={0}
                  className={cn('cursor-pointer', !material.isActive && 'opacity-55')}
                  onClick={() => setSelectedKey(key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setSelectedKey(key);
                  }}
                >
                  <TableCell>{material.code}</TableCell>
                  <TableCell>{material.name}</TableCell>
                  <TableCell>{warehouse?.name ?? '—'}</TableCell>
                  <TableCell>{material.unit}</TableCell>
                  <TableCell className="text-right">{formatNumber(line.quantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
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
        <Sheet onEscape={() => setSelectedKey(undefined)} onBackdropClick={() => setSelectedKey(undefined)}>
          <SheetContent aria-label={`Tồn ${selected.material.code}`}>
            <SheetHeader>
              <div className="flex min-w-0 flex-1 flex-col gap-[0.3rem]">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.04em] text-slate-500">{selected.warehouse?.name ?? 'Kho'}</span>
                <h2 className="m-0 text-xl font-bold leading-[1.3] text-slate-900">{selected.material.name}</h2>
                <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <code className="rounded bg-slate-100 px-[0.35rem] py-[0.1rem] font-mono font-bold text-slate-700">{selected.material.code}</code>
                  {!selected.material.isActive ? <span>Đã ngừng dùng</span> : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {onOpenMovement ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onOpenMovement({ kind: 'issue', materialCode: selected.material.code })}
                    >
                      Xuất kho
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onOpenMovement({ kind: 'receipt', materialCode: selected.material.code })}
                    >
                      Nhập kho
                    </Button>
                  </>
                ) : null}
                <DialogCloseButton onClick={() => setSelectedKey(undefined)} />
              </div>
            </SheetHeader>

            <SheetBody className="flex flex-col gap-4">
              <DrawerSection title="Thông tin tồn kho">
                <div className="grid grid-cols-2 gap-x-5 gap-y-3.5">
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
            </SheetBody>
          </SheetContent>
        </Sheet>
      ) : null}
    </section>
  );
}
