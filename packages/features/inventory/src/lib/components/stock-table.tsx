'use client';

import type { Material } from '@enterprise-platform/contracts-inventory';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  InventoryLedgerRow,
  InventoryReservationRow,
  InventoryWorkspace,
} from '../inventory-api';
import {
  RESERVATION_STATUS_LABEL,
  WAREHOUSE_TYPE_LABEL,
  formatDateTime,
  formatMaterialPrice,
  formatNumber,
} from '../inventory-labels';
import { loadMaterialHistory } from '../inventory-api';
import { exportStockToExcel } from '../inventory-export';
import { MaterialHistory } from './material-history';
import { SerialPanel } from './serial-panel';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { Ban, Download } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';

const PAGE_SIZE_OPTIONS = [15, 30, 45, 60, 100].map((value) => ({ value: String(value), label: `${value} / trang` }));
const CHIP_CLASS = 'cursor-pointer rounded-full border px-3 py-[0.3rem] text-[0.8125rem]';
const CHIP_ON_CLASS = 'border-primary bg-primary text-primary-foreground';
const CHIP_OFF_CLASS = 'border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-slate-900';
const SUB_CLASS = 'mt-[0.2rem] block text-[0.8125rem] font-normal text-slate-500';

/**
 * Tab Tồn kho gộp ba tab cũ: Tồn kho, Vật tư và Kho & vị trí. Một dòng tồn vốn đã
 * là một vật tư ở một kho, nên danh mục vật tư mở ra khi bấm vào dòng, còn danh
 * sách kho trở thành hàng chip lọc thay vì một tab riêng.
 */
