'use client';

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
import { SearchableSelect, Popconfirm } from '@enterprise-platform/shared-ui';
import { CreateStocktakeDialog } from './create-stocktake-dialog';
import { StocktakeLotSerialDrawer } from './stocktake-lot-serial-drawer';
import styles from '../inventory.module.scss';

const STATUS_BADGE: Record<
  StocktakeStatus,
  { label: string; bg: string; color: string; border: string }
> = {
  DRAFT: { label: 'Bản nháp', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
  COUNTING: { label: 'Đang kiểm đếm', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  PENDING_APPROVAL: { label: 'Chờ duyệt', bg: '#fefce8', color: '#854d0e', border: '#fef08a' },
  APPROVED: { label: 'Đã duyệt', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' },
  POSTED: { label: 'Đã ghi sổ', bg: '#f0fdf4', color: '#15803d', border: '#86efac' },
  CANCELLED: { label: 'Đã hủy', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value);
}

function formatCurrency(value?: number): string {
  if (value === undefined || value === null) return '—';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
}

function formatDateTime(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Hidden file input for Excel import */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".xlsx, .xls, .csv"
        style={{ display: 'none' }}
        onChange={handleImportExcel}
      />

      {/* Header chính của Hub */}
      <div className={styles.sectionHeading} style={{ marginBottom: 0 }}>
        <div>
          <span className={styles.eyebrow}>Đối soát &amp; Cân đối kho</span>
          <h1 style={{ margin: 0 }}>Kiểm kê kho &amp; Đối soát số sách</h1>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px' }}>
            Quy trình đối soát định kỳ và đột xuất toàn kho, chốt snapshot, ghi nhận chênh lệch và tự động sinh bút toán cân kho sau phê duyệt.
          </p>
        </div>
      </div>

      {/* BỐ CỤC MASTER-DETAIL 16:9 SPLIT GRID */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '380px minmax(0, 1fr)',
          gap: '16px',
          alignItems: 'start',
          minHeight: '680px',
        }}
      >
        {/* CỘT TRÁI (MASTER LIST): DANH SÁCH ĐỢT KIỂM KÊ */}
        <section className={styles.card} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Action & Search */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setOpenCreateDialog(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 12px',
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <Plus size={15} /> Tạo đợt
            </button>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search
                size={14}
                style={{ position: 'absolute', left: '10px', top: '9px', color: '#94a3b8' }}
              />
              <input
                type="text"
                placeholder="Tìm mã / tên đợt..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px 6px 30px',
                  fontSize: '12.5px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Bộ lọc Kho & Trạng thái */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
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
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '560px',
              overflowY: 'auto',
            }}
          >
            {filteredSessions.map((session) => {
              const isSelected = session.id === selectedSessionId;
              const badge = STATUS_BADGE[session.status] || STATUS_BADGE.DRAFT;
              return (
                <div
                  key={session.id}
                  onClick={() => setSelectedSessionId(session.id)}
                  style={{
                    padding: '12px',
                    borderRadius: '6px',
                    border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    background: isSelected ? '#eff6ff' : '#ffffff',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        fontSize: '12.5px',
                        color: isSelected ? '#1d4ed8' : '#0f172a',
                      }}
                    >
                      {session.code}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: badge.bg,
                        color: badge.color,
                        border: `1px solid ${badge.border}`,
                      }}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', lineHeight: 1.3 }}>
                    {session.title}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11.5px', color: '#64748b' }}>
                    <span>{session.warehouseCode}</span>
                    <span>{session.totalItems > 0 ? `Đếm ${session.countedItems}/${session.totalItems} mã` : 'Chưa snapshot'}</span>
                  </div>

                  {session.differenceItems > 0 ? (
                    <div style={{ fontSize: '11.5px', color: '#dc2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AlertTriangle size={12} /> Có {session.differenceItems} mặt hàng lệch
                    </div>
                  ) : null}
                </div>
              );
            })}

            {filteredSessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: '#94a3b8', fontSize: '13px' }}>
                Không tìm thấy đợt kiểm kê nào phù hợp.
              </div>
            ) : null}
          </div>
        </section>

        {/* CỘT PHẢI (DETAIL WORKSPACE): HỒ SƠ ĐỢT & BẢNG DATA GRID ĐA HÀNG HÓA */}
        {selectedSession ? (
          <section className={styles.card} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Header chi tiết đợt */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                paddingBottom: '14px',
                borderBottom: '1px solid #e2e8f0',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                    {selectedSession.code}
                  </h2>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '999px',
                      background: STATUS_BADGE[selectedSession.status]?.bg,
                      color: STATUS_BADGE[selectedSession.status]?.color,
                      border: `1px solid ${STATUS_BADGE[selectedSession.status]?.border}`,
                    }}
                  >
                    {STATUS_BADGE[selectedSession.status]?.label}
                  </span>
                  <span style={{ fontSize: '13px', color: '#475569', fontWeight: 600 }}>
                    {selectedSession.warehouseName || selectedSession.warehouseCode}
                  </span>
                </div>
                <div style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                  {selectedSession.title} · Người lập: <strong>{selectedSession.leadAuditor}</strong>
                </div>
              </div>

              {/* Action Toolbar buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {/* 1. Nút bắt đầu đếm nếu DRAFT */}
                {selectedSession.status === 'DRAFT' ? (
                  <button
                    type="button"
                    onClick={handleStartCounting}
                    style={{
                      padding: '7px 14px',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      background: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <Sparkles size={14} /> Chốt snapshot &amp; Bắt đầu đếm
                  </button>
                ) : null}

                {/* 2. Lưu nháp */}
                {!isReadOnly ? (
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    style={{
                      padding: '7px 12px',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      background: dirty ? '#f59e0b' : '#ffffff',
                      color: dirty ? '#ffffff' : '#1e293b',
                      border: dirty ? 'none' : '1px solid #cbd5e1',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <Save size={14} /> {dirty ? 'Lưu thay đổi *' : 'Lưu nháp'}
                  </button>
                ) : null}

                {/* 3. Xuất mẫu Excel */}
                <button
                  type="button"
                  onClick={handleExportExcel}
                  style={{
                    padding: '7px 12px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    background: '#ffffff',
                    color: '#0f172a',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                  title="Tải bảng tính Excel để điền số đếm ngoại tuyến"
                >
                  <Download size={14} /> Xuất Excel
                </button>

                {/* 4. Nhập Excel */}
                {!isReadOnly ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      padding: '7px 12px',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      background: '#ffffff',
                      color: '#0f172a',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                    title="Nạp số thực đếm từ file Excel đã kiểm"
                  >
                    <Upload size={14} /> Nhập Excel
                  </button>
                ) : null}

                {/* 5. Gửi duyệt (khi đang COUNTING) */}
                {selectedSession.status === 'COUNTING' ? (
                  <button
                    type="button"
                    onClick={handleSubmitApproval}
                    style={{
                      padding: '7px 14px',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      background: '#047857',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <Send size={14} /> Gửi trình duyệt
                  </button>
                ) : null}

                {/* 6. Phê duyệt & Ghi sổ (khi PENDING_APPROVAL) */}
                {selectedSession.status === 'PENDING_APPROVAL' ? (
                  <>
                    <button
                      type="button"
                      onClick={handleOpenRejectDialog}
                      style={{
                        padding: '7px 12px',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        background: '#ffffff',
                        color: '#b45309',
                        border: '1px solid #fcd34d',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                      title="Yêu cầu kiểm kê viên kiểm đếm lại số liệu"
                    >
                      <RotateCcw size={14} /> Yêu cầu đếm lại
                    </button>
                    <Popconfirm
                      title="Phê duyệt & Ghi sổ cân kho?"
                      description={`Xác nhận phê duyệt đợt kiểm kê ${selectedSession.code}. Hệ thống sẽ tự động tạo bút toán điều chỉnh tồn kho cho ${selectedSession.differenceItems} mặt hàng có chênh lệch và khóa hồ sơ chỉ đọc.`}
                      okText="Duyệt & Ghi sổ"
                      cancelText="Hủy"
                      okType="primary"
                      placement="bottom-end"
                      onConfirm={handleApproveAndPost}
                    >
                      <button
                        type="button"
                        style={{
                          padding: '7px 14px',
                          fontSize: '12.5px',
                          fontWeight: 700,
                          background: '#15803d',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                        }}
                      >
                        <CheckCircle2 size={14} /> Duyệt &amp; Ghi sổ
                      </button>
                    </Popconfirm>
                  </>
                ) : null}

                {/* 7. Hủy đợt nếu chưa POSTED */}
                {selectedSession.status !== 'POSTED' && selectedSession.status !== 'CANCELLED' ? (
                  <Popconfirm
                    title="Hủy đợt kiểm kê này?"
                    description="Hành động này sẽ hủy tiến độ kiểm kê hiện tại và lưu vào lịch sử hủy."
                    okText="Hủy đợt"
                    cancelText="Đóng"
                    okType="danger"
                    placement="bottom-end"
                    onConfirm={handleCancelSession}
                  >
                    <button
                      type="button"
                      style={{
                        padding: '7px 10px',
                        fontSize: '12px',
                        fontWeight: 600,
                        background: '#ffffff',
                        color: '#dc2626',
                        border: '1px solid #fca5a5',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      Hủy đợt
                    </button>
                  </Popconfirm>
                ) : null}
              </div>
            </div>

            {/* Dải chỉ số tổng hợp đợt kiểm kê */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: '12px',
                padding: '12px 16px',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
              }}
            >
              <div>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Tổng số mã kiểm kê:</span>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                  {selectedSession.totalItems} mã
                </div>
              </div>
              <div>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Đã hoàn tất đếm:</span>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#2563eb' }}>
                  {selectedSession.countedItems} / {selectedSession.totalItems}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Số mã phát hiện lệch:</span>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 800,
                    color: selectedSession.differenceItems > 0 ? '#dc2626' : '#15803d',
                  }}
                >
                  {selectedSession.differenceItems} mặt hàng
                </div>
              </div>
              <div>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Tổng giá trị chênh lệch:</span>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 800,
                    color: selectedSession.totalVarianceValue === 0 ? '#15803d' : selectedSession.totalVarianceValue > 0 ? '#2563eb' : '#dc2626',
                  }}
                >
                  {formatCurrency(selectedSession.totalVarianceValue)}
                </div>
              </div>
            </div>

            {/* Toolbar lọc Bảng kiểm đếm */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setGridFilter('all')}
                  style={{
                    padding: '5px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: gridFilter === 'all' ? '1px solid #2563eb' : '1px solid #cbd5e1',
                    background: gridFilter === 'all' ? '#eff6ff' : '#ffffff',
                    color: gridFilter === 'all' ? '#2563eb' : '#475569',
                    cursor: 'pointer',
                  }}
                >
                  Tất cả ({lines.length})
                </button>
                <button
                  type="button"
                  onClick={() => setGridFilter('uncounted')}
                  style={{
                    padding: '5px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: gridFilter === 'uncounted' ? '1px solid #2563eb' : '1px solid #cbd5e1',
                    background: gridFilter === 'uncounted' ? '#eff6ff' : '#ffffff',
                    color: gridFilter === 'uncounted' ? '#2563eb' : '#475569',
                    cursor: 'pointer',
                  }}
                >
                  Chưa đếm ({lines.filter((l) => l.actualQuantity === undefined || l.actualQuantity === null).length})
                </button>
                <button
                  type="button"
                  onClick={() => setGridFilter('diff')}
                  style={{
                    padding: '5px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: gridFilter === 'diff' ? '1px solid #dc2626' : '1px solid #cbd5e1',
                    background: gridFilter === 'diff' ? '#fef2f2' : '#ffffff',
                    color: gridFilter === 'diff' ? '#dc2626' : '#475569',
                    cursor: 'pointer',
                  }}
                >
                  Có chênh lệch ({lines.filter((l) => l.difference !== 0 && l.actualQuantity !== undefined).length})
                </button>
                <button
                  type="button"
                  onClick={() => setGridFilter('lot_serial')}
                  style={{
                    padding: '5px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: gridFilter === 'lot_serial' ? '1px solid #2563eb' : '1px solid #cbd5e1',
                    background: gridFilter === 'lot_serial' ? '#eff6ff' : '#ffffff',
                    color: gridFilter === 'lot_serial' ? '#2563eb' : '#475569',
                    cursor: 'pointer',
                  }}
                >
                  Hàng theo Lô / Sê-ri
                </button>
              </div>

              <div style={{ position: 'relative', width: '240px' }}>
                <Search size={13} style={{ position: 'absolute', left: '8px', top: '8px', color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Tìm mã hoặc tên VT..."
                  value={gridSearch}
                  onChange={(e) => setGridSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '5px 8px 5px 26px',
                    fontSize: '12px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* BẢNG KIỂM ĐẾM ĐA HÀNG HÓA (DATA GRID) */}
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ textAlign: 'left', padding: '10px 12px', width: '130px' }}>Mã VT</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px' }}>Tên vật tư &amp; Quy cách</th>
                    <th style={{ textAlign: 'center', padding: '10px 8px', width: '65px' }}>ĐVT</th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', width: '90px' }}>Vị trí kệ</th>
                    <th style={{ textAlign: 'center', padding: '10px 8px', width: '90px', background: '#f1f5f9' }}>
                      Tồn sổ
                    </th>
                    <th style={{ textAlign: 'center', padding: '10px 8px', width: '110px' }}>
                      Thực đếm
                    </th>
                    <th style={{ textAlign: 'center', padding: '10px 8px', width: '85px' }}>Lệch</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', width: '220px' }}>
                      Lý do chênh lệch
                    </th>
                    <th style={{ textAlign: 'right', padding: '10px 12px', width: '110px' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLines.map((line) => {
                    const isDiff = line.difference !== 0 && line.actualQuantity !== undefined;
                    return (
                      <tr
                        key={line.id}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: isDiff ? '#fffbeb' : '#ffffff',
                        }}
                      >
                        {/* Mã VT */}
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: '#1d4ed8' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>{line.materialCode}</span>
                            {line.isLotTracked ? (
                              <span
                                title="Vật tư theo dõi theo Lô"
                                style={{
                                  fontSize: '10px',
                                  padding: '1px 4px',
                                  borderRadius: '3px',
                                  background: '#e0e7ff',
                                  color: '#3730a3',
                                  fontWeight: 600,
                                }}
                              >
                                Lô
                              </span>
                            ) : null}
                            {line.isSerialized ? (
                              <span
                                title="Vật tư quản lý theo Sê-ri"
                                style={{
                                  fontSize: '10px',
                                  padding: '1px 4px',
                                  borderRadius: '3px',
                                  background: '#dcfce7',
                                  color: '#166534',
                                  fontWeight: 600,
                                }}
                              >
                                SN
                              </span>
                            ) : null}
                          </div>
                        </td>

                        {/* Tên VT */}
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ fontWeight: 600, color: '#1e293b' }}>{line.materialName}</div>
                          {line.unitCost ? (
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              Đơn giá: {formatCurrency(line.unitCost)}
                            </div>
                          ) : null}
                        </td>

                        {/* ĐVT */}
                        <td style={{ textAlign: 'center', padding: '8px', color: '#64748b' }}>
                          {line.unit}
                        </td>

                        {/* Vị trí kệ */}
                        <td style={{ padding: '8px', color: '#475569', fontSize: '12px' }}>
                          {line.binLocation || '-----'}
                        </td>

                        {/* Tồn sổ sách */}
                        <td
                          style={{
                            textAlign: 'center',
                            padding: '8px',
                            fontWeight: 700,
                            background: '#f8fafc',
                            color: '#334155',
                          }}
                        >
                          {formatNumber(line.systemQuantity)}
                        </td>

                        {/* Thực đếm */}
                        <td style={{ textAlign: 'center', padding: '8px' }}>
                          {isReadOnly || line.isLotTracked || line.isSerialized ? (
                            <div
                              onClick={() => {
                                if (line.isLotTracked || line.isSerialized) {
                                  setDrawerLine(line);
                                }
                              }}
                              style={{
                                fontWeight: 800,
                                color: line.actualQuantity !== undefined ? '#0f172a' : '#94a3b8',
                                cursor: line.isLotTracked || line.isSerialized ? 'pointer' : 'default',
                                textDecoration: line.isLotTracked || line.isSerialized ? 'underline' : 'none',
                              }}
                              title={line.isLotTracked || line.isSerialized ? 'Bấm để mở kiểm kê chi tiết Lô/Sê-ri' : ''}
                            >
                              {line.actualQuantity !== undefined ? formatNumber(line.actualQuantity) : '— Chưa đếm —'}
                            </div>
                          ) : (
                            <input
                              type="number"
                              value={line.actualQuantity !== undefined ? line.actualQuantity : ''}
                              placeholder="Nhập SL"
                              onChange={(e) => handleLineCountChange(line.id, e.target.value)}
                              style={{
                                width: '80px',
                                textAlign: 'center',
                                padding: '4px 6px',
                                fontSize: '12.5px',
                                fontWeight: 700,
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                background: '#ffffff',
                              }}
                            />
                          )}
                        </td>

                        {/* Chênh lệch */}
                        <td
                          style={{
                            textAlign: 'center',
                            padding: '8px',
                            fontWeight: 800,
                            color: line.difference === 0 ? '#15803d' : line.difference > 0 ? '#2563eb' : '#dc2626',
                          }}
                        >
                          {line.actualQuantity !== undefined
                            ? line.difference > 0
                              ? `+${line.difference}`
                              : line.difference
                            : '—'}
                        </td>

                        {/* Lý do chênh lệch */}
                        <td style={{ padding: '8px 12px' }}>
                          {isReadOnly ? (
                            <span style={{ fontSize: '12px', color: '#475569' }}>{line.reason || '—'}</span>
                          ) : (
                            <input
                              type="text"
                              value={line.reason || ''}
                              placeholder={line.difference !== 0 ? 'Ghi rõ lý do lệch...' : 'Ghi chú...'}
                              onChange={(e) => handleReasonChange(line.id, e.target.value)}
                              style={{
                                width: '100%',
                                padding: '4px 8px',
                                fontSize: '12px',
                                border: line.difference !== 0 && !line.reason ? '1px solid #f87171' : '1px solid #cbd5e1',
                                borderRadius: '4px',
                                background: '#ffffff',
                              }}
                            />
                          )}
                        </td>

                        {/* Thao tác */}
                        <td style={{ textAlign: 'right', padding: '8px 12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                            {line.isLotTracked || line.isSerialized ? (
                              <button
                                type="button"
                                onClick={() => setDrawerLine(line)}
                                style={{
                                  padding: '3px 7px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  background: '#eff6ff',
                                  color: '#1d4ed8',
                                  border: '1px solid #bfdbfe',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                }}
                                title="Kiểm kê chi tiết Lô và Sê-ri"
                              >
                                Chi tiết
                              </button>
                            ) : null}

                            {line.audits && line.audits.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => setAuditLine(line)}
                                style={{
                                  padding: '3px 6px',
                                  fontSize: '11px',
                                  background: 'transparent',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '4px',
                                  color: '#64748b',
                                  cursor: 'pointer',
                                }}
                                title="Xem lịch sử thay đổi số đếm"
                              >
                                <History size={13} />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {loadingLines ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                        Đang tải danh sách mặt hàng kiểm kê...
                      </td>
                    </tr>
                  ) : filteredLines.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                        Không có mặt hàng nào khớp bộ lọc.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className={styles.card} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
            Vui lòng chọn một đợt kiểm kê từ danh sách bên trái hoặc bấm <strong>+ Tạo đợt</strong>.
          </section>
        )}
      </div>

      {/* Popup Form Tạo đợt kiểm kê mới */}
      {openCreateDialog ? (
        <CreateStocktakeDialog
          workspace={workspace}
          busy={busy}
          onClose={() => setOpenCreateDialog(false)}
          onSubmit={async (input) => {
            const created = await createStocktakeSession(input, workspace);
            await reloadSessions(created.id);
            if (onNotice) onNotice(`Đã tạo đợt kiểm kê ${created.code}.`);
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
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 1060,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(3px)',
          }}
          role="dialog"
        >
          <div
            style={{
              width: '480px',
              maxWidth: '90vw',
              background: '#ffffff',
              borderRadius: '8px',
              overflow: 'hidden',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#f8fafc',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                Lịch sử kiểm đếm · {auditLine.materialCode}
              </h3>
              <button
                type="button"
                onClick={() => setAuditLine(null)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '16px', maxHeight: '350px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {auditLine.audits?.map((audit, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '10px',
                      background: '#f8fafc',
                      borderRadius: '6px',
                      border: '1px solid #e2e8f0',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>{audit.operator}</span>
                      <span>{formatDateTime(audit.timestamp)}</span>
                    </div>
                    <div style={{ margin: '4px 0', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                      Số đếm: {audit.newQuantity} {auditLine.unit}{' '}
                      {audit.previousQuantity !== undefined ? `(Trước đó: ${audit.previousQuantity})` : '(Lần đầu)'}
                    </div>
                    {audit.reason ? <div style={{ color: '#475569' }}>Lý do: {audit.reason}</div> : null}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '10px 16px', borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => setAuditLine(null)}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* DIALOG XÁC NHẬN GỬI TRÌNH DUYỆT (KHI CÒN HÀNG CHƯA ĐẾM) */}
      {confirmSubmitOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.5)',
            backdropFilter: 'blur(3px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '8px',
              maxWidth: '460px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid #e2e8f0',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertTriangle size={20} color="#d97706" />
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Xác nhận gửi trình duyệt kiểm kê</h3>
            </div>
            <div style={{ padding: '16px 20px', fontSize: '13.5px', color: '#334155', lineHeight: 1.5 }}>
              Hiện còn{' '}
              <strong style={{ color: '#dc2626' }}>
                {lines.filter((l) => l.actualQuantity === undefined).length} mặt hàng
              </strong>{' '}
              chưa được kiểm đếm (chưa nhập số thực tế).
              <br />
              <br />
              Bạn có chắc chắn muốn chốt hồ sơ và gửi trình duyệt đợt kiểm kê này sang cấp Quản lý xem xét không?
            </div>
            <div
              style={{
                padding: '12px 20px',
                background: '#f8fafc',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
              }}
            >
              <button
                type="button"
                onClick={() => setConfirmSubmitOpen(false)}
                style={{
                  padding: '7px 14px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Hủy / Quay lại
              </button>
              <button
                type="button"
                onClick={executeSubmitApproval}
                style={{
                  padding: '7px 16px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  background: '#047857',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Xác nhận Gửi duyệt
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* DIALOG YÊU CẦU ĐẾM LẠI (REJECT SESSION) */}
      {rejectDialogOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.5)',
            backdropFilter: 'blur(3px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '8px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid #e2e8f0',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <RotateCcw size={20} color="#b45309" />
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Yêu cầu kiểm đếm lại</h3>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                Lý do từ chối &amp; Yêu cầu kiểm đếm lại số liệu <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <textarea
                rows={3}
                value={rejectReasonInput}
                onChange={(e) => setRejectReasonInput(e.target.value)}
                placeholder="Nhập chi tiết lý do yêu cầu kiểm đếm lại..."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: '13px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Hồ sơ đợt kiểm kê sẽ được chuyển từ <strong>Chờ duyệt</strong> trở về trạng thái <strong>Đang kiểm đếm</strong> để nhân viên sửa số liệu.
              </span>
            </div>
            <div
              style={{
                padding: '12px 20px',
                background: '#f8fafc',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
              }}
            >
              <button
                type="button"
                onClick={() => setRejectDialogOpen(false)}
                style={{
                  padding: '7px 14px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={executeRejectSession}
                disabled={!rejectReasonInput.trim()}
                style={{
                  padding: '7px 16px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  background: rejectReasonInput.trim() ? '#b45309' : '#94a3b8',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: rejectReasonInput.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Xác nhận Yêu cầu đếm lại
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
