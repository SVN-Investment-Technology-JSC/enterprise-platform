'use client';

import type { Material, MaterialInventory, Warehouse } from '@enterprise-platform/contracts-inventory';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadMaterialHistory, type InventoryLedgerRow } from '../inventory-api';
import { TRANSACTION_TYPE_LABEL, formatDateTime, formatNumber } from '../inventory-labels';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';
import { useUserLabel } from '../user-names';

/** Dòng tồn của một mặt hàng; `materialCode` có khi dòng tồn đã được ghép mã ở màn Kho. */
export type StockRow = MaterialInventory & { warehouseCode?: string; materialCode?: string };

/** Một trường "nhãn nhỏ phía trên, giá trị bên dưới" của drawer chi tiết. */
export function DrawerField({
  label,
  hint,
  children,
}: {
  label: string;
  /** Lời giải thích hiện khi rê chuột vào nhãn. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs font-bold text-slate-500" title={hint}>
        {label}
      </span>
      <span className="text-sm text-slate-900 [overflow-wrap:anywhere]">{children || '—'}</span>
    </div>
  );
}

export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-[10px] border border-slate-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h3 className="m-0 mb-[0.85rem] border-b border-slate-100 pb-[0.6rem] text-sm font-bold text-slate-700">{title}</h3>
      {children}
    </section>
  );
}

/** Tồn của một mặt hàng theo từng kho, kèm tổng. Dịch vụ không quản lý tồn nên không có. */
export function MaterialStockSection({
  material,
  stock,
  warehouses,
}: {
  material: Pick<Material, 'id' | 'code' | 'unit' | 'kind'>;
  stock: readonly StockRow[];
  warehouses: readonly Warehouse[];
}) {
  const rows = useMemo(
    () => stock.filter((row) => row.materialId === material.id || row.materialCode === material.code),
    [stock, material.id, material.code],
  );
  const warehouseName = (id: string) => warehouses.find((warehouse) => warehouse.id === id)?.name ?? '—';

  if (material.kind === 'SERVICE') {
    return <p className="m-0 py-8 text-center text-slate-500">Dịch vụ không quản lý tồn kho.</p>;
  }
  if (rows.length === 0) return <p className="m-0 py-8 text-center text-slate-500">Chưa có tồn ở kho nào.</p>;

  const total = rows.reduce((sum, row) => sum + row.quantity, 0);
  const available = rows.reduce((sum, row) => sum + row.available, 0);

  return (
    <TableWrap>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Kho</TableHeaderCell>
            <TableHeaderCell className="text-right">Tồn thực tế</TableHeaderCell>
            <TableHeaderCell className="text-right">Đã giữ</TableHeaderCell>
            <TableHeaderCell className="text-right">Khả dụng</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{warehouseName(row.warehouseId)}</TableCell>
              <TableCell className="text-right">
                {formatNumber(row.quantity)} {material.unit}
              </TableCell>
              <TableCell className="text-right">{formatNumber(row.quantityReserved)}</TableCell>
              <TableCell className="text-right">{formatNumber(row.available)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell>
              <strong>Tổng</strong>
            </TableCell>
            <TableCell className="text-right">
              <strong>
                {formatNumber(total)} {material.unit}
              </strong>
            </TableCell>
            <TableCell className="text-right" />
            <TableCell className="text-right">
              <strong>{formatNumber(available)}</strong>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableWrap>
  );
}

/**
 * Lịch sử nhập, xuất, điều chuyển của một mã (100 dòng gần nhất).
 * Dịch vụ không có tồn nên không có lịch sử và không gọi API.
 */
export function MaterialHistorySection({
  material,
  warehouses,
  warehouseId,
}: {
  material: Pick<Material, 'code' | 'unit' | 'kind'>;
  warehouses: readonly Warehouse[];
  /** Chỉ hiện phát sinh của kho này; bỏ trống là mọi kho. */
  warehouseId?: string;
}) {
  const [history, setHistory] = useState<InventoryLedgerRow[] | 'loading' | 'error'>('loading');
  const userName = useUserLabel();
  const isService = material.kind === 'SERVICE';

  useEffect(() => {
    if (isService) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    setHistory('loading');
    loadMaterialHistory(material.code, 100)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setHistory('error');
      });
    return () => {
      cancelled = true;
    };
  }, [material.code, isService]);

  const warehouseName = (id: string) => warehouses.find((warehouse) => warehouse.id === id)?.name ?? '—';

  if (isService) {
    return <p className="m-0 py-8 text-center text-slate-500">Dịch vụ không quản lý tồn kho nên không có lịch sử xuất nhập.</p>;
  }
  if (history === 'loading') return <p className="m-0 py-8 text-center text-slate-500">Đang tải lịch sử…</p>;
  if (history === 'error') {
    return (
      <p className="m-0 py-8 text-center text-slate-500" role="alert">
        Không tải được lịch sử xuất nhập.
      </p>
    );
  }
  const rows = warehouseId ? history.filter((row) => row.warehouseId === warehouseId) : history;
  if (rows.length === 0) return <p className="m-0 py-8 text-center text-slate-500">Chưa có phát sinh nhập hoặc xuất.</p>;

  return (
    <TableWrap>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Thời gian</TableHeaderCell>
            <TableHeaderCell>Loại</TableHeaderCell>
            <TableHeaderCell className="text-right">Số lượng</TableHeaderCell>
            <TableHeaderCell>Kho</TableHeaderCell>
            <TableHeaderCell>Số phiếu</TableHeaderCell>
            <TableHeaderCell>Người thực hiện</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{formatDateTime(row.createdAt)}</TableCell>
              <TableCell>{TRANSACTION_TYPE_LABEL[row.type] ?? row.type}</TableCell>
              <TableCell className="text-right">
                {row.quantity > 0 ? '+' : ''}
                {formatNumber(row.quantity)} {material.unit}
              </TableCell>
              <TableCell>{warehouseName(row.warehouseId)}</TableCell>
              <TableCell>
                {/* Số phiếu là mã giao dịch hệ thống sinh; số hóa đơn nhập tay (nếu có) nằm dòng dưới. */}
                {row.transactionCode}
                {row.documentNumber ? <span className="mt-[0.2rem] block text-[0.8125rem] font-normal text-slate-500">Hóa đơn: {row.documentNumber}</span> : null}
              </TableCell>
              <TableCell title={row.createdBy}>{userName(row.createdBy)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableWrap>
  );
}
