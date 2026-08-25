'use client';

import type { Material } from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AssetDetail } from './components/asset-detail';
import { AssetForm } from './components/asset-form';
import { AssetTree } from './components/asset-tree';
import { InventoryDashboard } from './components/inventory-dashboard';
import { MaterialForm } from './components/material-form';
import { MovementForm, type MovementInput } from './components/movement-form';
import { StockTable } from './components/stock-table';
import { TransactionHub } from './components/transaction-hub';
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
import styles from './inventory.module.scss';

type Tab = 'dashboard' | 'materials' | 'assets' | 'transactions';

interface NavigationItem {
  id: Tab;
  num: string;
  label: string;
  caption: string;
  icon: string;
}

const TABS: ReadonlyArray<NavigationItem> = [
  { id: 'dashboard', num: '01', label: 'Dashboard Kho', caption: 'Tổng quan vận hành', icon: '📊' },
  { id: 'materials', num: '02', label: 'Vật tư & Tồn kho', caption: 'Danh mục & serial', icon: '📦' },
  { id: 'assets', num: '03', label: 'Thiết bị (Asset 360)', caption: 'Cây tài sản đa tầng', icon: '⚙️' },
  { id: 'transactions', num: '04', label: 'Xuất - Nhập kho', caption: 'Giao dịch & Work Order', icon: '⇄' },
];

/** Map hash URL cũ để link chia sẻ hoặc bookmark không bị hỏng */
const LEGACY_TAB: Readonly<Record<string, Tab>> = {
  overview: 'dashboard',
  dashboard: 'dashboard',
  stock: 'materials',
  materials: 'materials',
  warehouses: 'materials',
  serials: 'materials',
  reservations: 'materials',
  assets: 'assets',
  ledger: 'transactions',
  transactions: 'transactions',
};

function initialTab(): Tab {
  if (typeof window === 'undefined') return 'dashboard';
  const hash = window.location.hash.slice(1);
  if (TABS.some((tab) => tab.id === hash)) return hash as Tab;
  return LEGACY_TAB[hash] ?? 'dashboard';
}

