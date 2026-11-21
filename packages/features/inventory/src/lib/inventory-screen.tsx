'use client';

import type {
  Asset,
  InventoryCatalogSettings,
  InventoryTradeCatalog,
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
import { AppIcon, toast } from '@enterprise-platform/shared-ui';
import {
  BarChart3,
  HardDrive,
  LayoutDashboard,
  Network,
  Settings,
  Warehouse,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InventoryDashboard } from './components/inventory-dashboard';
import { TransactionHub } from './components/transaction-hub';
import { StocktakeHub } from './components/stocktake-hub';
import { SerialHub } from './components/serial-hub';
import { AssetDetail } from './components/asset-detail';
import { AssetCatalogEditor } from './components/asset-catalog-editor';
import { ItemProfileDialog } from './components/item-profile-dialog';
import { LocationLevelsEditor } from './components/location-levels-editor';
import { UnitCatalogEditor } from './components/unit-catalog-editor';
import {
  TrackingSettingsEditor,
  trackingDraftFromSettings,
  type TrackingSettingsDraft,
} from './components/tracking-settings-editor';
import { SupplierCatalogSection, supplierCatalogSectionKey } from './components/supplier-catalog-section';
import { SupplierInputProvider, supplierInputState } from './supplier-input';
import { WarehouseEditor } from './components/warehouse-editor';
import { AssetForm } from './components/asset-form';
import { AssetTree } from './components/asset-tree';
import { CustodyPanel } from './components/custody-panel';
import { InstallMaterialDialog } from './components/install-material-dialog';
import { ReturnToStockDialog } from './components/return-to-stock-dialog';
import { TradeItemsPage } from './components/trade-items-page';
import { WarehouseStockTab } from './components/warehouse-stock-tab';
import { MaterialForm } from './components/material-form';
import { MovementForm, type MovementInput, type MovementLineItem } from './components/movement-form';
import { ExcelImportDialog } from './components/excel-import-dialog';
import { CreateStocktakeDialog } from './components/create-stocktake-dialog';
import { LedgerTable } from './components/ledger-table';
import { StockMovementHub } from './components/stock-movement-hub';
import { InventoryReports } from './components/inventory-reports';
import {
  createAsset,
  createMaterial,
  createStocktakeSession,
  startStocktakeCounting,
  loadInventorySettings,
  installItem,
  loadProcedureOptions,
  loadProcedureWorkOrders,
  openMovementWorkOrder,
  returnItemToStock,
  updateAsset,
  assignCustody,
  type ProcedureOption,
  type ProcedureWorkOrder,
  loadInventoryWorkspace,
  loadLedger,
  loadInstallations,
  loadReservations,
  loadTenantHomePath,
  receiveStock,
  replaceMaterialStorageLocations,
  issueStock,
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
import { usageLabel } from './trade-items.model';
import { Button } from './ui/button';
import { cn } from './ui/cn';
import { InventoryPermissionsContext } from './inventory-permissions';
import { movementHashTarget, type MovementHashTarget } from './stock-movement.model';

type Tab =
  | 'dashboard'
  | 'items'
  | 'stock'
  | 'assets'
  | 'custody'
  | 'ledger'
  | 'reports'
  | 'settings';

/** Năm tab con của trang Kho hàng. */
type StockSubTab = 'goods' | 'warehouse' | 'serials' | 'movements' | 'history' | 'stocktakes';

const STOCK_SUB_TABS: readonly { id: StockSubTab; label: string }[] = [
  { id: 'goods', label: 'Hàng hóa' },
  { id: 'warehouse', label: 'Nhà kho' },
  { id: 'serials', label: 'Serial' },
  { id: 'movements', label: 'Xuất/nhập kho' },
  { id: 'history', label: 'Lịch sử xuất nhập' },
  { id: 'stocktakes', label: 'Lịch sử kiểm đếm' },
];

// Chứng từ kho, Duyệt chứng từ, Yêu cầu xuất từ đơn bán đã gộp vào tab con
// "Xuất/nhập kho" của Kho hàng; hash cũ chuyển hướng qua LEGACY_TAB.
const NAV: readonly ModuleNavItem<Tab>[] = [
  { id: 'dashboard', label: 'Tổng quan', icon: <AppIcon slot="nav.dashboard" fallback={LayoutDashboard} size={16} /> },
  { id: 'stock', label: 'Kho hàng', group: 'Vận hành', icon: <AppIcon slot="sidebar.inventory.stock" fallback={Warehouse} size={16} /> },
  { id: 'assets', label: 'Cây tài sản', group: 'Vận hành', icon: <AppIcon slot="sidebar.inventory.assets-tree" fallback={Network} size={16} /> },
  { id: 'custody', label: 'Tài sản', group: 'Vận hành', icon: <AppIcon slot="sidebar.inventory.custody" fallback={HardDrive} size={16} /> },
  { id: 'reports', label: 'Báo cáo kho', group: 'Báo cáo', icon: <AppIcon slot="nav.reports" fallback={BarChart3} size={16} /> },
  { id: 'settings', label: 'Cài đặt', group: 'Quản trị', icon: <AppIcon slot="nav.settings" fallback={Settings} size={16} /> },
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
  transactions: 'stock',
  'trade-items': 'stock',
  // Ba màn chứng từ cũ và link chứng từ trong thông báo: mở tab con Xuất/nhập kho.
  documents: 'stock',
  approvals: 'stock',
  'issue-requests': 'stock',
  vouchers: 'stock',
};

const LAST_STOCK_SUB_TAB_KEY = 'inventory:last-stock-subtab';

function isStockSubTab(value: string): value is StockSubTab {
  return STOCK_SUB_TABS.some((tab) => tab.id === value);
}

function getStoredStockSubTab(): StockSubTab | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const val = sessionStorage.getItem(LAST_STOCK_SUB_TAB_KEY);
    if (val && isStockSubTab(val)) return val;
  } catch {
    // sessionStorage có thể không truy cập được trong một số môi trường kiểm thử
  }
  return undefined;
}

function setStoredStockSubTab(subTab: StockSubTab): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(LAST_STOCK_SUB_TAB_KEY, subTab);
  } catch {
    // Bỏ qua
  }
}

/**
 * Trang Kho hàng gộp ba trang cũ; link cũ mở đúng tab con tương ứng.
 * Lưu lại dấu vết subtab cũ đã truy cập thay vì luôn mặc định về subtab đầu tiên.
 */
