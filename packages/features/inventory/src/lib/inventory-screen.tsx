'use client';

import type {
  InventoryCatalogSettings,
  InventorySettingsSnapshot,
  Material,
} from '@enterprise-platform/contracts-inventory';
import {
  DashboardCardPicker,
  DashboardView,
  ModuleSettingsView,
  ModuleShell,
  useHashView,
  type ModuleNavItem,
} from '@enterprise-platform/feature-module-shell';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AssetDetail } from './components/asset-detail';
import { AssetCatalogEditor } from './components/asset-catalog-editor';
import { AssetDocumentPanel } from './components/asset-document-panel';
import { SparePartPanel } from './components/spare-part-panel';
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
  loadInventorySettings,
  loadInventoryWorkspace,
  loadLedger,
  loadReservations,
  loadTenantHomePath,
  receiveStock,
  retireAsset,
  retireMaterial,
  saveInventorySetting,
  transferStock,
  updateMaterial,
  type InventoryLedgerRow,
  type InventoryReservationRow,
  type InventoryWorkspace,
} from './inventory-api';
import {
  INVENTORY_DASHBOARD_CARDS,
  type InventoryDashboardData,
} from './inventory-dashboard.cards';
import styles from './inventory.module.scss';

type Tab = 'dashboard' | 'stock' | 'assets' | 'ledger' | 'settings';

const NAV: readonly ModuleNavItem<Tab>[] = [
  { id: 'dashboard', label: 'Tổng quan' },
  { id: 'stock', label: 'Tồn kho', group: 'Vận hành' },
  { id: 'assets', label: 'Tài sản', group: 'Vận hành' },
  { id: 'ledger', label: 'Nhật ký', group: 'Vận hành' },
  { id: 'settings', label: 'Cài đặt', group: 'Quản trị' },
];

const TAB_IDS = NAV.map((item) => item.id);

/** Tám tab cũ gộp còn ba; giữ hash cũ chuyển hướng để link đã chia sẻ không vỡ. */
const LEGACY_TAB: Readonly<Record<string, Tab>> = {
  overview: 'stock',
  materials: 'stock',
  warehouses: 'stock',
  serials: 'stock',
  reservations: 'stock',
};

