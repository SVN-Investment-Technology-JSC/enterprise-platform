'use client';
import { formatDateTime as formatSharedDateTime } from '@enterprise-platform/shared-ui';
import { useInventoryPermissions } from '../inventory-permissions';

import type {
  StocktakeSession,
  StocktakeLine,
  StocktakeStatus,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryWorkspace } from '../inventory-api';
import {
  loadStocktakes,
  loadStocktakeLines,
  createStocktakeSession,
  startStocktakeCounting,
  saveStocktakeLines,
  submitStocktakeForApproval,
  rejectStocktakeSession,
  approveAndPostStocktake,
  cancelStocktakeSession,
} from '../inventory-api';
import { formatNumber } from '../inventory-labels';
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus,
  Search,
  Download,
  Upload,
  Save,
  Send,
  CheckCircle2,
  History,
  AlertTriangle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { SearchableSelect, Popconfirm, VnNumberInput, formatCurrencyVn } from '@enterprise-platform/shared-ui';
import { CreateStocktakeDialog } from './create-stocktake-dialog';
import { StocktakeLotSerialDrawer } from './stocktake-lot-serial-drawer';
import { Button, Card, Input, Label, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow, TableWrap, Textarea } from '../ui';
import { cn } from '../ui/cn';

const STATUS_BADGE: Record<StocktakeStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Bản nháp', className: 'border-slate-300 bg-slate-100 text-slate-600' },
  COUNTING: { label: 'Đang kiểm đếm', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  PENDING_APPROVAL: { label: 'Chờ duyệt', className: 'border-yellow-200 bg-yellow-50 text-yellow-800' },
  APPROVED: { label: 'Đã duyệt', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  POSTED: { label: 'Đã ghi sổ', className: 'border-green-300 bg-green-50 text-green-700' },
  CANCELLED: { label: 'Đã hủy', className: 'border-red-200 bg-red-50 text-red-700' },
};

function formatCurrency(value?: number): string {
  return formatCurrencyVn(value, { showUnit: true });
}

function formatDateTime(value?: string): string {
  if (!value) return '—';
  return formatSharedDateTime(value, '—');
}

export interface StocktakeHubProps {
  workspace: InventoryWorkspace;
  busy?: boolean;
  onSubmitMovement: (input: any) => Promise<void>;
  onNotice?: (msg: string) => void;
}

export function StocktakeHub({
  workspace,
  busy = false,
  onSubmitMovement,
  onNotice,
}: StocktakeHubProps) {
  const [sessions, setSessions] = useState<StocktakeSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [lines, setLines] = useState<StocktakeLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Filters Master list
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');

  // Filter Detail Table
  const [gridSearch, setGridSearch] = useState('');
  const [gridFilter, setGridFilter] = useState<'all' | 'uncounted' | 'diff' | 'lot_serial'>('all');

  // Modals & Drawers
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  const { canManage } = useInventoryPermissions();
  const [drawerLine, setDrawerLine] = useState<StocktakeLine | null>(null);
  const [auditLine, setAuditLine] = useState<StocktakeLine | null>(null);

  // Custom Confirm/Input Dialog States
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReasonInput, setRejectReasonInput] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Nạp danh sách đợt kiểm kê
  const reloadSessions = async (preferSelectedId?: string) => {
    const list = await loadStocktakes(workspace);
    setSessions(list);
    if (list.length > 0) {
      if (preferSelectedId && list.some((s) => s.id === preferSelectedId)) {
        setSelectedSessionId(preferSelectedId);
      } else if (!selectedSessionId || !list.some((s) => s.id === selectedSessionId)) {
        setSelectedSessionId(list[0].id);
      }
    }
  };

  useEffect(() => {
    void reloadSessions();
  }, [workspace]);

  // Nạp chi tiết các dòng khi chọn đợt
  useEffect(() => {
    if (!selectedSessionId) {
      setLines([]);
      return;
    }
    setLoadingLines(true);
    setDirty(false);
    loadStocktakeLines(selectedSessionId, workspace)
      .then((res) => {
        setLines(res);
      })
      .finally(() => {
        setLoadingLines(false);
      });
  }, [selectedSessionId, workspace]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId),
    [sessions, selectedSessionId],
  );

  const isReadOnly =
    !canManage ||
    !selectedSession ||
    selectedSession.status === 'POSTED' ||
    selectedSession.status === 'CANCELLED' ||
    selectedSession.status === 'PENDING_APPROVAL';

  // Lọc Master list
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (warehouseFilter !== 'all' && s.warehouseCode !== warehouseFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchCode = s.code.toLowerCase().includes(q);
        const matchTitle = s.title.toLowerCase().includes(q);
        if (!matchCode && !matchTitle) return false;
      }
      return true;
    });
  }, [sessions, statusFilter, warehouseFilter, searchQuery]);

  // Lọc Grid lines
  const filteredLines = useMemo(() => {
    return lines.filter((l) => {
      if (gridFilter === 'uncounted' && l.actualQuantity !== undefined && l.actualQuantity !== null) {
        return false;
      }
      if (gridFilter === 'diff' && l.difference === 0) {
        return false;
      }
      if (gridFilter === 'lot_serial' && !l.isLotTracked && !l.isSerialized) {
        return false;
      }
      if (gridSearch.trim()) {
        const q = gridSearch.toLowerCase();
        const matchCode = l.materialCode.toLowerCase().includes(q);
        const matchName = l.materialName.toLowerCase().includes(q);
        if (!matchCode && !matchName) return false;
      }
      return true;
    });
  }, [lines, gridFilter, gridSearch]);

  // Handler cập nhật số lượng trực tiếp trên dòng
  const handleLineCountChange = (lineId: string, val: string) => {
    const numeric = val === '' ? undefined : Number(val);
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const actual = numeric;
        const diff = actual !== undefined ? actual - l.systemQuantity : 0;
        const diffVal = diff * (l.unitCost ?? 0);
        let status: StocktakeLine['status'] = 'UNCOUNTED';
        if (actual !== undefined) {
          if (diff === 0) status = 'MATCHED';
          else if (diff > 0) status = 'SURPLUS';
          else status = 'DEFICIT';
        }
        return {
          ...l,
          actualQuantity: actual,
          difference: diff,
          differenceValue: diffVal,
          status,
        };
      }),
    );
    setDirty(true);
  };

  const handleReasonChange = (lineId: string, reason: string) => {
    setLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, reason } : l)),
    );
    setDirty(true);
  };

  // Lưu nháp thay đổi số đếm
  const handleSaveDraft = async () => {
    if (!selectedSessionId) return;
    try {
      const res = await saveStocktakeLines(selectedSessionId, lines);
      setSessions((prev) => prev.map((s) => (s.id === res.session.id ? res.session : s)));
      setLines(res.lines);
      setDirty(false);
      if (onNotice) onNotice('Đã lưu nháp tiến độ kiểm đếm.');
    } catch (err) {
      alert('Không thể lưu số đếm: ' + (err instanceof Error ? err.message : 'Lỗi'));
    }
  };

  // Bắt đầu đếm (chụp snapshot)
  const handleStartCounting = async () => {
    if (!selectedSessionId) return;
    try {
      const res = await startStocktakeCounting(selectedSessionId, workspace);
      setSessions((prev) => prev.map((s) => (s.id === res.session.id ? res.session : s)));
      setLines(res.lines);
      if (onNotice) onNotice(`Đã chốt snapshot và chuyển đợt ${res.session.code} sang Đang kiểm đếm.`);
    } catch (err) {
      alert('Lỗi: ' + (err instanceof Error ? err.message : 'Lỗi'));
    }
  };

  // Gửi duyệt - Mở dialog xác nhận nếu còn hàng chưa đếm
  const handleSubmitApproval = async () => {
    if (!selectedSessionId) return;
    if (dirty) {
      await handleSaveDraft();
    }
    const uncountedLines = lines.filter((l) => l.actualQuantity === undefined);
    if (uncountedLines.length > 0) {
      setConfirmSubmitOpen(true);
      return;
    }
    await executeSubmitApproval();
  };

  const executeSubmitApproval = async () => {
    if (!selectedSessionId) return;
    try {
      const updated = await submitStocktakeForApproval(selectedSessionId);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setConfirmSubmitOpen(false);
      if (onNotice) onNotice(`Đã gửi trình duyệt đợt kiểm kê ${updated.code}.`);
    } catch (err) {
      alert('Không thể gửi trình duyệt: ' + (err instanceof Error ? err.message : 'Lỗi'));
    }
  };

  // Trả về yêu cầu đếm lại - Mở dialog nhập lý do
  const handleOpenRejectDialog = () => {
    setRejectReasonInput('Số liệu chênh lệch cần đối soát lại thực tế');
    setRejectDialogOpen(true);
  };

  const executeRejectSession = async () => {
    if (!selectedSessionId) return;
    try {
      const updated = await rejectStocktakeSession(selectedSessionId, rejectReasonInput);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setRejectDialogOpen(false);
      if (onNotice) onNotice(`Đã trả đợt kiểm kê ${updated.code} về trạng thái Đang kiểm đếm.`);
    } catch (err) {
      alert('Lỗi: ' + (err instanceof Error ? err.message : 'Lỗi'));
    }
  };

  // Duyệt và ghi sổ
  const handleApproveAndPost = async () => {
    if (!selectedSessionId) return;
    const updated = await approveAndPostStocktake(selectedSessionId, 'Trưởng phòng Kho vận', onSubmitMovement);
    setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    if (onNotice) onNotice(`Đã duyệt & ghi sổ đợt kiểm kê ${updated.code}. Các bút toán cân kho đã được tự động sinh.`);
  };

  // Hủy đợt
  const handleCancelSession = async () => {
    if (!selectedSessionId) return;
    const updated = await cancelStocktakeSession(selectedSessionId, 'Người dùng hủy thao tác');
    setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    if (onNotice) onNotice(`Đã hủy đợt kiểm kê ${updated.code}.`);
  };

  // Xuất file mẫu Excel kiểm kê
  const handleExportExcel = () => {
    if (!selectedSession) return;
    const exportData = lines.map((l, idx) => ({
      'STT': idx + 1,
      'Mã vật tư': l.materialCode,
      'Tên vật tư': l.materialName,
      'ĐVT': l.unit,
      'Vị trí kệ': l.binLocation || '',
      'Tồn sổ sách': l.systemQuantity,
      'Thực đếm': l.actualQuantity ?? '',
      'Lý do chênh lệch': l.reason || '',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'KiemKe');
    XLSX.writeFile(wb, `Bien_Ban_Kiem_Ke_${selectedSession.code}.xlsx`);
    if (onNotice) onNotice(`Đã xuất mẫu Excel kiểm kê cho đợt ${selectedSession.code}.`);
  };

  // Nhập file Excel kiểm kê
  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        const data = XLSX.utils.sheet_to_json<any>(ws);

        let matchCount = 0;
        const codeToRow = new Map<string, { actual?: number; reason?: string; binLocation?: string }>();

        data.forEach((row) => {
          const code = row['Mã vật tư'] || row['Ma vat tu'] || row['Mã VT'] || row['Code'];
          const actual = row['Thực đếm'] !== undefined ? Number(row['Thực đếm']) : undefined;
          const reason = row['Lý do chênh lệch'] || row['Ly do'] || '';
          const binLocation = row['Vị trí kệ'] || row['Vi tri ke'] || row['Vị trí'] || row['Vi tri'] || undefined;
          if (code) {
            codeToRow.set(String(code).trim().toUpperCase(), {
              actual: isNaN(actual as any) ? undefined : actual,
              reason,
              binLocation: binLocation ? String(binLocation).trim() : undefined,
            });
          }
        });

        setLines((prev) =>
          prev.map((l) => {
            const hit = codeToRow.get(l.materialCode.toUpperCase());
            if (hit && hit.actual !== undefined) {
              matchCount++;
              const actual = hit.actual;
              const diff = actual - l.systemQuantity;
              const diffVal = diff * (l.unitCost ?? 0);
              let status: StocktakeLine['status'] = 'UNCOUNTED';
              if (diff === 0) status = 'MATCHED';
              else if (diff > 0) status = 'SURPLUS';
              else status = 'DEFICIT';

              return {
                ...l,
                binLocation: hit.binLocation || l.binLocation,
                actualQuantity: actual,
                difference: diff,
                differenceValue: diffVal,
                reason: hit.reason || l.reason,
                status,
              };
            }
            return l;
          }),
        );

        setDirty(true);
        if (onNotice) onNotice(`Đã nạp số đếm từ Excel cho ${matchCount} mặt hàng.`);
      } catch (err) {
        alert('Không thể đọc file Excel: ' + (err instanceof Error ? err.message : 'Định dạng không hợp lệ'));
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Hidden file input for Excel import */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".xlsx, .xls, .csv"
        className="hidden"
        onChange={handleImportExcel}
      />

      {/* Header chính của Hub */}
      <div className="flex flex-wrap items-center justify-between gap-[0.85rem]">
        <div>
          <span className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-[0.65rem] py-[0.2rem] text-[0.8125rem] font-bold text-blue-600">
            Đối soát &amp; Cân đối kho
          </span>
          <h1 className="m-0 text-xl font-bold tracking-[-0.02em] text-slate-900">Kiểm kê kho &amp; Đối soát số sách</h1>
          <p className="mb-0 mt-1 text-sm text-slate-500">
            Quy trình đối soát định kỳ và đột xuất toàn kho, chốt snapshot, ghi nhận chênh lệch và tự động sinh bút toán cân kho sau phê duyệt.
          </p>
        </div>
      </div>

      {/* BỐ CỤC MASTER-DETAIL 16:9 SPLIT GRID */}
      <div className="grid min-h-[680px] grid-cols-[380px_minmax(0,1fr)] items-start gap-4">
        {/* CỘT TRÁI (MASTER LIST): DANH SÁCH ĐỢT KIỂM KÊ */}
        <Card className="gap-3 overflow-visible rounded-2xl p-4">
          {/* Action & Search */}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => setOpenCreateDialog(true)}
              disabled={!canManage}
              className="font-bold"
            >
              <Plus size={15} /> Tạo đợt
            </Button>
            <div className="relative flex-1">
              <Search size={14} className="pointer-events-none absolute left-[10px] top-[11px] text-slate-400" />
              <Input
                type="text"
                placeholder="Tìm mã / tên đợt..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-[30px] text-[13px]"
              />
            </div>
          </div>

          {/* Bộ lọc Kho & Trạng thái */}
          <div className="grid grid-cols-2 gap-2">
            <SearchableSelect
              options={[
                { value: 'all', label: 'Tất cả kho' },
                ...workspace.warehouses.map((w) => ({ value: w.code, label: w.code })),
              ]}
              value={warehouseFilter}
              onChange={(val) => setWarehouseFilter(val)}
              clearable={false}
              placeholder="Kho hàng"
            />
            <SearchableSelect
              options={[
                { value: 'all', label: 'Tất cả trạng thái' },
                { value: 'DRAFT', label: 'Bản nháp' },
                { value: 'COUNTING', label: 'Đang kiểm đếm' },
                { value: 'PENDING_APPROVAL', label: 'Chờ duyệt' },
                { value: 'POSTED', label: 'Đã ghi sổ' },
                { value: 'CANCELLED', label: 'Đã hủy' },
              ]}
              value={statusFilter}
              onChange={(val) => setStatusFilter(val)}
              clearable={false}
              placeholder="Trạng thái"
            />
          </div>

          {/* Danh sách đợt (Master Cards) */}
          <div className="flex max-h-[560px] flex-col gap-2 overflow-y-auto">
            {filteredSessions.map((session) => {
              const isSelected = session.id === selectedSessionId;
              const badge = STATUS_BADGE[session.status] || STATUS_BADGE.DRAFT;
              return (
                <div
                  key={session.id}
                  onClick={() => setSelectedSessionId(session.id)}
                  className={cn(
                    'flex cursor-pointer flex-col gap-1.5 rounded-md p-3 transition-all',
                    isSelected ? 'border-2 border-blue-600 bg-blue-50' : 'border border-slate-200 bg-white',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn('font-mono text-[13px] font-bold', isSelected ? 'text-blue-700' : 'text-slate-900')}>
                      {session.code}
                    </span>
                    <span className={cn('rounded border px-1.5 py-px text-xs font-semibold', badge.className)}>
                      {badge.label}
                    </span>
                  </div>

                  <div className="text-sm font-semibold leading-[1.3] text-slate-800">{session.title}</div>

                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{session.warehouseCode}{session.stocktakeDate ? ` · ${session.stocktakeDate}` : ''}</span>
                    <span>{session.totalItems > 0 ? `Đếm ${session.countedItems}/${session.totalItems} mã` : 'Chưa snapshot'}</span>
                  </div>

                  {session.differenceItems > 0 ? (
                    <div className="flex items-center gap-1 text-xs font-semibold text-red-600">
                      <AlertTriangle size={12} /> Có {session.differenceItems} mặt hàng lệch
                    </div>
                  ) : null}
                </div>
              );
            })}

            {filteredSessions.length === 0 ? (
              <div className="px-[10px] py-[30px] text-center text-sm text-slate-400">
                Không tìm thấy đợt kiểm kê nào phù hợp.
              </div>
            ) : null}
          </div>
        </Card>

        {/* CỘT PHẢI (DETAIL WORKSPACE): HỒ SƠ ĐỢT & BẢNG DATA GRID ĐA HÀNG HÓA */}
        {selectedSession ? (
          <Card className="gap-4 overflow-visible rounded-2xl p-5">
            {/* Header chi tiết đợt */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-[14px]">
              <div>
                <div className="flex items-center gap-[10px]">
                  <h2 className="m-0 text-xl font-extrabold text-slate-900">{selectedSession.code}</h2>
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[13px] font-bold',
                      STATUS_BADGE[selectedSession.status]?.className,
                    )}
                  >
                    {STATUS_BADGE[selectedSession.status]?.label}
                  </span>
                  <span className="text-sm font-semibold text-slate-600">
                    {selectedSession.warehouseName || selectedSession.warehouseCode}
                  </span>
                </div>
                <div className="mb-0 mt-1 text-sm text-slate-500">
                  {selectedSession.title} · Người lập: <strong>{selectedSession.leadAuditor}</strong>
                  {selectedSession.stocktakeDate ? (
                    <> · Ngày kiểm: <strong>{selectedSession.stocktakeDate}</strong></>
                  ) : null}
                </div>
              </div>

              {/* Action Toolbar buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {/* 1. Nút bắt đầu đếm nếu DRAFT */}
                {canManage && selectedSession.status === 'DRAFT' ? (
                  <Button type="button" onClick={handleStartCounting} className="font-bold">
                    <Sparkles size={14} /> Chốt snapshot &amp; Bắt đầu đếm
                  </Button>
                ) : null}

                {/* 2. Lưu nháp */}
                {!isReadOnly ? (
                  <Button
                    type="button"
                    variant={dirty ? 'default' : 'outline'}
                    onClick={handleSaveDraft}
                    className={cn(dirty && 'bg-amber-500 text-white hover:bg-amber-600')}
                  >
                    <Save size={14} /> {dirty ? 'Lưu thay đổi *' : 'Lưu nháp'}
                  </Button>
                ) : null}

                {/* 3. Xuất mẫu Excel */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleExportExcel}
                  title="Tải bảng tính Excel để điền số đếm ngoại tuyến"
                >
                  <Download size={14} /> Xuất Excel
                </Button>

                {/* 4. Nhập Excel */}
                {!isReadOnly ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    title="Nạp số thực đếm từ file Excel đã kiểm"
                  >
                    <Upload size={14} /> Nhập Excel
                  </Button>
                ) : null}

                {/* 5. Gửi duyệt (khi đang COUNTING) */}
                {canManage && selectedSession.status === 'COUNTING' ? (
                  <Button
                    type="button"
                    onClick={handleSubmitApproval}
                    className="bg-emerald-700 font-bold text-white hover:bg-emerald-800"
                  >
                    <Send size={14} /> Gửi trình duyệt
                  </Button>
                ) : null}

                {/* 6. Phê duyệt & Ghi sổ (khi PENDING_APPROVAL) */}
                {canManage && selectedSession.status === 'PENDING_APPROVAL' ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleOpenRejectDialog}
                      className="border-amber-300 text-amber-700"
                      title="Yêu cầu kiểm kê viên kiểm đếm lại số liệu"
                    >
                      <RotateCcw size={14} /> Yêu cầu đếm lại
                    </Button>
                    <Popconfirm
                      title="Phê duyệt & Ghi sổ cân kho?"
                      description={`Xác nhận phê duyệt đợt kiểm kê ${selectedSession.code}. Hệ thống sẽ tự động tạo bút toán điều chỉnh tồn kho cho ${selectedSession.differenceItems} mặt hàng có chênh lệch và khóa hồ sơ chỉ đọc.`}
                      okText="Duyệt & Ghi sổ"
                      cancelText="Hủy"
                      okType="primary"
                      placement="bottom-end"
                      onConfirm={handleApproveAndPost}
                    >
                      <Button type="button" className="bg-green-700 font-bold text-white hover:bg-green-800">
                        <CheckCircle2 size={14} /> Duyệt &amp; Ghi sổ
                      </Button>
                    </Popconfirm>
                  </>
                ) : null}

                {/* 7. Hủy đợt nếu chưa POSTED */}
                {canManage && selectedSession.status !== 'POSTED' && selectedSession.status !== 'CANCELLED' ? (
                  <Popconfirm
                    title="Hủy đợt kiểm kê này?"
                    description="Hành động này sẽ hủy tiến độ kiểm kê hiện tại và lưu vào lịch sử hủy."
                    okText="Hủy đợt"
                    cancelText="Đóng"
                    okType="danger"
                    placement="bottom-end"
                    onConfirm={handleCancelSession}
                  >
                    <Button type="button" variant="outline" className="border-red-300 text-red-600">
                      Hủy đợt
                    </Button>
                  </Popconfirm>
                ) : null}
              </div>
            </div>

            {/* Dải chỉ số tổng hợp đợt kiểm kê */}
            <div className="grid grid-cols-4 gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <span className="text-[13px] text-slate-500">Tổng số mã kiểm kê:</span>
                <div className="text-xl font-extrabold text-slate-900">{selectedSession.totalItems} mã</div>
              </div>
              <div>
                <span className="text-[13px] text-slate-500">Đã hoàn tất đếm:</span>
                <div className="text-xl font-extrabold text-blue-600">
                  {selectedSession.countedItems} / {selectedSession.totalItems}
                </div>
              </div>
              <div>
                <span className="text-[13px] text-slate-500">Số mã phát hiện lệch:</span>
                <div
                  className={cn(
                    'text-xl font-extrabold',
                    selectedSession.differenceItems > 0 ? 'text-red-600' : 'text-green-700',
                  )}
                >
                  {selectedSession.differenceItems} mặt hàng
                </div>
              </div>
              <div>
                <span className="text-[13px] text-slate-500">Tổng giá trị chênh lệch:</span>
                <div
                  className={cn(
                    'text-xl font-extrabold',
                    selectedSession.totalVarianceValue === 0
                      ? 'text-green-700'
                      : selectedSession.totalVarianceValue > 0
                        ? 'text-blue-600'
                        : 'text-red-600',
                  )}
                >
                  {formatCurrency(selectedSession.totalVarianceValue)}
                </div>
              </div>
            </div>

            {/* Toolbar lọc Bảng kiểm đếm */}
            <div className="flex flex-wrap items-center justify-between gap-[10px]">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setGridFilter('all')}
                  className={cn('font-semibold', gridFilter === 'all' && 'border-blue-600 bg-blue-50 text-blue-600')}
                >
                  Tất cả ({lines.length})
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setGridFilter('uncounted')}
                  className={cn('font-semibold', gridFilter === 'uncounted' && 'border-blue-600 bg-blue-50 text-blue-600')}
                >
                  Chưa đếm ({lines.filter((l) => l.actualQuantity === undefined || l.actualQuantity === null).length})
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setGridFilter('diff')}
                  className={cn('font-semibold', gridFilter === 'diff' && 'border-red-600 bg-red-50 text-red-600')}
                >
                  Có chênh lệch ({lines.filter((l) => l.difference !== 0 && l.actualQuantity !== undefined).length})
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setGridFilter('lot_serial')}
                  className={cn('font-semibold', gridFilter === 'lot_serial' && 'border-blue-600 bg-blue-50 text-blue-600')}
                >
                  Hàng theo Lô / Sê-ri
                </Button>
              </div>

              <div className="relative w-[240px]">
                <Search size={13} className="pointer-events-none absolute left-2 top-[10px] text-slate-400" />
                <Input
                  type="text"
                  placeholder="Tìm mã hoặc tên VT..."
                  value={gridSearch}
                  onChange={(e) => setGridSearch(e.target.value)}
                  className="h-8 pl-[26px] text-[13px]"
                />
              </div>
            </div>

            {/* BẢNG KIỂM ĐẾM ĐA HÀNG HÓA (DATA GRID) */}
            <TableWrap className="overflow-x-auto rounded-md border border-slate-200">
              <Table className="text-[13px]">
                <TableHead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    <TableHeaderCell className="w-[130px] px-3 py-[10px]">Mã VT</TableHeaderCell>
                    <TableHeaderCell className="px-3 py-[10px]">Tên vật tư &amp; Quy cách</TableHeaderCell>
                    <TableHeaderCell className="w-[65px] px-2 py-[10px] text-center">ĐVT</TableHeaderCell>
                    <TableHeaderCell className="w-[90px] px-2 py-[10px]">Vị trí kệ</TableHeaderCell>
                    <TableHeaderCell className="w-[90px] bg-slate-100 px-2 py-[10px] text-center">Tồn sổ</TableHeaderCell>
                    <TableHeaderCell className="w-[110px] px-2 py-[10px] text-center">Thực đếm</TableHeaderCell>
                    <TableHeaderCell className="w-[85px] px-2 py-[10px] text-center">Lệch</TableHeaderCell>
                    <TableHeaderCell className="w-[220px] px-3 py-[10px]">Lý do chênh lệch</TableHeaderCell>
                    <TableHeaderCell className="w-[110px] px-3 py-[10px] text-right">Thao tác</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {filteredLines.map((line) => {
                    const isDiff = line.difference !== 0 && line.actualQuantity !== undefined;
                    return (
                      <TableRow key={line.id} className={isDiff ? 'bg-amber-50' : 'bg-white'}>
                        {/* Mã VT */}
                        <TableCell className="px-3 py-2 font-bold text-blue-700">
                          <div className="flex items-center gap-1.5">
                            <span>{line.materialCode}</span>
                            {line.isLotTracked ? (
                              <span
                                title="Vật tư theo dõi theo Lô"
                                className="rounded-[3px] bg-indigo-100 px-1 py-px text-xs font-semibold text-indigo-800"
                              >
                                Lô
                              </span>
                            ) : null}
                            {line.isSerialized ? (
                              <span
                                title="Vật tư quản lý theo Sê-ri"
                                className="rounded-[3px] bg-green-100 px-1 py-px text-xs font-semibold text-green-800"
                              >
                                SN
                              </span>
                            ) : null}
                          </div>
                        </TableCell>

                        {/* Tên VT */}
                        <TableCell className="px-3 py-2">
                          <div className="font-semibold text-slate-800">{line.materialName}</div>
                          {line.unitCost ? (
                            <div className="text-xs text-slate-500">Đơn giá: {formatCurrency(line.unitCost)}</div>
                          ) : null}
                        </TableCell>

                        {/* ĐVT */}
                        <TableCell className="p-2 text-center text-slate-500">{line.unit}</TableCell>

                        {/* Vị trí kệ */}
                        <TableCell className="p-2 text-[13px] text-slate-600">{line.binLocation || '-----'}</TableCell>

                        {/* Tồn sổ sách */}
                        <TableCell className="bg-slate-50 p-2 text-center font-bold text-slate-700">
                          {formatNumber(line.systemQuantity)}
                        </TableCell>

                        {/* Thực đếm */}
                        <TableCell className="p-2 text-center">
                          {isReadOnly || line.isLotTracked || line.isSerialized ? (
                            <div
                              onClick={() => {
                                if (line.isLotTracked || line.isSerialized) {
                                  setDrawerLine(line);
                                }
                              }}
                              className={cn(
                                'font-extrabold',
                                line.actualQuantity !== undefined ? 'text-slate-900' : 'text-slate-400',
                                line.isLotTracked || line.isSerialized ? 'cursor-pointer underline' : 'cursor-default no-underline',
                              )}
                              title={line.isLotTracked || line.isSerialized ? 'Bấm để mở kiểm kê chi tiết Lô/Sê-ri' : ''}
                            >
                              {line.actualQuantity !== undefined ? formatNumber(line.actualQuantity) : '— Chưa đếm —'}
                            </div>
                          ) : (
                            <VnNumberInput
                              maxDecimals={3}
                              value={line.actualQuantity !== undefined ? String(line.actualQuantity) : ''}
                              placeholder="Nhập SL"
                              onChange={(value) => handleLineCountChange(line.id, value)}
                              className="h-8 w-20 min-w-0 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[13px] font-bold outline-none focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-100"
                              style={{ textAlign: 'right' }}
                            />
                          )}
                        </TableCell>

                        {/* Chênh lệch */}
                        <TableCell
                          className={cn(
                            'p-2 text-center font-extrabold',
                            line.difference === 0 ? 'text-green-700' : line.difference > 0 ? 'text-blue-600' : 'text-red-600',
                          )}
                        >
                          {line.actualQuantity !== undefined
                            ? line.difference > 0
                              ? `+${line.difference}`
                              : line.difference
                            : '—'}
                        </TableCell>

                        {/* Lý do chênh lệch */}
                        <TableCell className="px-3 py-2">
                          {isReadOnly ? (
                            <span className="text-[13px] text-slate-600">{line.reason || '—'}</span>
                          ) : (
                            <Input
                              type="text"
                              value={line.reason || ''}
                              placeholder={line.difference !== 0 ? 'Ghi rõ lý do lệch...' : 'Ghi chú...'}
                              onChange={(e) => handleReasonChange(line.id, e.target.value)}
                              className={cn(
                                'h-8 text-[13px]',
                                line.difference !== 0 && !line.reason && 'border-red-400',
                              )}
                            />
                          )}
                        </TableCell>

                        {/* Thao tác */}
                        <TableCell className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1.5">
                            {line.isLotTracked || line.isSerialized ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                onClick={() => setDrawerLine(line)}
                                className="border-blue-200 bg-blue-50 font-semibold text-blue-700 hover:bg-blue-100"
                                title="Kiểm kê chi tiết Lô và Sê-ri"
                              >
                                Chi tiết
                              </Button>
                            ) : null}

                            {line.audits && line.audits.length > 0 ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon-xs"
                                onClick={() => setAuditLine(line)}
                                className="text-slate-500"
                                title="Xem lịch sử thay đổi số đếm"
                              >
                                <History size={13} />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {loadingLines ? (
                    <TableEmpty colSpan={9}>Đang tải danh sách mặt hàng kiểm kê...</TableEmpty>
                  ) : filteredLines.length === 0 ? (
                    <TableEmpty colSpan={9}>Không có mặt hàng nào khớp bộ lọc.</TableEmpty>
                  ) : null}
                </TableBody>
              </Table>
            </TableWrap>
          </Card>
        ) : (
          <Card className="overflow-visible rounded-2xl p-10 text-center text-slate-500">
            Vui lòng chọn một đợt kiểm kê từ danh sách bên trái hoặc bấm <strong>+ Tạo đợt</strong>.
          </Card>
        )}
      </div>

      {/* Popup Form Tạo đợt kiểm kê mới */}
      {openCreateDialog && canManage ? (
        <CreateStocktakeDialog
          workspace={workspace}
          busy={busy}
          onClose={() => setOpenCreateDialog(false)}
          onSubmit={async (input) => {
            const created = await createStocktakeSession(input, workspace);
            const { session } = await startStocktakeCounting(created.id, workspace);
            await reloadSessions(session.id);
            if (onNotice) onNotice(`Đã tạo đợt kiểm kê ${session.code} và bắt đầu kiểm đếm.`);
          }}
        />
      ) : null}

      {/* Drawer trượt bên phải kiểm đếm Lô / Sê-ri */}
      {drawerLine ? (
        <StocktakeLotSerialDrawer
          materialCode={drawerLine.materialCode}
          materialName={drawerLine.materialName}
          unit={drawerLine.unit}
          systemQuantity={drawerLine.systemQuantity}
          actualQuantity={drawerLine.actualQuantity}
          isLotTracked={drawerLine.isLotTracked}
          isSerialized={drawerLine.isSerialized}
          lotAllocations={drawerLine.lotAllocations}
          serialAllocations={drawerLine.serialAllocations}
          readOnly={isReadOnly}
          onClose={() => setDrawerLine(null)}
          onSave={(data) => {
            setLines((prev) =>
              prev.map((l) => {
                if (l.id !== drawerLine.id) return l;
                const actual = data.actualQuantity;
                const diff = actual - l.systemQuantity;
                const diffVal = diff * (l.unitCost ?? 0);
                let status: StocktakeLine['status'] = 'UNCOUNTED';
                if (diff === 0) status = 'MATCHED';
                else if (diff > 0) status = 'SURPLUS';
                else status = 'DEFICIT';

                return {
                  ...l,
                  actualQuantity: actual,
                  difference: diff,
                  differenceValue: diffVal,
                  status,
                  lotAllocations: data.lotAllocations,
                  serialAllocations: data.serialAllocations,
                };
              }),
            );
            setDirty(true);
            setDrawerLine(null);
            if (onNotice) onNotice(`Đã cập nhật số thực đếm cho ${drawerLine.materialCode}: ${data.actualQuantity} ${drawerLine.unit}.`);
          }}
        />
      ) : null}

      {/* Popup xem Lịch sử Audit log của dòng kiểm kê */}
      {auditLine ? (
        <div
          className="fixed inset-0 z-[1060] flex items-center justify-center bg-black/45 backdrop-blur-[3px]"
          role="dialog"
        >
          <div className="w-[480px] max-w-[90vw] overflow-hidden rounded-lg bg-white shadow-[0_10px_25px_rgba(0,0,0,0.2)]">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-[18px] py-[14px]">
              <h3 className="m-0 text-base font-bold">Lịch sử kiểm đếm · {auditLine.materialCode}</h3>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setAuditLine(null)}
                className="text-slate-500"
              >
                ✕
              </Button>
            </div>
            <div className="max-h-[350px] overflow-y-auto p-4">
              <div className="flex flex-col gap-[10px]">
                {auditLine.audits?.map((audit, idx) => (
                  <div key={idx} className="rounded-md border border-slate-200 bg-slate-50 p-[10px] text-[13px]">
                    <div className="flex justify-between text-slate-500">
                      <span>{audit.operator}</span>
                      <span>{formatDateTime(audit.timestamp)}</span>
                    </div>
                    <div className="my-1 text-sm font-bold text-slate-900">
                      Số đếm: {audit.newQuantity} {auditLine.unit}{' '}
                      {audit.previousQuantity !== undefined ? `(Trước đó: ${audit.previousQuantity})` : '(Lần đầu)'}
                    </div>
                    {audit.reason ? <div className="text-slate-600">Lý do: {audit.reason}</div> : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-slate-200 px-4 py-[10px] text-right">
              <Button type="button" onClick={() => setAuditLine(null)} className="font-semibold">
                Đóng
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* DIALOG XÁC NHẬN GỬI TRÌNH DUYỆT (KHI CÒN HÀNG CHƯA ĐẾM) */}
      {confirmSubmitOpen ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[3px]">
          <div className="w-full max-w-[460px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center gap-[10px] border-b border-slate-100 px-5 py-4">
              <AlertTriangle size={20} color="#d97706" />
              <h3 className="m-0 text-base font-bold text-slate-900">Xác nhận gửi trình duyệt kiểm kê</h3>
            </div>
            <div className="px-5 py-4 text-sm leading-normal text-slate-700">
              Hiện còn{' '}
              <strong className="text-red-600">
                {lines.filter((l) => l.actualQuantity === undefined).length} mặt hàng
              </strong>{' '}
              chưa được kiểm đếm (chưa nhập số thực tế).
              <br />
              <br />
              Bạn có chắc chắn muốn chốt hồ sơ và gửi trình duyệt đợt kiểm kê này sang cấp Quản lý xem xét không?
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <Button type="button" variant="outline" onClick={() => setConfirmSubmitOpen(false)}>
                Hủy / Quay lại
              </Button>
              <Button
                type="button"
                onClick={executeSubmitApproval}
                className="bg-emerald-700 font-bold text-white hover:bg-emerald-800"
              >
                Xác nhận Gửi duyệt
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* DIALOG YÊU CẦU ĐẾM LẠI (REJECT SESSION) */}
      {rejectDialogOpen ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[3px]">
          <div className="w-full max-w-[480px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center gap-[10px] border-b border-slate-100 px-5 py-4">
              <RotateCcw size={20} color="#b45309" />
              <h3 className="m-0 text-base font-bold text-slate-900">Yêu cầu kiểm đếm lại</h3>
            </div>
            <div className="flex flex-col gap-[10px] px-5 py-4">
              <Label required className="text-sm">
                Lý do từ chối &amp; Yêu cầu kiểm đếm lại số liệu
              </Label>
              <Textarea
                rows={3}
                value={rejectReasonInput}
                onChange={(e) => setRejectReasonInput(e.target.value)}
                placeholder="Nhập chi tiết lý do yêu cầu kiểm đếm lại..."
              />
              <span className="text-[13px] text-slate-500">
                Hồ sơ đợt kiểm kê sẽ được chuyển từ <strong>Chờ duyệt</strong> trở về trạng thái <strong>Đang kiểm đếm</strong> để nhân viên sửa số liệu.
              </span>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <Button type="button" variant="outline" onClick={() => setRejectDialogOpen(false)}>
                Hủy
              </Button>
              <Button
                type="button"
                onClick={executeRejectSession}
                disabled={!rejectReasonInput.trim()}
                className="bg-amber-700 font-bold text-white hover:bg-amber-800"
              >
                Xác nhận Yêu cầu đếm lại
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
