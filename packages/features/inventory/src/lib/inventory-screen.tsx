'use client';

import type { Material } from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AssetDetail } from './components/asset-detail';
import { AssetForm } from './components/asset-form';
import { AssetTree } from './components/asset-tree';
import { MaterialForm } from './components/material-form';
import { MovementForm, type MovementInput } from './components/movement-form';
import { LedgerTable } from './components/ledger-table';
import { StockTable } from './components/stock-table';
import {
  createAsset,
  createMaterial,
  issueStock,
  loadInventoryWorkspace,
  loadLedger,
  loadReservations,
  loadTenantHomePath,
  receiveStock,
  retireAsset,
  retireMaterial,
  transferStock,
  updateMaterial,
  type InventoryLedgerRow,
  type InventoryReservationRow,
  type InventoryWorkspace,
} from './inventory-api';
import { formatNumber } from './inventory-labels';
import styles from './inventory.module.scss';

type Tab = 'stock' | 'assets' | 'ledger';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'stock', label: 'Tồn kho' },
  { id: 'assets', label: 'Tài sản' },
  { id: 'ledger', label: 'Nhật ký' },
];

/** Tám tab cũ gộp còn ba; giữ hash cũ chuyển hướng để link đã chia sẻ không vỡ. */
const LEGACY_TAB: Readonly<Record<string, Tab>> = {
  overview: 'stock',
  materials: 'stock',
  warehouses: 'stock',
  serials: 'stock',
  reservations: 'stock',
};

function initialTab(): Tab {
  if (typeof window === 'undefined') return 'stock';
  const hash = window.location.hash.slice(1);
  if (TABS.some((tab) => tab.id === hash)) return hash as Tab;
  return LEGACY_TAB[hash] ?? 'stock';
}