export function InventoryScreen() {
  const {
    view: tab,
    sub: hashAsset,
    navigate,
  } = useHashView<Tab>({
    views: TAB_IDS,
    fallback: 'dashboard',
    legacy: LEGACY_TAB,
  });
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
  const [settings, setSettings] = useState<InventorySettingsSnapshot>();
  const [cardDraft, setCardDraft] = useState<readonly string[]>([]);
  const [savingCards, setSavingCards] = useState(false);
  const [settingsSection, setSettingsSection] = useState('dashboard');
  const [assetCatalogDraft, setAssetCatalogDraft] = useState<InventoryCatalogSettings>();

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
    void reload();
    void loadTenantHomePath().then(setHomePath);
  }, [reload]);

  /**
   * Cấu hình chỉ nạp khi thật sự cần: dashboard cần biết thẻ nào bật, màn cài
   * đặt cần cả bản gốc để so sánh thay đổi. Các tab còn lại không dùng tới.
   */
  useEffect(() => {
    // Tab Tài sản cũng cần cấu hình: nó quyết định trường nào được hiện.
    if (tab !== 'dashboard' && tab !== 'settings' && tab !== 'assets') return;
    if (settings) return;
    void loadInventorySettings()
      .then((loaded) => {
        setSettings(loaded);
        setCardDraft(loaded['dashboard.cards'].value.cardIds);
        setAssetCatalogDraft(loaded['catalog.asset'].value);
      })
      .catch(() => setSettings(undefined));
  }, [tab, settings]);

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

  /**
   * `#assets/<mã>` chọn sẵn đúng thiết bị.
   *
   * Module Bảo trì gửi người dùng sang đây bằng dạng link đó khi họ muốn sửa
   * đầu việc; không phân giải thì họ rơi vào thiết bị đầu danh sách và tưởng
   * mình bấm nhầm.
   */
  useEffect(() => {
    if (tab !== 'assets' || !hashAsset || !workspace) return;
    const wanted = decodeURIComponent(hashAsset).toUpperCase();
    const match = workspace.assets.find((asset) => asset.code.toUpperCase() === wanted);
    if (match) setSelectedAssetId(match.id);
  }, [tab, hashAsset, workspace]);

  const selectedAsset = workspace?.assets.find((asset) => asset.id === selectedAssetId);

  const saveCards = async () => {
    if (!settings) return;
    setSavingCards(true);
    try {
      const saved = await saveInventorySetting(
        'dashboard.cards',
        { cardIds: cardDraft },
        settings['dashboard.cards'].version,
      );
      setSettings({
        ...settings,
        'dashboard.cards': saved as InventorySettingsSnapshot['dashboard.cards'],
      });
      setError(undefined);
    } catch (cause) {
      // Kho không trả cờ quyền xuống client, nên quyền ghi do server quyết định:
      // thiếu quyền thì API trả 403 và thông báo hiện ở đây.
      setError(cause instanceof Error ? cause.message : 'Không lưu được cấu hình.');
    } finally {
      setSavingCards(false);
    }
  };

  const saveAssetCatalog = async () => {
    if (!settings || !assetCatalogDraft) return;
    setSavingCards(true);
    try {
      const saved = await saveInventorySetting(
        'catalog.asset',
        assetCatalogDraft,
        settings['catalog.asset'].version,
      );
      setSettings({
        ...settings,
        'catalog.asset': saved as InventorySettingsSnapshot['catalog.asset'],
      });
      setAssetCatalogDraft((saved as InventorySettingsSnapshot['catalog.asset']).value);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được cấu hình.');
    } finally {
      setSavingCards(false);
    }
  };

  const catalogDirty =
    assetCatalogDraft !== undefined &&
    JSON.stringify(assetCatalogDraft) !== JSON.stringify(settings?.['catalog.asset'].value);

  const storedCards = settings?.['dashboard.cards'].value.cardIds ?? [];
  const cardsDirty =
    cardDraft.length !== storedCards.length ||
    cardDraft.some((id, index) => id !== storedCards[index]);

  return (
    <ModuleShell<Tab>
      moduleKey="inventory"
      title="Kho & Vật tư"
      subtitle="Tồn thực tế, khả dụng và luân chuyển vật tư theo từng kho."
      nav={NAV}
      view={tab}
      onViewChange={navigate}
      homeHref={homePath}
      actions={
        <>
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
        </>
      }
      banner={
        <>
          {error ? (
            <p role="alert" className={styles.alert}>
              {error}
            </p>
          ) : null}
          {notice ? <p className={styles.notice}>{notice}</p> : null}
        </>
      }
    >

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

          {tab === 'dashboard' ? (
            <DashboardView<InventoryDashboardData>
              catalog={INVENTORY_DASHBOARD_CARDS}
              selection={settings?.['dashboard.cards'].value.cardIds ?? []}
              data={{ workspace, ledger, materialByCode }}
            />
          ) : null}

          {tab === 'settings' ? (
            <ModuleSettingsView
              sections={[
                {
                  id: 'dashboard',
                  label: 'Thẻ tổng quan',
                  description:
                    'Chọn những thẻ hiện trên trang Tổng quan và sắp xếp thứ tự hiển thị.',
                  render: () => (
                    <DashboardCardPicker<InventoryDashboardData>
                      catalog={INVENTORY_DASHBOARD_CARDS}
                      selection={cardDraft}
                      onChange={setCardDraft}
                      max={6}
                      disabled={savingCards}
                    />
                  ),
                },
                {
                  id: 'asset-fields',
                  label: 'Hồ sơ thiết bị',
                  description:
                    'Chọn trường nào hiện trên hồ sơ thiết bị. Tắt một trường chỉ ẩn nó khỏi giao diện, không xoá dữ liệu đã nhập.',
                  render: () =>
                    assetCatalogDraft ? (
                      <AssetCatalogEditor
                        value={assetCatalogDraft}
                        disabled={savingCards}
                        onChange={setAssetCatalogDraft}
                      />
                    ) : null,
                },
              ]}
              activeSectionId={settingsSection}
              onSectionChange={setSettingsSection}
              dirty={settingsSection === 'asset-fields' ? catalogDirty : cardsDirty}
              saving={savingCards}
              onSave={settingsSection === 'asset-fields' ? saveAssetCatalog : saveCards}
              onReset={() =>
                settingsSection === 'asset-fields'
                  ? setAssetCatalogDraft(settings?.['catalog.asset'].value)
                  : setCardDraft(storedCards)
              }
            />
          ) : null}

          {tab === 'stock' ? (
            <>
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
                    catalog={settings?.['catalog.asset'].value}
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
                ) : null}
                {selectedAsset ? (
                  <SparePartPanel
                    assetCode={selectedAsset.code}
                    materials={workspace.materials}
                    busy={busy}
                  />
                ) : null}
                {selectedAsset ? (
                  <AssetDocumentPanel assetCode={selectedAsset.code} busy={busy} />
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
    </ModuleShell>
  );
}
