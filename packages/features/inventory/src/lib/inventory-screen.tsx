'use client';

import type {
  Asset,
  InventoryCatalogSettings,
  InstalledMaterial,
  InventoryItem,
  InventorySettingsSnapshot,
  Material,
} from '@enterprise-platform/contracts-inventory';
import {
  DashboardCardPicker,
  ModuleSettingsView,
  ModuleShell,
  useHashView,
  type ModuleNavItem,
} from '@enterprise-platform/feature-module-shell';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { InventoryDashboard } from './components/inventory-dashboard';
import { TransactionHub } from './components/transaction-hub';
import { AssetDetail } from './components/asset-detail';
import { AssetCatalogEditor } from './components/asset-catalog-editor';
import { ItemCatalog } from './components/item-catalog';
import { ItemProfileDialog } from './components/item-profile-dialog';
import { UnitCatalogEditor } from './components/unit-catalog-editor';
import { WarehouseEditor } from './components/warehouse-editor';
import { AssetForm } from './components/asset-form';
import { AssetTree } from './components/asset-tree';
import { InstallMaterialDialog } from './components/install-material-dialog';
import { ReturnToStockDialog } from './components/return-to-stock-dialog';
import { MaterialForm } from './components/material-form';
import { MovementForm, type MovementInput } from './components/movement-form';
import { LedgerTable } from './components/ledger-table';
import {
  createAsset,
  createMaterial,
  issueStock,
  loadInventorySettings,
  loadInventoryItems,
  installItem,
  loadProcedureOptions,
  loadProcedureWorkOrders,
  openMovementWorkOrder,
  returnItemToStock,
  updateAsset,
  type ProcedureOption,
  type ProcedureWorkOrder,
  loadInventoryWorkspace,
  loadLedger,
  loadInstallations,
  loadReservations,
  registerSerials,
  loadTenantHomePath,
  receiveStock,
  retireMaterial,
  uninstallMaterial,
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
import { ASSET_STATUS_LABEL } from './inventory-labels';
import styles from './inventory.module.scss';

type Tab = 'dashboard' | 'items' | 'stock' | 'transactions' | 'assets' | 'ledger' | 'settings';

const NAV: readonly ModuleNavItem<Tab>[] = [
  { id: 'dashboard', label: 'Tổng quan' },
  { id: 'stock', label: 'Kho & Danh mục', group: 'Vận hành' },
  { id: 'transactions', label: 'Giao dịch & Nhập xuất', group: 'Vận hành' },
  { id: 'assets', label: 'Cây tài sản', group: 'Vận hành' },
  { id: 'settings', label: 'Cài đặt', group: 'Quản trị' },
];

const TAB_IDS = NAV.map((item) => item.id);

/** Tám tab cũ gộp còn ba; giữ hash cũ chuyển hướng để link đã chia sẻ không vỡ. */
const LEGACY_TAB: Readonly<Record<string, Tab>> = {
  // Danh mục vật tư và bảng tồn kho gộp làm một: một dòng tồn vốn đã là một vật
  // tư ở một kho, tách hai màn bắt người dùng tra hai chỗ cho cùng một câu hỏi.
  items: 'stock',
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

  // Tự động ẩn thông báo thành công sau 2 giây (2000ms)
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice(undefined);
    }, 2000);
    return () => clearTimeout(timer);
  }, [notice]);

  const [homePath, setHomePath] = useState('/');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<'material' | 'asset' | 'asset_root' | 'movement'>();
  const [editingMaterial, setEditingMaterial] = useState<Material>();
  const [settings, setSettings] = useState<InventorySettingsSnapshot>();
  const [cardDraft, setCardDraft] = useState<readonly string[]>([]);
  const [savingCards, setSavingCards] = useState(false);
  const [settingsSection, setSettingsSection] = useState('dashboard');
  const [assetCatalogDraft, setAssetCatalogDraft] = useState<InventoryCatalogSettings>();
  const [unitDraft, setUnitDraft] = useState<readonly string[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  /** Vật tư đang lắp trên các thiết bị — lá của cây, suy từ sổ cái. */
  const [installed, setInstalled] = useState<InstalledMaterial[]>([]);
  /** Đơn vị đang chờ chọn kho để tháo về, kèm số đang lắp. */
  const [uninstallTarget, setUninstallTarget] =
    useState<{ asset: Asset; line: InstalledMaterial }>();
  const [procedures, setProcedures] = useState<ProcedureOption[]>([]);
  /** Hồ sơ bên Quy trình, chỉ đọc — để gọi tên work order đang chờ vật tư. */
  const [workOrders, setWorkOrders] = useState<ProcedureWorkOrder[]>([]);
  /** Mã cha điền sẵn khi thêm vật tư con từ cây. */
  const [newAssetParent, setNewAssetParent] = useState<string>();
  /** Node đang chờ chọn vật tư từ kho để lắp vào. */
  const [installTarget, setInstallTarget] = useState<Asset>();
  /** Mã đang mở hồ sơ dạng hộp thoại từ danh mục Kho. */
  const [profileCode, setProfileCode] = useState<string>();
  /**
   * Vật tư đang chờ thanh lý về kho.
   *
   * Không thanh lý ngay khi bấm: thao tác này ghi một bút toán NHẬP nên phải
   * biết nhập vào kho nào, và kho là thứ chỉ người bấm mới biết.
   */
  const [returnTarget, setReturnTarget] = useState<Asset>();
  /** Ô tìm của bảng Tồn kho, để danh mục hợp nhất nhảy sang kèm mã. */
  const [stockQuery] = useState('');


  /** Tình trạng được phép chọn; danh mục rỗng nghĩa là dùng hết. */
  /**
   * Tình trạng được phép chọn.
   *
   * Đọc từ `catalog.asset` — CÙNG một khoá với màn Cài đặt đang ghi. Trước đây
   * chỗ này đọc `catalog.material`, một khoá không màn nào sửa, nên danh mục
   * admin khai và danh sách hiện trong bảng là hai thứ khác nhau.
   *
   * Rỗng thì rơi về bốn mã dựng sẵn để bảng không có ô chọn trống trơn.
   */
  const statusOptions = useMemo(() => {
    const enabled = settings?.['catalog.asset'].value.enabledStatuses ?? [];
    return enabled.length > 0 ? enabled : Object.keys(ASSET_STATUS_LABEL);
  }, [settings]);

  const usageStateOptions = settings?.['catalog.asset'].value.usageStates ?? [];

  /** Tồn khả dụng gộp mọi kho, theo mã — dùng chung cho cảnh báo sàn và vật tư trọng yếu. */
  const availableByCode = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of workspace?.stock ?? []) {
      if (!row.materialCode) continue;
      map.set(row.materialCode, (map.get(row.materialCode) ?? 0) + row.available);
    }
    return map;
  }, [workspace]);

  /**
   * Số HÀNG THẬT đang nằm trong kho, chưa trừ phần giữ chỗ.
   *
   * Khác `availableByCode`: cột `available` của database là `quantity - reserved`,
   * tức đã trừ phần đã hứa cho work order khác. Khi câu hỏi là "trong kho còn
   * mấy cái" thì phải trả lời bằng con số này; khả dụng là câu trả lời cho một
   * câu hỏi khác và đứng cạnh nó chứ không thay nó.
   */
  const onHandByCode = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of workspace?.stock ?? []) {
      if (!row.materialCode) continue;
      map.set(row.materialCode, (map.get(row.materialCode) ?? 0) + row.quantity);
    }
    return map;
  }, [workspace]);

  const reload = useCallback(async () => {
    try {
      setError(undefined);
      const [data, ledgerRows, reservationRows, itemRows, installedRows] = await Promise.all([
        loadInventoryWorkspace(),
        loadLedger(),
        loadReservations(),
        loadInventoryItems(),
        loadInstallations(),
      ]);
      setWorkspace(data);
      setLedger(ledgerRows);
      setReservations(reservationRows);
      setItems(itemRows);
      setInstalled(installedRows);
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

  /** Work order vừa mở cho lệnh kho; hiện popup rồi tự đóng khi người dùng bấm. */
  const [movementOrder, setMovementOrder] = useState<{ code: string; id: string }>();

  /**
   * Mở work order cho một lệnh kho vừa thực hiện.
   *
   * Nuốt lỗi có chủ đích: hàng đã vào/ra kho rồi, ném ra ở đây sẽ báo cho thủ
   * kho là lệnh thất bại trong khi sổ cái đã ghi. Thiếu work order thì sửa được
   * sau; báo sai một lệnh đã thành công thì họ làm lại và tồn kho sai gấp đôi.
   */
  const openOrderFor = async (input: MovementInput, reference: string) => {
    if (!input.procedureDefinitionId) return;
    const label =
      input.kind === 'receipt' ? 'Nhập kho' : input.kind === 'issue' ? 'Xuất kho' : 'Chuyển kho';
    try {
      const order = await openMovementWorkOrder({
        definitionId: input.procedureDefinitionId,
        title: `${label} ${input.materialCode} × ${input.quantity} — chứng từ ${reference}`,
      });
      setMovementOrder(order);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Lệnh kho đã ghi nhận nhưng không mở được work order: ${cause.message}`
          : 'Lệnh kho đã ghi nhận nhưng không mở được work order.',
      );
    }
  };

  useEffect(() => {
    // Chỉ nạp khi thật sự mở form lệnh kho: đây là lời gọi sang module khác,
    // nạp sẵn ở mọi màn là tốn một request cho thứ hầu hết lúc không dùng.
    if (form !== 'movement' || procedures.length > 0) return;
    void loadProcedureOptions().then(setProcedures);
    // Hồ sơ đang chạy nạp cùng lúc: nó chỉ dùng để gọi tên phiếu giữ chỗ trong
    // chính form này, nạp ở màn khác là tốn một request cho thứ không ai đọc.
    void loadProcedureWorkOrders().then(setWorkOrders);
  }, [form, procedures.length]);

  const submitMovement = (movement: MovementInput) =>
    perform(async () => {
      let input = movement;
      // Mã mới phải tồn tại TRƯỚC khi ghi phiếu — phiếu tham chiếu theo mã.
      if (input.newMaterial) {
        await createMaterial({
          code: input.newMaterial.code,
          name: input.newMaterial.name,
          unit: input.newMaterial.unit,
          minStock: input.newMaterial.minStock,
          // Nhóm đã bỏ khỏi giao diện; vẫn phải gửi vì ràng buộc của database.
          category: 'SPARE_PART',
        });
        input = { ...input, materialCode: input.newMaterial.code };
      }
      if (input.kind === 'receipt') {
        const tx = await receiveStock({
          warehouseCode: input.warehouseCode,
          materialCode: input.materialCode,
          quantity: input.quantity,
          unitCost: input.unitCost,
          note: input.note,
        });
        await openOrderFor(input, tx.transactionCode);

        // Sê-ri khai SAU khi bút toán đã ghi: nhập kho là việc chính, khai sê-ri
        // là phần bổ sung. Sê-ri hỏng thì không được kéo theo cả phiếu nhập.
        const serialNumbers = input.serialNumbers ?? [];
        if (serialNumbers.length > 0) {
          try {
            const result = await registerSerials({
              materialCode: input.materialCode,
              warehouseCode: input.warehouseCode,
              serialNumbers: [...serialNumbers],
            });
            return `Đã nhập kho — chứng từ ${tx.transactionCode}, khai ${result.added} sê-ri.`;
          } catch (cause) {
            return `Đã nhập kho — chứng từ ${tx.transactionCode}. Nhưng KHÔNG khai được sê-ri: ${
              cause instanceof Error ? cause.message : 'lỗi không rõ'
            }. Bổ sung trong hồ sơ vật tư.`;
          }
        }
        return `Đã nhập kho — chứng từ ${tx.transactionCode}.`;
      }
      if (input.kind === 'issue') {
        const tx = await issueStock({
          warehouseCode: input.warehouseCode,
          materialCode: input.materialCode,
          quantity: input.quantity,
          note: input.note,
        });
        await openOrderFor(input, tx.transactionCode);
        return `Đã xuất kho — chứng từ ${tx.transactionCode}.`;
      }
      const moved = await transferStock({
        fromWarehouseCode: input.warehouseCode,
        toWarehouseCode: input.toWarehouseCode ?? '',
        materialCode: input.materialCode,
        quantity: input.quantity,
        note: input.note,
      });
      await openOrderFor(input, `${moved.out.transactionCode} / ${moved.in.transactionCode}`);
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
        setUnitDraft(loaded['catalog.unit'].value.units ?? []);
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

  const saveUnits = async () => {
    if (!settings) return;
    setSavingCards(true);
    try {
      const saved = await saveInventorySetting(
        'catalog.unit',
        { units: unitDraft },
        settings['catalog.unit'].version,
      );
      setSettings({
        ...settings,
        'catalog.unit': saved as InventorySettingsSnapshot['catalog.unit'],
      });
      setUnitDraft((saved as InventorySettingsSnapshot['catalog.unit']).value.units ?? []);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được danh mục đơn vị.');
    } finally {
      setSavingCards(false);
    }
  };

  const unitsDirty =
    JSON.stringify(unitDraft) !== JSON.stringify(settings?.['catalog.unit'].value.units ?? []);

  /** Đơn vị đang có vật tư dùng — không cho xoá khỏi danh mục. */
  const usedUnits = useMemo(
    () => new Set((workspace?.materials ?? []).map((item) => item.unit).filter(Boolean)),
    [workspace],
  );

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
      actions={null}
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
          {installTarget ? (
            <InstallMaterialDialog
              parent={installTarget}
              materials={workspace.materials}
              warehouses={workspace.warehouses}
              stock={workspace.stock}
              busy={busy}
              onCancel={() => setInstallTarget(undefined)}
              onConfirm={(code, input) => {
                setInstallTarget(undefined);
                void perform(async () => {
                  const issue = await installItem(code, input);
                  return `Đã xuất ${input.quantity} ${code} từ ${input.warehouseCode} và lắp vào ${input.parentCode} — phiếu ${issue.transactionCode}.`;
                });
              }}
            />
          ) : null}

          {returnTarget ? (
            <ReturnToStockDialog
              title={`Thanh lý ${returnTarget.name}`}
              description={`Tháo ${returnTarget.code} khỏi vị trí lắp đặt và nhập về kho. Đây là một lệnh nhập thật — sổ cái sẽ có thêm một bút toán. Mã vật tư không bị xoá.`}
              unit={returnTarget.unit}
              warehouses={workspace.warehouses}
              busy={busy}
              onCancel={() => setReturnTarget(undefined)}
              onConfirm={(input) => {
                const { code, id } = returnTarget;
                setReturnTarget(undefined);
                void perform(async () => {
                  const receipt = await returnItemToStock(code, input);
                  if (selectedAssetId === id) setSelectedAssetId(undefined);
                  return `Đã nhập ${code} về kho ${input.warehouseCode} — phiếu ${receipt.transactionCode}.`;
                });
              }}
            />
          ) : null}

          {uninstallTarget ? (
            <ReturnToStockDialog
              title={`Tháo ${uninstallTarget.asset.name}`}
              description={`Tháo ${uninstallTarget.asset.code} khỏi cây và nhập ${uninstallTarget.line.materialCode} ngược về kho. Đang lắp ${uninstallTarget.line.quantity} ${uninstallTarget.line.unit ?? ''}.`}
              unit={uninstallTarget.line.unit}
              maxQuantity={uninstallTarget.line.quantity}
              warehouses={workspace.warehouses}
              busy={busy}
              onCancel={() => setUninstallTarget(undefined)}
              onConfirm={(input) => {
                const { asset, line } = uninstallTarget;
                setUninstallTarget(undefined);
                void perform(async () => {
                  const receipt = await uninstallMaterial(asset.code, {
                    warehouseCode: input.warehouseCode,
                    quantity: input.quantity,
                    note: input.note,
                  });
                  if (selectedAssetId === asset.id) setSelectedAssetId(undefined);
                  return `Đã tháo ${input.quantity} ${line.materialCode} về kho ${input.warehouseCode} — phiếu ${receipt.transactionCode}.`;
                });
              }}
            />
          ) : null}

          {profileCode ? (
            <ItemProfileDialog
              code={profileCode}
              catalog={settings?.['catalog.asset'].value}
              units={settings?.['catalog.unit'].value.units ?? []}
              busy={busy}
              onClose={() => setProfileCode(undefined)}
              onSaved={() => void reload()}
            />
          ) : null}

          {movementOrder ? (
            <div className={styles.orderDialog} role="alertdialog" aria-labelledby="wo-title">
              <div className={styles.orderDialogBox}>
                <h2 id="wo-title">Đã mở work order</h2>
                <p>
                  Lệnh kho đã ghi nhận và work order{' '}
                  <strong className={styles.orderDialogCode}>{movementOrder.code}</strong> đã được
                  mở bên module Quy trình.
                </p>
                <div className={styles.editActions}>
                  <a
                    className={`${styles.action} ${styles.actionPrimary}`}
                    href="/modules/procedure#workspace"
                  >
                    Mở work order
                  </a>
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() => setMovementOrder(undefined)}
                  >
                    Đóng
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {form === 'movement' ? (
            <MovementForm
              workspace={workspace}
              busy={busy}
              onCancel={() => setForm(undefined)}
              procedures={procedures}
              units={settings?.['catalog.unit'].value.units ?? []}
              reservations={reservations ?? []}
              workOrders={workOrders}
              onSubmit={submitMovement}
            />
          ) : null}

          {form === 'material' ? (
            <MaterialForm
              editing={editingMaterial}
              units={settings?.['catalog.unit'].value.units ?? []}
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

          {form === 'asset' || form === 'asset_root' ? (
            <AssetForm
              assets={workspace.assets}
              defaultParentCode={newAssetParent ?? selectedAsset?.code}
              isRootOnly={form === 'asset_root'}
              busy={busy}
              onCancel={() => {
                setForm(undefined);
                setNewAssetParent(undefined);
              }}
              onSubmit={(input) =>
                perform(async () => {
                  const created = await createAsset(input);
                  setNewAssetParent(undefined);
                  return `Đã thêm vật tư ${created.code}.`;
                })
              }
            />
          ) : null}

          {tab === 'dashboard' ? (
            <InventoryDashboard
              workspace={workspace}
              ledger={ledger ?? []}
              onNavigate={navigate}
              onOpenMovement={() => setForm('movement')}
            />
          ) : null}

          {tab === 'transactions' ? (
            <TransactionHub
              workspace={workspace}
              ledger={ledger ?? []}
              busy={busy}
              onSubmitMovement={submitMovement}
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
                  label: 'Hồ sơ vật tư',
                  description:
                    'Chọn trường nào hiện trên hồ sơ vật tư. Tắt một trường chỉ ẩn nó khỏi giao diện, không xoá dữ liệu đã nhập.',
                  render: () =>
                    assetCatalogDraft ? (
                      <AssetCatalogEditor
                        value={assetCatalogDraft}
                        disabled={savingCards}
                        onChange={setAssetCatalogDraft}
                      />
                    ) : null,
                },
                {
                  id: 'warehouses',
                  label: 'Kho',
                  description:
                    'Danh sách kho cho phiếu nhập/xuất chọn. Sửa xong là lưu ngay, không cần bấm Lưu. Kho còn hàng thì không ngừng dùng được.',
                  render: () => <WarehouseEditor disabled={savingCards} />,
                },
                {
                  id: 'units',
                  label: 'Đơn vị tính',
                  description:
                    'Danh sách đơn vị cho form vật tư chọn. Cho gõ tự do thì cùng một thứ vào kho dưới ba cái tên và không cộng gộp được.',
                  render: () => (
                    <UnitCatalogEditor
                      units={unitDraft}
                      usedUnits={usedUnits}
                      disabled={savingCards}
                      onChange={setUnitDraft}
                    />
                  ),
                },
              ]}
              activeSectionId={settingsSection}
              onSectionChange={setSettingsSection}
              /* Khối Kho tự lưu ngay khi sửa nên không bao giờ "bẩn": để nó
                 dùng chung nút Lưu sẽ hiện một nút không làm gì. */
              dirty={
                settingsSection === 'warehouses'
                  ? false
                  : settingsSection === 'asset-fields'
                    ? catalogDirty
                    : settingsSection === 'units'
                      ? unitsDirty
                      : cardsDirty
              }
              saving={savingCards}
              onSave={
                settingsSection === 'warehouses'
                  ? () => undefined
                  : settingsSection === 'asset-fields'
                    ? saveAssetCatalog
                    : settingsSection === 'units'
                      ? saveUnits
                      : saveCards
              }
              onReset={() =>
                settingsSection === 'asset-fields'
                  ? setAssetCatalogDraft(settings?.['catalog.asset'].value)
                  : settingsSection === 'units'
                    ? setUnitDraft(settings?.['catalog.unit'].value.units ?? [])
                    : setCardDraft(storedCards)
              }
            />
          ) : null}

          {tab === 'stock' ? (
            <>
              {/* Danh mục đứng trên bảng tồn: một dòng danh mục là một MÃ, một
                  dòng tồn là một mã ở một KHO. Cùng một màn nên người dùng đi
                  từ "cái này là gì" xuống "nó nằm ở kho nào" mà không đổi tab. */}
              <ItemCatalog
                items={items}
                initialQuery={stockQuery}
                materialByCode={materialByCode}
                statuses={statusOptions}
                usageStates={usageStateOptions}
                types={settings?.['catalog.asset'].value.types ?? []}
                installed={installed}
                warehouses={workspace.warehouses}
                stock={workspace.stock}
                busy={busy}
                onOpenProfile={(code) => setProfileCode(code)}
                onAddMaterial={() => setForm('material')}
                onRetire={(material) =>
                  perform(async () => {
                    const result = await retireMaterial(material.code);
                    // Không còn chế độ xoá: mã chỉ được ngừng dùng, lịch sử giữ
                    // nguyên. Nói rõ để người bấm không tưởng dữ liệu đã mất.
                    return `Đã ngừng dùng ${material.code}. ${result.reason ?? ''}`;
                  })
                }
                onPatch={(item, patch) =>
                  perform(async () => {
                    // Hai đường ghi khác nhau: mã đã lắp đi qua view `assets`
                    // (lọc kind='ASSET'), mã kho đi qua bảng vật tư. Gửi nhầm
                    // đường thì câu UPDATE không khớp dòng nào và im lặng không
                    // lưu gì.
                    if (item.kind === 'ASSET') await updateAsset(item.code, patch);
                    else await updateMaterial(item.code, patch);
                    return `Đã cập nhật ${item.code}.`;
                  })
                }
              />
            </>
          ) : null}

          {tab === 'assets' ? (
            <div className={styles.assetLayout}>
              <AssetTree
                assets={workspace.assets}
                installed={installed}
                selectedId={selectedAssetId}
                busy={busy}
                onSelect={setSelectedAssetId}
                onAddAsset={(parentCode) => {
                  setNewAssetParent(parentCode);
                  setForm(parentCode ? 'asset' : 'asset_root');
                }}
                onInstall={(parent) => setInstallTarget(parent)}
                onUninstall={(asset, line) => setUninstallTarget({ asset, line })}
                onReturn={(asset) => setReturnTarget(asset)}
                onRename={(asset, name) =>
                  perform(async () => {
                    await updateAsset(asset.code, { name });
                    return `Đã đổi tên ${asset.code}.`;
                  })
                }
                onMove={(asset, parentCode) =>
                  perform(async () => {
                    await updateAsset(asset.code, { parentCode });
                    return parentCode
                      ? `Đã chuyển ${asset.code} vào ${parentCode}.`
                      : `Đã đưa ${asset.code} lên làm gốc.`;
                  })
                }
              />
              <section>
                {selectedAsset ? (
                  <AssetDetail
                    asset={selectedAsset}
                    materials={workspace.materials}
                    childMaterials={workspace.assets
                      .filter((child) => child.parentId === selectedAsset.id)
                      .map((child) => installed.find((line) => line.unitId === child.id))
                      .filter((line): line is InstalledMaterial => line !== undefined)}
                    onHandByCode={onHandByCode}
                    availableByCode={availableByCode}
                    busy={busy}
                    catalog={settings?.['catalog.asset'].value}
                    units={settings?.['catalog.unit'].value.units ?? []}
                    onSaved={() => void reload()}
                    onRename={(asset, name) =>
                      perform(async () => {
                        await updateAsset(asset.code, { name });
                        return `Đã đổi tên ${asset.code}.`;
                      })
                    }
                    /* Cùng một thao tác với nút “−” trên cây: thanh lý là tháo
                       khỏi cây rồi nhập về kho, không phải xoá. */
                    onRetire={(asset) => setReturnTarget(asset)}
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
    </ModuleShell>
  );
}