export function InventoryScreen() {
  const [tab, setTab] = useState<Tab>('stock');
  const [workspace, setWorkspace] = useState<InventoryWorkspace>();
  const [ledger, setLedger] = useState<InventoryLedgerRow[]>();
  const [reservations, setReservations] = useState<InventoryReservationRow[]>();
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [homePath, setHomePath] = useState('/');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<'material' | 'asset' | 'movement'>();
  const [editingMaterial, setEditingMaterial] = useState<Material>();

  const reload = useCallback(async () => {
    try {
      setError(undefined);
      const [data, ledgerRows, reservationRows] = await Promise.all([
        loadInventoryWorkspace(),
        loadLedger(),
        loadReservations(),
      ]);
      setWorkspace(data);
      setLedger(ledgerRows);
      setReservations(reservationRows);
      setSelectedAssetId((current) => current ?? data.assets[0]?.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu kho.');
    }
  }, []);

  /** Chạy một lệnh ghi rồi nạp lại; gom xử lý lỗi về một chỗ. */
  const perform = async (run: () => Promise<string | void>) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const message = await run();
      setForm(undefined);
      setEditingMaterial(undefined);
      if (message) setNotice(message);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không hoàn tất được thao tác.');
    } finally {
      setBusy(false);
    }
  };

  const submitMovement = (input: MovementInput) =>
    perform(async () => {
      if (input.kind === 'receipt') {
        const tx = await receiveStock({
          warehouseCode: input.warehouseCode,
          materialCode: input.materialCode,
          quantity: input.quantity,
          unitCost: input.unitCost,
          note: input.note,
        });
        return `Đã nhập kho — chứng từ ${tx.transactionCode}.`;
      }
      if (input.kind === 'issue') {
        const tx = await issueStock({
          warehouseCode: input.warehouseCode,
          materialCode: input.materialCode,
          quantity: input.quantity,
          note: input.note,
        });
        return `Đã xuất kho — chứng từ ${tx.transactionCode}.`;
      }
      const moved = await transferStock({
        fromWarehouseCode: input.warehouseCode,
        toWarehouseCode: input.toWarehouseCode ?? '',
        materialCode: input.materialCode,
        quantity: input.quantity,
        note: input.note,
      });
      return `Đã chuyển kho — chứng từ ${moved.out.transactionCode} / ${moved.in.transactionCode}.`;
    });

  useEffect(() => {
    setTab(initialTab());
    void reload();
    void loadTenantHomePath().then(setHomePath);
  }, [reload]);

  useEffect(() => {
    if (typeof window !== 'undefined') window.location.hash = tab;
  }, [tab]);

  const materialByCode = useMemo(() => {
    const map = new Map<string, Material>();
    for (const material of workspace?.materials ?? []) map.set(material.code, material);
    return map;
  }, [workspace]);

  const materialById = useMemo(() => {
    const map = new Map<string, Material>();
    for (const material of workspace?.materials ?? []) map.set(material.id, material);
    return map;
  }, [workspace]);

  const warehouseById = useMemo(() => {
    const map = new Map<string, string>();
    for (const warehouse of workspace?.warehouses ?? []) map.set(warehouse.id, warehouse.code);
    return map;
  }, [workspace]);

  const lowStockCount = useMemo(
    () =>
      (workspace?.stock ?? []).filter((row) => {
        const material = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
        return material ? row.available < material.minStock : false;
      }).length,
    [workspace, materialByCode],
  );

  const totalAvailable = (workspace?.stock ?? []).reduce((sum, row) => sum + row.available, 0);
  const selectedAsset = workspace?.assets.find((asset) => asset.id === selectedAssetId);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1>Kho &amp; Vật tư</h1>
          <p>Tồn thực tế, khả dụng và luân chuyển vật tư theo từng kho.</p>
        </div>
        <div className={styles.headActions}>
          {tab === 'stock' ? (
            <>
              <button
                type="button"
                className={`${styles.action} ${styles.actionPrimary}`}
                onClick={() => setForm('movement')}
              >
                Nhập / xuất kho
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.actionGhost}`}
                onClick={() => {
                  setEditingMaterial(undefined);
                  setForm('material');
                }}
              >
                + Vật tư
              </button>
            </>
          ) : null}
          {tab === 'assets' ? (
            <button
              type="button"
              className={`${styles.action} ${styles.actionGhost}`}
              onClick={() => setForm('asset')}
            >
              + Thiết bị
            </button>
          ) : null}
          <a className={`${styles.action} ${styles.actionGhost}`} href={homePath}>
            ← Trang chủ
          </a>
        </div>
      </header>

      <nav className={styles.tabs}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.tab} ${tab === item.id ? styles.tabActive : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {notice ? <p className={styles.notice}>{notice}</p> : null}

      {!workspace ? (
        <p className={styles.empty}>Đang tải dữ liệu kho…</p>
      ) : (
        <>
          {form === 'movement' ? (
            <MovementForm
              workspace={workspace}
              busy={busy}
              onCancel={() => setForm(undefined)}
              onSubmit={submitMovement}
            />
          ) : null}

          {form === 'material' ? (
            <MaterialForm
              editing={editingMaterial}
              busy={busy}
              onCancel={() => {
                setForm(undefined);
                setEditingMaterial(undefined);
              }}
              onSubmit={(input) =>
                perform(async () => {
                  if (editingMaterial) {
                    await updateMaterial(editingMaterial.code, input);
                    return `Đã cập nhật ${editingMaterial.code}.`;
                  }
                  const created = await createMaterial(input);
                  return `Đã thêm vật tư ${created.code}.`;
                })
              }
            />
          ) : null}

          {form === 'asset' ? (
            <AssetForm
              assets={workspace.assets}
              defaultParentCode={selectedAsset?.code}
              busy={busy}
              onCancel={() => setForm(undefined)}
              onSubmit={(input) =>
                perform(async () => {
                  const created = await createAsset(input);
                  return `Đã thêm thiết bị ${created.code}.`;
                })
              }
            />
          ) : null}

          {tab === 'stock' ? (
            <>
              <div className={styles.statStrip}>
                <span>
                  Mã vật tư <strong>{formatNumber(workspace.materials.length)}</strong>
                </span>
                <span>
                  Tồn khả dụng <strong>{formatNumber(totalAvailable)}</strong>
                </span>
                <span className={lowStockCount > 0 ? styles.statWarn : ''}>
                  Dưới mức tối thiểu <strong>{formatNumber(lowStockCount)}</strong>
                </span>
                <span>
                  Kho hoạt động <strong>{formatNumber(workspace.warehouses.length)}</strong>
                </span>
              </div>
              <StockTable
                workspace={workspace}
                reservations={reservations}
                materialByCode={materialByCode}
                busy={busy}
                onEditMaterial={(material) => {
                  setEditingMaterial(material);
                  setForm('material');
                }}
                onRetireMaterial={(material) =>
                  perform(async () => {
                    const result = await retireMaterial(material.code);
                    // Server quyết xoá hẳn hay chỉ ngừng, tuỳ vật tư đã phát sinh
                    // giao dịch chưa — nói rõ kết quả thay vì báo chung chung.
                    return result.mode === 'deleted'
                      ? `Đã xoá vật tư ${material.code}.`
                      : `Đã ngừng dùng ${material.code}. ${result.reason ?? ''}`;
                  })
                }
              />
            </>
          ) : null}

          {tab === 'assets' ? (
            <div className={styles.assetLayout}>
              <AssetTree
                assets={workspace.assets}
                selectedId={selectedAssetId}
                onSelect={setSelectedAssetId}
              />
              <section>
                {selectedAsset ? (
                  <AssetDetail
                    asset={selectedAsset}
                    busy={busy}
                    onSaved={() => void reload()}
                    onRetire={(asset) =>
                      perform(async () => {
                        const result = await retireAsset(asset.code);
                        setSelectedAssetId(undefined);
                        return result.mode === 'deleted'
                          ? `Đã xoá thiết bị ${asset.code}.`
                          : `Đã thanh lý ${asset.code}. ${result.reason ?? ''}`;
                      })
                    }
                  />
                ) : (
                  <p className={styles.empty}>Chọn một tài sản.</p>
                )}
              </section>
            </div>
          ) : null}

          {tab === 'ledger' ? (
            <LedgerTable
              rows={ledger}
              materialById={materialById}
              warehouseById={warehouseById}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
