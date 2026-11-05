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
import styles from '../inventory.module.scss';

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
        className={styles.stocktakePickRow}
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
          className={
            isLead
              ? `${styles.stocktakePickCheck} ${styles.stocktakePickCheckLead}`
              : isSelected
              ? `${styles.stocktakePickCheck} ${styles.stocktakePickCheckOn}`
              : styles.stocktakePickCheck
          }
          aria-hidden="true"
        >
          {isLead ? <UserCheck size={12} /> : isSelected ? <Check size={12} /> : null}
        </span>

        <span className={styles.stocktakePickAvatar}>{getInitials(c.name)}</span>

        <div className={styles.stocktakePickInfo}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className={styles.stocktakePickName}>{c.name}</span>
            {c.code ? (
              <small style={{ color: '#94a3b8', fontFamily: 'monospace' }}>({c.code})</small>
            ) : null}
            {isLead ? (
              <span className={styles.stocktakeLeadBadge}>Trưởng nhóm</span>
            ) : null}
            {c.hasWarehouseAccess ? (
              <span className={styles.stocktakeWhBadge}>
                <ShieldCheck size={11} /> Có quyền kho
              </span>
            ) : null}
          </div>
          <small className={styles.stocktakePickDetail}>
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
    <div className={styles.stocktakePickerSection}>
      <div className={styles.stocktakeFieldHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Users size={15} style={{ color: '#2563eb' }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            Thành viên tham gia kiểm kê
          </span>
        </div>
        <span
          className={
            selectedNames.length > 0
              ? styles.stocktakePickerBadge
              : styles.stocktakePickerHint
          }
        >
          {selectedNames.length > 0
            ? `Đã chọn ${selectedNames.length} thành viên`
            : 'Chọn thêm thành viên tổ kiểm (không bắt buộc)'}
        </span>
      </div>

      {/* Danh sách thành viên đã chọn hiển thị dạng Chips (giống tạo nhóm chat) */}
      {selectedNames.length > 0 ? (
        <div className={styles.stocktakeChips} aria-label="Thành viên đã chọn">
          {selectedNames.map((name) => {
            const candidate = candidates.find((c) => c.name === name);
            const isWh = candidate?.hasWarehouseAccess;
            return (
              <span key={name} className={styles.stocktakeChip}>
                <span className={styles.stocktakeChipAvatar}>{getInitials(name)}</span>
                <span
                  className={styles.chipLabel}
                  title={candidate?.position ? `${name} (${candidate.position})` : name}
                >
                  {name}
                </span>
                {isWh ? (
                  <span title="Có quyền kho" style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <ShieldCheck size={12} style={{ color: '#16a34a', flexShrink: 0 }} />
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={`Bỏ ${name}`}
                  title={`Bỏ ${name}`}
                  onClick={() => onToggleName(name)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      {/* Thanh tìm kiếm nhân sự */}
      <div className={styles.stocktakePickerSearch}>
        <Search size={16} aria-hidden="true" />
        <input
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
            className={styles.stocktakePickerSearchClear}
            onClick={() => setQuery('')}
            aria-label="Xoá tìm kiếm"
            title="Xoá tìm kiếm"
          >
            <X size={12} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Danh sách chọn nhân sự chia thành 2 khu vực rõ ràng */}
      <div className={styles.stocktakePickList} role="listbox" aria-multiselectable="true">
        {totalVisibleCount === 0 && !query.trim() ? (
          <p
            style={{
              margin: 0,
              padding: '16px',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '13px',
            }}
          >
            Không có nhân sự nào trong danh sách.
          </p>
        ) : null}

        {totalVisibleCount === 0 && query.trim() ? (
          <p
            style={{
              margin: 0,
              padding: '12px 16px',
              textAlign: 'center',
              color: '#64748b',
              fontSize: '12.5px',
            }}
          >
            Không tìm thấy nhân sự phù hợp với từ khoá "{query}".
          </p>
        ) : null}

        {/* Khu 1: Nhân sự có nhiệm vụ trong kho hoặc có quyền inventory.* */}
        {warehouseGroup.length > 0 ? (
          <>
            <div className={styles.stocktakeGroupHeader}>
              <div className={styles.stocktakeGroupTitle}>
                <ShieldCheck size={13} style={{ color: '#16a34a' }} />
                <span>Khu 1: Có nhiệm vụ / quyền kho (inventory.*)</span>
              </div>
              <span className={`${styles.stocktakeGroupBadge} ${styles.stocktakeGroupBadgeWh}`}>
                {warehouseGroup.length} nhân sự
              </span>
            </div>
            {warehouseGroup.map(renderAuditorRow)}
          </>
        ) : null}

        {/* Khu 2: Nhân sự ngoài thẩm quyền kho */}
        {externalGroup.length > 0 ? (
          <>
            <div className={styles.stocktakeGroupHeader}>
              <div className={styles.stocktakeGroupTitle}>
                <Users size={13} style={{ color: '#64748b' }} />
                <span>Khu 2: Người ngoài thẩm quyền kho</span>
              </div>
              <span className={styles.stocktakeGroupBadge}>
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
            className={styles.stocktakeAddCustomRow}
            onClick={() => {
              onAddCustomName(query.trim());
              setQuery('');
            }}
          >
            <Plus size={14} style={{ color: '#16a34a' }} />
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
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(4px)',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          width: '740px',
          maxWidth: '95vw',
          maxHeight: '92vh',
          background: '#ffffff',
          borderRadius: '10px',
          boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 22px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#2563eb',
              }}
            >
              <ClipboardCheck size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                Khởi tạo Đợt Kiểm kê Kho
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
                Thiết lập thông tin đợt kiểm đếm và chốt số liệu tồn sổ sách (snapshot) để tiến hành đếm thực tế.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: '32px',
              height: '32px',
              border: 'none',
              borderRadius: '6px',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748b',
            }}
            title="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body with scroll */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void executeSubmit();
          }}
          style={{
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            overflowY: 'auto',
          }}
        >
          {error ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 14px',
                background: '#fee2e2',
                border: '1px solid #fca5a5',
                borderRadius: '6px',
                color: '#b91c1c',
                fontSize: '13px',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          ) : null}

          {/* Hàng 1: Kho kiểm kê & Thời gian kiểm kê */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                Kho kiểm kê <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <SearchableSelect
                options={warehouseOptions}
                value={warehouseCode}
                onChange={setWarehouseCode}
                placeholder="Chọn kho kiểm kê..."
                clearable={false}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Calendar size={14} style={{ color: '#2563eb' }} />
                <span>Thời gian kiểm kê</span> <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                type="date"
                value={stocktakeDate}
                onChange={(e) => setStocktakeDate(e.target.value)}
                style={{
                  height: '38px',
                  padding: '8px 12px',
                  fontSize: '13.5px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  color: '#1e293b',
                  fontFamily: 'inherit',
                }}
                required
              />
            </div>
          </div>

          {/* Hàng 2: Tên đợt kiểm kê (Bỏ mặc định, để trống) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              Tên đợt kiểm kê <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nhập tên đợt kiểm kê (VD: Kiểm kê định kỳ Quý IV, Đối soát đột xuất kho phụ tùng...)"
              style={{
                height: '38px',
                padding: '8px 12px',
                fontSize: '13.5px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              required
            />
          </div>

          {/* Hàng 3: Thẻ lựa chọn Phạm vi kiểm kê linh hoạt */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              Phạm vi kiểm đếm
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '10px',
              }}
            >
              <button
                type="button"
                onClick={() => setScopeType('ALL')}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: scopeType === 'ALL' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                  background: scopeType === 'ALL' ? '#eff6ff' : '#ffffff',
                  color: scopeType === 'ALL' ? '#1d4ed8' : '#475569',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '13px',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Layers size={15} style={{ color: scopeType === 'ALL' ? '#2563eb' : '#64748b' }} />
                  <span>Toàn bộ kho</span>
                </div>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 400, marginTop: '3px', display: 'block' }}>
                  Đối soát tất cả mặt hàng có tồn
                </span>
              </button>

              <button
                type="button"
                onClick={() => setScopeType('CATEGORY')}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border:
                    scopeType === 'CATEGORY' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                  background: scopeType === 'CATEGORY' ? '#eff6ff' : '#ffffff',
                  color: scopeType === 'CATEGORY' ? '#1d4ed8' : '#475569',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '13px',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Package size={15} style={{ color: scopeType === 'CATEGORY' ? '#2563eb' : '#64748b' }} />
                    <span>Theo nhóm vật tư</span>
                  </div>
                  {selectedCategories.length > 0 ? (
                    <span
                      style={{
                        fontSize: '11px',
                        background: '#2563eb',
                        color: '#ffffff',
                        padding: '1px 6px',
                        borderRadius: '10px',
                        fontWeight: 700,
                      }}
                    >
                      {selectedCategories.length}
                    </span>
                  ) : null}
                </div>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 400, marginTop: '3px', display: 'block' }}>
                  Chọn một hoặc nhiều phân loại
                </span>
              </button>

              <button
                type="button"
                onClick={() => setScopeType('SPECIFIC_ITEMS')}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border:
                    scopeType === 'SPECIFIC_ITEMS'
                      ? '2px solid #2563eb'
                      : '1px solid #cbd5e1',
                  background: scopeType === 'SPECIFIC_ITEMS' ? '#eff6ff' : '#ffffff',
                  color: scopeType === 'SPECIFIC_ITEMS' ? '#1d4ed8' : '#475569',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '13px',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ClipboardCheck size={15} style={{ color: scopeType === 'SPECIFIC_ITEMS' ? '#2563eb' : '#64748b' }} />
                    <span>Vật tư cụ thể</span>
                  </div>
                  {selectedItems.length > 0 ? (
                    <span
                      style={{
                        fontSize: '11px',
                        background: scopeType === 'SPECIFIC_ITEMS' ? '#2563eb' : '#94a3b8',
                        color: '#ffffff',
                        padding: '1px 6px',
                        borderRadius: '10px',
                        fontWeight: 700,
                      }}
                    >
                      {selectedItems.length}
                    </span>
                  ) : null}
                </div>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 400, marginTop: '3px', display: 'block' }}>
                  Chọn danh mục mặt hàng tuỳ ý
                </span>
              </button>
            </div>
          </div>

          {/* Chi tiết phạm vi: ALL */}
          {scopeType === 'ALL' ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 14px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '12.5px',
                color: '#475569',
              }}
            >
              <Info size={16} style={{ color: '#2563eb', flexShrink: 0 }} />
              <span>
                Hệ thống sẽ lấy toàn bộ mặt hàng có ghi nhận số dư tồn kho tại <strong>{warehouseCode}</strong> khi bắt đầu kiểm đếm.
              </span>
            </div>
          ) : null}

          {/* Chi tiết phạm vi: CATEGORY (Chọn nhiều nhóm linh hoạt) */}
          {scopeType === 'CATEGORY' ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px 14px',
                background: '#f8fafc',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Chọn các nhóm vật tư cần kiểm ({selectedCategories.length}/{categoryOptions.length} nhóm)
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedCategories(categoryOptions.map((c) => c.value))}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#2563eb',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: '2px 4px',
                    }}
                  >
                    Chọn tất cả
                  </button>
                  <span style={{ color: '#cbd5e1' }}>•</span>
                  <button
                    type="button"
                    onClick={() => setSelectedCategories([])}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#64748b',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      padding: '2px 4px',
                    }}
                  >
                    Bỏ chọn
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '2px' }}>
                {categoryOptions.map((cat) => {
                  const isSelected = selectedCategories.includes(cat.value);
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => handleToggleCategory(cat.value)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '20px',
                        border: isSelected ? '1px solid #2563eb' : '1px solid #cbd5e1',
                        background: isSelected ? '#eff6ff' : '#ffffff',
                        color: isSelected ? '#1d4ed8' : '#334155',
                        fontSize: '12.5px',
                        fontWeight: isSelected ? 600 : 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isSelected ? <Check size={13} style={{ color: '#2563eb' }} /> : null}
                      <span>{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Chi tiết phạm vi: SPECIFIC_ITEMS (Tìm kiếm, thêm bớt vật tư trực tiếp) */}
          {scopeType === 'SPECIFIC_ITEMS' ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px 14px',
                background: '#f8fafc',
              }}
            >
              {/* Thanh tìm kiếm & thêm vật tư vào đợt kiểm */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Plus size={14} style={{ color: '#2563eb' }} />
                    <span>Thêm vật tư vào đợt kiểm</span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                      type="button"
                      onClick={handleAddAllItemsInWh}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#2563eb',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: '2px 4px',
                      }}
                    >
                      + Thêm tất cả vật tư có tồn trong kho này
                    </button>
                    {selectedItems.length > 0 ? (
                      <>
                        <span style={{ color: '#cbd5e1' }}>•</span>
                        <button
                          type="button"
                          onClick={() => setSelectedItems([])}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#dc2626',
                            fontSize: '12px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            padding: '2px 4px',
                          }}
                        >
                          Xoá danh sách
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px' }}>
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
                  <button
                    type="button"
                    onClick={() => handleAddMaterial(materialToAdd)}
                    disabled={!materialToAdd}
                    style={{
                      height: '38px',
                      padding: '0 14px',
                      fontSize: '13px',
                      fontWeight: 600,
                      background: materialToAdd ? '#2563eb' : '#e2e8f0',
                      color: materialToAdd ? '#ffffff' : '#94a3b8',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: materialToAdd ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Plus size={15} />
                    <span>Thêm</span>
                  </button>
                </div>
              </div>

              {/* Bảng xem trước danh sách vật tư đã chọn */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '12.5px',
                  color: '#475569',
                }}
              >
                <span>
                  Danh sách vật tư sẽ kiểm đếm (<strong>{selectedItems.length}</strong> mặt hàng)
                </span>
                <span>
                  Tổng tồn sổ sách: <strong style={{ color: '#0f172a' }}>{formatNumber(totalSystemQtyInWh)}</strong>
                </span>
              </div>

              <div
                style={{
                  maxHeight: '160px',
                  overflowY: 'auto',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  background: '#ffffff',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', textAlign: 'left', color: '#475569' }}>
                      <th style={{ padding: '6px 8px', width: '35px', textAlign: 'center' }}>STT</th>
                      <th style={{ padding: '6px 8px' }}>Mã &amp; Tên hàng</th>
                      <th style={{ padding: '6px 8px', width: '60px', textAlign: 'center' }}>ĐVT</th>
                      <th style={{ padding: '6px 8px', width: '110px', textAlign: 'right' }}>Tồn sổ sách</th>
                      <th style={{ padding: '6px 8px', width: '40px', textAlign: 'center' }}>Xoá</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedItems.map((item, idx) => {
                      const bookQty = stockByCodeInSelectedWh.get(item.code) ?? 0;
                      return (
                        <tr
                          key={item.code}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                          }}
                        >
                          <td style={{ padding: '6px 8px', textAlign: 'center', color: '#64748b' }}>
                            {idx + 1}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: 700, color: '#2563eb', fontFamily: 'monospace' }}>
                                {item.code}
                              </span>
                              <span style={{ color: '#cbd5e1' }}>—</span>
                              <span style={{ fontWeight: 600, color: '#1e293b' }}>
                                {item.name}
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', color: '#475569' }}>
                            {item.unit || 'Cái'}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                            {formatNumber(bookQty)}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(item.code)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#94a3b8',
                                cursor: 'pointer',
                                padding: '2px',
                              }}
                              title="Loại khỏi đợt kiểm"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                    {selectedItems.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '22px', textAlign: 'center', color: '#94a3b8' }}>
                          Chưa có vật tư nào được chọn. Hãy tìm kiếm và thêm ở ô phía trên.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Hàng 4: Người phụ trách & Ghi chú đợt kiểm kê */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <UserCheck size={14} style={{ color: '#2563eb' }} />
                <span>Người phụ trách (Trưởng nhóm)</span> <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <SearchableSelect
                options={leadAuditorOptions}
                value={leadAuditor}
                onChange={handleSelectLeadAuditor}
                placeholder="Chọn nhân sự phụ trách có quyền kho..."
                clearable={true}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                Mục đích &amp; Ghi chú đợt kiểm kê
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="VD: Kiểm kê định kỳ, đối soát đột xuất, hao hụt..."
                style={{
                  height: '38px',
                  padding: '8px 12px',
                  fontSize: '13.5px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
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
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '6px',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12.5px',
              color: '#1e40af',
              lineHeight: 1.5,
            }}
          >
            <Info size={16} style={{ color: '#2563eb', flexShrink: 0 }} />
            <span>
              Hệ thống sẽ <strong>chốt tồn sổ sách (snapshot)</strong> tại kho ngay khi tạo và chuyển thẳng sang bảng nhập kết quả kiểm đếm thực tế.
            </span>
          </div>

          {/* Footer Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: '4px',
              paddingTop: '16px',
              borderTop: '1px solid #e2e8f0',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{
                padding: '8px 18px',
                fontSize: '13.5px',
                fontWeight: 600,
                background: 'transparent',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                color: '#475569',
                cursor: 'pointer',
              }}
            >
              Huỷ
            </button>

            <button
              type="submit"
              disabled={busy}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 24px',
                fontSize: '13.5px',
                fontWeight: 700,
                background: '#2563eb',
                border: 'none',
                borderRadius: '6px',
                color: '#ffffff',
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)',
              }}
              title="Chốt tồn sổ sách (snapshot) và chuyển sang bảng kiểm đếm thực tế ngay"
            >
              <Play size={15} />
              <span>{busy ? 'Đang khởi tạo...' : 'Bắt đầu kiểm đếm'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
