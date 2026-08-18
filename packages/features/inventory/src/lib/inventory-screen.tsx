'use client';
import type { InventoryWorkspaceDto } from '@enterprise-platform/contract-inventory';
import { useState, useMemo } from 'react';
import styles from './inventory.module.css';
import { AssetTreeExplorer } from './asset-tree-explorer';

export type InventoryView =
  | 'dashboard'
  | 'assets'
  | 'items'
  | 'warehouses'
  | 'stock'
  | 'serials'
  | 'reservations'
  | 'transactions';

export function InventoryScreen({
  data,
  tenantSlug,
  view = 'dashboard',
}: {
  data: InventoryWorkspaceDto;
  tenantSlug: string;
  view?: InventoryView;
}) {
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Bộ lọc theo Nhà máy & Tìm kiếm
  const [selectedPlant, setSelectedPlant] = useState<string>('ALL'); // 'ALL' | 'HPP-01' | 'SPP-01' | 'WPP-01'
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Gộp các dòng tồn kho nếu cùng (warehouseId, itemCode)
  const consolidatedBalances = useMemo(() => {
    const map = new Map<string, (typeof data.balances)[0]>();
    for (const b of data.balances) {
      const codeKey = b.itemCode.trim().toUpperCase();
      const key = `${b.warehouseId}-${codeKey}`;
      if (!map.has(key)) {
        map.set(key, { ...b, itemCode: codeKey });
      } else {
        const existing = map.get(key)!;
        existing.onHand += b.onHand;
        existing.reserved += b.reserved;
        existing.available += b.available;
        existing.minStock = Math.max(existing.minStock, b.minStock);
      }
    }
    return Array.from(map.values());
  }, [data.balances]);

  // Thống kê theo từng Nhà máy
  const plantSummaries = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        name: string;
        shortLabel: string;
        icon: string;
        badgeClass: string;
        warehouse: (typeof data.warehouses)[0];
        totalOnHand: number;
        totalAvailable: number;
        totalReserved: number;
        skuCount: number;
        lowStockCount: number;
      }
    >();

    for (const w of data.warehouses) {
      const pCode = w.plantCode || w.code;
      const bList = consolidatedBalances.filter((b) => b.warehouseId === w.id);
      const onHand = bList.reduce((sum, b) => sum + b.onHand, 0);
      const avail = bList.reduce((sum, b) => sum + b.available, 0);
      const res = bList.reduce((sum, b) => sum + b.reserved, 0);
      const low = bList.filter((b) => b.available <= b.minStock).length;

      let icon = '🏭';
      let badgeClass = styles.plantBadgeGeneric;
      let shortLabel = pCode;
      const cleanName = w.name.replace(/^Tổng kho\s+/i, '');

      if (pCode.includes('HPP') || w.code.includes('HPP') || w.name.includes('Thủy điện')) {
        icon = '💧';
        shortLabel = 'Thủy điện (HPP-01)';
        badgeClass = styles.plantBadgeHpp;
      } else if (
        pCode.includes('SPP') ||
        w.code.includes('SPP') ||
        w.name.includes('mặt trời') ||
        w.name.includes('Solar')
      ) {
        icon = '☀️';
        shortLabel = 'Điện mặt trời (SPP-01)';
        badgeClass = styles.plantBadgeSpp;
      } else if (
        pCode.includes('WPP') ||
        w.code.includes('WPP') ||
        w.name.includes('gió') ||
        w.name.includes('Wind')
      ) {
        icon = '💨';
        shortLabel = 'Điện gió (WPP-01)';
        badgeClass = styles.plantBadgeWpp;
      }

      map.set(pCode, {
        code: pCode,
        name: cleanName,
        shortLabel,
        icon,
        badgeClass,
        warehouse: w,
        totalOnHand: onHand,
        totalAvailable: avail,
        totalReserved: res,
        skuCount: bList.length,
        lowStockCount: low,
      });
    }

    return Array.from(map.values());
  }, [data.warehouses, consolidatedBalances]);

  // Lọc balances theo Nhà máy và từ khóa tìm kiếm
  const filteredBalances = useMemo(() => {
    let list = consolidatedBalances;
    if (selectedPlant !== 'ALL') {
      const targetPlant = plantSummaries.find((p) => p.code === selectedPlant);
      if (targetPlant) {
        list = list.filter((b) => b.warehouseId === targetPlant.warehouse.id);
      }
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(
        (b) =>
          b.itemCode.toLowerCase().includes(q) ||
          b.itemName.toLowerCase().includes(q) ||
          (b.warehouseCode && b.warehouseCode.toLowerCase().includes(q)) ||
          (b.warehouseName && b.warehouseName.toLowerCase().includes(q)) ||
          (b.plantCode && b.plantCode.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [consolidatedBalances, selectedPlant, plantSummaries, searchTerm]);

  const currentPlantObj = selectedPlant === 'ALL' ? null : plantSummaries.find((p) => p.code === selectedPlant);

  // Danh sách vật tư duy nhất theo SKU code
  const uniqueItems = useMemo(() => {
    const map = new Map<string, (typeof data.items)[0]>();
    for (const it of data.items) {
      const codeKey = it.code.trim().toUpperCase();
      if (!map.has(codeKey)) {
        map.set(codeKey, it);
      }
    }
    return Array.from(map.values());
  }, [data.items]);

  const displayMetrics = useMemo(() => {
    if (currentPlantObj) {
      return {
        plantLabel: currentPlantObj.shortLabel,
        warehouseCount: 1,
        skuCount: currentPlantObj.skuCount,
        totalOnHand: currentPlantObj.totalOnHand,
        totalAvailable: currentPlantObj.totalAvailable,
        totalReserved: currentPlantObj.totalReserved,
        lowStockCount: currentPlantObj.lowStockCount,
      };
    }
    return {
      plantLabel: 'Toàn bộ hệ thống',
      warehouseCount: data.warehouses.length,
      skuCount: uniqueItems.length,
      totalOnHand: consolidatedBalances.reduce((s, x) => s + x.onHand, 0),
      totalAvailable: consolidatedBalances.reduce((s, x) => s + x.available, 0),
      totalReserved: consolidatedBalances.reduce((s, x) => s + x.reserved, 0),
      lowStockCount: consolidatedBalances.filter((b) => b.available <= b.minStock).length,
    };
  }, [currentPlantObj, data.warehouses.length, uniqueItems.length, consolidatedBalances]);

  // Form Nhập kho (Hỗ trợ cả vật tư có sẵn & Nhập phụ tùng mới hoàn toàn)
  const [isNewMaterial, setIsNewMaterial] = useState(false);
  const [importForm, setImportForm] = useState({
    receiptNo: `NK-${Date.now().toString().slice(-6)}`,
    warehouseId: data.warehouses[0]?.id || '',
    itemId: data.items[0]?.id || '',
    sourceOrigin: 'Nhà phân phối thiết bị chính hãng',
    quantity: 10,
    unitCost: 250000,
    newItemCode: '',
    newItemName: '',
    newItemUom: 'Cái',
    newItemCategory: 'SPARE_PART',
    newItemManufacturer: '',
    newItemMinStock: 2,
  });

  const effectiveImportItemId =
    uniqueItems.find((it) => it.id === importForm.itemId)?.id ??
    uniqueItems[0]?.id ??
    '';

  const handleOpenImportModal = (preselectedWhId?: string, preselectedItemId?: string) => {
    const targetWhId = preselectedWhId || currentPlantObj?.warehouse.id || data.warehouses[0]?.id || '';
    const targetItemId = preselectedItemId || importForm.itemId || effectiveImportItemId || '';
    setImportForm((f) => ({
      ...f,
      receiptNo: `NK-${Date.now().toString().slice(-6)}`,
      warehouseId: targetWhId,
      itemId: targetItemId,
      quantity: 10,
      unitCost: 250000,
    }));
    setIsNewMaterial(false);
    setShowImportModal(true);
  };

  // Form Xuất kho (Xuất từ kho nào tới đâu - lọc thiết bị theo kho)
  const initialWhId = data.warehouses[0]?.id || '';
  const initialItemsInWh = consolidatedBalances.filter((b) => b.warehouseId === initialWhId && b.available > 0);
  const [exportForm, setExportForm] = useState({
    issueNo: `XK-${Date.now().toString().slice(-6)}`,
    warehouseId: initialWhId,
    destination: 'Gian máy chính - Tổ máy H1',
    itemId: initialItemsInWh[0]?.itemId || '',
    quantity: 1,
    referenceType: 'WORK_ORDER',
    referenceId: 'WO-2026-0815',
  });

  const total = consolidatedBalances.reduce((s, x) => s + x.onHand, 0);
  const base = `/t/${tenantSlug}/inventory`;

  // Lọc danh sách thiết bị/vật tư có sẵn trong nhà kho được chọn
  const availableItemsInSelectedWarehouse = consolidatedBalances.filter(
    (b) => b.warehouseId === exportForm.warehouseId && b.available > 0,
  );

  const effectiveExportItemId =
    availableItemsInSelectedWarehouse.find((b) => b.itemId === exportForm.itemId)?.itemId ??
    availableItemsInSelectedWarehouse[0]?.itemId ??
    '';

  const currentSelectedItemBalance = consolidatedBalances.find(
    (b) => b.warehouseId === exportForm.warehouseId && b.itemId === effectiveExportItemId,
  );

  const handleWarehouseChangeForExport = (newWarehouseId: string) => {
    const itemsInWh = consolidatedBalances.filter((b) => b.warehouseId === newWarehouseId && b.available > 0);
    setExportForm((prev) => ({
      ...prev,
      warehouseId: newWarehouseId,
      itemId: itemsInWh[0]?.itemId || '',
      quantity: 1,
    }));
  };

  const handleOpenExportModal = (preselectedWhId?: string, preselectedItemId?: string) => {
    const whId = preselectedWhId || exportForm.warehouseId || data.warehouses[0]?.id || '';
    const itemsInWh = consolidatedBalances.filter((b) => b.warehouseId === whId && b.available > 0);
    const itId = preselectedItemId || itemsInWh[0]?.itemId || '';
    setExportForm({
      issueNo: `XK-${Date.now().toString().slice(-6)}`,
      warehouseId: whId,
      destination: 'Gian máy chính - Tổ máy H1',
      itemId: itId,
      quantity: 1,
      referenceType: 'WORK_ORDER',
      referenceId: 'WO-2026-0815',
    });
    setShowExportModal(true);
  };

  const readErrorMessage = async (res: Response, fallback: string) => {
    try {
      const body = (await res.json()) as { message?: unknown };
      return typeof body.message === 'string' && body.message.trim() ? body.message : fallback;
    } catch {
      return fallback;
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedItemId = isNewMaterial ? undefined : (importForm.itemId || effectiveImportItemId);
    if (!importForm.warehouseId || (!isNewMaterial && !resolvedItemId)) {
      alert('Vui lòng chọn đầy đủ kho và vật tư cần nhập.');
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = {
        receiptNo: importForm.receiptNo,
        warehouseId: importForm.warehouseId,
        sourceOrigin: importForm.sourceOrigin,
        lines: [
          isNewMaterial
            ? {
                newItem: {
                  code: importForm.newItemCode,
                  name: importForm.newItemName,
                  uomCode: importForm.newItemUom,
                  category: importForm.newItemCategory,
                  manufacturer: importForm.newItemManufacturer || undefined,
                  minStock: Number(importForm.newItemMinStock),
                },
                quantity: Number(importForm.quantity),
                unitCost: Number(importForm.unitCost),
              }
            : {
                itemId: resolvedItemId,
                quantity: Number(importForm.quantity),
                unitCost: Number(importForm.unitCost),
              },
        ],
      };

      const res = await fetch('/api/inventory/v1/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        alert(
          isNewMaterial
            ? `Tạo phụ tùng mới [${importForm.newItemCode}] và Nhập kho thành công!`
            : 'Tạo phiếu nhập kho thành công!',
        );
        window.location.reload();
      } else {
        alert(`Lỗi nhập kho: ${await readErrorMessage(res, 'Thất bại')}`);
      }
    } catch {
      alert('Lỗi kết nối máy chủ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    const exportItemId = effectiveExportItemId;
    if (!exportForm.warehouseId || !exportItemId) {
      alert('Vui lòng chọn kho và thiết bị/vật tư cần xuất.');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/inventory/v1/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueNo: exportForm.issueNo,
          warehouseId: exportForm.warehouseId,
          destination: exportForm.destination,
          referenceType: exportForm.referenceType,
          referenceId: exportForm.referenceId,
          lines: [{ itemId: exportItemId, quantity: Number(exportForm.quantity) }],
        }),
      });

      if (res.ok) {
        alert(`Tạo phiếu xuất kho ${exportForm.issueNo} tới [${exportForm.destination}] thành công!`);
        window.location.reload();
      } else {
        alert(`Lỗi xuất kho: ${await readErrorMessage(res, 'Không đủ tồn kho khả dụng')}`);
      }
    } catch {
      alert('Lỗi kết nối máy chủ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const [showCreateItemModal, setShowCreateItemModal] = useState(false);
  const [createItemForm, setCreateItemForm] = useState({
    code: '',
    name: '',
    uomCode: 'Cái',
    category: 'SPARE_PART',
    manufacturer: '',
    trackingType: 'NONE' as 'NONE' | 'SERIAL' | 'LOT',
    costingMethod: 'FIFO' as 'FIFO' | 'AVERAGE',
    minStock: 0,
    maxStock: 100,
  });

  const handleCreateItemDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/inventory/v1/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: createItemForm.code.trim().toUpperCase(),
          name: createItemForm.name.trim(),
          uomCode: createItemForm.uomCode.trim(),
          trackingType: createItemForm.trackingType,
          costingMethod: createItemForm.costingMethod,
          minStock: Number(createItemForm.minStock) || 0,
          maxStock: Number(createItemForm.maxStock) || 0,
        }),
      });
      if (res.ok) {
        alert(`Tạo vật tư [${createItemForm.code.toUpperCase()}] thành công!`);
        window.location.reload();
      } else {
        alert(`Lỗi tạo vật tư: ${await readErrorMessage(res, 'Thất bại')}`);
      }
    } catch {
      alert('Lỗi kết nối máy chủ');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <header>
        <div>
          <small>OPERATIONS · INVENTORY</small>
          <h1>Kho & Vật tư Nhà máy</h1>
          <p>Mô hình 1 kho cho mỗi nhà máy: Chọn kho nguồn để xuất thiết bị tới các vị trí lắp đặt/vận hành.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {view === 'stock' ? <button
            style={{
              padding: '8px 14px',
              background: '#125b45',
              color: '#fff',
              border: 0,
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            onClick={() => handleOpenImportModal()}
          >
            + Nhập kho (Hàng có sẵn / Phụ tùng mới)
          </button> : null}
          {view === 'stock' ? <button
            style={{
              padding: '8px 14px',
              background: '#e06544',
              color: '#fff',
              border: 0,
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            onClick={() => handleOpenExportModal()}
          >
            - Xuất kho (Theo từng nhà kho)
          </button> : null}
          <a
            href={`/t/${tenantSlug}`}
            style={{
              padding: '8px 14px',
              background: '#fff',
              border: '1px solid #c9d9d3',
              borderRadius: '6px',
              textDecoration: 'none',
              color: '#333',
              fontWeight: 600,
            }}
          >
            ← Portal
          </a>
        </div>
      </header>

      <nav>
        {[
          ['dashboard', 'Tổng quan', base],
          ['assets', 'Tài sản & BOM', `${base}/assets`],
          ['items', 'Danh mục vật tư', `${base}/items`],
          ['warehouses', 'Kho mỗi nhà máy', `${base}/warehouses`],
          ['stock', 'Tồn kho thực tế', `${base}/stock`],
          ['serials', 'Serial / Rotable', `${base}/serials`],
          ['reservations', 'Giữ chỗ', `${base}/reservations`],
          ['transactions', 'Sổ cái giao dịch', `${base}/transactions`],
        ].map(([id, label, url]) => (
          <a className={view === id ? styles.active : ''} href={url} key={id}>
            {label}
          </a>
        ))}
      </nav>

      {view === 'dashboard' ? (
        <>
          <PlantFilterBar
            plants={plantSummaries}
            selectedPlant={selectedPlant}
            onSelectPlant={setSelectedPlant}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            totalOnHandAll={total}
          />

          <section className={styles.metrics}>
            <Metric label={`Kho lưu trữ (${displayMetrics.plantLabel})`} value={displayMetrics.warehouseCount} />
            <Metric label="Mã vật tư SKU" value={displayMetrics.skuCount} />
            <Metric label="Tổng tồn vật lý" value={displayMetrics.totalOnHand} />
            <Metric label="Tồn khả dụng" value={displayMetrics.totalAvailable} />
            <Metric label="Cảnh báo tồn thấp" value={displayMetrics.lowStockCount} warn={displayMetrics.lowStockCount > 0} />
          </section>

          {selectedPlant === 'ALL' ? (
            <div>
              <div style={{ marginBottom: '10px', fontWeight: 700, color: '#123e32', fontSize: '15px' }}>
                📊 Tổng hợp tồn kho 3 Nhà máy chính
              </div>
              <div className={styles.plantGrid}>
                {plantSummaries.map((p) => (
                  <div
                    key={p.code}
                    className={styles.plantCard}
                    onClick={() => setSelectedPlant(p.code)}
                    title={`Click để lọc dữ liệu của ${p.name}`}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span className={`${styles.plantBadge} ${p.badgeClass}`}>
                          {p.icon} {p.code}
                        </span>
                        <small style={{ color: '#1f6f57', fontWeight: 600 }}>Xem tồn kho →</small>
                      </div>
                      <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#123e32' }}>{p.name}</h3>
                      <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#688278' }}>{p.warehouse.name}</p>
                    </div>
                    <div style={{ background: '#f8faf9', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e6eeea' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '13px' }}>
                        <span style={{ color: '#688278' }}>Tồn vật lý:</span>
                        <strong style={{ color: '#123e32' }}>{p.totalOnHand.toLocaleString('vi-VN')} SP</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '13px' }}>
                        <span style={{ color: '#688278' }}>Khả dụng:</span>
                        <strong style={{ color: '#1f6f57' }}>{p.totalAvailable.toLocaleString('vi-VN')} SP</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                        <span style={{ color: '#688278' }}>Quy mô:</span>
                        <span style={{ fontWeight: 600 }}>
                          {p.skuCount} SKU {p.lowStockCount > 0 ? `(${p.lowStockCount} cảnh báo)` : '(An toàn)'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.plantBanner}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span className={`${styles.plantBadge} ${currentPlantObj?.badgeClass}`}>
                    {currentPlantObj?.icon} {currentPlantObj?.code}
                  </span>
                  <strong style={{ fontSize: '16px', color: '#123e32' }}>{currentPlantObj?.name}</strong>
                </div>
                <small style={{ color: '#557268' }}>
                  {currentPlantObj?.warehouse.name} · {currentPlantObj?.warehouse.address || 'Khu kỹ thuật trung tâm'} · {currentPlantObj?.warehouse.locationCount} vị trí lưu trữ
                </small>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setSelectedPlant('ALL')}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: '#fff',
                    border: '1px solid #c9d9d3',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  ✕ Bỏ lọc nhà máy
                </button>
              </div>
            </div>
          )}

          <Balances
            rows={filteredBalances}
            title={selectedPlant === 'ALL' ? 'Tồn kho theo SKU & Nhà kho' : `Tồn kho SKU — ${currentPlantObj?.name}`}
            onExport={(whId, itemId) => handleOpenExportModal(whId, itemId)}
            onImport={(whId, itemId) => handleOpenImportModal(whId, itemId)}
            warehouses={data.warehouses}
          />
        </>
      ) : null}

      {view === 'assets' ? (
        <AssetTreeExplorer assets={data.assets} assetStatuses={data.assetStatuses} />
      ) : null}

      {view === 'items' ? (
        <section className={styles.panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>Material Master — Danh mục vật tư & Phụ tùng ({data.items.length})</h2>
            <button
              style={{
                padding: '8px 16px',
                background: '#125b45',
                color: '#fff',
                border: 0,
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '13px',
              }}
              onClick={() => setShowCreateItemModal(true)}
            >
              + Thêm vật tư mới
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Mã SKU</th>
                <th>Tên vật tư</th>
                <th>Phân loại</th>
                <th>Nhà sản xuất</th>
                <th>ĐVT</th>
                <th>Theo dõi</th>
                <th>Tồn min / ROP / max</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((x) => (
                <tr key={x.id}>
                  <td>
                    <b>{x.code}</b>
                  </td>
                  <td>{x.name}</td>
                  <td>{x.category ?? '—'}</td>
                  <td>{x.manufacturer ?? '—'}</td>
                  <td>{x.uom}</td>
                  <td>{x.trackingType}</td>
                  <td>
                    {x.minStock} / {x.reorderPoint ?? 0} / {x.maxStock}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Empty show={!data.items.length} />
        </section>
      ) : null}

      {view === 'warehouses' ? (
        <section className={styles.cards}>
          {data.warehouses.map((x) => (
            <article key={x.id} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <span>
                  {x.plantCode ? `NHÀ MÁY: ${x.plantCode}` : 'TOÀN CÔNG TY'} · {x.warehouseType ?? x.type}
                </span>
                <h2>{x.code}</h2>
                <p style={{ fontWeight: 600, color: '#125b45', marginBottom: '4px' }}>{x.name}</p>
                {x.address ? <small style={{ display: 'block', marginBottom: '10px' }}>{x.address}</small> : null}
                <strong>
                  {x.locationCount} vị trí lưu trữ · {x.itemCount} SKU · {x.totalOnHand.toLocaleString('vi-VN')} đơn vị tồn
                </strong>
              </div>
            </article>
          ))}
          <Empty show={!data.warehouses.length} />
        </section>
      ) : null}

      {view === 'stock' ? (
        <>
          <PlantFilterBar
            plants={plantSummaries}
            selectedPlant={selectedPlant}
            onSelectPlant={setSelectedPlant}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            totalOnHandAll={total}
          />

          <div className={styles.plantBanner} style={{ marginTop: '-6px' }}>
            <div>
              <span style={{ fontSize: '13px', color: '#557268' }}>
                Đang hiển thị: <strong style={{ color: '#123e32' }}>{filteredBalances.length}</strong> dòng tồn kho thuộc{' '}
                <strong style={{ color: '#1f6f57' }}>
                  {selectedPlant === 'ALL' ? 'Tất cả nhà máy' : currentPlantObj?.name}
                </strong>
                {searchTerm ? ` (khớp từ khóa "${searchTerm}")` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
              <span>
                Tồn vật lý: <strong>{filteredBalances.reduce((s, x) => s + x.onHand, 0).toLocaleString('vi-VN')}</strong>
              </span>
              <span>
                Khả dụng:{' '}
                <strong style={{ color: '#1f6f57' }}>
                  {filteredBalances.reduce((s, x) => s + x.available, 0).toLocaleString('vi-VN')}
                </strong>
              </span>
              <span>
                Đã giữ chỗ: <strong>{filteredBalances.reduce((s, x) => s + x.reserved, 0).toLocaleString('vi-VN')}</strong>
              </span>
            </div>
          </div>

          <Balances
            rows={filteredBalances}
            title={selectedPlant === 'ALL' ? 'Tồn kho thực tế theo SKU & Nhà kho' : `Tồn kho thực tế — ${currentPlantObj?.name}`}
            onExport={(whId, itemId) => handleOpenExportModal(whId, itemId)}
            onImport={(whId, itemId) => handleOpenImportModal(whId, itemId)}
            warehouses={data.warehouses}
          />
        </>
      ) : null}

      {view === 'serials' ? (
        <section className={styles.panel}>
          <h2>Vòng đời Serial / Rotable</h2>
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Vật tư</th>
                <th>Serial nhà sản xuất</th>
                <th>Mã nội bộ</th>
                <th>Trạng thái</th>
                <th>Vị trí hiện tại</th>
              </tr>
            </thead>
            <tbody>
              {data.serials.map((x) => (
                <tr key={x.id}>
                  <td>
                    <b>{x.itemCode}</b>
                  </td>
                  <td>{x.itemName}</td>
                  <td>{x.serialNumber}</td>
                  <td>{x.internalCode ?? '—'}</td>
                  <td>{x.status}</td>
                  <td>{x.assetCode ?? x.warehouseCode ?? x.locationType}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Empty show={!data.serials.length} />
        </section>
      ) : null}

      {view === 'reservations' ? (
        <section className={styles.panel}>
          <h2>Phiếu giữ chỗ vật tư</h2>
          <table>
            <thead>
              <tr>
                <th>Mã phiếu</th>
                <th>Tham chiếu</th>
                <th>Trạng thái</th>
                <th>Số dòng</th>
                <th>Tổng giữ chỗ</th>
                <th>Hết hạn</th>
              </tr>
            </thead>
            <tbody>
              {data.reservations.map((x) => (
                <tr key={x.id}>
                  <td>
                    <b>{x.code}</b>
                  </td>
                  <td>
                    {x.referenceType}
                    <small>{x.referenceId}</small>
                  </td>
                  <td>{x.status}</td>
                  <td>{x.lineCount}</td>
                  <td>{x.totalReserved}</td>
                  <td>
                    {x.expiresAt
                      ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(x.expiresAt))
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Empty show={!data.reservations.length} />
        </section>
      ) : null}

      {view === 'transactions' ? (
        <section className={styles.panel}>
          <h2>Sổ cái giao dịch kho (Xuất / Nhập)</h2>
          <p>{data.transactions.length} giao dịch gần nhất, thể hiện rõ kho xuất/nhập và đích đến/nguồn gốc.</p>
          <table>
            <thead>
              <tr>
                <th>Chứng từ</th>
                <th>Thời gian</th>
                <th>Loại GD</th>
                <th>Vật tư</th>
                <th>Kho</th>
                <th>Đích đến / Nguồn</th>
                <th>Biến động</th>
                <th>Số dư</th>
                <th>Tham chiếu</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((x) => (
                <tr key={x.id}>
                  <td>
                    <b>{x.code}</b>
                  </td>
                  <td>
                    {new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(
                      new Date(x.date),
                    )}
                  </td>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: x.type === 'RECEIPT' || x.type === 'IMPORT' ? '#e6f4ea' : '#fce8e6',
                        color: x.type === 'RECEIPT' || x.type === 'IMPORT' ? '#137333' : '#c5221f',
                      }}
                    >
                      {x.type === 'RECEIPT' || x.type === 'IMPORT' ? 'NHẬP KHO' : 'XUẤT KHO'}
                    </span>
                  </td>
                  <td>
                    <b>{x.itemCode}</b>
                    <small>{x.itemName}</small>
                  </td>
                  <td>{x.warehouseCode}</td>
                  <td>
                    <span style={{ fontSize: '12px', color: '#444' }}>
                      {x.destination
                        ? `→ ${x.destination}`
                        : x.sourceOrigin
                          ? `← ${x.sourceOrigin}`
                          : x.notes || '—'}
                    </span>
                  </td>
                  <td className={x.quantity < 0 ? styles.low : ''}>
                    {x.quantity > 0 ? '+' : ''}
                    {x.quantity}
                  </td>
                  <td>
                    {x.balanceBefore} → {x.balanceAfter}
                  </td>
                  <td>
                    {x.referenceType}
                    <small>{x.referenceId}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Empty show={!data.transactions.length} />
        </section>
      ) : null}

      {/* Modal: Tạo vật tư mới trực tiếp vào Material Master */}
      {showCreateItemModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '14px',
              width: '540px',
              maxWidth: '92vw',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px 28px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '18px', color: '#134638' }}>+ Đăng ký vật tư / Phụ tùng mới</h3>
            <form onSubmit={handleCreateItemDirect}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#38594e', marginBottom: '6px' }}>
                  Mã SKU vật tư *
                </label>
                <input
                  required
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #c5d8d1', borderRadius: '8px' }}
                  value={createItemForm.code}
                  onChange={(e) => setCreateItemForm({ ...createItemForm, code: e.target.value })}
                  placeholder="VD: RO-GEN-102, OIL-SYN-46..."
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#38594e', marginBottom: '6px' }}>
                  Tên gọi vật tư / Phụ tùng *
                </label>
                <input
                  required
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #c5d8d1', borderRadius: '8px' }}
                  value={createItemForm.name}
                  onChange={(e) => setCreateItemForm({ ...createItemForm, name: e.target.value })}
                  placeholder="VD: Gioăng cao su làm kín gối trục"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#38594e', marginBottom: '6px' }}>
                    Đơn vị tính (ĐVT) *
                  </label>
                  <input
                    required
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #c5d8d1', borderRadius: '8px' }}
                    value={createItemForm.uomCode}
                    onChange={(e) => setCreateItemForm({ ...createItemForm, uomCode: e.target.value })}
                    placeholder="VD: Cái, Bộ, Mét, Lít, Kg..."
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#38594e', marginBottom: '6px' }}>
                    Phân loại
                  </label>
                  <select
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #c5d8d1', borderRadius: '8px' }}
                    value={createItemForm.category}
                    onChange={(e) => setCreateItemForm({ ...createItemForm, category: e.target.value })}
                  >
                    <option value="SPARE_PART">Phụ tùng thay thế (Spare Part)</option>
                    <option value="CONSUMABLE">Vật tư tiêu hao (Consumable)</option>
                    <option value="TOOL">Dụng cụ / Công cụ (Tool)</option>
                    <option value="RAW_MATERIAL">Nguyên nhiên vật liệu</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#38594e', marginBottom: '6px' }}>
                    Tồn tối thiểu (Min Stock)
                  </label>
                  <input
                    type="number"
                    min="0"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #c5d8d1', borderRadius: '8px' }}
                    value={createItemForm.minStock}
                    onChange={(e) => setCreateItemForm({ ...createItemForm, minStock: Number(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#38594e', marginBottom: '6px' }}>
                    Tồn tối đa (Max Stock)
                  </label>
                  <input
                    type="number"
                    min="0"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #c5d8d1', borderRadius: '8px' }}
                    value={createItemForm.maxStock}
                    onChange={(e) => setCreateItemForm({ ...createItemForm, maxStock: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px', paddingTop: '14px', borderTop: '1px solid #e7efe9' }}>
                <button
                  type="button"
                  style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #ceded6', background: '#fff', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setShowCreateItemModal(false)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{ padding: '8px 18px', borderRadius: '8px', border: 0, background: '#125b45', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                >
                  {isSubmitting ? 'Đang lưu…' : 'Tạo vật tư'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nhập kho (Hỗ trợ vật tư có sẵn & Nhập phụ tùng mới hoàn toàn) */}
      {view === 'stock' && showImportModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '14px',
              width: '540px',
              maxWidth: '92vw',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 12px', color: '#125b45' }}>+ Lập phiếu Nhập kho (Goods Receipt)</h3>

            {/* Chế độ chọn vật tư */}
            <div
              style={{
                display: 'flex',
                gap: '12px',
                padding: '10px',
                background: '#f0f7f4',
                borderRadius: '8px',
                marginBottom: '16px',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="importMode"
                  checked={!isNewMaterial}
                  onChange={() => setIsNewMaterial(false)}
                />
                Vật tư đã có khai báo
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: '#125b45',
                }}
              >
                <input
                  type="radio"
                  name="importMode"
                  checked={isNewMaterial}
                  onChange={() => setIsNewMaterial(true)}
                />
                ✨ Nhập phụ tùng mới hoàn toàn
              </label>
            </div>

            <form onSubmit={handleImport}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                    Mã phiếu nhập *
                  </label>
                  <input
                    required
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px', border: '1px solid #ccc', borderRadius: '6px' }}
                    value={importForm.receiptNo}
                    onChange={(e) => setImportForm({ ...importForm, receiptNo: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                    Nhập vào kho nhà máy *
                  </label>
                  <select
                    required
                    style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '6px' }}
                    value={importForm.warehouseId}
                    onChange={(e) => setImportForm({ ...importForm, warehouseId: e.target.value })}
                  >
                    {data.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} - {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!isNewMaterial ? (
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                    Chọn vật tư có sẵn *
                  </label>
                  <select
                    required
                    style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '6px' }}
                    value={importForm.itemId || effectiveImportItemId}
                    onChange={(e) => setImportForm({ ...importForm, itemId: e.target.value })}
                  >
                    {uniqueItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.code} - {it.name} ({it.uom})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div
                  style={{
                    border: '1px solid #c9d9d3',
                    background: '#fafcfb',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '12px',
                  }}
                >
                  <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: '#125b45' }}>
                    Thông tin phụ tùng / vật tư mới:
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#666', marginBottom: '3px' }}>
                        Mã phụ tùng (SKU) *
                      </label>
                      <input
                        required={isNewMaterial}
                        placeholder="VD: VT-HPP-VALVE-01"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '7px', border: '1px solid #ccc', borderRadius: '5px', fontSize: '12px' }}
                        value={importForm.newItemCode}
                        onChange={(e) => setImportForm({ ...importForm, newItemCode: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#666', marginBottom: '3px' }}>
                        Tên phụ tùng / vật tư *
                      </label>
                      <input
                        required={isNewMaterial}
                        placeholder="VD: Van điện từ điều khiển 24VDC"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '7px', border: '1px solid #ccc', borderRadius: '5px', fontSize: '12px' }}
                        value={importForm.newItemName}
                        onChange={(e) => setImportForm({ ...importForm, newItemName: e.target.value })}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#666', marginBottom: '3px' }}>
                        Đơn vị tính *
                      </label>
                      <input
                        required={isNewMaterial}
                        placeholder="Cái, Bộ, Phuy..."
                        style={{ width: '100%', boxSizing: 'border-box', padding: '7px', border: '1px solid #ccc', borderRadius: '5px', fontSize: '12px' }}
                        value={importForm.newItemUom}
                        onChange={(e) => setImportForm({ ...importForm, newItemUom: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#666', marginBottom: '3px' }}>
                        Nhà sản xuất
                      </label>
                      <input
                        placeholder="VD: Siemens, SKF..."
                        style={{ width: '100%', boxSizing: 'border-box', padding: '7px', border: '1px solid #ccc', borderRadius: '5px', fontSize: '12px' }}
                        value={importForm.newItemManufacturer}
                        onChange={(e) => setImportForm({ ...importForm, newItemManufacturer: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#666', marginBottom: '3px' }}>
                        Tồn tối thiểu
                      </label>
                      <input
                        type="number"
                        min="0"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '7px', border: '1px solid #ccc', borderRadius: '5px', fontSize: '12px' }}
                        value={importForm.newItemMinStock}
                        onChange={(e) => setImportForm({ ...importForm, newItemMinStock: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                  Nguồn nhập / Nhà cung cấp / Đơn vị giao
                </label>
                <input
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px', border: '1px solid #ccc', borderRadius: '6px' }}
                  value={importForm.sourceOrigin}
                  onChange={(e) => setImportForm({ ...importForm, sourceOrigin: e.target.value })}
                  placeholder="VD: Nhà cung cấp SKF Việt Nam, Đơn mua PO-2026-01"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                    Số lượng nhập *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px', border: '1px solid #ccc', borderRadius: '6px' }}
                    value={importForm.quantity}
                    onChange={(e) => setImportForm({ ...importForm, quantity: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                    Đơn giá (VNĐ)
                  </label>
                  <input
                    type="number"
                    min="0"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px', border: '1px solid #ccc', borderRadius: '6px' }}
                    value={importForm.unitCost}
                    onChange={(e) => setImportForm({ ...importForm, unitCost: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  style={{ padding: '8px 14px', background: '#fff', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer' }}
                  onClick={() => setShowImportModal(false)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !data.warehouses.length || (!isNewMaterial && !data.items.length)}
                  style={{ padding: '8px 14px', background: '#125b45', color: '#fff', border: 0, borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                >
                  {isSubmitting ? 'Đang xử lý...' : isNewMaterial ? 'Tạo mới & Nhập kho' : 'Xác nhận Nhập kho'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Xuất kho (Chọn nhà kho lưu trữ -> Chỉ hiển thị thiết bị/vật tư có trong kho đó) */}
      {view === 'stock' && showExportModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '14px',
              width: '540px',
              maxWidth: '92vw',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 16px', color: '#e06544' }}>- Lập phiếu Xuất kho (Goods Issue)</h3>
            <form onSubmit={handleExport}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                  Mã phiếu xuất *
                </label>
                <input
                  required
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px', border: '1px solid #ccc', borderRadius: '6px' }}
                  value={exportForm.issueNo}
                  onChange={(e) => setExportForm({ ...exportForm, issueNo: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#125b45', marginBottom: '4px' }}>
                    🏢 1. Chọn nhà kho xuất hàng *
                  </label>
                  <select
                    required
                    style={{ width: '100%', padding: '8px', border: '2px solid #125b45', borderRadius: '6px', fontWeight: 600 }}
                    value={exportForm.warehouseId}
                    onChange={(e) => handleWarehouseChangeForExport(e.target.value)}
                  >
                    {data.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} - {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                    🎯 2. Xuất tới đâu (Nơi nhận) *
                  </label>
                  <input
                    required
                    placeholder="VD: Gian máy H1, Trụ gió WTG-01..."
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px', border: '1px solid #ccc', borderRadius: '6px' }}
                    value={exportForm.destination}
                    onChange={(e) => setExportForm({ ...exportForm, destination: e.target.value })}
                  />
                </div>
              </div>

              {/* Mục Thiết bị / Vật tư: Chỉ hiển thị các thiết bị có tồn kho trong nhà kho đã chọn */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                  📦 3. Thiết bị / Vật tư trong kho này ({availableItemsInSelectedWarehouse.length} mục có sẵn) *
                </label>

                {availableItemsInSelectedWarehouse.length > 0 ? (
                  <>
                    <select
                      required
                      style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '6px', fontWeight: 500 }}
                      value={effectiveExportItemId}
                      onChange={(e) => setExportForm({ ...exportForm, itemId: e.target.value })}
                    >

                      {availableItemsInSelectedWarehouse.map((b) => (
                        <option key={b.itemId} value={b.itemId}>
                          {b.itemCode} - {b.itemName} — [Khả dụng: {b.available} {b.uom}]
                        </option>
                      ))}
                    </select>

                    {currentSelectedItemBalance && (
                      <div
                        style={{
                          marginTop: '6px',
                          fontSize: '12px',
                          color: '#125b45',
                          background: '#eaf4ee',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: '1px solid #c8e4d2',
                        }}
                      >
                        ✓ Tồn vật lý trong kho: <strong>{currentSelectedItemBalance.onHand} {currentSelectedItemBalance.uom}</strong> (Tồn khả dụng: <strong>{currentSelectedItemBalance.available} {currentSelectedItemBalance.uom}</strong>{currentSelectedItemBalance.reserved > 0 ? `, Đang giữ chỗ: ${currentSelectedItemBalance.reserved} ${currentSelectedItemBalance.uom}` : ''})
                      </div>
                    )}
                  </>
                ) : (
                  <div
                    style={{
                      border: '1px dashed #e06544',
                      background: '#fdf5f3',
                      color: '#c5221f',
                      padding: '10px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      lineHeight: '1.4',
                    }}
                  >
                    ⚠️ <strong>Nhà kho này hiện chưa có thiết bị / vật tư nào có tồn khả dụng để xuất.</strong>
                    <br />
                    Vui lòng chọn nhà kho khác hoặc thực hiện Nhập kho trước.
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                    Số lượng xuất {currentSelectedItemBalance ? `(Max: ${currentSelectedItemBalance.available} ${currentSelectedItemBalance.uom})` : ''} *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={currentSelectedItemBalance?.available || 99999}
                    required
                    disabled={availableItemsInSelectedWarehouse.length === 0}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px',
                      border: '1px solid #ccc',
                      borderRadius: '6px',
                      background: availableItemsInSelectedWarehouse.length === 0 ? '#f5f5f5' : '#fff',
                    }}
                    value={exportForm.quantity}
                    onChange={(e) => setExportForm({ ...exportForm, quantity: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                    Mã Lệnh bảo trì / Work Order
                  </label>
                  <input
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px', border: '1px solid #ccc', borderRadius: '6px' }}
                    value={exportForm.referenceId}
                    onChange={(e) => setExportForm({ ...exportForm, referenceId: e.target.value })}
                    placeholder="VD: WO-2026-0815"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  style={{ padding: '8px 14px', background: '#fff', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer' }}
                  onClick={() => setShowExportModal(false)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || availableItemsInSelectedWarehouse.length === 0}
                  style={{
                    padding: '8px 14px',
                    background: availableItemsInSelectedWarehouse.length === 0 ? '#bbb' : '#e06544',
                    color: '#fff',
                    border: 0,
                    borderRadius: '6px',
                    cursor: availableItemsInSelectedWarehouse.length === 0 ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {isSubmitting ? 'Đang xử lý...' : 'Xác nhận Xuất kho'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

function Metric({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <article className={warn ? styles.warn : ''}>
      <span>{label}</span>
      <strong>{value.toLocaleString('vi-VN')}</strong>
    </article>
  );
}

function PlantFilterBar({
  plants,
  selectedPlant,
  onSelectPlant,
  searchTerm,
  onSearchChange,
  totalOnHandAll,
}: {
  plants: Array<{
    code: string;
    name: string;
    shortLabel: string;
    icon: string;
    totalOnHand: number;
    skuCount: number;
  }>;
  selectedPlant: string;
  onSelectPlant: (code: string) => void;
  searchTerm?: string;
  onSearchChange?: (term: string) => void;
  totalOnHandAll: number;
}) {
  return (
    <div className={styles.filterContainer}>
      <div className={styles.filterTopRow}>
        <div className={styles.filterTitle}>
          <span>🏭 BỘ LỌC THEO NHÀ MÁY:</span>
        </div>
        {onSearchChange && (
          <input
            type="search"
            className={styles.filterSearchInput}
            placeholder="🔍 Tìm theo SKU, tên vật tư, kho..."
            value={searchTerm || ''}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        )}
      </div>
      <div className={styles.filterPills}>
        <button
          type="button"
          className={`${styles.filterPill} ${selectedPlant === 'ALL' ? styles.filterPillActive : ''}`}
          onClick={() => onSelectPlant('ALL')}
        >
          <span>🌐 Tất cả nhà máy</span>
          <span className={styles.filterPillBadge}>{totalOnHandAll.toLocaleString('vi-VN')} đơn vị</span>
        </button>

        {plants.map((p) => (
          <button
            type="button"
            key={p.code}
            className={`${styles.filterPill} ${selectedPlant === p.code ? styles.filterPillActive : ''}`}
            onClick={() => onSelectPlant(p.code)}
          >
            <span>
              {p.icon} {p.shortLabel}
            </span>
            <span className={styles.filterPillBadge}>
              {p.totalOnHand.toLocaleString('vi-VN')} SP · {p.skuCount} SKU
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Balances({
  rows,
  title = 'Tồn kho theo SKU & Nhà kho',
  onExport,
  onImport,
  warehouses = [],
}: {
  rows: InventoryWorkspaceDto['balances'];
  title?: string;
  onExport?: (warehouseId: string, itemId?: string) => void;
  onImport?: (warehouseId: string, itemId?: string) => void;
  warehouses?: InventoryWorkspaceDto['warehouses'];
}) {
  const warehouseMap = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  return (
    <section className={styles.panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span style={{ fontSize: '12px', color: '#688278', fontWeight: 600 }}>
          {rows.length} mục tồn kho
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Vật tư / Thiết bị</th>
            <th>Nhà máy & Kho lưu trữ</th>
            <th>Tồn vật lý (On-hand)</th>
            <th>Đã giữ chỗ</th>
            <th>Khả dụng</th>
            {(onExport || onImport) && <th style={{ textAlign: 'right' }}>Thao tác</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((x, idx) => {
            const wh = warehouseMap.get(x.warehouseId);
            const plantCode = x.plantCode || wh?.plantCode || '';
            let badgeClass = styles.plantBadgeGeneric;
            let plantLabel = plantCode;
            if (plantCode.includes('HPP') || x.warehouseCode?.includes('HPP')) {
              badgeClass = styles.plantBadgeHpp;
              plantLabel = '💧 Thủy điện (HPP-01)';
            } else if (plantCode.includes('SPP') || x.warehouseCode?.includes('SPP')) {
              badgeClass = styles.plantBadgeSpp;
              plantLabel = '☀️ Solar (SPP-01)';
            } else if (plantCode.includes('WPP') || x.warehouseCode?.includes('WPP')) {
              badgeClass = styles.plantBadgeWpp;
              plantLabel = '💨 Điện gió (WPP-01)';
            }

            return (
              <tr key={`${x.warehouseId}-${x.itemId}-${idx}`}>
                <td>
                  <b>{x.itemCode}</b>
                  <small>{x.itemName}</small>
                </td>
                <td>
                  {plantLabel ? (
                    <div style={{ marginBottom: '3px' }}>
                      <span className={`${styles.plantBadge} ${badgeClass}`}>{plantLabel}</span>
                    </div>
                  ) : null}
                  <span style={{ fontWeight: 600, color: '#125b45', fontSize: '12px' }}>
                    {x.warehouseCode}
                  </span>
                  {wh?.name && wh.name !== x.warehouseCode ? (
                    <small style={{ display: 'block', color: '#688278', fontSize: '11px' }}>{wh.name}</small>
                  ) : null}
                </td>
                <td>
                  <strong>{x.onHand.toLocaleString('vi-VN')}</strong> <small style={{ display: 'inline' }}>{x.uom}</small>
                </td>
                <td>{x.reserved.toLocaleString('vi-VN')}</td>
                <td className={x.available <= x.minStock ? styles.low : ''}>
                  <strong>{x.available.toLocaleString('vi-VN')}</strong>
                  {x.available <= x.minStock ? (
                    <small style={{ display: 'block', color: '#c5221f', fontWeight: 600 }}>
                      ⚠️ Dưới mức min ({x.minStock})
                    </small>
                  ) : null}
                </td>
                {(onExport || onImport) && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: '6px', justifyContent: 'flex-end' }}>
                      {x.available > 0 && onExport && (
                        <button
                          style={{
                            padding: '5px 10px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: '#fdf5f3',
                            color: '#c5221f',
                            border: '1px solid #fadcd5',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                          onClick={() => onExport(x.warehouseId, x.itemId)}
                        >
                          Xuất kho
                        </button>
                      )}
                      {onImport && (
                        <button
                          style={{
                            padding: '5px 10px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: x.available === 0 ? '#e6f4ea' : '#f4f7f5',
                            color: '#125b45',
                            border: x.available === 0 ? '1px solid #ceead6' : '1px solid #c9d9d3',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                          onClick={() => onImport(x.warehouseId, x.itemId)}
                        >
                          + Nhập hàng
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <Empty show={!rows.length} />
    </section>
  );
}

function Empty({ show }: { show: boolean }) {
  return show ? (
    <p className={styles.empty}>Chưa có dữ liệu tồn kho. Sử dụng tính năng Nhập kho để bắt đầu.</p>
  ) : null;
}
