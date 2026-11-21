'use client';

import type { Material, SerialStockState, SerialTracking, Warehouse } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteSerial, loadAllSerials } from '../inventory-api';
import { QUALITY_STATUS_LABEL, SERIAL_STOCK_STATE_LABEL } from '../inventory-labels';
import { useInventoryPermissions } from '../inventory-permissions';
import { PAGE_SIZES, fold, paginate } from '../trade-items.model';
import { SerialDeclareDialog } from './serial-declare-dialog';
import { SerialLifecycleDrawer } from './serial-lifecycle-drawer';
import { TablePager } from './table-pager';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';

const NOT_IN_LEDGER = 'NONE';

/**
 * Quản lý serial toàn kho: tìm theo số serial, mã hay tên vật tư, lọc theo vị trí sổ kho; khai báo serial
 * mới. Bấm một dòng mở drawer: xem vòng đời, và sửa số hoặc xoá khi serial chưa phát sinh.
 */
export function SerialHub({
  materials,
  warehouses,
  statuses,
  usageStates,
}: {
  materials: readonly Material[];
  warehouses: readonly Warehouse[];
  statuses: readonly string[];
  usageStates: readonly string[];
}) {
  const { canManage } = useInventoryPermissions();
  const [rows, setRows] = useState<SerialTracking[]>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [materialFilter, setMaterialFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [declaring, setDeclaring] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setRows(await loadAllSerials());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đọc được danh sách serial.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const materialByCode = useMemo(() => new Map(materials.map((m) => [m.code, m])), [materials]);
  const warehouseCodeById = useMemo(() => new Map(warehouses.map((w) => [w.id, w.code])), [warehouses]);

  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    return (rows ?? []).filter((row) => {
      if (materialFilter && row.materialCode !== materialFilter) return false;
      if (stateFilter === NOT_IN_LEDGER ? row.stockState : stateFilter && row.stockState !== stateFilter) return false;
      if (!needle) return true;
      const name = materialByCode.get(row.materialCode ?? '')?.name ?? '';
      return [row.serialNumber, row.materialCode ?? '', name].some((value) => fold(value).includes(needle));
    });
  }, [rows, query, materialFilter, stateFilter, materialByCode]);

  const view = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize]);
  const selected = rows?.find((row) => row.id === selectedId);

  const materialOptions = useMemo(() => {
    const codes = [...new Set((rows ?? []).map((row) => row.materialCode).filter(Boolean) as string[])].sort();
    return codes.map((code) => ({ value: code, label: `${code} · ${materialByCode.get(code)?.name ?? ''}` }));
  }, [rows, materialByCode]);

  const reset = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const remove = async (row: SerialTracking) => {
    try {
      await deleteSerial(row.materialCode as string, row.serialNumber);
      toast.success(`Đã xoá serial ${row.serialNumber}.`);
      setSelectedId(undefined);
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Không xoá được serial.');
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-[1_1_480px] flex-wrap items-center gap-2">
          <div className="relative flex min-w-[180px] flex-[0_1_280px] items-center">
            <Search size={14} className="pointer-events-none absolute left-[0.65rem] text-slate-400" />
            <Input
              className="pl-8"
              value={query}
              placeholder="Tìm serial, mã hoặc tên vật tư…"
              aria-label="Tìm serial"
              onChange={(event) => reset(() => setQuery(event.target.value))}
            />
          </div>
          <div className="w-[240px]">
            <SearchableSelect
              options={materialOptions}
              value={materialFilter}
              placeholder="Vật tư"
              onChange={(value) => reset(() => setMaterialFilter(value ?? ''))}
              clearable
              height={36}
            />
          </div>
          <div className="w-[200px]">
            <SearchableSelect
              options={[
                ...(Object.keys(SERIAL_STOCK_STATE_LABEL) as SerialStockState[]).map((s) => ({
                  value: s,
                  label: SERIAL_STOCK_STATE_LABEL[s],
                })),
                { value: NOT_IN_LEDGER, label: 'Chưa vào kho' },
              ]}
              value={stateFilter}
              placeholder="Theo sổ kho"
              onChange={(value) => reset(() => setStateFilter(value ?? ''))}
              clearable
              height={36}
            />
          </div>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            <Button type="button" className="whitespace-nowrap" onClick={() => setDeclaring(true)}>
              <Plus size={14} className="mr-1.5 -mt-px" />
              Khai báo serial
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!rows && !error ? <p className="m-0 text-slate-500">Đang tải…</p> : null}

      {rows ? (
        view.total === 0 ? (
          <p className="m-0 py-8 text-center text-slate-500">
            {rows.length === 0
              ? 'Chưa có serial nào. Bấm "Khai báo serial" hoặc nhập kho kèm serial.'
              : 'Không có serial khớp bộ lọc.'}
          </p>
        ) : (
          <TableWrap className="rounded-xl border border-slate-200 bg-white">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Số serial</TableHeaderCell>
                  <TableHeaderCell>Mã vật tư</TableHeaderCell>
                  <TableHeaderCell>Tên vật tư</TableHeaderCell>
                  <TableHeaderCell>Theo sổ kho</TableHeaderCell>
                  <TableHeaderCell>Chất lượng</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {view.rows.map((row) => (
                  <TableRow
                    key={row.id}
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') setSelectedId(row.id);
                    }}
                  >
                    <TableCell className="font-mono font-bold tracking-[0.03em] text-slate-800">{row.serialNumber}</TableCell>
                    <TableCell>{row.materialCode}</TableCell>
                    <TableCell>{materialByCode.get(row.materialCode ?? '')?.name}</TableCell>
                    <TableCell>
                      {row.stockState ? SERIAL_STOCK_STATE_LABEL[row.stockState] : 'Chưa vào kho'}
                      {row.currentWarehouseId ? ` · ${warehouseCodeById.get(row.currentWarehouseId) ?? ''}` : ''}
                    </TableCell>
                    <TableCell>{QUALITY_STATUS_LABEL[row.qualityStatus ?? 'PASSED']}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )
      ) : null}

      {rows ? (
        <TablePager
          view={view}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          onPageChange={setPage}
        />
      ) : null}

      {declaring ? (
        <SerialDeclareDialog
          materials={materials}
          statuses={statuses}
          usageStates={usageStates}
          initialMaterialCode={materialFilter || undefined}
          onCancel={() => setDeclaring(false)}
          onDone={({ added, requested }) => {
            setDeclaring(false);
            if (added < requested) toast.warning(`Đã thêm ${added}/${requested}: số còn lại đã có sẵn.`);
            else toast.success(`Đã khai ${added} serial.`);
            void reload();
          }}
        />
      ) : null}
      {selected ? (
        <SerialLifecycleDrawer
          serialNumber={selected.serialNumber}
          materialCode={selected.materialCode as string}
          materialName={materialByCode.get(selected.materialCode ?? '')?.name}
          serial={selected}
          canManage={canManage}
          warehouseCodeById={warehouseCodeById}
          onClose={() => setSelectedId(undefined)}
          onChanged={() => void reload()}
          onDelete={(row) => void remove(row)}
        />
      ) : null}
    </section>
  );
}
