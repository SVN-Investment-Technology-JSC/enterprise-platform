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
import { StocktakeHub } from './components/stocktake-hub';
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
import { MovementForm, type MovementInput, type MovementLineItem } from './components/movement-form';
import { ExcelImportDialog } from './components/excel-import-dialog';
import { CreateStocktakeDialog } from './components/create-stocktake-dialog';
import { LedgerTable } from './components/ledger-table';
import { StockDocumentApproval, StockDocumentList } from './components/stock-document-list';
import { IssueRequestPanel } from './components/issue-request-panel';
import { InventoryReports } from './components/inventory-reports';
import {
  createAsset,
  createMaterial,
  createStocktakeSession,
  startStocktakeCounting,
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
  loadTenantHomePath,
  receiveStock,
  issueStock,
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
import { InventoryPermissionsContext } from './inventory-permissions';

type Tab =
  | 'dashboard'
  | 'items'
  | 'stock'
  | 'transactions'
  | 'documents'
  | 'approvals'
  | 'issue-requests'
  | 'assets'
  | 'ledger'
  | 'reports'
  | 'settings';

type StockSubTab = 'kho' | 'transactions' | 'stocktakes';

const NAV: readonly ModuleNavItem<Tab>[] = [
  { id: 'dashboard', label: 'Tổng quan' },
  { id: 'stock', label: 'Kho & Danh mục', group: 'Vận hành' },
  { id: 'transactions', label: 'Giao dịch & Nhập xuất', group: 'Vận hành' },
  { id: 'documents', label: 'Chứng từ kho', group: 'Chứng từ' },
  { id: 'approvals', label: 'Duyệt chứng từ', group: 'Chứng từ' },
  { id: 'issue-requests', label: 'Yêu cầu xuất từ đơn bán', group: 'Chứng từ' },
  { id: 'assets', label: 'Cây tài sản', group: 'Vận hành' },
  { id: 'reports', label: 'Báo cáo kho', group: 'Báo cáo' },
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
  transactions: 'stock',
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
  const [stockSubTab, setStockSubTab] = useState<StockSubTab>('kho');
  const [workspace, setWorkspace] = useState<InventoryWorkspace>();
  const canManage = workspace?.permissions?.canManage ?? false;
  const canWriteTransactions = workspace?.permissions?.canWriteTransactions ?? false;
  const canWriteQuality = workspace?.permissions?.canWriteQuality ?? false;
  const canApproveDocuments = workspace?.permissions?.canApproveDocuments ?? false;
  const uiPermissions = useMemo(
    () => ({ canManage, canWriteTransactions, canWriteQuality, canApproveDocuments }),
    [canManage, canWriteTransactions, canWriteQuality, canApproveDocuments],
  );
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
  /** Ô tìm của bảng Tồn kho. */
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
    const [workspaceResult, ledgerResult, reservationResult, itemResult, installedResult] =
      await Promise.allSettled([
        loadInventoryWorkspace(),
        loadLedger(),
        loadReservations(),
        loadInventoryItems(),
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
    if (itemResult.status === 'fulfilled') setItems(itemResult.value);
    if (installedResult.status === 'fulfilled') setInstalled(installedResult.value);
    note('tồn kho', workspaceResult);
    note('sổ cái', ledgerResult);
    note('phiếu giữ chỗ', reservationResult);
    note('danh mục thiết bị', itemResult);
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
      // Thao tác đã ghi xong: nạp lại lỗi chỉ là chưa cập nhật màn hình, không phải ghi thất bại.
      const reloadFailure = await reload();
      if (reloadFailure && message) setError(`${message} ${reloadFailure}`);
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
      setError(
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

  const submitMovement = (movement: MovementInput) =>
    perform(async () => {
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
    });

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
      // The API rechecks capabilities even if the screen has stale permissions.
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
    <InventoryPermissionsContext.Provider value={uiPermissions}>
    <ModuleShell<Tab>
      moduleKey="inventory"
      appearance="light"
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
              {loadFailed ? (
                <>
                  {' '}
                  <button type="button" className={styles.linkButton} onClick={() => void reload()}>
                    Tải lại
                  </button>
                </>
              ) : null}
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
          {installTarget !== undefined ? (
            <InstallMaterialDialog
              parent={installTarget === 'root' ? undefined : installTarget}
              materials={workspace.materials}
              warehouses={workspace.warehouses}
              stock={workspace.stock}
              busy={busy}
              onCancel={() => setInstallTarget(undefined)}
              onConfirm={(code, input) => {
                setInstallTarget(undefined);
                void perform(async () => {
                  const issue = await installItem(code, input);
                  return input.parentCode
                    ? `Đã xuất ${input.quantity} ${code} từ ${input.warehouseCode} và lắp vào ${input.parentCode} — phiếu ${issue.transactionCode}.`
                    : `Đã xuất ${input.quantity} ${code} từ ${input.warehouseCode} làm thiết bị gốc trên cây tài sản — phiếu ${issue.transactionCode}.`;
                });
              }}
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
                setReturnTarget(undefined);
                void perform(async () => {
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
                      setError(
                        cause instanceof Error
                          ? `Đã nhập về kho nhưng không mở được work order: ${cause.message}`
                          : 'Đã nhập về kho nhưng không mở được work order.',
                      );
                    }
                  }

                  return `Đã tháo dỡ ${code} về kho ${input.warehouseCode} — phiếu ${receipt.transactionCode}.`;
                });
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
                setUninstallTarget(undefined);
                void perform(async () => {
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
                      setError(
                        cause instanceof Error
                          ? `Đã tháo về kho nhưng không mở được work order: ${cause.message}`
                          : 'Đã tháo về kho nhưng không mở được work order.',
                      );
                    }
                  }

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

          {showStocktakeDialog && workspace ? (
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
                setStockSubTab('stocktakes');
                setShowStocktakeDialog(false);
                setStocktakeInit(undefined);
                setNotice(`Đã tạo đợt kiểm kê ${session.code} và bắt đầu phiên đếm.`);
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
              onSubmit={submitMovement}
            />
          ) : null}

          {form === 'material' ? (
            <MaterialForm
              editing={editingMaterial}
              units={settings?.['catalog.unit'].value.units ?? []}
              types={settings?.['catalog.asset'].value.types ?? []}
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
                })
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
                  setStockSubTab('transactions');
                  navigate('stock');
                  return;
                }
                navigate(target);
              }}
              onOpenMovement={canWriteTransactions ? () => setForm('movement') : undefined}
            />
          ) : null}

          {tab === 'transactions' ? (
            <TransactionHub
              workspace={workspace}
              ledger={ledger ?? []}
              busy={busy}
              onSubmitMovement={submitMovement}
              onReload={async () => { await reload(); }}
              onNotice={(msg) => setNotice(msg)}
              onOpenProfile={(code) => setProfileCode(code)}
            />
          ) : null}

          {tab === 'documents' ? (
            <StockDocumentList
              warehouses={workspace.warehouses}
              materials={workspace.materials}
              onNotice={setNotice}
              onStockChanged={() => void reload()}
            />
          ) : null}

          {tab === 'approvals' ? (
            <StockDocumentApproval
              warehouses={workspace.warehouses}
              onNotice={setNotice}
              onStockChanged={() => void reload()}
            />
          ) : null}

          {tab === 'issue-requests' ? (
            <IssueRequestPanel
              warehouses={workspace.warehouses}
              materials={workspace.materials}
              onNotice={setNotice}
              onStockChanged={() => void reload()}
            />
          ) : null}

          {tab === 'reports' ? <InventoryReports warehouses={workspace.warehouses} /> : null}

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
                  render: () => <WarehouseEditor disabled={!canManage || savingCards} />,
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
              ]}
              activeSectionId={settingsSection}
              readOnly={!canManage}
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
              {/* THANH SUB-TAB: KHO - LỊCH SỬ XUẤT NHẬP - LỊCH SỬ KIỂM ĐẾM */}
              <div className={styles.tabs} style={{ margin: '0 0 1rem 0' }}>
                <button
                  type="button"
                  className={`${styles.tab} ${stockSubTab === 'kho' ? styles.tabActive : ''}`}
                  onClick={() => setStockSubTab('kho')}
                >
                  Kho
                </button>
                <button
                  type="button"
                  className={`${styles.tab} ${stockSubTab === 'transactions' ? styles.tabActive : ''}`}
                  onClick={() => setStockSubTab('transactions')}
                >
                  Lịch sử xuất nhập
                </button>
                <button
                  type="button"
                  className={`${styles.tab} ${stockSubTab === 'stocktakes' ? styles.tabActive : ''}`}
                  onClick={() => setStockSubTab('stocktakes')}
                >
                  Lịch sử kiểm đếm
                </button>
              </div>

              {/* 1. Sub-tab Kho: Danh mục vật tư và tồn kho theo mã */}
              {stockSubTab === 'kho' ? (
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
                  workspace={workspace}
                  busy={busy}
                  onOpenProfile={(code) => setProfileCode(code)}
                  onOpenStocktake={(init) => {
                    setStocktakeInit(init);
                    setShowStocktakeDialog(true);
                  }}
                  onAddMaterial={canManage ? () => setForm('material') : undefined}
                  onOpenBulkImport={canWriteTransactions ? () => setShowBulkImport(true) : undefined}
                  onOpenMovement={canWriteTransactions ? (init) => {
                    setMovementInit(init);
                    setForm('movement');
                  } : undefined}
                  onRetire={canManage ? (material) =>
                    perform(async () => {
                      const result = await retireMaterial(material.code);
                      return `Đã ngừng dùng ${material.code}. ${result.reason ?? ''}`;
                    })
                  : undefined}
                  onPatch={canManage ? (item, patch) =>
                    perform(async () => {
                      if (item.kind === 'ASSET') await updateAsset(item.code, patch);
                      else await updateMaterial(item.code, patch);
                      return `Đã cập nhật ${item.code}.`;
                    })
                  : undefined}
                />
              ) : null}

              {/* 2. Sub-tab Lịch sử xuất nhập: Toàn bộ sổ cái giao dịch xuất nhập kho */}
              {stockSubTab === 'transactions' ? (
                <TransactionHub
                  workspace={workspace}
                  ledger={ledger ?? []}
                  busy={busy}
                  onSubmitMovement={submitMovement}
                  onReload={async () => { await reload(); }}
                  onNotice={(msg) => setNotice(msg)}
                  hideSubTabs={true}
                  onOpenProfile={(code) => setProfileCode(code)}
                />
              ) : null}

              {/* 3. Sub-tab Lịch sử kiểm đếm: Quản lý các đợt kiểm kê và đối soát */}
              {stockSubTab === 'stocktakes' ? (
                <StocktakeHub
                  workspace={workspace}
                  busy={busy}
                  onSubmitMovement={submitMovement}
                  onNotice={(msg) => setNotice(msg)}
                />
              ) : null}
            </>
          ) : null}

          {tab === 'assets' ? (
            <div className={styles.assetLayout}>
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
                  })
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
    </InventoryPermissionsContext.Provider>
  );
}
