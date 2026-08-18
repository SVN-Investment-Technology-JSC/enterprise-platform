'use client';
import type { AssetStatusDto, AssetSummaryDto } from '@enterprise-platform/contract-inventory';
import { useMemo, useRef, useState } from 'react';
import styles from './asset-tree-explorer.module.css';

export interface HierarchyTypeDefinition {
  code: string;
  label: string;
  icon: string;
  defaultChildType?: string;
  description: string;
}

export const HIERARCHY_TYPES: HierarchyTypeDefinition[] = [
  { code: 'PLANT', label: 'Nhà máy / Dự án', icon: '🏭', defaultChildType: 'AREA', description: 'Cấp cao nhất của nhà máy / cụm công trình' },
  { code: 'AREA', label: 'Phân xưởng / Khu vực', icon: '🏢', defaultChildType: 'SYSTEM', description: 'Khu vực, gian máy, trạm hoặc phân xưởng' },
  { code: 'SYSTEM', label: 'Hệ thống chính', icon: '⚙️', defaultChildType: 'SUBSYSTEM', description: 'Hệ thống công nghệ (VD: Thủy lực, Điện, Điều tốc)' },
  { code: 'SUBSYSTEM', label: 'Phân hệ / Hệ phụ', icon: '🔧', defaultChildType: 'EQUIPMENT', description: 'Phân hệ hoặc mạch chức năng trong hệ thống' },
  { code: 'EQUIPMENT', label: 'Thiết bị / Máy móc', icon: '🔌', defaultChildType: 'ASSEMBLY', description: 'Thiết bị máy móc độc lập (VD: Máy phát, Tuabin, MBA)' },
  { code: 'ASSEMBLY', label: 'Cụm thiết bị / Cụm chi tiết', icon: '📦', defaultChildType: 'COMPONENT', description: 'Cụm bộ phận hợp thành (VD: Cụm van đón nước, Cụm gối trục)' },
  { code: 'COMPONENT', label: 'Chi tiết / Bộ phận', icon: '🧩', defaultChildType: 'PART', description: 'Chi tiết bộ phận kỹ thuật (VD: Cánh tuabin, Stator, Bạc trục)' },
  { code: 'PART', label: 'Phụ tùng / Vật tư tiêu hao', icon: '🔩', defaultChildType: 'PART', description: 'Phụ tùng thay thế, gioăng phớt, bu lông' },
];

const typeMap: Record<string, HierarchyTypeDefinition> = Object.fromEntries(
  HIERARCHY_TYPES.map(t => [t.code, t])
);

export function getTypeLabel(type: string): string {
  return typeMap[type]?.label ?? type;
}

export function getTypeIcon(type: string): string {
  return typeMap[type]?.icon ?? '🔹';
}

export function getChildActionLabel(parent?: AssetSummaryDto): string {
  if (!parent) return '+ Thêm cấp con';
  const def = typeMap[parent.type];
  if (def?.defaultChildType && typeMap[def.defaultChildType]) {
    return `+ Thêm ${typeMap[def.defaultChildType].label.split('/')[0].trim()}`;
  }
  return `+ Thêm cấp con cho ${parent.name}`;
}

export interface SpecField {
  id: string;
  key: string;
  value: string;
}

function objectToSpecFields(obj?: Record<string, unknown>): SpecField[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.entries(obj)
    .filter(([k]) => !k.startsWith('_'))
    .map(([key, val], idx) => ({
      id: `spec-${idx}-${Date.now()}`,
      key,
      value: typeof val === 'string' ? val : JSON.stringify(val)
    }));
}

function specFieldsToObject(fields: SpecField[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const k = field.key.trim();
    if (k) {
      result[k] = field.value;
    }
  }
  return result;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/pdf';
  const byteString = atob(parts[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mime });
}

const COMMON_SPEC_SUGGESTIONS = [
  'Công suất',
  'Hãng sản xuất',
  'Model / Kiểu',
  'Điện áp định mức',
  'Dòng điện định mức',
  'Áp lực làm việc',
  'Lưu lượng định mức',
  'Năm sản xuất',
  'Xuất xứ',
  'Vật liệu chế tạo',
  'Kích thước / Quy cách'
];

export const DEFAULT_ASSET_STATUSES: AssetStatusDto[] = [
  { code: 'OPERATING', name: 'OPERATING (Đang chạy)', badgeLabel: 'Đang chạy', color: '#10b981', isSystem: true },
  { code: 'TESTING', name: 'TESTING (Đang thí nghiệm)', badgeLabel: 'Đang thí nghiệm', color: '#0284c7', isSystem: true },
  { code: 'COMMISSIONING', name: 'COMMISSIONING (Chạy thử nghiệm thu)', badgeLabel: 'Chạy thử nghiệm thu', color: '#06b6d4', isSystem: true },
  { code: 'MAINTENANCE', name: 'MAINTENANCE (Bảo trì)', badgeLabel: 'Bảo trì', color: '#f59e0b', isSystem: true },
  { code: 'STOPPED', name: 'STOPPED (Dừng sự cố)', badgeLabel: 'Dừng sự cố', color: '#ef4444', isSystem: true },
  { code: 'STORAGE', name: 'STORAGE (Lưu kho / Dự phòng)', badgeLabel: 'Lưu kho', color: '#6b7280', isSystem: true },
];

