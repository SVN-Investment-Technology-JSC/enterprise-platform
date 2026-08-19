'use client';

import type {
  Asset,
  AssetTaskItem,
  Material,
  UpdateAssetRequest,
} from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadInventoryWorkspace,
  loadLedger,
  loadReservations,
  loadSerials,
  loadTenantHomePath,
  updateAsset,
  type InventoryLedgerRow,
  type InventoryReservationRow,
  type InventorySerialRow,
  type InventoryWorkspace,
} from './inventory-api';
import styles from './inventory.module.scss';

type Tab =
  | 'overview'
  | 'assets'
  | 'materials'
  | 'warehouses'
  | 'stock'
  | 'serials'
  | 'reservations'
  | 'ledger';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'assets', label: 'Tài sản & BOM' },
  { id: 'materials', label: 'Vật tư' },
  { id: 'warehouses', label: 'Kho & vị trí' },
  { id: 'stock', label: 'Tồn kho' },
  { id: 'serials', label: 'Serial' },
  { id: 'reservations', label: 'Giữ chỗ' },
  { id: 'ledger', label: 'Sổ cái' },
];

const ASSET_TYPE_LABEL: Record<Asset['type'], string> = {
  PLANT: 'Nhà máy',
  SYSTEM: 'Hệ thống',
  EQUIPMENT: 'Thiết bị',
  COMPONENT: 'Chi tiết',
};

function initialTab(): Tab {
  if (typeof window === 'undefined') return 'overview';
  const hash = window.location.hash.slice(1) as Tab;
  return TABS.some((tab) => tab.id === hash) ? hash : 'overview';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value);
}

function formatDateTime(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'numeric',
    year: '2-digit',
  }).format(new Date(value));
}

