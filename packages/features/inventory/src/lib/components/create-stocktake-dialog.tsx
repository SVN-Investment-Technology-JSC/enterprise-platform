'use client';

import type {
  CreateStocktakeRequest,
  InventoryItem,
  StocktakeScopeType,
} from '@enterprise-platform/contracts-inventory';
import {
  type InventoryWorkspace,
  loadAuditorCandidates,
  type AuditorCandidate,
} from '../inventory-api';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useState, useMemo, useEffect } from 'react';
import {
  X,
  ClipboardCheck,
  AlertCircle,
  Trash2,
  Play,
  Calendar,
  Users,
  UserCheck,
  Plus,
  Info,
  Check,
  Layers,
  Package,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { formatNumber } from '../inventory-labels';
import { Button, Input, Label, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui';
import { cn } from '../ui/cn';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'NV';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function matchesAuditor(c: AuditorCandidate, q: string): boolean {
  if (!q.trim()) return true;
  const lower = q.trim().toLowerCase();
  return (
    c.name.toLowerCase().includes(lower) ||
    (c.code?.toLowerCase().includes(lower) ?? false) ||
    (c.department?.toLowerCase().includes(lower) ?? false) ||
    (c.position?.toLowerCase().includes(lower) ?? false) ||
    (c.email?.toLowerCase().includes(lower) ?? false)
  );
}

interface AuditorPickerProps {
  readonly candidates: readonly AuditorCandidate[];
  readonly selectedNames: readonly string[];
  readonly onToggleName: (name: string) => void;
  readonly leadAuditorName?: string;
  readonly onAddCustomName: (name: string) => void;
}

/**
 * Thành phần chọn nhân sự tham gia tổ kiểm kê (thiết kế theo chuẩn form tạo nhóm chat):
 * Có thanh tìm kiếm, danh sách cuộn mượt mà có checkbox, avatar chữ viết tắt,
 * thẻ hiển thị các thành viên đã chọn có nút xoá nhanh (X), và hỗ trợ thêm nhân sự ngoài danh bạ.
 */
function AuditorPicker({
  candidates,
  selectedNames,
  onToggleName,
  leadAuditorName,
  onAddCustomName,
}: AuditorPickerProps) {
  const [query, setQuery] = useState('');

  const { warehouseGroup, externalGroup } = useMemo(() => {
    const wh: AuditorCandidate[] = [];
    const ext: AuditorCandidate[] = [];
    for (const c of candidates) {
      if (matchesAuditor(c, query)) {
        if (c.hasWarehouseAccess) {
          wh.push(c);
        } else {
          ext.push(c);
        }
      }
    }
    return { warehouseGroup: wh, externalGroup: ext };
  }, [candidates, query]);

  const totalVisibleCount = warehouseGroup.length + externalGroup.length;

  const hasExactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return false;
    return (
      candidates.some((c) => c.name.toLowerCase() === q) ||
      selectedNames.some((n) => n.toLowerCase() === q)
    );
  }, [candidates, selectedNames, query]);

  const renderAuditorRow = (c: AuditorCandidate) => {
    const isLead = c.name === leadAuditorName;
    const isSelected = selectedNames.includes(c.name);
    return (
      <button
        key={c.id || c.name}
        type="button"
        role="option"
        aria-selected={isSelected}
        disabled={isLead}
        className="flex w-full cursor-pointer items-center gap-[10px] border-0 border-b border-slate-100 bg-transparent px-3 py-2 text-left font-[inherit] text-inherit transition-colors last:border-b-0 enabled:hover:bg-slate-50 disabled:cursor-default disabled:bg-slate-50 aria-selected:bg-blue-600/5 aria-selected:enabled:hover:bg-blue-600/10"
        onClick={() => {
          if (!isLead) onToggleName(c.name);
        }}
        title={
          isLead
            ? 'Đang là người phụ trách chính (Trưởng nhóm kiểm kê)'
            : isSelected
            ? `Bỏ chọn ${c.name}`
            : `Chọn ${c.name} vào tổ kiểm kê`
        }
      >
        <span
          className={cn(
            'grid size-[18px] shrink-0 place-items-center rounded-[5px] border-[1.5px] border-slate-300 bg-white text-white transition-colors',
            isLead && 'border-blue-300 bg-blue-100 text-blue-700',
            !isLead && isSelected && 'border-blue-600 bg-blue-600',
          )}
          aria-hidden="true"
        >
          {isLead ? <UserCheck size={12} /> : isSelected ? <Check size={12} /> : null}
        </span>

        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-800">{getInitials(c.name)}</span>

        <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
          <div className="flex items-center gap-1.5">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-slate-800">{c.name}</span>
            {c.code ? (
              <small className="font-mono text-slate-400">({c.code})</small>
            ) : null}
            {isLead ? (
              <span className="inline-flex items-center rounded-[10px] border border-blue-200 bg-blue-50 px-1.5 py-px text-[10.5px] font-bold text-blue-700">Trưởng nhóm</span>
            ) : null}
            {c.hasWarehouseAccess ? (
              <span className="inline-flex items-center gap-[3px] rounded-[10px] border border-green-200 bg-green-50 px-1.5 py-px text-[10.5px] font-semibold text-green-800 [&_svg]:size-[11px] [&_svg]:text-green-600">
                <ShieldCheck size={11} /> Có quyền kho
              </span>
            ) : null}
          </div>
          <small className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-500">
            {[
              c.position,
              c.department,
              c.hasWarehouseAccess ? 'Nhiệm vụ kho' : 'Ngoài kho',
            ]
              .filter(Boolean)
              .join(' • ')}
          </small>
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Users size={15} className="text-blue-600" />
          <span className="text-[13px] font-semibold text-slate-700">
            Thành viên tham gia kiểm kê
          </span>
        </div>
        <span
          className={
            selectedNames.length > 0
              ? 'rounded-xl border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11.5px] font-semibold text-blue-600'
              : 'text-xs text-slate-400'
          }
        >
          {selectedNames.length > 0
            ? `Đã chọn ${selectedNames.length} thành viên`
            : 'Chọn thêm thành viên tổ kiểm (không bắt buộc)'}
        </span>
      </div>

      {/* Danh sách thành viên đã chọn hiển thị dạng Chips (giống tạo nhóm chat) */}
      {selectedNames.length > 0 ? (
        <div className="flex max-h-[84px] flex-wrap gap-1.5 overflow-y-auto pb-1 pt-0.5" aria-label="Thành viên đã chọn">
          {selectedNames.map((name) => {
            const candidate = candidates.find((c) => c.name === name);
            const isWh = candidate?.hasWarehouseAccess;
            return (
              <span key={name} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 pl-1.5 pr-1 text-[12.5px] leading-none text-blue-800">
                <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-blue-600 text-[9.5px] font-bold text-white">{getInitials(name)}</span>
                <span
                  className="max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap font-medium"
                  title={candidate?.position ? `${name} (${candidate.position})` : name}
                >
                  {name}
                </span>
                {isWh ? (
                  <span title="Có quyền kho" className="inline-flex items-center">
                    <ShieldCheck size={12} className="shrink-0 text-green-600" />
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={`Bỏ ${name}`}
                  title={`Bỏ ${name}`}
                  onClick={() => onToggleName(name)}
                  className="grid size-[18px] cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-blue-800 transition-colors hover:bg-blue-100"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      {/* Thanh tìm kiếm nhân sự */}
      <div className="flex h-[38px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-[10px] text-slate-500 transition-[border-color,box-shadow] focus-within:border-blue-600 focus-within:ring-[3px] focus-within:ring-blue-600/10 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-slate-400">
        <Search size={16} aria-hidden="true" />
        <Input
          className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-[13px] text-slate-800 focus-visible:ring-0"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm nhân sự theo tên, mã NV hoặc phòng ban..."
          aria-label="Tìm nhân sự"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (query.trim()) {
                const allVisible = [...warehouseGroup, ...externalGroup];
                const match = allVisible.find((c) => c.name !== leadAuditorName);
                if (match) {
                  onToggleName(match.name);
                } else if (!hasExactMatch) {
                  onAddCustomName(query.trim());
                  setQuery('');
                }
              }
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-slate-200 p-0 text-slate-500 transition-colors hover:bg-slate-300 hover:text-slate-700 [&_svg]:size-3"
            onClick={() => setQuery('')}
            aria-label="Xoá tìm kiếm"
            title="Xoá tìm kiếm"
          >
            <X size={12} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Danh sách chọn nhân sự chia thành 2 khu vực rõ ràng */}
      <div className="max-h-[220px] overflow-y-auto rounded-lg border border-slate-200 bg-white" role="listbox" aria-multiselectable="true">
        {totalVisibleCount === 0 && !query.trim() ? (
          <p className="m-0 p-4 text-center text-[13px] text-slate-400">
            Không có nhân sự nào trong danh sách.
          </p>
        ) : null}

        {totalVisibleCount === 0 && query.trim() ? (
          <p className="m-0 px-4 py-3 text-center text-[12.5px] text-slate-500">
            Không tìm thấy nhân sự phù hợp với từ khoá "{query}".
          </p>
        ) : null}

        {/* Khu 1: Nhân sự có nhiệm vụ trong kho hoặc có quyền inventory.* */}
        {warehouseGroup.length > 0 ? (
          <>
            <div className="sticky top-0 z-[2] flex items-center justify-between border-y border-slate-200 bg-slate-50 px-3 py-1.5 first:border-t-0">
              <div className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.03em] text-slate-700">
                <ShieldCheck size={13} className="text-green-600" />
                <span>Khu 1: Có nhiệm vụ / quyền kho (inventory.*)</span>
              </div>
              <span className="rounded-[10px] border border-green-200 bg-green-100 px-[7px] py-px text-[11px] font-semibold text-green-700">
                {warehouseGroup.length} nhân sự
              </span>
            </div>
            {warehouseGroup.map(renderAuditorRow)}
          </>
        ) : null}

        {/* Khu 2: Nhân sự ngoài thẩm quyền kho */}
        {externalGroup.length > 0 ? (
          <>
            <div className="sticky top-0 z-[2] flex items-center justify-between border-y border-slate-200 bg-slate-50 px-3 py-1.5 first:border-t-0">
              <div className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.03em] text-slate-700">
                <Users size={13} className="text-slate-500" />
                <span>Khu 2: Người ngoài thẩm quyền kho</span>
              </div>
              <span className="rounded-[10px] bg-slate-200 px-[7px] py-px text-[11px] font-semibold text-slate-600">
                {externalGroup.length} nhân sự
              </span>
            </div>
            {externalGroup.map(renderAuditorRow)}
          </>
        ) : null}

        {/* Nút thêm nhân sự ngoài danh bạ nếu tìm kiếm tên mới */}
        {query.trim() && !hasExactMatch ? (
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 border-0 border-t border-dashed border-green-200 bg-green-50 px-3 py-[9px] text-left text-[12.5px] font-semibold text-green-800 transition-colors hover:bg-green-100"
            onClick={() => {
              onAddCustomName(query.trim());
              setQuery('');
            }}
          >
            <Plus size={14} className="text-green-600" />
            <span>
              Thêm nhân sự ngoài danh bạ: <strong>"{query.trim()}"</strong>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

export interface CreateStocktakeDialogProps {
  workspace: InventoryWorkspace;
  busy?: boolean;
  initialWarehouseCode?: string;
  initialSelectedMaterials?: readonly InventoryItem[];
  onClose: () => void;
  onSubmit: (input: CreateStocktakeRequest, startCountingImmediately?: boolean) => Promise<void>;
}

export function CreateStocktakeDialog({
  workspace,
  busy = false,
  initialWarehouseCode,
  initialSelectedMaterials = [],
  onClose,
  onSubmit,
}: CreateStocktakeDialogProps) {
  // Kho kiểm kê
  const [warehouseCode, setWarehouseCode] = useState(() => {
    if (initialWarehouseCode && workspace.warehouses.some((w) => w.code === initialWarehouseCode)) {
      return initialWarehouseCode;
    }
    return workspace.warehouses[0]?.code || 'WH-CENTRAL';
  });

  // Tên đợt kiểm kê - Để trống mặc định cho người dùng tự nhập
  const [title, setTitle] = useState('');

  // Thời gian kiểm kê - Mặc định ngày hôm nay YYYY-MM-DD
  const [stocktakeDate, setStocktakeDate] = useState(() => {
    return new Date().toISOString().slice(0, 10);
  });

  // Phạm vi kiểm đếm: ALL, CATEGORY, SPECIFIC_ITEMS
  const [scopeType, setScopeType] = useState<StocktakeScopeType>(() =>
    initialSelectedMaterials.length > 0 ? 'SPECIFIC_ITEMS' : 'ALL',
  );

  // Danh mục nhóm vật tư được chọn (khi scopeType === 'CATEGORY')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Danh sách vật tư cụ thể (khi scopeType === 'SPECIFIC_ITEMS')
  const [selectedItems, setSelectedItems] = useState<InventoryItem[]>(() => [
    ...initialSelectedMaterials,
  ]);
  const [materialToAdd, setMaterialToAdd] = useState('');

  // Nhân sự phụ trách & Tổ kiểm kê
  const [auditorCandidates, setAuditorCandidates] = useState<AuditorCandidate[]>([]);
  const [leadAuditor, setLeadAuditor] = useState('');
  const [selectedAuditors, setSelectedAuditors] = useState<string[]>([]);

  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();

  // Tải danh sách nhân sự phụ trách có quyền hoặc vai trò quản lý kho
  useEffect(() => {
    let alive = true;
    void loadAuditorCandidates().then((candidates) => {
      if (alive && candidates.length > 0) {
        setAuditorCandidates(candidates);
        // Để trống Người phụ trách (Trưởng nhóm), người dùng chủ động chọn từ danh sách
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Danh sách kho options
  const warehouseOptions = useMemo(
    () =>
      workspace.warehouses.map((w) => ({
        value: w.code,
        label: `${w.code} — ${w.name || 'Kho'}`,
        description: w.location,
      })),
    [workspace.warehouses],
  );

  // Danh mục nhóm vật tư
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of workspace.materials) {
      if (m.type) set.add(m.type);
    }
    return Array.from(set).map((t) => ({ value: t, label: t }));
  }, [workspace.materials]);

  // Map số tồn theo kho được chọn
  const stockByCodeInSelectedWh = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of workspace.stock) {
      if (s.warehouseCode === warehouseCode || !s.warehouseCode) {
        if (s.materialCode) {
          map.set(s.materialCode, (map.get(s.materialCode) ?? 0) + s.quantity);
        }
      }
    }
    return map;
  }, [workspace.stock, warehouseCode]);

  // Options cho ô chọn Người phụ trách (Trưởng nhóm kiểm kê) - BẮT BUỘC chỉ gồm người có thẩm quyền / quyền kho (inventory.*)
  const leadAuditorOptions = useMemo(() => {
    const list = auditorCandidates.filter((c) => c.hasWarehouseAccess);
    return list.map((c) => {
      const parts = [c.position, c.department];
      return {
        value: c.name,
        label: `${c.name} ${c.code ? `(${c.code})` : ''}`,
        description: parts.filter(Boolean).join(' • '),
      };
    });
  }, [auditorCandidates]);

  // Options vật tư để tìm kiếm và thêm vào đợt kiểm
  const materialOptions = useMemo(() => {
    const currentCodes = new Set(selectedItems.map((i) => i.code));
    return workspace.materials
      .filter((m) => !currentCodes.has(m.code))
      .map((m) => {
        const bookQty = stockByCodeInSelectedWh.get(m.code) ?? 0;
        return {
          value: m.code,
          label: `${m.code} — ${m.name}`,
          description: `ĐVT: ${m.unit || 'Cái'} • Tồn kho: ${formatNumber(bookQty)} • Loại: ${m.type || 'Chung'}`,
        };
      });
  }, [workspace.materials, selectedItems, stockByCodeInSelectedWh]);

  // Thêm một vật tư vào danh sách kiểm
  const handleAddMaterial = (code: string) => {
    if (!code) return;
    const mat = workspace.materials.find((m) => m.code === code);
    if (!mat) return;
    if (selectedItems.some((i) => i.code === code)) return;

    const item: InventoryItem = {
      code: mat.code,
      name: mat.name,
      kind: 'STOCK',
      unit: mat.unit || 'Cái',
      type: mat.type,
      available: stockByCodeInSelectedWh.get(mat.code) ?? 0,
    };
    setSelectedItems((prev) => [...prev, item]);
    setMaterialToAdd('');
  };

  // Thêm tất cả vật tư có tồn trong kho này vào danh sách
  const handleAddAllItemsInWh = () => {
    const existing = new Set(selectedItems.map((i) => i.code));
    const toAdd: InventoryItem[] = [];
    for (const mat of workspace.materials) {
      const qty = stockByCodeInSelectedWh.get(mat.code) ?? 0;
      if (qty > 0 && !existing.has(mat.code)) {
        toAdd.push({
          code: mat.code,
          name: mat.name,
          kind: 'STOCK',
          unit: mat.unit || 'Cái',
          type: mat.type,
          available: qty,
        });
        existing.add(mat.code);
      }
    }
    if (toAdd.length > 0) {
      setSelectedItems((prev) => [...prev, ...toAdd]);
    }
  };

  // Xoá một vật tư khỏi danh sách kiểm
  const handleRemoveItem = (code: string) => {
    setSelectedItems((prev) => prev.filter((i) => i.code !== code));
  };

  // Bật/tắt chọn nhóm vật tư
  const handleToggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  // Bật/tắt thành viên tổ kiểm kê
  const handleToggleAuditor = (name: string) => {
    setSelectedAuditors((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  // Thêm thành viên ngoài danh bạ
  const handleAddCustomAuditor = (name: string) => {
    const val = name.trim();
    if (val && !selectedAuditors.includes(val) && val !== leadAuditor) {
      setSelectedAuditors((prev) => [...prev, val]);
    }
  };

  // Đổi người phụ trách: nếu người mới đang nằm trong tổ kiểm kê thì rút ra khỏi tổ
  const handleSelectLeadAuditor = (newLead: string) => {
    setLeadAuditor(newLead);
    setSelectedAuditors((prev) => prev.filter((n) => n !== newLead));
  };

  const executeSubmit = async () => {
    if (!title.trim()) {
      setError('Vui lòng nhập tên đợt kiểm kê.');
      return;
    }
    if (!warehouseCode) {
      setError('Vui lòng chọn kho kiểm kê.');
      return;
    }
    if (!leadAuditor.trim()) {
      setError('Vui lòng chọn người phụ trách (Trưởng nhóm kiểm kê).');
      return;
    }
    const leadCandidate = auditorCandidates.find((c) => c.name === leadAuditor.trim());
    if (leadCandidate && !leadCandidate.hasWarehouseAccess) {
      setError('Người phụ trách (Trưởng nhóm) bắt buộc phải là nhân sự có phân quyền kho hoặc vai trò nghiệp vụ kho (inventory.*).');
      return;
    }

    if (scopeType === 'SPECIFIC_ITEMS' && selectedItems.length === 0) {
      setError('Chưa có vật tư nào trong danh sách. Vui lòng thêm vật tư hoặc chọn phạm vi khác.');
      return;
    }

    if (scopeType === 'CATEGORY' && selectedCategories.length === 0) {
      setError('Vui lòng chọn ít nhất một nhóm vật tư cần kiểm kê.');
      return;
    }

    try {
      const specificCodes =
        scopeType === 'SPECIFIC_ITEMS' ? selectedItems.map((i) => i.code) : undefined;

      await onSubmit(
        {
          title: title.trim(),
          warehouseCode,
          stocktakeDate: stocktakeDate || new Date().toISOString().slice(0, 10),
          scopeType,
          scopeCategories: scopeType === 'CATEGORY' ? selectedCategories : undefined,
          specificMaterialCodes: specificCodes,
          leadAuditor: leadAuditor.trim() || undefined,
          auditors: selectedAuditors,
          note: note.trim() || undefined,
        },
        true,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể khởi tạo đợt kiểm kê.');
    }
  };

  const totalSystemQtyInWh = useMemo(() => {
    return selectedItems.reduce(
      (sum, item) => sum + (stockByCodeInSelectedWh.get(item.code) ?? 0),
      0,
    );
  }, [selectedItems, stockByCodeInSelectedWh]);

  return (
    <div
      className="fixed inset-0 z-[1060] flex items-center justify-center bg-slate-900/55 backdrop-blur-[4px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[92vh] w-[740px] max-w-[95vw] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0_20px_40px_-10px_rgba(0,0,0,0.25)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-[22px] py-4">
          <div className="flex items-center gap-[10px]">
            <div className="flex size-9 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600">
              <ClipboardCheck size={20} />
            </div>
            <div>
              <h3 className="m-0 text-base font-bold text-slate-900">Khởi tạo Đợt Kiểm kê Kho</h3>
              <p className="mb-0 mt-0.5 text-[13px] text-slate-500">
                Thiết lập thông tin đợt kiểm đếm và chốt số liệu tồn sổ sách (snapshot) để tiến hành đếm thực tế.
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} className="text-slate-500" title="Đóng">
            <X size={18} />
          </Button>
        </div>

        {/* Form Body with scroll */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void executeSubmit();
          }}
          className="flex flex-col gap-[14px] overflow-y-auto px-[22px] py-5"
        >
          {error ? (
            <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-100 px-[14px] py-[10px] text-[13px] text-red-700">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {/* Hàng 1: Kho kiểm kê & Thời gian kiểm kê */}
          <div className="grid grid-cols-2 gap-[14px]">
            <div className="flex flex-col gap-[5px]">
              <Label required>Kho kiểm kê</Label>
              <SearchableSelect
                options={warehouseOptions}
                value={warehouseCode}
                onChange={setWarehouseCode}
                placeholder="Chọn kho kiểm kê..."
                clearable={false}
              />
            </div>

            <div className="flex flex-col gap-[5px]">
              <Label required className="flex items-center gap-[5px]">
                <Calendar size={14} className="text-blue-600" />
                <span>Thời gian kiểm kê</span>
              </Label>
              <Input
                type="date"
                value={stocktakeDate}
                onChange={(e) => setStocktakeDate(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Hàng 2: Tên đợt kiểm kê (Bỏ mặc định, để trống) */}
          <div className="flex flex-col gap-[5px]">
            <Label required>Tên đợt kiểm kê</Label>
            <Input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nhập tên đợt kiểm kê (VD: Kiểm kê định kỳ Quý IV, Đối soát đột xuất kho phụ tùng...)"
              required
            />
          </div>

          {/* Hàng 3: Thẻ lựa chọn Phạm vi kiểm kê linh hoạt */}
          <div className="flex flex-col gap-1.5">
            <Label>Phạm vi kiểm đếm</Label>
            <div className="grid grid-cols-3 gap-[10px]">
              <button
                type="button"
                onClick={() => setScopeType('ALL')}
                className={cn(
                  'cursor-pointer rounded-lg px-3 py-[10px] text-left text-[13px] font-semibold transition-all',
                  scopeType === 'ALL'
                    ? 'border-2 border-blue-600 bg-blue-50 text-blue-700'
                    : 'border border-slate-300 bg-white text-slate-600',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Layers size={15} className={scopeType === 'ALL' ? 'text-blue-600' : 'text-slate-500'} />
                  <span>Toàn bộ kho</span>
                </div>
                <span className="mt-[3px] block text-xs font-normal text-slate-500">
                  Đối soát tất cả mặt hàng có tồn
                </span>
              </button>

              <button
                type="button"
                onClick={() => setScopeType('CATEGORY')}
                className={cn(
                  'cursor-pointer rounded-lg px-3 py-[10px] text-left text-[13px] font-semibold transition-all',
                  scopeType === 'CATEGORY'
                    ? 'border-2 border-blue-600 bg-blue-50 text-blue-700'
                    : 'border border-slate-300 bg-white text-slate-600',
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Package size={15} className={scopeType === 'CATEGORY' ? 'text-blue-600' : 'text-slate-500'} />
                    <span>Theo nhóm vật tư</span>
                  </div>
                  {selectedCategories.length > 0 ? (
                    <span className="rounded-[10px] bg-blue-600 px-1.5 py-px text-[11px] font-bold text-white">
                      {selectedCategories.length}
                    </span>
                  ) : null}
                </div>
                <span className="mt-[3px] block text-xs font-normal text-slate-500">
                  Chọn một hoặc nhiều phân loại
                </span>
              </button>

              <button
                type="button"
                onClick={() => setScopeType('SPECIFIC_ITEMS')}
                className={cn(
                  'cursor-pointer rounded-lg px-3 py-[10px] text-left text-[13px] font-semibold transition-all',
                  scopeType === 'SPECIFIC_ITEMS'
                    ? 'border-2 border-blue-600 bg-blue-50 text-blue-700'
                    : 'border border-slate-300 bg-white text-slate-600',
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <ClipboardCheck
                      size={15}
                      className={scopeType === 'SPECIFIC_ITEMS' ? 'text-blue-600' : 'text-slate-500'}
                    />
                    <span>Vật tư cụ thể</span>
                  </div>
                  {selectedItems.length > 0 ? (
                    <span
                      className={cn(
                        'rounded-[10px] px-1.5 py-px text-[11px] font-bold text-white',
                        scopeType === 'SPECIFIC_ITEMS' ? 'bg-blue-600' : 'bg-slate-400',
                      )}
                    >
                      {selectedItems.length}
                    </span>
                  ) : null}
                </div>
                <span className="mt-[3px] block text-xs font-normal text-slate-500">
                  Chọn danh mục mặt hàng tuỳ ý
                </span>
              </button>
            </div>
          </div>

          {/* Chi tiết phạm vi: ALL */}
          {scopeType === 'ALL' ? (
            <div className="flex items-center gap-[10px] rounded-lg border border-slate-200 bg-slate-50 px-[14px] py-[10px] text-[12.5px] text-slate-600">
              <Info size={16} className="shrink-0 text-blue-600" />
              <span>
                Hệ thống sẽ lấy toàn bộ mặt hàng có ghi nhận số dư tồn kho tại <strong>{warehouseCode}</strong> khi bắt đầu kiểm đếm.
              </span>
            </div>
          ) : null}

          {/* Chi tiết phạm vi: CATEGORY (Chọn nhiều nhóm linh hoạt) */}
          {scopeType === 'CATEGORY' ? (
            <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-[14px] py-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-slate-700">
                  Chọn các nhóm vật tư cần kiểm ({selectedCategories.length}/{categoryOptions.length} nhóm)
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={() => setSelectedCategories(categoryOptions.map((c) => c.value))}
                    className="font-semibold"
                  >
                    Chọn tất cả
                  </Button>
                  <span className="text-slate-300">•</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setSelectedCategories([])}
                    className="text-slate-500"
                  >
                    Bỏ chọn
                  </Button>
                </div>
              </div>

              <div className="mt-0.5 flex flex-wrap gap-2">
                {categoryOptions.map((cat) => {
                  const isSelected = selectedCategories.includes(cat.value);
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => handleToggleCategory(cat.value)}
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-1.5 rounded-[20px] border px-3 py-1.5 text-[12.5px] transition-all',
                        isSelected
                          ? 'border-blue-600 bg-blue-50 font-semibold text-blue-700'
                          : 'border-slate-300 bg-white font-medium text-slate-700',
                      )}
                    >
                      {isSelected ? <Check size={13} className="text-blue-600" /> : null}
                      <span>{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Chi tiết phạm vi: SPECIFIC_ITEMS (Tìm kiếm, thêm bớt vật tư trực tiếp) */}
          {scopeType === 'SPECIFIC_ITEMS' ? (
            <div className="flex flex-col gap-[10px] rounded-lg border border-slate-200 bg-slate-50 px-[14px] py-3">
              {/* Thanh tìm kiếm & thêm vật tư vào đợt kiểm */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-[5px]">
                    <Plus size={14} className="text-blue-600" />
                    <span>Thêm vật tư vào đợt kiểm</span>
                  </Label>
                  <div className="flex items-center gap-[10px]">
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      onClick={handleAddAllItemsInWh}
                      className="font-semibold"
                    >
                      + Thêm tất cả vật tư có tồn trong kho này
                    </Button>
                    {selectedItems.length > 0 ? (
                      <>
                        <span className="text-slate-300">•</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setSelectedItems([])}
                          className="text-red-600"
                        >
                          Xoá danh sách
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <SearchableSelect
                    options={materialOptions}
                    value={materialToAdd}
                    onChange={(val) => {
                      setMaterialToAdd(val);
                      if (val) handleAddMaterial(val);
                    }}
                    placeholder="Tìm theo mã hoặc tên vật tư để thêm vào đợt kiểm..."
                    clearable
                  />
                  <Button
                    type="button"
                    size="lg"
                    onClick={() => handleAddMaterial(materialToAdd)}
                    disabled={!materialToAdd}
                    className="px-3.5 text-[13px] font-semibold"
                  >
                    <Plus size={15} />
                    <span>Thêm</span>
                  </Button>
                </div>
              </div>

              {/* Bảng xem trước danh sách vật tư đã chọn */}
              <div className="flex items-center justify-between text-[12.5px] text-slate-600">
                <span>
                  Danh sách vật tư sẽ kiểm đếm (<strong>{selectedItems.length}</strong> mặt hàng)
                </span>
                <span>
                  Tổng tồn sổ sách: <strong className="text-slate-900">{formatNumber(totalSystemQtyInWh)}</strong>
                </span>
              </div>

              <TableWrap className="max-h-[160px] rounded-md border border-slate-300 bg-white">
                <Table className="text-[12.5px]">
                  <TableHead>
                    <tr className="border-b border-slate-300 bg-slate-100 text-left text-slate-600">
                      <TableHeaderCell className="w-[35px] px-2 py-1.5 text-center">STT</TableHeaderCell>
                      <TableHeaderCell className="px-2 py-1.5">Mã &amp; Tên hàng</TableHeaderCell>
                      <TableHeaderCell className="w-[60px] px-2 py-1.5 text-center">ĐVT</TableHeaderCell>
                      <TableHeaderCell className="w-[110px] px-2 py-1.5 text-right">Tồn sổ sách</TableHeaderCell>
                      <TableHeaderCell className="w-[40px] px-2 py-1.5 text-center">Xoá</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {selectedItems.map((item, idx) => {
                      const bookQty = stockByCodeInSelectedWh.get(item.code) ?? 0;
                      return (
                        <TableRow key={item.code}>
                          <TableCell className="px-2 py-1.5 text-center text-slate-500">{idx + 1}</TableCell>
                          <TableCell className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-blue-600">{item.code}</span>
                              <span className="text-slate-300">—</span>
                              <span className="font-semibold text-slate-800">{item.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-center text-slate-600">{item.unit || 'Cái'}</TableCell>
                          <TableCell className="px-2 py-1.5 text-right font-semibold text-slate-900">
                            {formatNumber(bookQty)}
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => handleRemoveItem(item.code)}
                              className="text-slate-400"
                              title="Loại khỏi đợt kiểm"
                            >
                              <Trash2 size={14} />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {selectedItems.length === 0 ? (
                      <TableEmpty colSpan={5}>
                        Chưa có vật tư nào được chọn. Hãy tìm kiếm và thêm ở ô phía trên.
                      </TableEmpty>
                    ) : null}
                  </TableBody>
                </Table>
              </TableWrap>
            </div>
          ) : null}

          {/* Hàng 4: Người phụ trách & Ghi chú đợt kiểm kê */}
          <div className="grid grid-cols-2 gap-[14px]">
            <div className="flex flex-col gap-[5px]">
              <Label required className="flex items-center gap-[5px]">
                <UserCheck size={14} className="text-blue-600" />
                <span>Người phụ trách (Trưởng nhóm)</span>
              </Label>
              <SearchableSelect
                options={leadAuditorOptions}
                value={leadAuditor}
                onChange={handleSelectLeadAuditor}
                placeholder="Chọn nhân sự phụ trách có quyền kho..."
                clearable={true}
              />
            </div>

            <div className="flex flex-col gap-[5px]">
              <Label>Mục đích &amp; Ghi chú đợt kiểm kê</Label>
              <Input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="VD: Kiểm kê định kỳ, đối soát đột xuất, hao hụt..."
              />
            </div>
          </div>

          {/* Hàng 5: Tổ kiểm kê tham gia (Thiết kế chuẩn form tạo nhóm chat) */}
          <AuditorPicker
            candidates={auditorCandidates}
            selectedNames={selectedAuditors}
            onToggleName={handleToggleAuditor}
            leadAuditorName={leadAuditor}
            onAddCustomName={handleAddCustomAuditor}
          />

          {/* Ghi chú thông báo về Snapshot và kiểm đếm ngay */}
          <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-[14px] py-[10px] text-[12.5px] leading-normal text-blue-800">
            <Info size={16} className="shrink-0 text-blue-600" />
            <span>
              Hệ thống sẽ <strong>chốt tồn sổ sách (snapshot)</strong> tại kho ngay khi tạo và chuyển thẳng sang bảng nhập kết quả kiểm đếm thực tế.
            </span>
          </div>

          {/* Footer Actions */}
          <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Huỷ
            </Button>

            <Button
              type="submit"
              disabled={busy}
              className="font-bold"
              title="Chốt tồn sổ sách (snapshot) và chuyển sang bảng kiểm đếm thực tế ngay"
            >
              <Play size={15} />
              <span>{busy ? 'Đang khởi tạo...' : 'Bắt đầu kiểm đếm'}</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