export function AssetTreeExplorer({
  assets: initialAssets,
  assetStatuses: initialStatuses,
}: {
  assets: AssetSummaryDto[];
  assetStatuses?: AssetStatusDto[];
}) {
  const [assets, setAssets] = useState<AssetSummaryDto[]>(initialAssets);
  const [statuses, setStatuses] = useState<AssetStatusDto[]>(() => {
    if (initialStatuses && initialStatuses.length > 0) return initialStatuses;
    return DEFAULT_ASSET_STATUSES;
  });
  const [selectedId, setSelectedId] = useState(assets[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'timeline' | 'procedures'>('overview');
  
  // Expanded nodes state in Tree
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(initialAssets.map(x => x.id)));

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditSpecsModal, setShowEditSpecsModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAddStatusModal, setShowAddStatusModal] = useState(false);
  const [newStatusForm, setNewStatusForm] = useState({
    code: '',
    name: '',
    badgeLabel: '',
    color: '#8b5cf6',
  });
  const [creatingStatus, setCreatingStatus] = useState(false);

  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteAcknowledge, setDeleteAcknowledge] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Target parent for addition
  const [addParentTarget, setAddParentTarget] = useState<AssetSummaryDto | undefined>(undefined);

  const selected = assets.find(x => x.id === selectedId) ?? assets[0];

  const getStatusObj = (statusStr?: string) => {
    const s = statusStr?.toUpperCase() || '';
    return (
      statuses.find((x) => x.code.toUpperCase() === s) || {
        code: s,
        name: statusStr || 'OPERATING',
        badgeLabel: statusStr || 'Đang chạy',
        color: '#10b981',
      }
    );
  };

  const getDescendantCount = (nodeId: string): number => {
    const directChildren = assets.filter(a => a.parentId === nodeId);
    return directChildren.length + directChildren.reduce((sum, c) => sum + getDescendantCount(c.id), 0);
  };

  const handleOpenDeleteModal = () => {
    setDeleteStep(1);
    setDeleteConfirmInput('');
    setDeleteAcknowledge(false);
    setShowDeleteModal(true);
  };

  const handleDeleteAsset = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/inventory/v1/assets/${selected.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await apiError(res, 'Không thể xóa tài sản.'));
      const { deletedIds } = (await res.json()) as { deletedIds: string[] };
      const deletedSet = new Set(deletedIds || [selected.id]);
      const remaining = assets.filter((a) => !deletedSet.has(a.id));
      setAssets(remaining);
      const nextSelected =
        selected.parentId && remaining.some((a) => a.id === selected.parentId)
          ? selected.parentId
          : remaining[0]?.id ?? '';
      setSelectedId(nextSelected);
      setShowDeleteModal(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Lỗi xóa tài sản');
    } finally {
      setDeleting(false);
    }
  };

  // Forms
  const [newAsset, setNewAsset] = useState({
    code: '',
    name: '',
    type: 'PLANT',
    customType: '',
    criticality: 'MEDIUM' as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
    serialNumber: '',
  });
  const [newAssetSpecs, setNewAssetSpecs] = useState<SpecField[]>([
    { id: '1', key: 'Công suất', value: '50MW' },
    { id: '2', key: 'Hãng sản xuất', value: 'Andritz' }
  ]);
  const [newAssetRawJsonMode, setNewAssetRawJsonMode] = useState(false);
  const [newAssetRawJson, setNewAssetRawJson] = useState('{}');

  const [editSpecs, setEditSpecs] = useState({
    status: selected?.status ?? 'OPERATING',
    criticality: selected?.criticality ?? 'MEDIUM'
  });
  const [editSpecsFields, setEditSpecsFields] = useState<SpecField[]>([]);
  const [editSpecsRawJsonMode, setEditSpecsRawJsonMode] = useState(false);
  const [editSpecsRawJson, setEditSpecsRawJson] = useState('{}');

  const [newDoc, setNewDoc] = useState({
    title: '',
    docType: 'manual' as 'manual' | 'cocq' | 'test_report' | 'drawing' | 'procedure',
    fileName: '',
    fileUrl: '',
    fileSize: '1.0 MB'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);
  const [useManualUrl, setUseManualUrl] = useState(false);

  const handleCreateCustomStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStatusForm.code.trim() || !newStatusForm.name.trim()) return;
    setCreatingStatus(true);
    setFormError('');
    try {
      const res = await fetch('/api/inventory/v1/asset-statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newStatusForm),
      });
      if (!res.ok) throw new Error(await apiError(res, 'Không thể tạo trạng thái mới.'));
      const created = (await res.json()) as AssetStatusDto;
      setStatuses((prev) => [...prev.filter((s) => s.code !== created.code), created]);
      setEditSpecs((prev) => ({ ...prev, status: created.code }));
      setShowAddStatusModal(false);
      setNewStatusForm({ code: '', name: '', badgeLabel: '', color: '#8b5cf6' });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Lỗi tạo trạng thái');
    } finally {
      setCreatingStatus(false);
    }
  };

  const handlePdfFileSelect = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setFormError('Vui lòng chỉ chọn tệp có định dạng PDF (.pdf).');
      return;
    }
    if (file.size > 40 * 1024 * 1024) {
      setFormError('Dung lượng file vượt quá giới hạn tải trực tiếp (tối đa 40 MB). Vui lòng dùng tùy chọn "Nhập liên kết URL từ S3 / NAS / Google Drive".');
      return;
    }
    setSelectedPdfFile(file);
    setFormError('');
    const sizeInMb = file.size / (1024 * 1024);
    const formattedSize = sizeInMb >= 1 ? `${sizeInMb.toFixed(1)} MB` : `${Math.round(file.size / 1024)} KB`;
    const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setNewDoc(prev => ({
        ...prev,
        fileName: file.name,
        fileSize: formattedSize,
        fileUrl: result,
        title: prev.title.trim() ? prev.title : cleanName
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleOpenUploadModal = () => {
    setFormError('');
    setSelectedPdfFile(null);
    setUseManualUrl(false);
    setNewDoc({
      title: '',
      docType: 'manual',
      fileName: '',
      fileUrl: '',
      fileSize: '1.0 MB'
    });
    setShowUploadModal(true);
  };

  const [previewDoc, setPreviewDoc] = useState<{ title: string; fileName: string; url: string; blobUrl: string } | null>(null);

  const getDocBlobUrl = (fileUrl: string): string => {
    if (fileUrl.startsWith('data:')) {
      const blob = dataUrlToBlob(fileUrl);
      return URL.createObjectURL(blob);
    }
    return fileUrl;
  };

  const handleOpenPdfNewTab = (doc: { fileUrl: string; fileName: string; title: string }) => {
    if (doc.fileUrl.startsWith('data:')) {
      try {
        const blob = dataUrlToBlob(doc.fileUrl);
        const blobUrl = URL.createObjectURL(blob);
        const win = window.open(blobUrl, '_blank');
        if (!win) {
          handleDownloadPdf(doc);
        }
      } catch {
        handleDownloadPdf(doc);
      }
    } else {
      window.open(doc.fileUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handlePreviewPdf = (doc: { fileUrl: string; fileName: string; title: string }) => {
    const blobUrl = getDocBlobUrl(doc.fileUrl);
    setPreviewDoc({
      title: doc.title,
      fileName: doc.fileName,
      url: doc.fileUrl,
      blobUrl
    });
  };

  const handleDownloadPdf = (doc: { fileUrl: string; fileName: string }) => {
    let downloadUrl = doc.fileUrl;
    let shouldRevoke = false;
    if (doc.fileUrl.startsWith('data:')) {
      const blob = dataUrlToBlob(doc.fileUrl);
      downloadUrl = URL.createObjectURL(blob);
      shouldRevoke = true;
    }
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = doc.fileName || 'tai-lieu.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (shouldRevoke) {
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
    }
  };

  // Calculate Ancestor Breadcrumbs for selected item
  const breadcrumbs = useMemo(() => {
    if (!selected) return [];
    const chain: AssetSummaryDto[] = [];
    let current: AssetSummaryDto | undefined = selected;
    while (current) {
      chain.unshift(current);
      current = assets.find(x => x.id === current?.parentId);
    }
    return chain;
  }, [assets, selected]);

  const visible = useMemo(() => {
    let result = assets;
    if (typeFilter !== 'ALL') {
      result = result.filter(x => x.type === typeFilter);
    }

    if (!query.trim() && typeFilter === 'ALL') {
      return new Set(assets.map(x => x.id));
    }

    const found = new Set<string>();
    const queryLower = query.trim().toLocaleLowerCase('vi');

    for (const item of result) {
      const matchQuery = !queryLower || `${item.code} ${item.name}`.toLocaleLowerCase('vi').includes(queryLower);
      if (matchQuery) {
        let current: AssetSummaryDto | undefined = item;
        while (current) {
          found.add(current.id);
          current = assets.find(x => x.id === current?.parentId);
        }
      }
    }
    return found;
  }, [assets, query, typeFilter]);

  const roots = useMemo(() => assets.filter(x => !x.parentId), [assets]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedIds(new Set(assets.map(x => x.id)));
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  // Open Modal for adding Root Plant or Root Asset
  const handleOpenAddPlant = () => {
    setAddParentTarget(undefined);
    setFormError('');
    const plantSeq = String(assets.filter(a => a.type === 'PLANT').length + 1).padStart(2, '0');
    setNewAsset({
      code: `NMD-PLT-${plantSeq}`,
      name: '',
      type: 'PLANT',
      customType: '',
      criticality: 'CRITICAL',
      serialNumber: ''
    });
    const defaultSpecs = [
      { id: '1', key: 'Công suất', value: '100 MW' },
      { id: '2', key: 'Vị trí', value: 'Khu công nghiệp / Thủy điện' },
      { id: '3', key: 'Năm vận hành', value: '2024' }
    ];
    setNewAssetSpecs(defaultSpecs);
    setNewAssetRawJson(JSON.stringify(specFieldsToObject(defaultSpecs), null, 2));
    setNewAssetRawJsonMode(false);
    setShowAddModal(true);
  };

  // Open Modal for adding Child Asset under any parent (arbitrary depth)
  const handleOpenAddChild = (parent: AssetSummaryDto) => {
    setAddParentTarget(parent);
    setFormError('');
    const parentDef = typeMap[parent.type];
    const suggestedChildType = parentDef?.defaultChildType || 'COMPONENT';
    const parentCode = parent.code;
    const seq = String(assets.filter(a => a.parentId === parent.id).length + 1).padStart(2, '0');
    
    setNewAsset({
      code: `${parentCode}-${suggestedChildType.slice(0, 3)}-${seq}`,
      name: '',
      type: suggestedChildType,
      customType: '',
      criticality: 'MEDIUM',
      serialNumber: `SN-${parentCode}-${seq}`
    });

    const defaultSpecs = [
      { id: '1', key: 'Quy cách / Kiểu', value: 'Tiêu chuẩn' },
      { id: '2', key: 'Hãng sản xuất', value: 'Andritz' }
    ];
    setNewAssetSpecs(defaultSpecs);
    setNewAssetRawJson(JSON.stringify(specFieldsToObject(defaultSpecs), null, 2));
    setNewAssetRawJsonMode(false);
    setShowAddModal(true);
  };

  const handleOpenEditSpecs = () => {
    if (!selected) return;
    setFormError('');
    setEditSpecs({
      status: selected.status,
      criticality: selected.criticality
    });
    const fields = objectToSpecFields(selected.specs);
    setEditSpecsFields(fields);
    setEditSpecsRawJson(JSON.stringify(selected.specs ?? {}, null, 2));
    setEditSpecsRawJsonMode(false);
    setShowEditSpecsModal(true);
  };

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      let parsedSpecs: Record<string, unknown> = {};
      if (newAssetRawJsonMode) {
        try {
          parsedSpecs = JSON.parse(newAssetRawJson || '{}');
        } catch {
          throw new Error('Dữ liệu JSON thông số không hợp lệ.');
        }
      } else {
        parsedSpecs = specFieldsToObject(newAssetSpecs);
      }

      const finalType = newAsset.type === 'CUSTOM' ? (newAsset.customType.trim() || 'CUSTOM') : newAsset.type;
      
      const payload = {
        code: newAsset.code.trim().toUpperCase(),
        name: newAsset.name.trim(),
        parentId: addParentTarget?.id || undefined,
        type: finalType,
        criticality: newAsset.criticality,
        serialNumber: newAsset.serialNumber?.trim() || undefined,
        specs: parsedSpecs
      };

      const res = await fetch('/api/inventory/v1/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await apiError(res, 'Không thể thêm tài sản.'));
      const created = await res.json();
      setAssets(prev => [...prev, created]);
      setSelectedId(created.id);
      
      // Ensure path is expanded
      setExpandedIds(prev => {
        const next = new Set(prev);
        if (addParentTarget) next.add(addParentTarget.id);
        next.add(created.id);
        return next;
      });
      setShowAddModal(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể thêm tài sản.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSpecs = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      let parsedSpecs: Record<string, unknown> = {};
      if (editSpecsRawJsonMode) {
        try {
          parsedSpecs = JSON.parse(editSpecsRawJson || '{}');
        } catch {
          throw new Error('Dữ liệu JSON thông số không hợp lệ.');
        }
      } else {
        parsedSpecs = specFieldsToObject(editSpecsFields);
      }

      const response = await fetch(`/api/inventory/v1/assets/${selected.id}/specs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specs: parsedSpecs,
          status: editSpecs.status,
          criticality: editSpecs.criticality
        })
      });
      if (!response.ok) throw new Error(await apiError(response, 'Không thể lưu thông số.'));
      const updated = await response.json() as AssetSummaryDto;
      setAssets(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a));
      setShowEditSpecsModal(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể lưu thông số.');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const response = await fetch(`/api/inventory/v1/assets/${selected.id}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDoc)
      });
      if (!response.ok) throw new Error(await apiError(response, 'Không thể lưu tài liệu.'));
      const document = await response.json();
      setAssets(prev => prev.map(a => a.id === selected.id ? { ...a, documents: [document, ...(a.documents ?? [])] } : a));
      setShowUploadModal(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể lưu tài liệu.');
    } finally {
      setSaving(false);
    }
  };

  const getChildActionLabel = (node?: AssetSummaryDto) => {
    if (!node) return '+ Thêm cấp con';
    const def = typeMap[node.type];
    if (def?.defaultChildType && typeMap[def.defaultChildType]) {
      return `+ Thêm ${typeMap[def.defaultChildType].label}`;
    }
    return '+ Thêm cấp con';
  };

  return (
    <section className={styles.explorer}>
      <aside>
        <div className={styles.treeHead}>
          <span>ASSET HIERARCHY</span>
          <strong>Cây tài sản đa phân cấp</strong>
          
          <input
            aria-label="Tìm tài sản"
            onChange={e => setQuery(e.target.value)}
            placeholder="🔍 Tìm mã, tên thiết bị hoặc chi tiết..."
            value={query}
          />

          {/* Type Filter Pills */}
          <div className={styles.treeFilterRow}>
            <button
              type="button"
              className={`${styles.filterPill} ${typeFilter === 'ALL' ? styles.filterPillActive : ''}`}
              onClick={() => setTypeFilter('ALL')}
            >
              Tất cả ({assets.length})
            </button>
            {HIERARCHY_TYPES.map(t => {
              const count = assets.filter(a => a.type === t.code).length;
              if (count === 0 && typeFilter !== t.code) return null;
              return (
                <button
                  key={t.code}
                  type="button"
                  className={`${styles.filterPill} ${typeFilter === t.code ? styles.filterPillActive : ''}`}
                  onClick={() => setTypeFilter(t.code)}
                >
                  {t.icon} {t.label.split('/')[0].trim()} ({count})
                </button>
              );
            })}
          </div>

          <div className={styles.treeToolbar}>
            <div className={styles.expandControls}>
              <button type="button" onClick={expandAll} title="Mở rộng tất cả các nhánh">Mở hết</button>
              <button type="button" onClick={collapseAll} title="Thu gọn tất cả các nhánh">Thu gọn</button>
            </div>
            <button className={styles.btnPrimaryPlant} onClick={handleOpenAddPlant} title="Thêm một nhà máy hoặc đơn vị cấp cao nhất">
              🏭 + Thêm Nhà máy
            </button>
          </div>
        </div>

        <div className={styles.tree}>
          {roots.length === 0 ? (
            <div className={styles.empty} style={{ padding: '24px 12px' }}>
              <p>Chưa có Nhà máy nào.</p>
              <button className={styles.btnPrimaryPlant} onClick={handleOpenAddPlant}>
                🏭 Tạo Nhà máy đầu tiên
              </button>
            </div>
          ) : (
            roots.map(x => (
              <TreeNode
                key={x.id}
                node={x}
                assets={assets}
                visible={visible}
                selectedId={selected?.id}
                expandedIds={expandedIds}
                onToggleExpand={toggleExpand}
                onSelect={setSelectedId}
                depth={0}
              />
            ))
          )}
        </div>
      </aside>

      {selected ? (
        <article className={styles.profile}>
          <header>
            {/* Breadcrumbs Navigation */}
            {breadcrumbs.length > 1 && (
              <nav className={styles.breadcrumbs} aria-label="Đường dẫn phân cấp">
                {breadcrumbs.map((item, idx) => (
                  <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span
                      className={styles.breadcrumbItem}
                      onClick={() => setSelectedId(item.id)}
                      title={`${item.code} (${getTypeLabel(item.type)})`}
                    >
                      {getTypeIcon(item.type)} {item.name}
                    </span>
                    {idx < breadcrumbs.length - 1 && <span className={styles.breadcrumbSep}>›</span>}
                  </span>
                ))}
              </nav>
            )}

            <div className={styles.headerContent}>
              <div>
                <span className={styles.profileTypeTag}>
                  {getTypeIcon(selected.type)} {getTypeLabel(selected.type)} · CẤP PHÂN TẦNG
                </span>
                <h2>{selected.name}</h2>
                <p>{selected.code}</p>
              </div>
              <div className={styles.actions}>
                <button onClick={handleOpenEditSpecs}>
                  ✏️ Chỉnh sửa thông số
                </button>
                <button className={styles.primary} onClick={() => handleOpenAddChild(selected)}>
                  {getChildActionLabel(selected)}
                </button>
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={handleOpenDeleteModal}
                  title={`Xóa ${selected.name}`}
                >
                  🗑️ Xóa node
                </button>
              </div>
            </div>
          </header>

          <section className={styles.status}>
            <div>
              <small>Tình trạng vận hành</small>
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i
                  className={styles.dot}
                  style={{
                    background: getStatusObj(selected.status).color,
                    boxShadow: `0 0 6px ${getStatusObj(selected.status).color}66`,
                  }}
                />
                <span style={{ color: getStatusObj(selected.status).color, fontWeight: 700 }}>
                  {getStatusObj(selected.status).badgeLabel || getStatusObj(selected.status).name}
                </span>
              </strong>
            </div>
            <div>
              <small>Độ quan trọng</small>
              <strong>{selected.criticality}</strong>
            </div>
            <div>
              <small>Mã Serial phân tầng</small>
              <strong>{selected.serialNumber ?? 'Chưa khai báo'}</strong>
            </div>
            <div>
              <small>Mã QR định danh</small>
              <strong>{selected.qrCode ?? selected.code}</strong>
            </div>
          </section>

          {/* Navigation Tabs */}
          <div className={styles.tabs}>
            <button className={activeTab === 'overview' ? styles.tabActive : ''} onClick={() => setActiveTab('overview')}>
              Tổng quan & BOM
            </button>
            <button className={activeTab === 'documents' ? styles.tabActive : ''} onClick={() => setActiveTab('documents')}>
              Tài liệu kỹ thuật ({selected.documents?.length || 0})
            </button>
            <button className={activeTab === 'timeline' ? styles.tabActive : ''} onClick={() => setActiveTab('timeline')}>
              Lịch sử vận hành & bảo trì ({selected.maintenanceHistory?.length || 0})
            </button>
            <button className={activeTab === 'procedures' ? styles.tabActive : ''} onClick={() => setActiveTab('procedures')}>
              Quy trình bảo trì
            </button>
          </div>

          {/* Tab Content 1: Overview */}
          {activeTab === 'overview' && (
            <div className={styles.columns}>
              <section>
                <h3>
                  Thông số kỹ thuật
                  <button
                    onClick={handleOpenEditSpecs}
                    style={{ background: 'none', border: 0, color: '#125b45', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
                  >
                    ✏️ Sửa
                  </button>
                </h3>
                {selected.specs && Object.keys(selected.specs).length ? (
                  <dl className={styles.specsGrid}>
                    {Object.entries(selected.specs).map(([key, value]) => (
                      <div key={key} className={styles.specCard}>
                        <dt>{key}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className={styles.muted}>Chưa có thông số kỹ thuật. Bấm "Chỉnh sửa thông số" để cập nhật dạng ô nhập.</p>
                )}
              </section>
              <section>
                <h3>
                  BOM phụ tùng tiêu chuẩn <span>{selected.bomCount ?? selected.bom?.length ?? 0}</span>
                </h3>
                {selected.bom && selected.bom.length ? (
                  <ul>
                    {selected.bom.map(x => (
                      <li key={x.itemCode}>
                        <div>
                          <b>{x.itemName}</b>
                          <small>{x.itemCode}</small>
                        </div>
                        <strong>{x.quantity}{x.critical ? ' · Critical' : ''}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.muted}>Node này chưa gắn BOM phụ tùng.</p>
                )}
              </section>
            </div>
          )}

          {/* Tab Content 2: Documents */}
          {activeTab === 'documents' && (
            <div className={styles.tabContent}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0 }}>Hồ sơ & Tài liệu kỹ thuật PDF</h3>
                <button
                  style={{ padding: '8px 14px', background: '#125b45', color: '#fff', border: 0, borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                  onClick={handleOpenUploadModal}
                >
                  + Upload Tài liệu PDF
                </button>
              </div>
              <div className={styles.docList}>
                {selected.documents && selected.documents.length > 0 ? (
                  selected.documents.map((doc) => (
                    <div key={doc.id} className={styles.docCard}>
                      <div>
                        <strong style={{ display: 'block', fontSize: '14px', color: '#1a4135' }}>{doc.title}</strong>
                        <span style={{ fontSize: '12px', color: '#748b83' }}>
                          {doc.fileName} · {doc.fileSize} · Loại: {doc.docType.toUpperCase()}
                        </span>
                      </div>
                      <div className={styles.docCardActions}>
                        <button
                          type="button"
                          className={styles.btnDocView}
                          onClick={() => handlePreviewPdf(doc)}
                        >
                          👁️ Xem PDF
                        </button>
                        <button
                          type="button"
                          className={styles.btnDocDownload}
                          onClick={() => handleOpenPdfNewTab(doc)}
                          title="Mở tài liệu trong tab trình duyệt mới"
                        >
                          ↗ Mở tab mới
                        </button>
                        <button
                          type="button"
                          className={styles.btnDocDownload}
                          onClick={() => handleDownloadPdf(doc)}
                          title="Tải tệp PDF về máy tính"
                        >
                          📥 Tải về
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className={styles.muted}>Chưa có tài liệu nào đính kèm cho thiết bị này.</p>
                )}
              </div>
            </div>
          )}

          {/* Tab Content 3: Timeline */}
          {activeTab === 'timeline' && (
            <div className={styles.tabContent}>
              <h3 style={{ marginTop: 0 }}>Lịch sử Vận hành & Sự cố bảo trì</h3>
              <div className={styles.timelineList}>
                {selected.maintenanceHistory && selected.maintenanceHistory.length > 0 ? (
                  selected.maintenanceHistory.map(ev => (
                    <div key={ev.id} className={styles.timelineCard}>
                      <i />
                      <div style={{ flex: 1 }}>
                        <h4>
                          {ev.title}{' '}
                          <span style={{ fontSize: '11px', padding: '2px 8px', background: '#e1ede8', color: '#165742', borderRadius: '12px', marginLeft: '6px' }}>
                            {ev.type}
                          </span>
                        </h4>
                        <p>{ev.note}</p>
                        {ev.replacedParts && ev.replacedParts.length > 0 && (
                          <p style={{ fontSize: '12px', color: '#b94726' }}>Phụ tùng thay thế: <b>{ev.replacedParts.join(', ')}</b></p>
                        )}
                        <span>Thực hiện: {ev.technician} · Ngày: {new Intl.DateTimeFormat('vi-VN').format(new Date(ev.date))}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className={styles.muted}>Chưa ghi nhận lịch sử bảo trì nào.</p>
                )}
              </div>
            </div>
          )}

          {/* Tab Content 4: Procedures */}
          {activeTab === 'procedures' && (
            <div className={styles.tabContent}>
              <h3 style={{ marginTop: 0 }}>Quy trình & Hướng dẫn Bảo dưỡng Tiêu chuẩn</h3>
              {selected.procedures && selected.procedures.length > 0 ? (
                selected.procedures.map(proc => (
                  <div key={proc.id} style={{ background: '#f8faf9', border: '1px solid #dce8e3', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <strong style={{ fontSize: '16px', color: '#154b3c' }}>{proc.title}</strong>
                      <span style={{ fontSize: '12px', background: '#e0efe9', padding: '3px 9px', borderRadius: '12px', color: '#165843' }}>
                        Chu kỳ: {proc.frequency} · Thời lượng: {proc.estimatedDuration}
                      </span>
                    </div>
                    {proc.safetyNotes && (
                      <div style={{ background: '#fdf3ef', borderLeft: '4px solid #e06544', padding: '8px 12px', fontSize: '13px', color: '#913b22', marginBottom: '14px' }}>
                        ⚠️ <b>Lưu ý an toàn:</b> {proc.safetyNotes}
                      </div>
                    )}
                    <table style={{ width: '100%', textAlign: 'left', fontSize: '13px', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #d8e5e0', color: '#5b766d' }}>
                          <th style={{ padding: '8px 4px', width: '60px' }}>Bước</th>
                          <th style={{ padding: '8px 4px', width: '200px' }}>Hạng mục</th>
                          <th style={{ padding: '8px 4px' }}>Nội dung thao tác</th>
                          <th style={{ padding: '8px 4px', width: '180px' }}>Dụng cụ yêu cầu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proc.steps.map(s => (
                          <tr key={s.stepNo} style={{ borderBottom: '1px solid #edf3f1' }}>
                            <td style={{ padding: '10px 4px', fontWeight: 'bold' }}>{s.stepNo}</td>
                            <td style={{ padding: '10px 4px', color: '#19493b' }}><b>{s.title}</b></td>
                            <td style={{ padding: '10px 4px', color: '#4a655c' }}>{s.description}</td>
                            <td style={{ padding: '10px 4px', color: '#748b83' }}>{s.toolRequired || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              ) : (
                <p className={styles.muted}>Chưa có quy trình bảo trì nào được gán cho thiết bị này.</p>
              )}
            </div>
          )}
        </article>
      ) : (
        <div className={styles.empty}>Không tìm thấy tài sản.</div>
      )}

      {/* Modal 1: Add Asset / Plant / Flexible Child */}
      {showAddModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>
              {addParentTarget ? `+ Thêm cấp con cho: ${addParentTarget.name}` : '🏭 + Tạo Đơn vị / Nhà máy mới (Cấp cao nhất)'}
            </h3>

            <div className={styles.modalContext}>
              {addParentTarget ? (
                <>
                  Đơn vị cấp trên: <b>{addParentTarget.name}</b> ({addParentTarget.code} · {getTypeLabel(addParentTarget.type)})
                </>
              ) : (
                <>
                  Tạo đơn vị độc lập ở cấp phân tầng cao nhất (Root level).
                </>
              )}
            </div>

            <form onSubmit={handleCreateAsset}>
              <div className={styles.formGroup}>
                <label>Mã định danh (Code) *</label>
                <input
                  required
                  value={newAsset.code}
                  onChange={e => setNewAsset({ ...newAsset, code: e.target.value })}
                  placeholder="VD: NMD-ML, SYS-ELEC-01, TURB-01..."
                />
              </div>

              <div className={styles.formGroup}>
                <label>Tên gọi *</label>
                <input
                  required
                  value={newAsset.name}
                  onChange={e => setNewAsset({ ...newAsset, name: e.target.value })}
                  placeholder="VD: Nhà máy Thủy điện Minh Long, Tổ máy phát số 1, Gối trục..."
                />
              </div>

              {/* Flexible Hierarchy Selection */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className={styles.formGroup}>
                  <label>Cấp bậc phân tầng (Tự do lựa chọn)</label>
                  <select
                    value={newAsset.type}
                    onChange={e => setNewAsset({ ...newAsset, type: e.target.value })}
                  >
                    {HIERARCHY_TYPES.map(t => (
                      <option key={t.code} value={t.code}>
                        {t.icon} {t.label}
                      </option>
                    ))}
                    <option value="CUSTOM">✏️ Cấp bậc khác (Tự nhập...)</option>
                  </select>

                  {newAsset.type === 'CUSTOM' && (
                    <input
                      className={styles.customTypeInput}
                      required
                      value={newAsset.customType}
                      onChange={e => setNewAsset({ ...newAsset, customType: e.target.value })}
                      placeholder="Nhập tên cấp bậc tuỳ chỉnh..."
                    />
                  )}
                </div>

                <div className={styles.formGroup}>
                  <label>Độ quan trọng</label>
                  <select
                    value={newAsset.criticality}
                    onChange={e => setNewAsset({ ...newAsset, criticality: e.target.value as typeof newAsset.criticality })}
                  >
                    <option value="CRITICAL">Critical (Sống còn)</option>
                    <option value="HIGH">High (Cao)</option>
                    <option value="MEDIUM">Medium (Trung bình)</option>
                    <option value="LOW">Low (Thấp)</option>
                  </select>
                </div>
              </div>

              <div className={styles.formGroup}>
                <label>Số Serial phân tầng (Manufacturer / Internal)</label>
                <input
                  value={newAsset.serialNumber}
                  onChange={e => setNewAsset({ ...newAsset, serialNumber: e.target.value })}
                  placeholder="VD: SN-HPP-GEN-01"
                />
              </div>

              {/* Dynamic Specs Form */}
              <div className={styles.formGroup}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ margin: 0 }}>Thông số kỹ thuật</label>
                  <button
                    type="button"
                    style={{ background: 'none', border: 0, color: '#125b45', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => {
                      if (!newAssetRawJsonMode) {
                        setNewAssetRawJson(JSON.stringify(specFieldsToObject(newAssetSpecs), null, 2));
                      } else {
                        try {
                          const parsed = JSON.parse(newAssetRawJson || '{}');
                          setNewAssetSpecs(objectToSpecFields(parsed));
                        } catch {
                          // keep as is
                        }
                      }
                      setNewAssetRawJsonMode(!newAssetRawJsonMode);
                    }}
                  >
                    {newAssetRawJsonMode ? '⇄ Chuyển sang dạng ô nhập' : '⇄ Chuyển sang JSON thô'}
                  </button>
                </div>

                {newAssetRawJsonMode ? (
                  <textarea
                    rows={4}
                    value={newAssetRawJson}
                    onChange={e => setNewAssetRawJson(e.target.value)}
                    placeholder='{"Công suất": "50MW"}'
                  />
                ) : (
                  <SpecsFieldEditor
                    fields={newAssetSpecs}
                    onChange={setNewAssetSpecs}
                  />
                )}
              </div>

              {formError ? <p role="alert" style={{ color: '#dc2626', fontSize: '13px', margin: '10px 0' }}>{formError}</p> : null}

              <div className={styles.modalActions}>
                <button type="button" className={styles.cancel} onClick={() => setShowAddModal(false)}>Hủy</button>
                <button type="submit" className={styles.submit} disabled={saving}>
                  {saving ? 'Đang lưu…' : addParentTarget ? 'Tạo cấp con' : 'Tạo mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Edit Specs */}
      {showEditSpecsModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>Chỉnh sửa thông số & Trạng thái: {selected?.code}</h3>
            <form onSubmit={handleUpdateSpecs}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className={styles.formGroup}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ margin: 0 }}>Trạng thái vận hành (Từ Database)</label>
                    <button
                      type="button"
                      style={{ background: 'none', border: 0, color: '#125b45', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                      onClick={() => setShowAddStatusModal(true)}
                    >
                      + Thêm mới
                    </button>
                  </div>
                  <select
                    value={editSpecs.status}
                    onChange={(e) => {
                      if (e.target.value === '__ADD_NEW__') {
                        setShowAddStatusModal(true);
                      } else {
                        setEditSpecs({ ...editSpecs, status: e.target.value });
                      }
                    }}
                  >
                    {statuses.map((st) => (
                      <option key={st.code} value={st.code}>
                        {st.name}
                      </option>
                    ))}
                    <option value="__ADD_NEW__">➕ + Thêm trạng thái mới vào Database...</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Độ quan trọng</label>
                  <select value={editSpecs.criticality} onChange={e => setEditSpecs({ ...editSpecs, criticality: e.target.value })}>
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </div>
              </div>

              {/* Dynamic Key-Value Specs Editor */}
              <div className={styles.formGroup}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ margin: 0 }}>Thông số kỹ thuật</label>
                  <button
                    type="button"
                    style={{ background: 'none', border: 0, color: '#125b45', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => {
                      if (!editSpecsRawJsonMode) {
                        setEditSpecsRawJson(JSON.stringify(specFieldsToObject(editSpecsFields), null, 2));
                      } else {
                        try {
                          const parsed = JSON.parse(editSpecsRawJson || '{}');
                          setEditSpecsFields(objectToSpecFields(parsed));
                        } catch {
                          // keep as is
                        }
                      }
                      setEditSpecsRawJsonMode(!editSpecsRawJsonMode);
                    }}
                  >
                    {editSpecsRawJsonMode ? '⇄ Chuyển sang dạng ô nhập' : '⇄ Chuyển sang JSON thô'}
                  </button>
                </div>

                {editSpecsRawJsonMode ? (
                  <textarea
                    rows={6}
                    value={editSpecsRawJson}
                    onChange={e => setEditSpecsRawJson(e.target.value)}
                  />
                ) : (
                  <SpecsFieldEditor
                    fields={editSpecsFields}
                    onChange={setEditSpecsFields}
                  />
                )}
              </div>

              {formError ? <p role="alert" style={{ color: '#dc2626', fontSize: '13px', margin: '10px 0' }}>{formError}</p> : null}

              <div className={styles.modalActions}>
                <button type="button" className={styles.cancel} onClick={() => setShowEditSpecsModal(false)}>Hủy</button>
                <button type="submit" className={styles.submit} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu thông số'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Upload Document */}
      {showUploadModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>Đăng ký & Tải lên tài liệu kỹ thuật PDF: {selected?.code}</h3>
            <form onSubmit={handleUploadDoc}>
              {/* PDF File Dropzone / File Picker */}
              <div className={styles.formGroup}>
                <label>Tệp tài liệu PDF *</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePdfFileSelect(file);
                  }}
                />

                {!selectedPdfFile && !useManualUrl ? (
                  <div
                    className={`${styles.dropzone} ${isDragging ? styles.dropzoneDragOver : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) handlePdfFileSelect(file);
                    }}
                  >
                    <span className={styles.dropzoneIcon}>📄</span>
                    <strong className={styles.dropzoneTitle}>Kéo & thả file PDF vào đây hoặc bấm để chọn tệp</strong>
                    <span className={styles.dropzoneHint}>Hỗ trợ định dạng PDF (.pdf) từ máy tính</span>
                  </div>
                ) : null}

                {selectedPdfFile && !useManualUrl ? (
                  <div className={styles.filePreviewCard}>
                    <div className={styles.filePreviewInfo}>
                      <span className={styles.pdfBadge}>PDF</span>
                      <div>
                        <div className={styles.fileNameText}>{newDoc.fileName}</div>
                        <span className={styles.fileSizeText}>{newDoc.fileSize} · Đã sẵn sàng tải lên</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        style={{
                          padding: '4px 10px',
                          border: '1px solid #cadcd5',
                          background: '#fff',
                          borderRadius: '6px',
                          fontSize: '11px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          color: '#1b5645',
                        }}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Đổi tệp khác
                      </button>
                      <button
                        type="button"
                        className={styles.btnRemoveFile}
                        onClick={() => {
                          setSelectedPdfFile(null);
                          setNewDoc((prev) => ({ ...prev, fileName: '', fileUrl: '' }));
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                      >
                        Gỡ bỏ
                      </button>
                    </div>
                  </div>
                ) : null}

                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    style={{ background: 'none', border: 0, color: '#125b45', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => {
                      setUseManualUrl(!useManualUrl);
                      if (!useManualUrl) {
                        setSelectedPdfFile(null);
                      }
                    }}
                  >
                    {useManualUrl ? '← Chọn tải lên tệp PDF từ máy tính' : '🔗 Hoặc nhập liên kết URL tài liệu đám mây (S3 / NAS)'}
                  </button>
                </div>
              </div>

              {useManualUrl && (
                <>
                  <div className={styles.formGroup}>
                    <label>Tên file PDF *</label>
                    <input
                      required
                      value={newDoc.fileName}
                      onChange={(e) => setNewDoc({ ...newDoc, fileName: e.target.value })}
                      placeholder="manual-thiet-bi.pdf"
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>URL file trên kho tài liệu / S3 *</label>
                    <input
                      required
                      type="url"
                      value={newDoc.fileUrl}
                      onChange={(e) => setNewDoc({ ...newDoc, fileUrl: e.target.value })}
                      placeholder="https://storage.example/manual-thiet-bi.pdf"
                    />
                  </div>
                </>
              )}

              <div className={styles.formGroup}>
                <label>Tên tài liệu / Tiêu đề hiển thị *</label>
                <input
                  required
                  value={newDoc.title}
                  onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })}
                  placeholder="VD: Hướng dẫn tháo lắp và bảo dưỡng gối trục"
                />
              </div>

              <div className={styles.formGroup}>
                <label>Phân loại hồ sơ tài liệu</label>
                <select
                  value={newDoc.docType}
                  onChange={(e) => setNewDoc({ ...newDoc, docType: e.target.value as typeof newDoc.docType })}
                >
                  <option value="manual">📘 Tài liệu O&M (Manual / Vận hành & Bảo dưỡng)</option>
                  <option value="cocq">📜 Chứng nhận xuất xưởng & Chất lượng CO/CQ</option>
                  <option value="test_report">📋 Biên bản thử nghiệm (Test Report / Thí nghiệm)</option>
                  <option value="drawing">📐 Bản vẽ kỹ thuật & Sơ đồ (Drawing / CAD)</option>
                  <option value="procedure">📑 Quy trình vận hành & Biện pháp an toàn</option>
                </select>
              </div>

              {formError ? <p role="alert" style={{ color: '#dc2626', fontSize: '13px', margin: '10px 0' }}>{formError}</p> : null}

              <div className={styles.modalActions}>
                <button type="button" className={styles.cancel} onClick={() => setShowUploadModal(false)}>
                  Hủy
                </button>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={saving || (!selectedPdfFile && !useManualUrl && !newDoc.fileUrl)}
                >
                  {saving ? 'Đang tải lên…' : '📤 Tải lên & Lưu tài liệu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: PDF Live Viewer Modal */}
      {previewDoc && (
        <div className={styles.modalOverlay} onClick={() => setPreviewDoc(null)}>
          <div className={styles.pdfModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.pdfModalHeader}>
              <div>
                <h3 title={previewDoc.title}>{previewDoc.title}</h3>
                <span style={{ fontSize: '11px', color: '#68897f', fontFamily: 'monospace' }}>
                  {previewDoc.fileName}
                </span>
              </div>
              <div className={styles.pdfModalActions}>
                <button
                  type="button"
                  className={styles.btnDocDownload}
                  onClick={() => handleOpenPdfNewTab({ fileUrl: previewDoc.url, fileName: previewDoc.fileName, title: previewDoc.title })}
                >
                  ↗ Mở tab mới
                </button>
                <button
                  type="button"
                  className={styles.btnDocDownload}
                  onClick={() => handleDownloadPdf({ fileUrl: previewDoc.url, fileName: previewDoc.fileName })}
                >
                  📥 Tải về
                </button>
                <button
                  type="button"
                  style={{
                    padding: '6px 12px',
                    border: '1px solid #dce8e3',
                    background: '#f4f8f6',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                  onClick={() => setPreviewDoc(null)}
                >
                  ✕ Đóng
                </button>
              </div>
            </div>
            <iframe
              src={previewDoc.blobUrl}
              className={styles.pdfFrame}
              title={previewDoc.title}
            />
          </div>
        </div>
      )}

      {/* Modal 5: Delete Asset Confirmation Modal with 2-Step Double Verification */}
      {showDeleteModal && selected && (
        <div className={styles.modalOverlay} onClick={() => setShowDeleteModal(false)}>
          <div className={styles.modal} style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            {getDescendantCount(selected.id) === 0 ? (
              /* Single confirmation for leaf node */
              <>
                <h3 style={{ color: '#b91c1c', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  ⚠️ Xác nhận xóa tài sản
                </h3>
                <p style={{ fontSize: '14px', color: '#334155', lineHeight: 1.5, margin: '0 0 16px' }}>
                  Bạn có chắc chắn muốn xóa <b>{selected.name}</b> (<code>{selected.code}</code> · {getTypeLabel(selected.type)}) không?
                </p>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 20px' }}>
                  Hành động này sẽ xóa dữ liệu vĩnh viễn khỏi hệ thống và không thể hoàn tác.
                </p>
                <div className={styles.modalActions}>
                  <button type="button" className={styles.cancel} onClick={() => setShowDeleteModal(false)}>
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '9px 18px',
                      borderRadius: '8px',
                      border: 0,
                      background: '#dc2626',
                      color: '#ffffff',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    disabled={deleting}
                    onClick={handleDeleteAsset}
                  >
                    {deleting ? 'Đang xóa…' : '🗑️ Xác nhận xóa vĩnh viễn'}
                  </button>
                </div>
              </>
            ) : deleteStep === 1 ? (
              /* Step 1 of 2: Warning for node with children */
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <h3 style={{ color: '#b91c1c', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '17px' }}>
                    ⚠️ Bước 1/2: Cảnh báo xóa node có cấp con
                  </h3>
                  <span style={{ fontSize: '11px', padding: '2px 8px', background: '#fee2e2', color: '#991b1b', borderRadius: '12px', fontWeight: 700 }}>
                    BẢO VỆ 2 LỚP
                  </span>
                </div>

                <p style={{ fontSize: '14px', color: '#334155', lineHeight: 1.5, margin: '0 0 14px' }}>
                  Bạn đang yêu cầu xóa: <b>{selected.name}</b> (<code>{selected.code}</code> · {getTypeLabel(selected.type)}).
                </p>

                <div
                  style={{
                    background: '#fff1f2',
                    border: '1.5px solid #fecaca',
                    borderRadius: '10px',
                    padding: '14px 16px',
                    color: '#991b1b',
                    fontSize: '13px',
                    lineHeight: 1.6,
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🛑 CẢNH BÁO TÁC ĐỘNG PHÂN CẤP:
                  </div>
                  <div>
                    Node này hiện có <b>{getDescendantCount(selected.id)} cấp con trực thuộc</b>.
                  </div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: '20px' }}>
                    <li>Toàn bộ các phân xưởng, hệ thống, thiết bị và phụ tùng con sẽ bị xóa đồng loạt.</li>
                    <li>Toàn bộ tài liệu PDF, hồ sơ thông số kỹ thuật và danh mục BOM liên quan sẽ bị xóa vĩnh viễn.</li>
                  </ul>
                </div>

                <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 20px' }}>
                  Vì lý do an toàn dữ liệu, hệ thống yêu cầu bạn phải xác thực thêm một bước thứ 2 trước khi thực hiện xóa.
                </p>

                <div className={styles.modalActions}>
                  <button type="button" className={styles.cancel} onClick={() => setShowDeleteModal(false)}>
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '9px 18px',
                      borderRadius: '8px',
                      border: 0,
                      background: '#ea580c',
                      color: '#ffffff',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    onClick={() => setDeleteStep(2)}
                  >
                    Tiếp tục sang bước 2 xác thực ➔
                  </button>
                </div>
              </>
            ) : (
              /* Step 2 of 2: Strict Double Confirmation Box */
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <h3 style={{ color: '#b91c1c', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '17px' }}>
                    🛑 Bước 2/2: Hộp thoại xác thực nghiêm ngặt
                  </h3>
                  <span style={{ fontSize: '11px', padding: '2px 8px', background: '#dc2626', color: '#fff', borderRadius: '12px', fontWeight: 700 }}>
                    BƯỚC CUỐI
                  </span>
                </div>

                <div
                  style={{
                    background: '#fef2f2',
                    border: '1.5px dashed #dc2626',
                    borderRadius: '10px',
                    padding: '16px',
                    marginBottom: '16px',
                  }}
                >
                  <label style={{ display: 'block', fontSize: '13px', color: '#7f1d1d', marginBottom: '8px', lineHeight: 1.5 }}>
                    Để xác nhận xóa vĩnh viễn <b>{selected.name}</b> và <b>{getDescendantCount(selected.id)} cấp con</b>, vui lòng gõ chính xác mã định danh:{' '}
                    <b style={{ color: '#dc2626', background: '#fee2e2', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '14px' }}>
                      {selected.code}
                    </b>
                  </label>

                  <input
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      border: '1.5px solid #f87171',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      color: '#991b1b',
                      background: '#ffffff',
                      outline: 'none',
                    }}
                    value={deleteConfirmInput}
                    onChange={(e) => setDeleteConfirmInput(e.target.value)}
                    placeholder={`Gõ đúng "${selected.code}" vào đây...`}
                    autoFocus
                  />

                  <div style={{ marginTop: '14px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <input
                      type="checkbox"
                      id="del-ack"
                      checked={deleteAcknowledge}
                      onChange={(e) => setDeleteAcknowledge(e.target.checked)}
                      style={{ marginTop: '3px', cursor: 'pointer', accentColor: '#dc2626' }}
                    />
                    <label htmlFor="del-ack" style={{ fontSize: '12px', color: '#991b1b', cursor: 'pointer', lineHeight: 1.4, fontWeight: 600 }}>
                      Tôi cam kết và hiểu rằng dữ liệu này cùng toàn bộ các cấp con sẽ bị xóa hoàn toàn khỏi cơ sở dữ liệu.
                    </label>
                  </div>
                </div>

                <div className={styles.modalActions}>
                  <button type="button" className={styles.cancel} onClick={() => setDeleteStep(1)}>
                    ← Quay lại bước 1
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '9px 18px',
                      borderRadius: '8px',
                      border: 0,
                      background:
                        deleteConfirmInput.trim().toUpperCase() === selected.code.trim().toUpperCase() && deleteAcknowledge
                          ? '#dc2626'
                          : '#fca5a5',
                      color: '#ffffff',
                      fontWeight: 600,
                      cursor:
                        deleteConfirmInput.trim().toUpperCase() === selected.code.trim().toUpperCase() && deleteAcknowledge
                          ? 'pointer'
                          : 'not-allowed',
                      boxShadow:
                        deleteConfirmInput.trim().toUpperCase() === selected.code.trim().toUpperCase() && deleteAcknowledge
                          ? '0 2px 8px rgba(220, 38, 38, 0.4)'
                          : 'none',
                    }}
                    disabled={
                      deleteConfirmInput.trim().toUpperCase() !== selected.code.trim().toUpperCase() ||
                      !deleteAcknowledge ||
                      deleting
                    }
                    onClick={handleDeleteAsset}
                  >
                    {deleting ? 'Đang xóa vĩnh viễn…' : '🗑️ Xác nhận xóa vĩnh viễn'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal 6: Create New Asset Status Modal */}
      {showAddStatusModal && (
        <div className={styles.modalOverlay} onClick={() => setShowAddStatusModal(false)}>
          <div className={styles.modal} style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', color: '#124738', display: 'flex', alignItems: 'center', gap: '8px' }}>
              ➕ Thêm trạng thái thiết bị mới vào Database
            </h3>
            <form onSubmit={handleCreateCustomStatus}>
              <div className={styles.formGroup}>
                <label>Mã trạng thái (Code) *</label>
                <input
                  required
                  value={newStatusForm.code}
                  onChange={(e) => setNewStatusForm({ ...newStatusForm, code: e.target.value.toUpperCase() })}
                  placeholder="VD: OVERHAUL, STANDBY, DECOMMISSIONED..."
                  style={{ fontFamily: 'monospace', fontWeight: 700 }}
                  autoFocus
                />
              </div>

              <div className={styles.formGroup}>
                <label>Tên hiển thị đầy đủ *</label>
                <input
                  required
                  value={newStatusForm.name}
                  onChange={(e) => setNewStatusForm({ ...newStatusForm, name: e.target.value })}
                  placeholder="VD: OVERHAUL (Đại tu sửa chữa lớn)"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className={styles.formGroup}>
                  <label>Nhãn rút gọn (Badge)</label>
                  <input
                    value={newStatusForm.badgeLabel}
                    onChange={(e) => setNewStatusForm({ ...newStatusForm, badgeLabel: e.target.value })}
                    placeholder="VD: Đại tu"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Màu sắc nhận diện</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="color"
                      value={newStatusForm.color}
                      onChange={(e) => setNewStatusForm({ ...newStatusForm, color: e.target.value })}
                      style={{ width: '40px', height: '36px', padding: 0, border: '1px solid #dce8e3', borderRadius: '6px', cursor: 'pointer' }}
                    />
                    <input
                      value={newStatusForm.color}
                      onChange={(e) => setNewStatusForm({ ...newStatusForm, color: e.target.value })}
                      style={{ fontFamily: 'monospace', fontSize: '13px' }}
                    />
                  </div>
                </div>
              </div>

              {/* Preset colors */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0 16px' }}>
                <span style={{ fontSize: '11px', color: '#68897f' }}>Màu mẫu:</span>
                {['#10b981', '#0284c7', '#06b6d4', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#6b7280'].map((c) => (
                  <span
                    key={c}
                    onClick={() => setNewStatusForm({ ...newStatusForm, color: c })}
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: c,
                      cursor: 'pointer',
                      border: newStatusForm.color === c ? '2px solid #000' : '1px solid #e5e7eb',
                    }}
                    title={c}
                  />
                ))}
              </div>

              {formError ? <p role="alert" style={{ color: '#dc2626', fontSize: '13px', margin: '10px 0' }}>{formError}</p> : null}

              <div className={styles.modalActions}>
                <button type="button" className={styles.cancel} onClick={() => setShowAddStatusModal(false)}>
                  Hủy
                </button>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={creatingStatus || !newStatusForm.code.trim() || !newStatusForm.name.trim()}
                >
                  {creatingStatus ? 'Đang lưu…' : '💾 Lưu trạng thái vào Database'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

// Dynamic Spec Editor Component
function SpecsFieldEditor({
  fields,
  onChange
}: {
  fields: SpecField[];
  onChange: (fields: SpecField[]) => void;
}) {
  const handleFieldChange = (id: string, keyOrVal: 'key' | 'value', text: string) => {
    onChange(fields.map(f => f.id === id ? { ...f, [keyOrVal]: text } : f));
  };

  const handleAddField = (suggestedKey = '') => {
    onChange([
      ...fields,
      { id: `spec-${Date.now()}-${Math.random()}`, key: suggestedKey, value: '' }
    ]);
  };

  const handleDeleteField = (id: string) => {
    onChange(fields.filter(f => f.id !== id));
  };

  return (
    <div className={styles.specsEditorContainer}>
      <div className={styles.specsHeaderRow}>
        <span>Tên thông số (Trường)</span>
        <span>Giá trị thông số</span>
        <span />
      </div>

      <div className={styles.specsRowList}>
        {fields.length === 0 ? (
          <p style={{ margin: '8px 0', fontSize: '12px', color: '#7a968e', textAlign: 'center' }}>
            Chưa có trường thông số nào. Bấm "+ Thêm dòng" hoặc chọn gợi ý bên dưới.
          </p>
        ) : (
          fields.map(field => (
            <div key={field.id} className={styles.specRow}>
              <input
                value={field.key}
                onChange={e => handleFieldChange(field.id, 'key', e.target.value)}
                placeholder="VD: Công suất, Điện áp..."
              />
              <input
                value={field.value}
                onChange={e => handleFieldChange(field.id, 'value', e.target.value)}
                placeholder="VD: 50MW, 220kV..."
              />
              <button
                type="button"
                className={styles.btnDeleteRow}
                onClick={() => handleDeleteField(field.id)}
                title="Xóa trường này"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <div className={styles.specsEditorActions}>
        <button
          type="button"
          className={styles.btnAddSpecRow}
          onClick={() => handleAddField()}
        >
          + Thêm dòng thông số
        </button>
        <span style={{ fontSize: '11px', color: '#78958c' }}>{fields.length} trường</span>
      </div>

      <div className={styles.specQuickTags}>
        <label>Gợi ý nhanh:</label>
        {COMMON_SPEC_SUGGESTIONS.map(sug => {
          const exists = fields.some(f => f.key.trim().toLowerCase() === sug.toLowerCase());
          if (exists) return null;
          return (
            <button
              key={sug}
              type="button"
              className={styles.quickTag}
              onClick={() => handleAddField(sug)}
            >
              + {sug}
            </button>
          );
        })}
      </div>
    </div>
  );
}

async function apiError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { message?: string };
    return body.message || fallback;
  } catch {
    return fallback;
  }
}

function TreeNode({
  node,
  assets,
  visible,
  selectedId,
  expandedIds,
  onToggleExpand,
  onSelect,
  depth
}: {
  node: AssetSummaryDto;
  assets: AssetSummaryDto[];
  visible: Set<string>;
  selectedId?: string;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const children = assets.filter(x => x.parentId === node.id && visible.has(x.id));
  if (!visible.has(node.id)) return null;

  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const badgeClass = styles[`badge${node.type}`] || styles.badgeCUSTOM;

  return (
    <div className={styles.branch}>
      <div className={`${styles.nodeRow} ${isSelected ? styles.activeNode : ''}`}>
        {hasChildren ? (
          <button
            type="button"
            className={styles.toggleBtn}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            title={isExpanded ? 'Thu gọn nhánh' : 'Mở rộng nhánh'}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className={styles.toggleEmpty} />
        )}

        <button
          type="button"
          className={styles.nodeBtn}
          onClick={() => onSelect(node.id)}
        >
          <span className={`${styles.nodeBadge} ${badgeClass}`}>
            {getTypeIcon(node.type)} {getTypeLabel(node.type).split('/')[0].trim()}
          </span>
          <i className={`${styles.dot} ${styles[node.status.toLowerCase()] ?? ''}`} title={`Trạng thái: ${node.status}`} />
          <div className={styles.nodeInfo}>
            <div className={styles.nodeTitle}>
              <b>{node.name}</b>
            </div>
            <small>{node.code}</small>
          </div>
          {hasChildren ? <em className={styles.countBadge}>{children.length}</em> : null}
        </button>
      </div>

      {hasChildren && isExpanded ? (
        <div className={styles.children}>
          {children.map(x => (
            <TreeNode
              key={x.id}
              node={x}
              assets={assets}
              visible={visible}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