export function StockTable({
  workspace,
  reservations,
  materialByCode,
  busy,
  onEditMaterial,
  onRetireMaterial,
  initialQuery,
  onTransfer,
  statuses = [],
  usageStates = [],
}: {
  workspace: InventoryWorkspace;
  reservations?: readonly InventoryReservationRow[];
  materialByCode: ReadonlyMap<string, Material>;
  busy?: boolean;
  onEditMaterial?: (material: Material) => void;
  onRetireMaterial?: (material: Material) => void;
  /** Mã cần tìm sẵn khi nhảy sang từ danh mục hợp nhất. */
  initialQuery?: string;
  /** Tình trạng và vị trí sử dụng được phép chọn, theo cấu hình admin. */
  statuses?: readonly string[];
  usageStates?: readonly string[];
  /** Mở quy trình chuyển kho cho một dòng tồn. */
  onTransfer?: (input: {
    materialCode: string;
    materialName: string;
    fromWarehouseCode: string;
  }) => void;
}) {
  const [warehouseCode, setWarehouseCode] = useState('all');
  const [query, setQuery] = useState(initialQuery ?? '');

  /**
   * Đồng bộ khi bên ngoài đổi mã cần tìm.
   *
   * Chỉ chạy khi `initialQuery` đổi, không chạy mỗi lần gõ: nếu phụ thuộc cả
   * `query` thì mọi ký tự người dùng gõ sẽ bị ghi đè lại ngay.
   */
  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
  }, [initialQuery]);
  const [openRowId, setOpenRowId] = useState<string>();

  /**
   * Lịch sử nhập/xuất của mã đang mở, tải theo yêu cầu.
   *
   * Không nạp sẵn cho mọi dòng: bảng tồn có thể hàng trăm dòng, mỗi dòng một
   * lượt gọi sổ cái là đủ làm treo màn hình. Cache theo mã để đóng rồi mở lại
   * không gọi thêm lần nữa.
   */
  const [history, setHistory] = useState<Record<string, InventoryLedgerRow[] | 'loading' | 'error'>>({});

  /** Sổ cái lưu `warehouseId`; bảng cần mã kho để đọc được. */
  const warehouseCodeById = useMemo(
    () => new Map((workspace.warehouses ?? []).map((item) => [item.id, item.code])),
    [workspace.warehouses],
  );

  const openHistory = (materialCode: string | undefined) => {
    if (!materialCode || history[materialCode]) return;
    setHistory((current) => ({ ...current, [materialCode]: 'loading' }));
    loadMaterialHistory(materialCode)
      .then((rows) => setHistory((current) => ({ ...current, [materialCode]: rows })))
      .catch(() => setHistory((current) => ({ ...current, [materialCode]: 'error' })));
  };

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspace.stock.filter((row) => {
      if (warehouseCode !== 'all' && row.warehouseCode !== warehouseCode) return false;
      if (!needle) return true;
      const material = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
      return (
        (row.materialCode ?? '').toLowerCase().includes(needle) ||
        (material?.name ?? '').toLowerCase().includes(needle)
      );
    });
  }, [workspace.stock, warehouseCode, query, materialByCode]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const pagedRows = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safeCurrentPage, pageSize]);

  /** Phiếu giữ chỗ đang chiếm số lượng của một dòng tồn, để giải thích cột "Đã giữ". */
  const holdersOf = (materialId: string, warehouseId: string) =>
    (reservations ?? []).filter((reservation) =>
      (reservation.items ?? []).some(
        (item) => item.materialId === materialId && item.warehouseId === warehouseId,
      ),
    );

  const handleExport = () => {
    exportStockToExcel({
      rows,
      materialByCode,
      warehouseLabel: warehouseCode === 'all' ? 'Tat_Ca_Kho' : warehouseCode,
    });
  };

  return (
    <Card className="gap-0">
      <CardHeader className="mb-4 flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="m-0 text-base font-bold tracking-[-0.02em] text-slate-900">Tồn kho theo vật tư</CardTitle>
        <div className="flex items-center gap-2">
          <Input
            className="min-w-56 w-auto"
            placeholder="Tìm mã hoặc tên vật tư…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="gap-1.5"
            onClick={handleExport}
            title="Xuất danh sách tồn kho ra tệp Excel"
          >
            <Download size={15} />
            <span>Xuất Excel</span>
          </Button>
        </div>
      </CardHeader>

      <div className="mb-[0.35rem] mt-[0.85rem] flex flex-wrap gap-[0.35rem]">
        <button
          type="button"
          className={cn(CHIP_CLASS, warehouseCode === 'all' ? CHIP_ON_CLASS : CHIP_OFF_CLASS)}
          onClick={() => setWarehouseCode('all')}
        >
          Tất cả kho
        </button>
        {workspace.warehouses.map((warehouse) => (
          <button
            key={warehouse.id}
            type="button"
            title={`${warehouse.name} · ${WAREHOUSE_TYPE_LABEL[warehouse.type]}`}
            className={cn(CHIP_CLASS, warehouseCode === warehouse.code ? CHIP_ON_CLASS : CHIP_OFF_CLASS)}
            onClick={() => setWarehouseCode(warehouse.code)}
          >
            {warehouse.code}
          </button>
        ))}
      </div>

      <TableWrap className="rounded-[0.85rem] border border-slate-200 bg-white">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Vật tư</TableHeaderCell>
              <TableHeaderCell>Kho</TableHeaderCell>
              <TableHeaderCell className="text-center">Tồn thực</TableHeaderCell>
              <TableHeaderCell className="text-center">Đã giữ</TableHeaderCell>
              <TableHeaderCell className="text-center">Khả dụng</TableHeaderCell>
              <TableHeaderCell className="text-center">Đơn giá</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {pagedRows.map((row) => {
              const material = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
              const low = material ? row.available < material.minStock : false;
              const open = openRowId === row.id;
              const holders = open ? holdersOf(row.materialId, row.warehouseId) : [];
              return (
                <Fragment key={row.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => {
                      setOpenRowId(open ? undefined : row.id);
                      if (!open) openHistory(row.materialCode ?? undefined);
                    }}
                  >
                    <TableCell className="font-bold text-slate-900">
                      <div className="flex items-center gap-[6px]">
                        <span>{row.materialCode ?? '—'}</span>
                        {material && material.isActive === false ? (
                          <Badge variant="outline" className="h-auto rounded px-[5px] py-px text-[12px] font-medium text-slate-500">
                            Ngừng dùng
                          </Badge>
                        ) : null}
                      </div>
                      {material ? <span className={SUB_CLASS}>{material.name}</span> : null}
                    </TableCell>
                    <TableCell>{row.warehouseCode ?? '—'}</TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatNumber(row.quantity)} {material?.unit ?? ''}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatNumber(row.quantityReserved)}
                    </TableCell>
                    <TableCell className={cn('text-center tabular-nums', low && 'font-bold text-red-700')}>
                      {formatNumber(row.available)}
                      {low && material ? (
                        <span className={SUB_CLASS}>dưới mức tối thiểu {formatNumber(material.minStock)}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatMaterialPrice(material?.purchasePrice, material?.currency)}
                    </TableCell>
                  </TableRow>
                  {open ? (
                    <tr>
                      <TableCell colSpan={6} className="bg-slate-50">
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-4 rounded-[0.65rem] border border-slate-200 bg-white px-4 py-3 [&_span]:block [&_span]:text-xs [&_span]:font-bold [&_span]:uppercase [&_span]:tracking-[0.04em] [&_span]:text-slate-500 [&_strong]:mt-1 [&_strong]:block [&_strong]:text-sm [&_strong]:text-slate-900">
                          <div>
                            <span>Phân loại</span>
                            <strong>{material?.tradeCategory || '—'}</strong>
                          </div>
                          <div>
                            <span>Đơn vị tính</span>
                            <strong>{material?.unit ?? '—'}</strong>
                          </div>
                          <div>
                            <span>Tồn tối thiểu</span>
                            {/* Trần tồn đã bỏ: không luật nào của kho dựa vào nó,
                                nên nó chỉ là một con số phải nhập rồi không ai
                                đọc. Sàn thì có việc thật — nó bật cảnh báo. */}
                            <strong className={low ? 'text-red-700' : undefined}>
                              {material ? formatNumber(material.minStock) : '—'}
                            </strong>
                          </div>
                          <div>
                            <span>Cập nhật</span>
                            <strong>{formatDateTime(row.updatedAt)}</strong>
                          </div>
                        </div>

                        {material ? (
                          <SerialPanel
                            material={material}
                            statuses={statuses}
                            usageStates={usageStates}
                            busy={busy}
                          />
                        ) : null}

                        {row.materialCode ? (
                          <MaterialHistory
                            state={history[row.materialCode]}
                            unit={material?.unit}
                            warehouseCodeById={warehouseCodeById}
                          />
                        ) : null}

                        {material && (onEditMaterial || onRetireMaterial) ? (
                          <div className="flex items-center gap-[0.9rem] border-t border-slate-100 pt-[0.4rem]">
                            {onEditMaterial ? (
                              <Button
                                type="button"
                                variant="link"
                                size="xs"
                                className="h-auto p-0 font-bold"
                                onClick={() => onEditMaterial(material)}
                              >
                                Sửa vật tư
                              </Button>
                            ) : null}
                            {onTransfer && row.materialCode && row.warehouseCode ? (
                              <Button
                                type="button"
                                variant="link"
                                size="xs"
                                className="h-auto p-0 font-bold"
                                title="Mở quy trình chuyển kho bên module Quy trình. Kho chỉ chuyển bạn sang đó kèm sẵn nội dung — số lượng chỉ đổi khi thủ kho thao tác."
                                onClick={() =>
                                  onTransfer({
                                    materialCode: row.materialCode as string,
                                    materialName: material.name,
                                    fromWarehouseCode: row.warehouseCode as string,
                                  })
                                }
                              >
                                Chuyển kho
                              </Button>
                            ) : null}
                            {onRetireMaterial && material.isActive !== false ? (
                              <Popconfirm
                                title="Ngừng sử dụng vật tư?"
                                description={`Vật tư "${material.name}" (${material.code}) sẽ chuyển sang trạng thái ngừng dùng. Lịch sử kho vẫn được bảo lưu.`}
                                okText="Ngừng dùng"
                                cancelText="Huỷ"
                                okType="danger"
                                placement="top-end"
                                disabled={busy}
                                onConfirm={() => onRetireMaterial(material)}
                              >
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  className="gap-[0.35rem]"
                                  disabled={busy}
                                  title="Ngừng sử dụng mã vật tư này"
                                >
                                  <Ban size={12} />
                                  <span>Ngừng dùng</span>
                                </Button>
                              </Popconfirm>
                            ) : null}
                          </div>
                        ) : null}

                        {row.quantityReserved > 0 ? (
                          holders.length > 0 ? (
                            <ul className="mx-0 mb-1 mt-[0.35rem] flex list-none flex-col gap-[0.35rem] p-0 [&_em]:text-[0.8125rem] [&_em]:not-italic [&_em]:text-slate-500 [&_li]:flex [&_li]:flex-wrap [&_li]:items-center [&_li]:gap-[0.6rem] [&_li]:rounded-lg [&_li]:border [&_li]:border-slate-200 [&_li]:bg-white [&_li]:px-[0.6rem] [&_li]:py-[0.45rem] [&_li]:text-sm">
                              {holders.map((reservation) => {
                                const held = (reservation.items ?? [])
                                  .filter(
                                    (item) =>
                                      item.materialId === row.materialId &&
                                      item.warehouseId === row.warehouseId,
                                  )
                                  .reduce((sum, item) => sum + item.quantityReserved, 0);
                                return (
                                  <li key={reservation.id}>
                                    <span className="font-bold text-slate-900">{reservation.reservationCode}</span>
                                    <Badge variant="outline" className="border-primary/30 bg-primary/10 text-slate-900">
                                      {RESERVATION_STATUS_LABEL[reservation.status]}
                                    </Badge>
                                    <span>giữ {formatNumber(held)}</span>
                                    <em>
                                      {reservation.expiresAt
                                        ? `hết hạn ${formatDateTime(reservation.expiresAt)}`
                                        : 'không hạn'}
                                    </em>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="m-0 mb-1 text-[0.8125rem] leading-normal text-slate-500">
                              Số lượng đang giữ không khớp phiếu nào còn hiệu lực.
                            </p>
                          )
                        ) : null}
                      </TableCell>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
        {rows.length === 0 ? (
          <p className="m-0 py-8 text-center text-slate-500">
            {workspace.stock.length === 0 ? 'Chưa có tồn kho.' : 'Không có dòng tồn nào khớp bộ lọc.'}
          </p>
        ) : null}

        {/* Pagination Footer */}
        {rows.length > pageSize ? (
          <div className="flex flex-wrap items-center justify-between border-t border-slate-200 bg-slate-50 px-[14px] py-[10px] text-[13px] text-slate-500">
            <div>
              Hiển thị {rows.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} –{' '}
              {Math.min(currentPage * pageSize, rows.length)} trong tổng số{' '}
              <strong>{rows.length}</strong> dòng tồn
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-[6px]">
                <span>Hiển thị:</span>
                <div className="w-[120px]">
                  <SearchableSelect
                    options={PAGE_SIZE_OPTIONS}
                    value={String(pageSize)}
                    onChange={(value) => {
                      setPageSize(Number(value) || 15);
                      setCurrentPage(1);
                    }}
                    clearable={false}
                    height={28}
                  />
                </div>
              </div>

              <div className="flex items-center gap-[6px]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                >
                  ← Trước
                </Button>
                <span className="font-semibold text-slate-900">
                  {safeCurrentPage} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  Sau →
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </TableWrap>
    </Card>
  );
}