function initialStockSubTab(): StockSubTab {
  if (typeof window === 'undefined') return 'goods';
  if (movementHashTarget(window.location.hash)) return 'movements';

  const parts = window.location.hash.replace(/^#/, '').split('/');
  const head = parts[0];
  const second = parts[1];

  // Hash mới dạng #stock/warehouse, #stock/goods, #stock/movements, #stock/history, #stock/stocktakes
  if (head === 'stock') {
    if (second && isStockSubTab(second)) return second;
    const stored = getStoredStockSubTab();
    if (stored) return stored;
    return 'goods';
  }

  // Hash cũ
  if (head === 'transactions') return 'history';
  if (head === 'items' || head === 'overview' || head === 'materials' || head === 'warehouses') {
    return 'warehouse';
  }
  if (head === 'serials') return 'serials';

  const stored = getStoredStockSubTab();
  if (stored) return stored;

  return 'goods';
}

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
  const [stockSubTab, setStockSubTab] = useState<StockSubTab>(initialStockSubTab);
  const lastStockSubTabRef = useRef<StockSubTab>(stockSubTab);

  const handleSelectSubTab = useCallback(
    (subId: StockSubTab) => {
      setStockSubTab(subId);
      lastStockSubTabRef.current = subId;
      setStoredStockSubTab(subId);
      navigate('stock', subId);
    },
    [navigate],
  );

  const handleViewChange = useCallback(
    (nextView: Tab) => {
      if (nextView === 'stock') {
        const remembered = lastStockSubTabRef.current || getStoredStockSubTab() || stockSubTab || 'goods';
        navigate('stock', remembered);
      } else {
        navigate(nextView);
      }
    },
    [navigate, stockSubTab],
  );

  // Đồng bộ subtab khi hash đổi (qua điều hướng, nút back/forward trình duyệt, hoặc link trực tiếp)
  useEffect(() => {
    if (tab !== 'stock') return;
    if (hashAsset) {
      const subKey = hashAsset.split('/')[0];
      if (isStockSubTab(subKey)) {
        setStockSubTab(subKey);
        lastStockSubTabRef.current = subKey;
        setStoredStockSubTab(subKey);
      }
    } else {
      // Khi URL hash chỉ là #stock (không có subtab)
      const remembered = lastStockSubTabRef.current || getStoredStockSubTab();
      if (remembered && remembered !== 'goods') {
        setStockSubTab(remembered);
        navigate('stock', remembered);
      }
    }
  }, [tab, hashAsset, navigate]);

  const [movementTarget, setMovementTarget] = useState<MovementHashTarget | undefined>(() =>
    typeof window === 'undefined' ? undefined : movementHashTarget(window.location.hash),
  );
  // Link chứng từ bấm khi đang ở sẵn trong Kho (thông báo, link cũ) chỉ đổi hash:
  // phải tự chuyển sang tab con Xuất/nhập kho và đúng góc nhìn.
  useEffect(() => {
    const onHashChange = () => {
      const target = movementHashTarget(window.location.hash);
      if (!target) return;
      setMovementTarget(target);
      setStockSubTab('movements');
      lastStockSubTabRef.current = 'movements';
      setStoredStockSubTab('movements');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [workspace, setWorkspace] = useState<InventoryWorkspace>();
  const canManage = workspace?.permissions?.canManage ?? false;
  const canWriteTransactions = workspace?.permissions?.canWriteTransactions ?? false;
  const canWriteQuality = workspace?.permissions?.canWriteQuality ?? false;
  const canApproveDocuments = workspace?.permissions?.canApproveDocuments ?? false;
  const canCreateStocktake = workspace?.permissions?.canCreateStocktake ?? false;
  const canApproveStocktake = workspace?.permissions?.canApproveStocktake ?? false;
  const uiPermissions = useMemo(
    () => ({
      canManage,
      canWriteTransactions,
      canWriteQuality,
      canApproveDocuments,
      canCreateStocktake,
      canApproveStocktake,
    }),
    [canManage, canWriteTransactions, canWriteQuality, canApproveDocuments, canCreateStocktake, canApproveStocktake],
  );
  const [ledger, setLedger] = useState<InventoryLedgerRow[]>();
  const [reservations, setReservations] = useState<InventoryReservationRow[]>();
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [error, setError] = useState<string>();
  /** Kết quả thao tác hiện bằng toast (tự ẩn), như HRM; dải đầu trang chỉ còn cho lỗi tải dữ liệu. */
  const notify = (message: string) => toast.success(message);
  const notifyError = (message: string) => toast.error(message);

  const [homePath, setHomePath] = useState('/');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<'material' | 'asset' | 'asset_root' | 'movement'>();
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [movementInit, setMovementInit] = useState<{
    kind?: 'receipt' | 'issue' | 'transfer' | 'adjust';
    materialCode?: string;
    openExcelImport?: boolean;
    initialItems?: readonly MovementLineItem[];
  }>();
  const [stocktakeInit, setStocktakeInit] = useState<{
    warehouseCode?: string;
    selectedMaterials?: readonly InventoryItem[];
  }>();
  const [showStocktakeDialog, setShowStocktakeDialog] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material>();
  const [settings, setSettings] = useState<InventorySettingsSnapshot>();
  const [cardDraft, setCardDraft] = useState<readonly string[]>([]);
  const [savingCards, setSavingCards] = useState(false);
  const [settingsSection, setSettingsSection] = useState('dashboard');
  const [assetCatalogDraft, setAssetCatalogDraft] = useState<InventoryCatalogSettings>();
  const [unitDraft, setUnitDraft] = useState<readonly string[]>([]);
  /** Mẫu tên cấp vị trí lưu trữ của tenant (thứ tự có ý nghĩa: cấp đầu là lớn nhất). */
  const [levelsDraft, setLevelsDraft] = useState<readonly string[]>([]);
  const [tradeDraft, setTradeDraft] = useState<InventoryTradeCatalog>();
  const [trackingDraft, setTrackingDraft] = useState<TrackingSettingsDraft>();
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
  /** Node đang chờ chọn vật tư từ kho để lắp vào. 'root' là lắp làm thiết bị gốc. */
  const [installTarget, setInstallTarget] = useState<Asset | 'root'>();
  /** Mã đang mở hồ sơ dạng hộp thoại từ danh mục Kho. */
  const [profileCode, setProfileCode] = useState<string>();
  /**
   * Vật tư đang chờ thanh lý về kho.
   *
   * Không thanh lý ngay khi bấm: thao tác này ghi một bút toán NHẬP nên phải
   * biết nhập vào kho nào, và kho là thứ chỉ người bấm mới biết.
   */
  const [returnTarget, setReturnTarget] = useState<Asset>();
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

  /** Nạp lại thất bại một phần: hiện nút "Tải lại" cạnh thông báo lỗi. */
  const [loadFailed, setLoadFailed] = useState(false);

  /**
   * Đưa các giao dịch server vừa trả về lên đầu sổ cái ngay, không chờ nạp lại.
   *
   * Phiếu đã ghi sổ rồi mà bước nạp lại lỗi thì người dùng vẫn phải thấy phiếu của mình;
   * không thì họ tưởng chưa ghi và nhập lại. Nạp lại thành công sẽ thay cả danh sách này.
   */
  const showInLedger = useCallback((rows: readonly InventoryLedgerRow[]) => {
    if (rows.length === 0) return;
    setLedger((current) => {
      const incoming = new Set(rows.map((row) => row.id));
      return [...rows, ...(current ?? []).filter((row) => !incoming.has(row.id))];
    });
  }, []);

  /**
   * Nạp lại toàn bộ dữ liệu màn hình. Mỗi nguồn nạp độc lập: một request lỗi (ví dụ Platform
   * chưa trả lời kiểm quyền) không được làm mất các phần đã nạp được.
   * Trả về câu mô tả phần nạp lỗi, hoặc `undefined` nếu nạp đủ.
   */
  const reload = useCallback(async (): Promise<string | undefined> => {
    setError(undefined);
    const [workspaceResult, ledgerResult, reservationResult, installedResult] =
      await Promise.allSettled([
        loadInventoryWorkspace(),
        loadLedger(),
        loadReservations(),
        loadInstallations(),
      ]);

    const failed: string[] = [];
    let firstCause: unknown;
    const note = (label: string, result: PromiseSettledResult<unknown>) => {
      if (result.status === 'fulfilled') return;
      failed.push(label);
      firstCause ??= result.reason;
    };

    if (workspaceResult.status === 'fulfilled') {
      setWorkspace(workspaceResult.value);
      setSelectedAssetId((current) => current ?? workspaceResult.value.assets[0]?.id);
    }
    if (ledgerResult.status === 'fulfilled') setLedger(ledgerResult.value);
    if (reservationResult.status === 'fulfilled') setReservations(reservationResult.value);
    if (installedResult.status === 'fulfilled') setInstalled(installedResult.value);
    note('tồn kho', workspaceResult);
    note('sổ cái', ledgerResult);
    note('phiếu giữ chỗ', reservationResult);
    note('vật tư đã lắp', installedResult);

    if (failed.length === 0) {
      setLoadFailed(false);
      return undefined;
    }
    const detail = firstCause instanceof Error && firstCause.message ? ` (${firstCause.message})` : '';
    const message = `Chưa tải lại được ${failed.join(', ')}${detail}. Dữ liệu đang hiển thị có thể chưa cập nhật.`;
    setLoadFailed(true);
    setError(message);
    return message;
  }, []);

  /**
   * Chạy một lệnh ghi rồi nạp lại; gom xử lý lỗi về một chỗ. Lỗi mặc định hiện ở dải thông báo
   * đầu trang. Form hay hộp thoại đang mở truyền `rethrow` để nhận lỗi ngay trong khung của nó
   * (dải đầu trang nằm sau lớp phủ nên người dùng không thấy), giữ nguyên dữ liệu đã nhập.
   */
  const perform = async (run: () => Promise<string | void>, options?: { rethrow?: boolean }) => {
    setBusy(true);
    setError(undefined);
    try {
      const message = await run();
      setForm(undefined);
      setEditingMaterial(undefined);
      if (message) notify(message);
      // Thao tác đã ghi xong: nạp lại lỗi chỉ là chưa cập nhật màn hình, không phải ghi thất bại.
      // Nạp lại lỗi đã hiện ở dải đầu trang kèm nút "Tải lại"; không gộp vào thông báo thành công.
      await reload();
    } catch (cause) {
      if (options?.rethrow) throw cause;
      notifyError(cause instanceof Error ? cause.message : 'Không hoàn tất được thao tác.');
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
    const itemsSummary =
      input.items && input.items.length > 0
        ? `${input.items.length} mặt hàng (${input.items
            .map((i) => `${i.materialCode}×${i.quantity}`)
            .slice(0, 3)
            .join(', ')}${input.items.length > 3 ? '...' : ''})`
        : `${input.materialCode} × ${input.quantity}`;
    try {
      const order = await openMovementWorkOrder({
        definitionId: input.procedureDefinitionId,
        title: `${label} ${itemsSummary} — chứng từ ${reference}`,
      });
      setMovementOrder(order);
    } catch (cause) {
      notifyError(
        cause instanceof Error
          ? `Lệnh kho đã ghi nhận nhưng không mở được work order: ${cause.message}`
          : 'Lệnh kho đã ghi nhận nhưng không mở được work order.',
      );
    }
  };

  useEffect(() => {
    // Nạp khi mở form lệnh kho hoặc form tháo dỡ hoàn kho:
    if (
      (form !== 'movement' && !returnTarget && !uninstallTarget) ||
      procedures.length > 0
    ) {
      return;
    }
    void loadProcedureOptions().then(setProcedures);
    // Hồ sơ đang chạy nạp cùng lúc: nó chỉ dùng để gọi tên phiếu giữ chỗ trong
    // chính form này, nạp ở màn khác là tốn một request cho thứ không ai đọc.
    void loadProcedureWorkOrders().then(setWorkOrders);
  }, [form, returnTarget, uninstallTarget, procedures.length]);

  const runMovement = async (movement: MovementInput): Promise<string | void> => {
      if (!canWriteTransactions) throw new Error('Bạn không có quyền ghi giao dịch kho.');
      // Xác định danh sách dòng vật tư: ưu tiên movement.items, nếu rỗng thì fallback về single item
      const lineItems: readonly MovementLineItem[] =
        movement.items && movement.items.length > 0
          ? movement.items
          : movement.materialCode
          ? [
              {
                id: 'item-fallback',
                materialCode: movement.materialCode,
                materialName: movement.materialCode,
                unit: 'Cái',
                warehouseCode: movement.warehouseCode,
                toWarehouseCode: movement.toWarehouseCode,
                quantity: movement.quantity ?? 1,
                unitCost: movement.unitCost,
                serialNumbers: movement.serialNumbers,
                newMaterial: movement.newMaterial,
              },
            ]
          : [];

      if (lineItems.length === 0) {
        return 'Không có vật tư nào trên phiếu để thực hiện.';
      }

      // Check mixed-operation forms before the first write, not after posting stock.
      if (!canManage && (movement.targetAssetCode || lineItems.some((item) => item.newMaterial || (movement.kind === 'receipt' && item.serialNumbers?.length)))) {
        throw new Error('Tạo mã vật tư, khai sê-ri và xuất lắp đặt cần quyền quản lý kho. Chưa ghi giao dịch.');
      }

      // Mã mới phải tồn tại TRƯỚC khi ghi phiếu — phiếu tham chiếu theo mã.
      for (const item of lineItems) {
        if (item.newMaterial) {
          await createMaterial({
            code: item.newMaterial.code,
            name: item.newMaterial.name,
            unit: item.newMaterial.unit,
            minStock: item.newMaterial.minStock,
            category: 'SPARE_PART',
          });
        }
      }

      const txCodes: string[] = [];
      let totalSerialsAdded = 0;

      // Lô lưu ở server: phiếu nhập gửi kèm lô (tạo mới hoặc cộng vào lô cùng số
      // lô), phiếu xuất và chuyển gửi phân bổ theo lô; cùng một chứng từ với bút toán.
      const lotAllocations = (item: (typeof lineItems)[number]) =>
        item.lotAllocations?.length
          ? item.lotAllocations.map((lot) => ({ lotNo: lot.lotNumber, quantity: lot.quantity }))
          : undefined;
      const receiptLot = (item: (typeof lineItems)[number]) =>
        item.receiptLot
          ? {
              lotNo: item.receiptLot.lotNumber,
              manufacturedOn: item.receiptLot.manufactureDate,
              expiresOn: item.receiptLot.expiryDate,
              supplier: item.receiptLot.supplier,
              certificateNo: item.receiptLot.coCqNumber,
            }
          : undefined;

      if (movement.kind === 'receipt') {
        for (const item of lineItems) {
          const wh = item.warehouseCode || movement.warehouseCode;
          const itemVat = item.vatRate !== undefined ? item.vatRate : movement.vatRate;
          const itemVatNote = itemVat !== undefined ? `VAT: ${itemVat}%` : '';
          const lineNoteBase = [
            movement.note,
            movement.supplierName ? `NCC: ${movement.supplierName}` : '',
            movement.supplierAddress ? `Đ/c: ${movement.supplierAddress}` : '',
            movement.invoiceNumber ? `HĐ: ${movement.invoiceNumber}` : '',
            itemVatNote,
            movement.movementDate ? `Ngày nhận: ${movement.movementDate}` : '',
          ].filter(Boolean).join(' | ');
          const lineFullNote = item.lineNote ? `${lineNoteBase} (${item.lineNote})` : lineNoteBase;
          // Sê-ri đi cùng phiếu nhập (T8-11): chỉ chứng từ nhập mới đưa sê-ri vào
          // kho, khai riêng sau phiếu thì sê-ri chưa vào sổ kho. Số sê-ri lệch số
          // lượng thì server từ chối cả dòng, không ghi nửa vời.
          const serials = item.serialNumbers ?? [];
          const tx = await receiveStock({
            warehouseCode: wh,
            materialCode: item.materialCode,
            quantity: item.quantity,
            unitCost: item.unitCost,
            note: lineFullNote,
            lot: receiptLot(item),
            serials: serials.length > 0 ? [...serials] : undefined,
            counterparty: movement.counterparty,
          });
          showInLedger([tx]);
          txCodes.push(tx.transactionCode);
          totalSerialsAdded += serials.length;
        }

        const refText = txCodes.join(', ');
        await openOrderFor(movement, refText);
        return `Đã nhập kho ${lineItems.length} mặt hàng — chứng từ [${refText}]${
          totalSerialsAdded > 0 ? `, đã nhập ${totalSerialsAdded} sê-ri vào kho` : ''
        }.`;
      }

      if (movement.kind === 'issue') {
        const fullIssueNote = [
          movement.note,
          movement.movementDate ? `Ngày xuất: ${movement.movementDate}` : '',
        ].filter(Boolean).join(' | ');

        for (const item of lineItems) {
          const wh = item.warehouseCode || movement.warehouseCode;
          const lineNote = item.lineNote ? `${fullIssueNote} (${item.lineNote})` : fullIssueNote;
          if (movement.targetAssetCode) {
            const tx = await installItem(item.materialCode, {
              warehouseCode: wh,
              parentCode: movement.targetAssetCode,
              quantity: item.quantity,
              note: lineNote,
            });
            showInLedger([tx]);
            txCodes.push(tx.transactionCode);
          } else {
            const tx = await issueStock({
              warehouseCode: wh,
              materialCode: item.materialCode,
              quantity: item.quantity,
              note: lineNote,
              lots: lotAllocations(item),
              counterparty: movement.counterparty,
            });
            showInLedger([tx]);
            txCodes.push(tx.transactionCode);
          }
        }

        const refText = txCodes.join(', ');
        await openOrderFor(movement, refText);
        if (movement.targetAssetCode) {
          return `Đã xuất kho ${lineItems.length} mặt hàng lắp đặt vào ${movement.targetAssetCode} — chứng từ [${refText}]. Số lượng đã được cộng vào "Đang sử dụng".`;
        }
        return `Đã xuất kho ${lineItems.length} mặt hàng — chứng từ [${refText}].`;
      }

      // Transfer
      const fullTransferNote = [
        movement.note,
        movement.movementDate ? `Ngày chuyển: ${movement.movementDate}` : '',
      ].filter(Boolean).join(' | ');

      for (const item of lineItems) {
        const fromWh = item.warehouseCode || movement.warehouseCode;
        const toWh = item.toWarehouseCode || movement.toWarehouseCode || '';
        const lineNote = item.lineNote ? `${fullTransferNote} (${item.lineNote})` : fullTransferNote;
        const moved = await transferStock({
          fromWarehouseCode: fromWh,
          toWarehouseCode: toWh,
          materialCode: item.materialCode,
          quantity: item.quantity,
          note: lineNote,
          lots: lotAllocations(item),
        });
        showInLedger([moved.out, moved.in]);
        txCodes.push(`${moved.out.transactionCode}/${moved.in.transactionCode}`);
      }

      const refText = txCodes.join(', ');
      await openOrderFor(movement, refText);
      return `Đã chuyển kho ${lineItems.length} mặt hàng — chứng từ [${refText}].`;
  };

  /** Dùng cho đợt kiểm kê và các luồng không có form: lỗi hiện ở dải thông báo đầu trang. */
  const submitMovement = (movement: MovementInput) => perform(() => runMovement(movement));

  /** Dùng cho phiếu nhập/xuất đang mở: lỗi trả về cho form để hiện trong form. */
  const submitMovementInDialog = (movement: MovementInput) =>
    perform(() => runMovement(movement), { rethrow: true });

  /**
   * Xử lý nạp dữ liệu bổ sung từ tệp Excel trên Toolbar Tab Kho (hỗ trợ nhiều kho khác nhau)
   */
  const handleBulkImportData = (importedItems: MovementLineItem[]) =>
    perform(async () => {
      setShowBulkImport(false);
      if (!canWriteTransactions) throw new Error('Bạn không có quyền ghi giao dịch kho.');
      if (importedItems.length === 0) return;

      // 1. Tạo các mã vật tư mới chưa có trong danh mục (đầy đủ nhóm, thương hiệu, mã vạch...)
      const createdCodes = new Set<string>();
      for (const item of importedItems) {
        if (item.newMaterial && !createdCodes.has(item.newMaterial.code)) {
          createdCodes.add(item.newMaterial.code);
          await createMaterial({
            code: item.newMaterial.code,
            name: item.newMaterial.name,
            unit: item.newMaterial.unit,
            type: item.newMaterial.type || item.materialType || undefined,
            minStock: item.newMaterial.minStock,
            maxStock: item.newMaterial.maxStock,
            category: 'SPARE_PART',
            barcode: item.newMaterial.barcode,
            manufacturer: item.newMaterial.manufacturer,
            purchasePrice: item.unitCost,
          });
        }
      }

      // 2. Nạp tồn kho theo đúng kho của từng dòng (hỗ trợ nhiều kho khác nhau)
      let importedCount = 0;
      for (const item of importedItems) {
        const wh = item.warehouseCode || workspace?.warehouses[0]?.code;
        if (!wh) continue;
        await receiveStock({
          warehouseCode: wh,
          materialCode: item.materialCode,
          quantity: item.quantity,
          unitCost: item.unitCost,
          note: item.lineNote || 'Bổ sung dữ liệu đa kho từ tệp Excel',
        });
        if (item.locationId?.trim()) {
          try {
            await replaceMaterialStorageLocations(item.materialCode, wh, [
              { locationText: item.locationId.trim(), isPrimary: true },
            ]);
          } catch {
            // Không chặn nhập tồn nếu lưu vị trí kệ gặp lỗi
          }
        }
        importedCount++;
      }

      return `Đã bổ sung thành công ${importedCount} vật tư vào hệ thống kho.`;
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
    // Tab Tài sản cũng cần cấu hình: nó quyết định trường nào được hiện. Kho hàng cần danh mục
    // phân loại và sử dụng của hàng hóa.
    // Form hàng hóa cần công tắc lô, serial và bảng gợi ý theo nhóm, nên cũng nạp khi mở form.
    if (tab !== 'dashboard' && tab !== 'settings' && tab !== 'assets' && tab !== 'stock' && form !== 'material') return;
    if (settings) return;
    void loadInventorySettings()
      .then((loaded) => {
        setSettings(loaded);
        setCardDraft(loaded['dashboard.cards'].value.cardIds);
        setAssetCatalogDraft(loaded['catalog.asset'].value);
        setUnitDraft(loaded['catalog.unit'].value.units ?? []);
        setLevelsDraft(loaded['warehouse.location.levels']?.value.levels ?? []);
        setTradeDraft(loaded['catalog.trade']?.value);
        setTrackingDraft(trackingDraftFromSettings(loaded));
      })
      .catch(() => setSettings(undefined));
  }, [tab, form, settings]);

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
      // The API rechecks capabilities even if the screen has stale permissions.
      notifyError(cause instanceof Error ? cause.message : 'Không lưu được cấu hình.');
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
      notifyError(cause instanceof Error ? cause.message : 'Không lưu được cấu hình.');
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
      notifyError(cause instanceof Error ? cause.message : 'Không lưu được danh mục đơn vị.');
    } finally {
      setSavingCards(false);
    }
  };

  const saveLocationLevels = async () => {
    if (!settings) return;
    setSavingCards(true);
    try {
      const saved = await saveInventorySetting(
        'warehouse.location.levels',
        { levels: levelsDraft },
        settings['warehouse.location.levels']?.version ?? 0,
      );
      setSettings({
        ...settings,
        'warehouse.location.levels': saved as InventorySettingsSnapshot['warehouse.location.levels'],
      });
      setLevelsDraft((saved as InventorySettingsSnapshot['warehouse.location.levels']).value.levels ?? []);
      setError(undefined);
    } catch (cause) {
      notifyError(cause instanceof Error ? cause.message : 'Không lưu được mẫu cấp vị trí.');
    } finally {
      setSavingCards(false);
    }
  };

  const levelsDirty =
    JSON.stringify(levelsDraft) !== JSON.stringify(settings?.['warehouse.location.levels']?.value.levels ?? []);

  const saveTradeCatalog = async () => {
    if (!settings || !tradeDraft) return;
    setSavingCards(true);
    try {
      const saved = await saveInventorySetting(
        'catalog.trade',
        tradeDraft,
        settings['catalog.trade'].version,
      );
      setSettings({
        ...settings,
        'catalog.trade': saved as InventorySettingsSnapshot['catalog.trade'],
      });
      setTradeDraft((saved as InventorySettingsSnapshot['catalog.trade']).value);
      setError(undefined);
    } catch (cause) {
      notifyError(cause instanceof Error ? cause.message : 'Không lưu được danh mục hàng hóa.');
    } finally {
      setSavingCards(false);
    }
  };

  const saveTracking = async () => {
    if (!settings || !trackingDraft) return;
    setSavingCards(true);
    let next = settings;
    try {
      // Công tắc trước, bảng gợi ý sau; chỉ ghi khoá nào đổi. Dừng ở khoá đầu tiên lỗi (ví dụ còn hàng có tồn
      // đang theo dõi nên không tắt được) và giữ những khoá đã lưu.
      const writes = [
        ['tracking.serial.enabled', { enabled: trackingDraft.serialEnabled }],
        ['tracking.lot.enabled', { enabled: trackingDraft.lotEnabled }],
        ['tracking.defaultByCategory', trackingDraft.defaults],
      ] as const;
      for (const [key, value] of writes) {
        if (JSON.stringify(value) === JSON.stringify(next[key]?.value)) continue;
        const saved = await saveInventorySetting(key, value, next[key]?.version);
        next = { ...next, [key]: saved } as InventorySettingsSnapshot;
      }
      setTrackingDraft(trackingDraftFromSettings(next));
      setError(undefined);
    } catch (cause) {
      notifyError(cause instanceof Error ? cause.message : 'Không lưu được cấu hình theo dõi lô và serial.');
    } finally {
      setSettings(next);
      setSavingCards(false);
    }
  };

  const trackingDirty =
    trackingDraft !== undefined &&
    JSON.stringify(trackingDraft) !== JSON.stringify(trackingDraftFromSettings(settings));

  const tradeDirty =
    tradeDraft !== undefined &&
    JSON.stringify(tradeDraft) !== JSON.stringify(settings?.['catalog.trade']?.value);

  /** Phân loại và cách sử dụng đang có mặt hàng dùng — không cho xoá khỏi danh mục. */
  const usedTrade = useMemo(() => {
    const goods = new Set<string>();
    const services = new Set<string>();
    const usage = new Set<string>();
    for (const material of workspace?.materials ?? []) {
      const category = material.tradeCategory?.trim();
      if (category) (material.kind === 'SERVICE' ? services : goods).add(category);
      const mode = usageLabel(material.tradeMode);
      if (mode) usage.add(mode);
    }
    return { goods, services, usage };
  }, [workspace]);

  const unitsDirty =
    JSON.stringify(unitDraft) !== JSON.stringify(settings?.['catalog.unit'].value.units ?? []);

  /** Đơn vị đang có vật tư dùng — không cho xoá khỏi danh mục. */
  const usedUnits = useMemo(
    () => new Set((workspace?.materials ?? []).map((item) => item.unit).filter(Boolean)),
    [workspace],
  );

  /** Quy tắc nhập nhà cung cấp cho các form (nhập kho, lô): chọn từ danh mục hay gõ tự do. */
  const supplierInput = useMemo(() => supplierInputState(settings), [settings]);

  const catalogDirty =
    assetCatalogDraft !== undefined &&
    JSON.stringify(assetCatalogDraft) !== JSON.stringify(settings?.['catalog.asset'].value);

  const storedCards = settings?.['dashboard.cards'].value.cardIds ?? [];
  const cardsDirty =
    cardDraft.length !== storedCards.length ||
    cardDraft.some((id, index) => id !== storedCards[index]);

  return (
    <InventoryPermissionsContext.Provider value={uiPermissions}>
    <SupplierInputProvider value={supplierInput}>
    <ModuleShell<Tab>
      moduleKey="inventory"
      appearance="light"
      title="Kho & Vật tư"
      subtitle="Tồn thực tế, khả dụng và luân chuyển vật tư theo từng kho."
      nav={NAV}
      view={tab}
      onViewChange={handleViewChange}
      homeHref={homePath}
      actions={null}
      banner={
        <>
          {error ? (
            <p role="alert" className="mb-4 rounded-[0.65rem] border border-[#f0c2c2] bg-[#fdf2f2] px-4 py-[0.8rem] text-[#a12b2b]">
              {error}
              {loadFailed ? (
                <>
                  {' '}
                  <Button type="button" variant="link" size="xs" className="h-auto p-0 font-bold" onClick={() => void reload()}>
                    Tải lại
                  </Button>
                </>
              ) : null}
            </p>
          ) : null}
        </>
      }
    >

      {!workspace ? (
        <p className="m-0 py-8 text-center text-slate-500">Đang tải dữ liệu kho…</p>
      ) : (
        <>
          {installTarget !== undefined ? (
            <InstallMaterialDialog
              parent={installTarget === 'root' ? undefined : installTarget}
              materials={workspace.materials}
              warehouses={workspace.warehouses}
              stock={workspace.stock}
              busy={busy}
              onCancel={() => setInstallTarget(undefined)}
              onConfirm={(code, input) =>
                perform(async () => {
                  const issue = await installItem(code, input);
                  return input.parentCode
                    ? `Đã xuất ${input.quantity} ${code} từ ${input.warehouseCode} và lắp vào ${input.parentCode} — phiếu ${issue.transactionCode}.`
                    : `Đã xuất ${input.quantity} ${code} từ ${input.warehouseCode} làm thiết bị gốc trên cây tài sản — phiếu ${issue.transactionCode}.`;
                }, { rethrow: true }).then(() => setInstallTarget(undefined))
              }
            />
          ) : null}

          {returnTarget ? (
            <ReturnToStockDialog
              title={`Tháo dỡ / Thanh lý ${returnTarget.name}`}
              description={`Tháo dỡ ${returnTarget.code} khỏi vị trí lắp đặt và nhập về kho. Đây là một lệnh nhập thật — sổ cái sẽ có thêm một bút toán. Mã vật tư không bị xoá.`}
              unit={returnTarget.unit}
              maxQuantity={1}
              isAsset={true}
              warehouses={workspace.warehouses}
              procedures={procedures}
              hasChildren={workspace.assets.some((a) => a.parentId === returnTarget.id)}
              busy={busy}
              onCancel={() => setReturnTarget(undefined)}
              onConfirm={(input) => {
                const { code, id, name } = returnTarget;
                return perform(async () => {
                  const receipt = await returnItemToStock(code, input);
                  if (selectedAssetId === id) setSelectedAssetId(undefined);

                  if (input.procedureDefinitionId) {
                    try {
                      const order = await openMovementWorkOrder({
                        definitionId: input.procedureDefinitionId,
                        title: `Tháo dỡ thiết bị ${code} (${name}) về kho ${input.warehouseCode} — chứng từ ${receipt.transactionCode}`,
                      });
                      setMovementOrder(order);
                    } catch (cause) {
                      notifyError(
                        cause instanceof Error
                          ? `Đã nhập về kho nhưng không mở được work order: ${cause.message}`
                          : 'Đã nhập về kho nhưng không mở được work order.',
                      );
                    }
                  }

                  return `Đã tháo dỡ ${code} về kho ${input.warehouseCode} — phiếu ${receipt.transactionCode}.`;
                }, { rethrow: true }).then(() => setReturnTarget(undefined));
              }}
            />
          ) : null}

          {uninstallTarget ? (
            <ReturnToStockDialog
              title={`Tháo dỡ ${uninstallTarget.asset.name}`}
              description={`Tháo dỡ ${uninstallTarget.asset.code} khỏi cây và nhập ${uninstallTarget.line.materialCode} ngược về kho. Đang lắp ${uninstallTarget.line.quantity} ${uninstallTarget.line.unit ?? ''}.`}
              unit={uninstallTarget.line.unit}
              maxQuantity={uninstallTarget.line.quantity}
              serialMaterialCode={
                workspace.materials.find((item) => item.code === uninstallTarget.line.materialCode)?.isSerialized
                  ? uninstallTarget.line.materialCode
                  : undefined
              }
              warehouses={workspace.warehouses}
              procedures={procedures}
              busy={busy}
              onCancel={() => setUninstallTarget(undefined)}
              onConfirm={(input) => {
                const { asset, line } = uninstallTarget;
                return perform(async () => {
                  const receipt = await uninstallMaterial(asset.code, {
                    warehouseCode: input.warehouseCode,
                    quantity: input.quantity,
                    note: input.note,
                    serials: input.serials,
                  });
                  if (selectedAssetId === asset.id) setSelectedAssetId(undefined);

                  if (input.procedureDefinitionId) {
                    try {
                      const order = await openMovementWorkOrder({
                        definitionId: input.procedureDefinitionId,
                        title: `Tháo dỡ vật tư ${line.materialCode} khỏi ${asset.code} về kho ${input.warehouseCode} — phiếu ${receipt.transactionCode}`,
                      });
                      setMovementOrder(order);
                    } catch (cause) {
                      notifyError(
                        cause instanceof Error
                          ? `Đã tháo về kho nhưng không mở được work order: ${cause.message}`
                          : 'Đã tháo về kho nhưng không mở được work order.',
                      );
                    }
                  }

                  return `Đã tháo ${input.quantity} ${line.materialCode} về kho ${input.warehouseCode} — phiếu ${receipt.transactionCode}.`;
                }, { rethrow: true }).then(() => setUninstallTarget(undefined));
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
            <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40" role="alertdialog" aria-labelledby="wo-title">
              <div className="w-[min(28rem,90vw)] rounded-xl bg-white p-5 shadow-xl [&_h2]:m-0 [&_h2]:mb-2 [&_h2]:text-lg [&_p]:m-0 [&_p]:mb-4 [&_p]:text-sm">
                <h2 id="wo-title">Đã mở work order</h2>
                <p>
                  Lệnh kho đã ghi nhận và work order{' '}
                  <strong className="font-bold">{movementOrder.code}</strong> đã được
                  mở bên module Quy trình.
                </p>
                <div className="mt-1 flex gap-2">
                  <Button render={<a href="/modules/procedure#workspace" />} nativeButton={false}>
                    Mở work order
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setMovementOrder(undefined)}>
                    Đóng
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {showBulkImport && workspace ? (
            <ExcelImportDialog
              warehouses={workspace.warehouses}
              materials={workspace.materials}
              defaultWarehouseCode={workspace.warehouses[0]?.code ?? ''}
              isSingleWarehouseOnly={false}
              onCancel={() => setShowBulkImport(false)}
              onImportItems={handleBulkImportData}
            />
          ) : null}

          {showStocktakeDialog && workspace && canCreateStocktake ? (
            <CreateStocktakeDialog
              workspace={workspace}
              busy={busy}
              initialWarehouseCode={stocktakeInit?.warehouseCode}
              initialSelectedMaterials={stocktakeInit?.selectedMaterials}
              onClose={() => {
                setShowStocktakeDialog(false);
                setStocktakeInit(undefined);
              }}
              onSubmit={async (input) => {
                const created = await createStocktakeSession(input, workspace);
                const { session } = await startStocktakeCounting(created.id, workspace);
                handleSelectSubTab('stocktakes');
                setShowStocktakeDialog(false);
                setStocktakeInit(undefined);
                notify(`Đã tạo đợt kiểm kê ${session.code} và bắt đầu phiên đếm.`);
              }}
            />
          ) : null}

          {form === 'movement' ? (
            <MovementForm
              workspace={workspace}
              initialKind={movementInit?.kind ?? 'receipt'}
              initialMaterialCode={movementInit?.materialCode}
              initialOpenExcelImport={movementInit?.openExcelImport}
              initialItems={movementInit?.initialItems}
              isDialog={true}
              busy={busy}
              onCancel={() => {
                setForm(undefined);
                setMovementInit(undefined);
              }}
              procedures={procedures}
              units={settings?.['catalog.unit'].value.units ?? []}
              types={settings?.['catalog.asset'].value.types ?? []}
              reservations={reservations ?? []}
              workOrders={workOrders}
              onSubmit={submitMovementInDialog}
            />
          ) : null}

          {form === 'material' ? (
            <MaterialForm
              editing={editingMaterial}
              units={settings?.['catalog.unit'].value.units ?? []}
              types={settings?.['catalog.asset'].value.types ?? []}
              catalog={settings?.['catalog.trade']?.value}
              tracking={
                settings
                  ? {
                      lotEnabled: settings['tracking.lot.enabled']?.value.enabled === true,
                      serialEnabled: settings['tracking.serial.enabled']?.value.enabled === true,
                    }
                  : undefined
              }
              trackingDefaults={settings?.['tracking.defaultByCategory']?.value}
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
                }, { rethrow: true })
              }
            />
          ) : null}

          {form === 'asset' || form === 'asset_root' ? (
            <AssetForm
              assets={workspace.assets}
              materials={workspace.materials}
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
                }, { rethrow: true })
              }
            />
          ) : null}

          {tab === 'dashboard' ? (
            <InventoryDashboard
              workspace={workspace}
              ledger={ledger ?? []}
              materialByCode={materialByCode}
              cardSelection={settings ? settings['dashboard.cards'].value.cardIds : undefined}
              onNavigate={(target) => {
                if (target === 'transactions') {
                  handleSelectSubTab('history');
                  return;
                }
                navigate(target);
              }}
              onOpenMovement={canWriteTransactions ? () => setForm('movement') : undefined}
            />
          ) : null}

          {tab === 'reports' ? <InventoryReports warehouses={workspace.warehouses} catalog={settings?.['catalog.trade']?.value} /> : null}

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
                      disabled={!canManage || savingCards}
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
                        disabled={!canManage || savingCards}
                        onChange={setAssetCatalogDraft}
                      />
                    ) : null,
                },
                {
                  id: 'warehouses',
                  label: 'Kho',
                  description:
                    'Danh sách kho cho phiếu nhập/xuất chọn. Sửa xong là lưu ngay, không cần bấm Lưu. Kho còn hàng thì không ngừng dùng được.',
                  render: () => (
                    <WarehouseEditor
                      disabled={!canManage || savingCards}
                      templateLevels={settings?.['warehouse.location.levels']?.value.levels ?? []}
                    />
                  ),
                },
                {
                  id: 'location-levels',
                  label: 'Cấp vị trí kho',
                  description:
                    'Mẫu tên các cấp vị trí lưu trữ (Khu vực, Dãy, Kệ, Tầng, Ô chứa...) dùng cho mọi kho. Mỗi kho có thể đặt tên cấp riêng ở mục Kho. Không giới hạn số cấp; đổi tên cấp không đổi vị trí đã nhập.',
                  render: () => (
                    <LocationLevelsEditor
                      levels={levelsDraft}
                      disabled={!canManage || savingCards}
                      onChange={setLevelsDraft}
                    />
                  ),
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
                      disabled={!canManage || savingCards}
                      onChange={setUnitDraft}
                    />
                  ),
                },
                {
                  id: 'suppliers',
                  label: 'Nhà cung cấp',
                  description:
                    'Danh mục nhà cung cấp cho form nhập kho và lô. Chỉ chọn từ danh mục thì "Công ty A" và "CÔNG TY A" không thành hai nhà khác nhau khi tìm và truy xuất.',
                  render: () => (
                    <SupplierCatalogSection
                      key={supplierCatalogSectionKey(settings)}
                      settings={settings}
                      canManage={canManage}
                      onSaved={(message) => {
                        notify(message);
                        void loadInventorySettings().then(setSettings).catch(() => undefined);
                      }}
                    />
                  ),
                },
                {
                  id: 'trade',
                  label: 'Phân loại hàng hóa',
                  description:
                    'Khai báo phân loại (hàng hóa và dịch vụ mỗi nhóm một danh sách) và cách sử dụng (chỉ bán, chỉ tặng, đi kèm combo...) cho trang Kho hàng. Mục đang có mặt hàng dùng thì không xoá được.',
                  render: () =>
                    tradeDraft ? (
                      <div className="flex flex-col gap-5">
                        <div>
                          <h4 className="m-0 mb-2 text-[14px]">Phân loại hàng hóa</h4>
                          <UnitCatalogEditor
                            units={tradeDraft.goodsCategories}
                            usedUnits={usedTrade.goods}
                            disabled={!canManage || savingCards}
                            noun="phân loại hàng hóa"
                            placeholder="VD: Cáp điện, Thiết bị đo"
                            onChange={(next) => setTradeDraft({ ...tradeDraft, goodsCategories: next })}
                          />
                        </div>
                        <div>
                          <h4 className="m-0 mb-2 text-[14px]">Phân loại dịch vụ</h4>
                          <UnitCatalogEditor
                            units={tradeDraft.serviceCategories}
                            usedUnits={usedTrade.services}
                            disabled={!canManage || savingCards}
                            noun="phân loại dịch vụ"
                            placeholder="VD: Lắp đặt, Bảo trì"
                            onChange={(next) => setTradeDraft({ ...tradeDraft, serviceCategories: next })}
                          />
                        </div>
                        <div>
                          <h4 className="m-0 mb-2 text-[14px]">Sử dụng</h4>
                          <UnitCatalogEditor
                            units={tradeDraft.usageModes}
                            usedUnits={usedTrade.usage}
                            disabled={!canManage || savingCards}
                            noun="cách sử dụng"
                            placeholder="VD: Chỉ bán, Chỉ tặng, Đi kèm combo"
                            onChange={(next) => setTradeDraft({ ...tradeDraft, usageModes: next })}
                          />
                        </div>
                      </div>
                    ) : null,
                },
                {
                  id: 'tracking',
                  label: 'Theo dõi lô và serial',
                  description:
                    'Bật quản lý theo lô hoặc theo serial cho đơn vị. Tắt thì form hàng hóa không hiện lựa chọn đó. Còn hàng đang theo dõi kiểu đó mà có tồn thì không tắt được.',
                  render: () =>
                    trackingDraft ? (
                      <TrackingSettingsEditor
                        value={trackingDraft}
                        disabled={!canManage || savingCards}
                        onChange={setTrackingDraft}
                      />
                    ) : null,
                },
              ]}
              activeSectionId={settingsSection}
              readOnly={!canManage}
              onSectionChange={setSettingsSection}
              /* Khối Kho tự lưu ngay khi sửa nên không bao giờ "bẩn": để nó
                 dùng chung nút Lưu sẽ hiện một nút không làm gì. */
              dirty={
                settingsSection === 'tracking'
                  ? trackingDirty
                  : settingsSection === 'warehouses' || settingsSection === 'suppliers'
                    ? false
                    : settingsSection === 'asset-fields'
                    ? catalogDirty
                    : settingsSection === 'units'
                      ? unitsDirty
                      : settingsSection === 'location-levels'
                        ? levelsDirty
                        : settingsSection === 'trade'
                          ? tradeDirty
                          : cardsDirty
              }
              saving={savingCards}
              onSave={
                settingsSection === 'tracking'
                  ? saveTracking
                  : settingsSection === 'warehouses' || settingsSection === 'suppliers'
                    ? () => undefined
                    : settingsSection === 'asset-fields'
                    ? saveAssetCatalog
                    : settingsSection === 'units'
                      ? saveUnits
                      : settingsSection === 'location-levels'
                        ? saveLocationLevels
                        : settingsSection === 'trade'
                          ? saveTradeCatalog
                          : saveCards
              }
              onReset={() =>
                settingsSection === 'tracking'
                  ? setTrackingDraft(trackingDraftFromSettings(settings))
                  : settingsSection === 'asset-fields'
                  ? setAssetCatalogDraft(settings?.['catalog.asset'].value)
                  : settingsSection === 'units'
                    ? setUnitDraft(settings?.['catalog.unit'].value.units ?? [])
                    : settingsSection === 'location-levels'
                      ? setLevelsDraft(settings?.['warehouse.location.levels']?.value.levels ?? [])
                      : settingsSection === 'trade'
                        ? setTradeDraft(settings?.['catalog.trade']?.value)
                        : setCardDraft(storedCards)
              }
            />
          ) : null}

          {tab === 'stock' ? (
            <>
              {/* Trang Kho hàng: Hàng hóa (buôn bán) - Nhà kho (tồn kho) - Lịch sử xuất nhập - Lịch sử kiểm đếm */}
              <div className="mb-4 flex flex-wrap gap-[0.35rem]">
                {STOCK_SUB_TABS.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    className={cn(
                      'cursor-pointer rounded-[0.65rem] border-0 px-[0.95rem] py-2 text-sm font-semibold',
                      stockSubTab === sub.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    )}
                    onClick={() => handleSelectSubTab(sub.id)}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              {stockSubTab === 'goods' ? (
                <TradeItemsPage
                  canManage={canManage}
                  warehouses={workspace.warehouses}
                  stock={workspace.stock}
                  catalog={settings?.['catalog.trade']?.value}
                  units={settings?.['catalog.unit']?.value.units}
                  locationLevels={settings?.['warehouse.location.levels']?.value.levels}
                  onChanged={() => void reload()}
                  onCatalogChanged={() => void loadInventorySettings().then(setSettings).catch(() => undefined)}
                />
              ) : null}

              {stockSubTab === 'warehouse' ? (
                <WarehouseStockTab
                  materials={workspace.materials}
                  warehouses={workspace.warehouses}
                  stock={workspace.stock}
                  statuses={settings?.['catalog.asset']?.value.enabledStatuses ?? []}
                  usageStates={settings?.['catalog.asset']?.value.usageStates ?? []}
                  onOpenBulkImport={canWriteTransactions ? () => setShowBulkImport(true) : undefined}
                  onOpenStocktake={
                    canCreateStocktake
                      ? (init) => {
                          setStocktakeInit(init);
                          setShowStocktakeDialog(true);
                        }
                      : undefined
                  }
                  onOpenMovement={
                    canWriteTransactions
                      ? (init) => {
                          setMovementInit(init);
                          setForm('movement');
                        }
                      : undefined
                  }
                />
              ) : null}

              {stockSubTab === 'serials' ? (
                <SerialHub
                  materials={workspace.materials}
                  warehouses={workspace.warehouses}
                  statuses={settings?.['catalog.asset']?.value.enabledStatuses ?? []}
                  usageStates={settings?.['catalog.asset']?.value.usageStates ?? []}
                />
              ) : null}

              {stockSubTab === 'movements' ? (
                <StockMovementHub
                  warehouses={workspace.warehouses}
                  materials={workspace.materials}
                  target={movementTarget}
                  onNotice={notify}
                  onStockChanged={() => void reload()}
                />
              ) : null}

              {stockSubTab === 'history' ? (
                <TransactionHub
                  workspace={workspace}
                  ledger={ledger ?? []}
                  busy={busy}
                  onSubmitMovement={submitMovement}
                  onSubmitMovementInDialog={submitMovementInDialog}
                  onReload={async () => { await reload(); }}
                  onNotice={notify}
                  hideSubTabs={true}
                  onOpenProfile={(code) => setProfileCode(code)}
                />
              ) : null}

              {stockSubTab === 'stocktakes' ? (
                <StocktakeHub
                  workspace={workspace}
                  busy={busy}
                  onNotice={notify}
                />
              ) : null}
            </>
          ) : null}

          {tab === 'assets' ? (
            <div className="grid grid-cols-1 items-start gap-5 min-[60.01rem]:grid-cols-[minmax(18rem,23rem)_minmax(0,1fr)]">
              <AssetTree
                assets={workspace.assets}
                installed={installed}
                warehouses={workspace.warehouses}
                selectedId={selectedAssetId}
                busy={busy}
                onSelect={setSelectedAssetId}
                onAddAsset={canManage ? () => {
                  setInstallTarget('root');
                } : undefined}
                onInstall={canManage ? (parent) => setInstallTarget(parent) : undefined}
                onUninstall={canManage ? (asset, line) => setUninstallTarget({ asset, line }) : undefined}
                onReturn={canManage ? (asset) => setReturnTarget(asset) : undefined}
                onBulkReturn={canManage ? (entries) =>
                  perform(async () => {
                    for (const entry of entries) {
                      await returnItemToStock(entry.asset.code, {
                        warehouseCode: entry.warehouseCode,
                        quantity: 1,
                        note: entry.note ? entry.note : undefined,
                      });
                      if (selectedAssetId === entry.asset.id) {
                        setSelectedAssetId(undefined);
                      }
                    }
                    return `Đã tháo dỡ ${entries.length} thiết bị về kho thành công.`;
                  }, { rethrow: true })
                : undefined}
                onRename={canManage ? (asset, name) =>
                  perform(async () => {
                    await updateAsset(asset.code, { name });
                    return `Đã đổi tên ${asset.code}.`;
                  })
                : undefined}
                onMove={canManage ? (asset, parentCode) =>
                  perform(async () => {
                    await updateAsset(asset.code, { parentCode });
                    return parentCode
                      ? `Đã chuyển ${asset.code} vào ${parentCode}.`
                      : `Đã đưa ${asset.code} lên làm gốc.`;
                  })
                : undefined}
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
                    onRetire={canManage ? (asset) => setReturnTarget(asset) : undefined}
                    onAddChild={canManage ? (asset) => setInstallTarget(asset) : undefined}
                  />
                ) : (
                  <p className="m-0 py-8 text-center text-slate-500">Chọn một tài sản.</p>
                )}
              </section>
            </div>
          ) : null}

          {tab === 'custody' ? (
            <CustodyPanel
              canManage={canManage}
              busy={busy}
              onAssign={(asset, employeeId) =>
                perform(
                  async () => {
                    await assignCustody(asset.code, employeeId);
                    return employeeId
                      ? `Đã cấp phát ${asset.code}.`
                      : `Đã thu hồi ${asset.code}.`;
                  },
                  // Cấp phát đi qua hộp thoại nên nhận lỗi trong hộp thoại; thu hồi là nút ngoài bảng.
                  { rethrow: employeeId !== null },
                )
              }
              onDeclare={(input) =>
                perform(async () => {
                  const created = await createAsset(input);
                  return `Đã khai báo tài sản ${created.code}.`;
                }, { rethrow: true })
              }
            />
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
    </SupplierInputProvider>
    </InventoryPermissionsContext.Provider>
  );
}