export function InventoryScreen() {
  const [tab, setTab] = useState<Tab>('overview');
  const [workspace, setWorkspace] = useState<InventoryWorkspace>();
  const [ledger, setLedger] = useState<InventoryLedgerRow[]>();
  const [reservations, setReservations] = useState<InventoryReservationRow[]>();
  const [serials, setSerials] = useState<InventorySerialRow[]>();
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string>();
  const [homePath, setHomePath] = useState('/');

  const reload = useCallback(async () => {
    try {
      setError(undefined);
      const [data, ledgerRows, reservationRows, serialRows] = await Promise.all([
        loadInventoryWorkspace(),
        loadLedger(),
        loadReservations(),
        loadSerials(),
      ]);
      setWorkspace(data);
      setLedger(ledgerRows);
      setReservations(reservationRows);
      setSerials(serialRows);
      setSelectedAssetId((current) => current ?? data.assets[0]?.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu kho.');
    }
  }, []);

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

  const lowStock = useMemo(
    () =>
      (workspace?.stock ?? []).filter((row) => {
        const material = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
        return material ? row.available < material.minStock : false;
      }),
    [workspace, materialByCode],
  );

  const selectedAsset = workspace?.assets.find((asset) => asset.id === selectedAssetId);

  const visibleAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return workspace?.assets ?? [];
    return (workspace?.assets ?? []).filter(
      (asset) =>
        asset.code.toLowerCase().includes(needle) || asset.name.toLowerCase().includes(needle),
    );
  }, [workspace, query]);

  return (
    <div className={styles.page}>
      <header className={styles.banner}>
        <div>
          <span className={styles.eyebrow}>Operations · Inventory</span>
          <h1>Kho &amp; Vật tư</h1>
          <p>Theo dõi tồn thực tế, khả dụng và luân chuyển vật tư theo từng kho.</p>
        </div>
        <div className={styles.bannerActions}>
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

      {!workspace ? (
        <p className={styles.empty}>Đang tải dữ liệu kho…</p>
      ) : (
        <>
          {tab === 'overview' ? (
            <Overview
              workspace={workspace}
              lowStockCount={lowStock.length}
              ledgerCount={ledger?.length ?? 0}
              reservationCount={reservations?.length ?? 0}
              serialCount={serials?.length ?? 0}
              materialByCode={materialByCode}
            />
          ) : null}

          {tab === 'assets' ? (
            <div className={styles.assetLayout}>
              <aside className={styles.treePanel}>
                <span className={styles.eyebrowDark}>Asset hierarchy</span>
                <h3 style={{ margin: '.4rem 0 0' }}>Cây tài sản</h3>
                <input
                  className={styles.search}
                  placeholder="Tìm theo mã hoặc tên thiết bị…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <div className={styles.tree}>
                  {visibleAssets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      className={`${styles.node} ${asset.id === selectedAssetId ? styles.nodeActive : ''}`}
                      onClick={() => setSelectedAssetId(asset.id)}
                    >
                      <strong>{asset.name}</strong>
                      <small>
                        {asset.code} · {ASSET_TYPE_LABEL[asset.type]}
                      </small>
                    </button>
                  ))}
                  {visibleAssets.length === 0 ? (
                    <p className={styles.empty}>Không có tài sản khớp.</p>
                  ) : null}
                </div>
              </aside>
              <section>
                {selectedAsset ? (
                  <AssetDetail asset={selectedAsset} onSaved={() => void reload()} />
                ) : (
                  <p className={styles.empty}>Chọn một tài sản.</p>
                )}
              </section>
            </div>
          ) : null}

          {tab === 'materials' ? (
            <section className={styles.card}>
              <h2>Material Master — Danh mục vật tư</h2>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Mã SKU</th>
                      <th>Tên vật tư</th>
                      <th>Nhóm</th>
                      <th>ĐVT</th>
                      <th>Theo dõi</th>
                      <th>Min / Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.materials.map((material) => (
                      <tr key={material.id}>
                        <td className={styles.code}>{material.code}</td>
                        <td>{material.name}</td>
                        <td>
                          <span className={styles.pill}>{material.category}</span>
                        </td>
                        <td>{material.unit}</td>
                        <td>{material.isSerialized ? 'SERIAL' : 'NONE'}</td>
                        <td className={styles.numeric}>
                          {formatNumber(material.minStock)} / {formatNumber(material.maxStock)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {workspace.materials.length === 0 ? <p className={styles.empty}>Chưa có vật tư.</p> : null}
              </div>
            </section>
          ) : null}

          {tab === 'warehouses' ? (
            <div className={styles.grid}>
              {workspace.warehouses.map((warehouse) => {
                const rows = workspace.stock.filter((row) => row.warehouseId === warehouse.id);
                const units = rows.reduce((sum, row) => sum + row.quantity, 0);
                return (
                  <article key={warehouse.id} className={styles.gridCard}>
                    <span>{warehouse.type}</span>
                    <h3>{warehouse.code}</h3>
                    <p>{warehouse.name}</p>
                    <small>
                      {rows.length} SKU · {formatNumber(units)} đơn vị
                    </small>
                  </article>
                );
              })}
              {workspace.warehouses.length === 0 ? <p className={styles.empty}>Chưa có kho.</p> : null}
            </div>
          ) : null}

          {tab === 'stock' ? (
            <StockTable rows={workspace.stock} materialByCode={materialByCode} />
          ) : null}

          {tab === 'serials' ? (
            <section className={styles.card}>
              <h2>Vòng đời Serial / Rotable</h2>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Vật tư</th>
                      <th>Serial nhà sản xuất</th>
                      <th>Mã nội bộ</th>
                      <th>Trạng thái</th>
                      <th>Vị trí hiện tại</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(serials ?? []).map((serial) => (
                      <tr key={serial.id}>
                        <td className={styles.code}>
                          {materialById.get(serial.materialId)?.code ?? '—'}
                          <span className={styles.sub}>{materialById.get(serial.materialId)?.name}</span>
                        </td>
                        <td>{serial.serialNumber}</td>
                        <td>{serial.internalCode ?? '—'}</td>
                        <td>
                          <span className={styles.pill}>{serial.currentStatus}</span>
                        </td>
                        <td>
                          {serial.currentWarehouseId
                            ? warehouseById.get(serial.currentWarehouseId) ?? serial.locationType
                            : serial.locationType}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(serials ?? []).length === 0 ? (
                  <p className={styles.empty}>Chưa có vật tư theo dõi serial.</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {tab === 'reservations' ? (
            <section className={styles.card}>
              <h2>Phiếu giữ chỗ vật tư</h2>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
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
                    {(reservations ?? []).map((reservation) => (
                      <tr key={reservation.id}>
                        <td className={styles.code}>{reservation.reservationCode}</td>
                        <td>
                          {reservation.referenceType}
                          <span className={styles.sub}>{reservation.referenceId ?? '—'}</span>
                        </td>
                        <td>
                          <span className={styles.pill}>{reservation.status}</span>
                        </td>
                        <td className={styles.numeric}>{reservation.items?.length ?? 0}</td>
                        <td className={styles.numeric}>
                          {formatNumber(
                            (reservation.items ?? []).reduce(
                              (sum, item) => sum + item.quantityReserved,
                              0,
                            ),
                          )}
                        </td>
                        <td>{reservation.expiresAt ? formatDateTime(reservation.expiresAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(reservations ?? []).length === 0 ? (
                  <p className={styles.empty}>Chưa có phiếu giữ chỗ.</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {tab === 'ledger' ? (
            <section className={styles.card}>
              <h2>Sổ cái giao dịch kho</h2>
              <p>{ledger?.length ?? 0} giao dịch gần nhất, sắp xếp theo thời gian phát sinh.</p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Chứng từ</th>
                      <th>Thời gian</th>
                      <th>Loại</th>
                      <th>Vật tư</th>
                      <th>Kho</th>
                      <th>Biến động</th>
                      <th>Tham chiếu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ledger ?? []).map((entry) => (
                      <tr key={entry.id}>
                        <td className={styles.code}>{entry.transactionCode}</td>
                        <td>{formatDateTime(entry.createdAt)}</td>
                        <td>{entry.type}</td>
                        <td className={styles.code}>
                          {materialById.get(entry.materialId)?.code ?? '—'}
                          <span className={styles.sub}>{materialById.get(entry.materialId)?.name}</span>
                        </td>
                        <td>{warehouseById.get(entry.warehouseId) ?? '—'}</td>
                        <td
                          className={`${styles.numeric} ${entry.quantity < 0 ? styles.negative : styles.positive}`}
                        >
                          {entry.quantity > 0 ? '+' : ''}
                          {formatNumber(entry.quantity)}
                        </td>
                        <td>
                          {entry.referenceType ?? '—'}
                          {entry.note ? <span className={styles.sub}>{entry.note}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(ledger ?? []).length === 0 ? <p className={styles.empty}>Chưa có giao dịch.</p> : null}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Overview({
  workspace,
  lowStockCount,
  ledgerCount,
  reservationCount,
  serialCount,
  materialByCode,
}: {
  workspace: InventoryWorkspace;
  lowStockCount: number;
  ledgerCount: number;
  reservationCount: number;
  serialCount: number;
  materialByCode: Map<string, Material>;
}) {
  const totalAvailable = workspace.stock.reduce((sum, row) => sum + row.available, 0);
  const totalOnHand = workspace.stock.reduce((sum, row) => sum + row.quantity, 0);
  const plants = workspace.assets.filter((asset) => asset.type === 'PLANT').length;
  const critical = workspace.assets.filter((asset) => asset.criticality === 'CRITICAL').length;

  return (
    <>
      <div className={styles.kpiRow}>
        <article className={styles.kpi}>
          <span>Tài sản kỹ thuật</span>
          <strong>{formatNumber(workspace.assets.length)}</strong>
        </article>
        <article className={styles.kpi}>
          <span>Kho hoạt động</span>
          <strong>{formatNumber(workspace.warehouses.length)}</strong>
        </article>
        <article className={styles.kpi}>
          <span>Mã vật tư</span>
          <strong>{formatNumber(workspace.materials.length)}</strong>
        </article>
        <article className={styles.kpi}>
          <span>Tồn khả dụng</span>
          <strong>{formatNumber(totalAvailable)}</strong>
        </article>
        <article className={`${styles.kpi} ${lowStockCount > 0 ? styles.kpiWarn : ''}`}>
          <span>Cảnh báo tồn thấp</span>
          <strong>{formatNumber(lowStockCount)}</strong>
        </article>
      </div>

      <div className={styles.panelRow}>
        <article className={styles.panel}>
          <span>Asset management</span>
          <h3>{formatNumber(plants)} nhà máy</h3>
          <p>{formatNumber(critical)} tài sản mức Critical</p>
        </article>
        <article className={styles.panel}>
          <span>Inventory operations</span>
          <h3>{formatNumber(totalOnHand)} tồn vật lý</h3>
          <p>{formatNumber(ledgerCount)} giao dịch gần nhất</p>
        </article>
        <article className={styles.panel}>
          <span>Reservation &amp; serial</span>
          <h3>{formatNumber(reservationCount)} phiếu giữ chỗ</h3>
          <p>{formatNumber(serialCount)} serial đang theo dõi</p>
        </article>
      </div>

      <StockTable rows={workspace.stock} materialByCode={materialByCode} />
    </>
  );
}

function StockTable({
  rows,
  materialByCode,
}: {
  rows: InventoryWorkspace['stock'];
  materialByCode: Map<string, Material>;
}) {
  return (
    <section className={styles.card}>
      <h2>Tồn kho theo SKU</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Vật tư</th>
              <th>Kho</th>
              <th>On-hand</th>
              <th>Đã giữ</th>
              <th>Khả dụng</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const material = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
              const low = material ? row.available < material.minStock : false;
              return (
                <tr key={row.id}>
                  <td className={styles.code}>
                    {row.materialCode ?? '—'}
                    {material ? <span className={styles.sub}>{material.name}</span> : null}
                  </td>
                  <td>{row.warehouseCode ?? '—'}</td>
                  <td className={styles.numeric}>
                    {formatNumber(row.quantity)} {material?.unit ?? ''}
                  </td>
                  <td className={styles.numeric}>{formatNumber(row.quantityReserved)}</td>
                  <td className={`${styles.numeric} ${low ? styles.low : ''}`}>
                    {formatNumber(row.available)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <p className={styles.empty}>Chưa có tồn kho.</p> : null}
      </div>
    </section>
  );
}

function AssetDetail({ asset, onSaved }: { asset: Asset; onSaved: () => void }) {
  const [editing, setEditing] = useState<'specs' | 'tasks'>();
  const [specRows, setSpecRows] = useState<{ key: string; value: string }[]>([]);
  const [taskRows, setTaskRows] = useState<AssetTaskItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const specs = Object.entries(asset.specs ?? {});
  const taskTemplate = asset.taskTemplate ?? [];

  const openSpecs = () => {
    setSpecRows(specs.map(([key, value]) => ({ key, value: String(value) })));
    setError(undefined);
    setEditing('specs');
  };

  const openTasks = () => {
    setTaskRows(taskTemplate.map((task) => ({ ...task })));
    setError(undefined);
    setEditing('tasks');
  };

  const save = async (patch: UpdateAssetRequest) => {
    setSaving(true);
    setError(undefined);
    try {
      await updateAsset(asset.code, patch);
      setEditing(undefined);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className={styles.detailBanner}>
        <span>{ASSET_TYPE_LABEL[asset.type]} · Asset 360°</span>
        <h2>{asset.name}</h2>
        <p>{asset.code}</p>
      </div>
      <div className={styles.factRow}>
        <div className={styles.fact}>
          <span>Tình trạng</span>
          <strong>{asset.status}</strong>
        </div>
        <div className={styles.fact}>
          <span>Độ quan trọng</span>
          <strong>{asset.criticality}</strong>
        </div>
        <div className={styles.fact}>
          <span>Mã serial</span>
          <strong>{asset.serialNumber ?? '—'}</strong>
        </div>
        <div className={styles.fact}>
          <span>Mã QR định danh</span>
          <strong>{asset.qrCode ?? '—'}</strong>
        </div>
      </div>

      {error ? (
        <p role="alert" className={styles.alert} style={{ marginTop: '.85rem' }}>
          {error}
        </p>
      ) : null}

      <div className={styles.panelRow} style={{ marginTop: '.85rem' }}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Thông số kỹ thuật</h2>
            {editing !== 'specs' ? (
              <button type="button" className={styles.linkButton} onClick={openSpecs}>
                {specs.length === 0 ? '+ Khai báo' : 'Sửa'}
              </button>
            ) : null}
          </div>

          {editing === 'specs' ? (
            <div className={styles.editList}>
              {specRows.map((row, index) => (
                <div key={index} className={styles.editRow}>
                  <input
                    placeholder="Tên thông số"
                    value={row.key}
                    onChange={(event) =>
                      setSpecRows((rows) =>
                        rows.map((item, position) =>
                          position === index ? { ...item, key: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <input
                    placeholder="Giá trị"
                    value={row.value}
                    onChange={(event) =>
                      setSpecRows((rows) =>
                        rows.map((item, position) =>
                          position === index ? { ...item, value: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className={styles.removeRow}
                    onClick={() => setSpecRows((rows) => rows.filter((_, p) => p !== index))}
                    aria-label="Xoá dòng"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.addRow}
                onClick={() => setSpecRows((rows) => [...rows, { key: '', value: '' }])}
              >
                + Thêm thông số
              </button>
              <div className={styles.editActions}>
                <button
                  type="button"
                  className={`${styles.action} ${styles.actionPrimary}`}
                  disabled={saving}
                  onClick={() =>
                    save({
                      specs: Object.fromEntries(
                        specRows
                          .filter((row) => row.key.trim())
                          .map((row) => [row.key.trim(), row.value]),
                      ),
                    })
                  }
                >
                  Lưu thông số
                </button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.actionGhost}`}
                  onClick={() => setEditing(undefined)}
                >
                  Huỷ
                </button>
              </div>
            </div>
          ) : specs.length === 0 ? (
            <p className={styles.empty}>Chưa khai báo thông số.</p>
          ) : (
            <div className={styles.specList}>
              {specs.map(([key, value]) => (
                <div key={key} className={styles.specRow}>
                  <span>{key}</span>
                  <strong>{String(value)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Đầu việc bảo trì mặc định</h2>
            {editing !== 'tasks' ? (
              <button type="button" className={styles.linkButton} onClick={openTasks}>
                {taskTemplate.length === 0 ? '+ Khai báo' : 'Sửa'}
              </button>
            ) : null}
          </div>

          {editing === 'tasks' ? (
            <div className={styles.editList}>
              <p className={styles.hint}>
                Đây là nguồn đầu việc cho vai trò E của Quy trình. Quy trình chụp lại danh sách này
                lúc công bố, nên sửa ở đây không làm đổi các bản đã công bố.
              </p>
              {taskRows.map((task, index) => (
                <div key={index} className={styles.editRow}>
                  <input
                    placeholder="Mã"
                    style={{ maxWidth: '5rem' }}
                    value={task.key}
                    onChange={(event) =>
                      setTaskRows((rows) =>
                        rows.map((item, position) =>
                          position === index ? { ...item, key: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <input
                    placeholder="Tên đầu việc"
                    value={task.name}
                    onChange={(event) =>
                      setTaskRows((rows) =>
                        rows.map((item, position) =>
                          position === index ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <input
                    placeholder="Phút"
                    type="number"
                    min={0}
                    style={{ maxWidth: '5.5rem' }}
                    value={task.durationMinutes ?? ''}
                    onChange={(event) =>
                      setTaskRows((rows) =>
                        rows.map((item, position) =>
                          position === index
                            ? {
                                ...item,
                                durationMinutes: event.target.value
                                  ? Number(event.target.value)
                                  : undefined,
                              }
                            : item,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className={styles.removeRow}
                    onClick={() => setTaskRows((rows) => rows.filter((_, p) => p !== index))}
                    aria-label="Xoá đầu việc"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.addRow}
                onClick={() =>
                  setTaskRows((rows) => [
                    ...rows,
                    { key: `T${rows.length + 1}`, name: '', durationMinutes: undefined },
                  ])
                }
              >
                + Thêm đầu việc
              </button>
              <div className={styles.editActions}>
                <button
                  type="button"
                  className={`${styles.action} ${styles.actionPrimary}`}
                  disabled={saving}
                  onClick={() =>
                    save({
                      taskTemplate: taskRows
                        .filter((task) => task.key.trim() && task.name.trim())
                        .map((task) => ({
                          key: task.key.trim().toUpperCase(),
                          name: task.name.trim(),
                          durationMinutes: task.durationMinutes,
                        })),
                    })
                  }
                >
                  Lưu đầu việc
                </button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.actionGhost}`}
                  onClick={() => setEditing(undefined)}
                >
                  Huỷ
                </button>
              </div>
            </div>
          ) : taskTemplate.length === 0 ? (
            <p className={styles.empty}>Node này chưa gắn đầu việc.</p>
          ) : (
            <ol className={styles.taskList}>
              {taskTemplate.map((task) => (
                <li key={task.key}>
                  <span className={styles.taskKey}>{task.key}</span>
                  <span>{task.name}</span>
                  {task.durationMinutes ? <em>{task.durationMinutes} phút</em> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