export function InventoryScreen() {
  const [tab, setTab] = useState<Tab>('dashboard');
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
        return `Đã nhập kho thành công — chứng từ ${tx.transactionCode}.`;
      }
      if (input.kind === 'issue') {
        const tx = await issueStock({
          warehouseCode: input.warehouseCode,
          materialCode: input.materialCode,
          quantity: input.quantity,
          note: input.note,
        });
        return `Đã xuất kho thành công — chứng từ ${tx.transactionCode}.`;
      }
      const moved = await transferStock({
        fromWarehouseCode: input.warehouseCode,
        toWarehouseCode: input.toWarehouseCode ?? '',
        materialCode: input.materialCode,
        quantity: input.quantity,
        note: input.note,
      });
      return `Đã chuyển kho thành công — chứng từ ${moved.out.transactionCode} / ${moved.in.transactionCode}.`;
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

  const selectedAsset = workspace?.assets.find((asset) => asset.id === selectedAssetId);

  return (
    <div className={styles.shell}>
      {/* SIDEBAR: Enterprise Dark Sapphire (#09192e - #0d223f) */}
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>IN</span>
          <div>
            <strong>Inventory</strong>
            <span>Enterprise Platform</span>
          </div>
        </div>

        <nav className={styles.navigation}>
          <span className={styles.navCategory}>Phân hệ Kho &amp; Vật tư</span>
          {TABS.map((item) => {
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.navButton} ${isActive ? styles.navButtonActive : ''}`}
                onClick={() => setTab(item.id)}
              >
                <span className={styles.navNum}>{item.num}</span>
                <div>
                  <div>{item.label}</div>
                  <small style={{ fontSize: '11px', opacity: 0.65 }}>{item.caption}</small>
                </div>
              </button>
            );
          })}
        </nav>

        <a className={styles.backLink} href={homePath}>
          <span>←</span> Trang chủ hệ thống
        </a>

        <div className={styles.tenantCard}>
          <span>Tenant Context</span>
          <strong>Kho Tổng Nhà Máy</strong>
          <small>16:9 Widescreen Mode</small>
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <div className={styles.main}>
        {/* FROSTED TOP HEADER */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.eyebrow}>
              {TABS.find((t) => t.id === tab)?.label}
            </span>
            <div className={styles.searchBoxGlobal}>
              <span className={styles.searchIcon}>🔍</span>
              <input placeholder="Tìm nhanh mã SKU, Serial, Lệnh WO…" />
            </div>
          </div>

          <div className={styles.headerRight}>
            <div className={styles.warehouseSelector}>
              <span>🏭</span>
              <span>Kho Tổng Nhà Máy</span>
              <span style={{ fontSize: '11px' }}>▼</span>
            </div>

            <button
              type="button"
              className={styles.qrButton}
              onClick={() => window.alert('Đang mở máy quét mã QR/Barcode…')}
            >
              <span>📷</span>
              <span>Quét mã QR</span>
            </button>

            <div className={styles.actorPill}>
              <span className={styles.actorAvatar}>AD</span>
              <div>
                <strong>Admin</strong>
                <small>Quản trị Kho</small>
              </div>
            </div>
          </div>
        </header>

        {/* NOTICES & ALERTS */}
        <main className={styles.container}>
          {error ? (
            <div className={styles.alert}>
              ⚠️ {error}
            </div>
          ) : null}

          {notice ? (
            <div className={styles.notice}>
              ✓ {notice}
            </div>
          ) : null}

          {!workspace ? (
            <div className={styles.loading}>
              <span />
              <p>Đang tải dữ liệu Kho &amp; Vật tư…</p>
            </div>
          ) : (
            <>
              {/* MODALS / OVERLAY FORMS */}
              {form === 'movement' ? (
                <div style={{ marginBottom: '20px' }}>
                  <MovementForm
                    workspace={workspace}
                    busy={busy}
                    onCancel={() => setForm(undefined)}
                    onSubmit={submitMovement}
                  />
                </div>
              ) : null}

              {form === 'material' ? (
                <div style={{ marginBottom: '20px' }}>
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
                          return `Đã cập nhật vật tư ${editingMaterial.code}.`;
                        }
                        const created = await createMaterial(input);
                        return `Đã thêm vật tư mới ${created.code}.`;
                      })
                    }
                  />
                </div>
              ) : null}

              {form === 'asset' ? (
                <div style={{ marginBottom: '20px' }}>
                  <AssetForm
                    assets={workspace.assets}
                    defaultParentCode={selectedAsset?.code}
                    busy={busy}
                    onCancel={() => setForm(undefined)}
                    onSubmit={(input) =>
                      perform(async () => {
                        const created = await createAsset(input);
                        return `Đã thêm thiết bị mới ${created.code}.`;
                      })
                    }
                  />
                </div>
              ) : null}

              {/* TAB 1: DASHBOARD KHO */}
              {tab === 'dashboard' ? (
                <InventoryDashboard
                  workspace={workspace}
                  ledger={ledger}
                  materialByCode={materialByCode}
                  materialById={materialById}
                  onOpenMovement={() => setForm('movement')}
                  onNavigate={(targetTab) => setTab(targetTab)}
                />
              ) : null}

              {/* TAB 2: VẬT TƯ & TỒN KHO */}
              {tab === 'materials' ? (
                <StockTable
                  workspace={workspace}
                  reservations={reservations}
                  materialByCode={materialByCode}
                  busy={busy}
                  onAddMaterial={() => {
                    setEditingMaterial(undefined);
                    setForm('material');
                  }}
                  onEditMaterial={(material) => {
                    setEditingMaterial(material);
                    setForm('material');
                  }}
                  onRetireMaterial={(material) =>
                    perform(async () => {
                      const result = await retireMaterial(material.code);
                      return result.mode === 'deleted'
                        ? `Đã xoá vật tư ${material.code}.`
                        : `Đã ngừng dùng vật tư ${material.code}. ${result.reason ?? ''}`;
                    })
                  }
                />
              ) : null}

              {/* TAB 3: THIẾT BỊ (ASSET 360) */}
              {tab === 'assets' ? (
                <div className={styles.assetLayout}>
                  <AssetTree
                    assets={workspace.assets}
                    selectedId={selectedAssetId}
                    onSelect={setSelectedAssetId}
                    onAddAsset={() => setForm('asset')}
                  />
                  <section style={{ overflowY: 'auto', paddingRight: '4px' }}>
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
                              : `Đã thanh lý thiết bị ${asset.code}. ${result.reason ?? ''}`;
                          })
                        }
                      />
                    ) : (
                      <div className={styles.card} style={{ textAlign: 'center', padding: '40px', color: 'var(--pe-text-muted)' }}>
                        Chọn một thiết bị từ cây tài sản để xem hồ sơ Asset 360.
                      </div>
                    )}
                  </section>
                </div>
              ) : null}

              {/* TAB 4: XUẤT - NHẬP KHO & TRANSACTION HUB */}
              {tab === 'transactions' ? (
                <TransactionHub
                  workspace={workspace}
                  ledger={ledger}
                  reservations={reservations}
                  materialByCode={materialByCode}
                  materialById={materialById}
                  warehouseById={warehouseById}
                  busy={busy}
                  onSubmitMovement={submitMovement}
                />
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
