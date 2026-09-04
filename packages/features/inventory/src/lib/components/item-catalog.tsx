'use client';

import type {
  AssetStatus,
  InstalledMaterial,
  InventoryItem,
  Material,
  MaterialInventory,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { formatNumber } from '../inventory-labels';
import { loadMaterialHistory, type InventoryLedgerRow } from '../inventory-api';
import { MaterialHistory } from './material-history';
import { SerialPanel } from './serial-panel';
import { Search } from 'lucide-react';
import styles from '../inventory.module.scss';

/**
 * Nhãn phân loại nói theo TRẠNG THÁI, không theo "loại vật tư".
 *
 * Thiết bị và phụ tùng đều là vật tư — cùng một bảng, cùng một khái niệm. Khác
 * nhau ở chỗ nó đang nằm trong kho hay đã lắp vào một vị trí. Gọi tên theo trạng
 * thái thì người đọc không phải học thêm hai từ mới cho cùng một thứ.
 */
const KIND_LABEL: Readonly<Record<InventoryItem['kind'], string>> = {
  STOCK: 'Trong kho',
  ASSET: 'Lắp đặt',
};

/**
 * Danh mục HỢP NHẤT — vật tư kho và thiết bị trong một bảng.
 *
 * Từ lượt gộp dữ liệu, cả hai đã là cùng một bảng, chỉ khác `kind`. Một cái máy
 * biến áp cũng là một mã vật tư: nó có đơn vị tính, có giá, có thể tồn trong kho
 * trước khi lắp. Tách làm hai màn hình khiến câu hỏi thường gặp nhất — "cái này
 * là gì, còn bao nhiêu, đang lắp ở đâu" — phải tra hai chỗ.
 *
 * Cột "Đang lắp tại" là thứ danh sách vật tư cũ không trả lời được: nó cho biết
 * một thiết bị đang nằm trong kho hay đã ra hiện trường, và ở trạm nào.
 */
/** Danh mục kèm giá trị đang dùng, để một lần sửa không xoá mất dữ liệu cũ. */
function withCurrent(options: readonly string[], current?: string): string[] {
  if (!current || options.includes(current)) return [...options];
  return [...options, current];
}

export function ItemCatalog({
  items,
  materialByCode,
  statuses = [],
  usageStates = [],
  types = [],
  installed = [],
  warehouses = [],
  stock = [],
  busy,
  initialQuery,
  onPatch,
  onRetire,
  onOpenProfile,
  onAddMaterial,
}: {
  items: readonly InventoryItem[];
  /** Hồ sơ mã kho, để mở khối sê-ri khi mã theo dõi theo cá thể. */
  materialByCode?: ReadonlyMap<string, Material>;
  statuses?: readonly string[];
  usageStates?: readonly string[];
  /** Danh mục "Loại vật tư", khai trong Cài đặt. */
  types?: readonly string[];
  /** Số đang lắp của từng đơn vị, để cộng ra tổng sở hữu. */
  installed?: readonly InstalledMaterial[];
  /** Danh sách kho — nguồn MẶC ĐỊNH của ô "Vị trí". */
  warehouses?: readonly Warehouse[];
  /** Tồn theo từng kho, để bung chi tiết dưới mỗi mã. */
  stock?: readonly (MaterialInventory & { warehouseCode?: string; materialCode?: string })[];
  busy?: boolean;
  /** Mã cần tìm sẵn khi nhảy sang từ cảnh báo thủng sàn tồn. */
  initialQuery?: string;
  /** Thêm vật tư mới vào danh mục kho. */
  onAddMaterial?: () => void;
  /** Ngừng dùng một mã — không có đường xoá. */
  onRetire?: (material: Material) => void;
  /** Mở hồ sơ đầy đủ của một mã — dạng hộp thoại. */
  onOpenProfile?: (code: string) => void;
  /** Lưu ngay khi đổi ô chọn trên dòng. */
  onPatch?: (
    item: InventoryItem,
    patch: { status?: AssetStatus; usageState?: string; type?: string },
  ) => void;
}) {
  const [kind, setKind] = useState<'all' | InventoryItem['kind']>('all');
  /** Mã đang mở chi tiết. Một mã một lúc: mở hết thì bảng dài vô tận. */
  const [openCode, setOpenCode] = useState<string>();
  /** Lịch sử nạp theo yêu cầu: kéo hết mọi mã là hàng chục nghìn dòng cho một
      màn chỉ mở một mã một lúc. */
  const [history, setHistory] = useState<
    Record<string, InventoryLedgerRow[] | 'loading' | 'error'>
  >({});

  const open = (code: string) => {
    setOpenCode((current) => (current === code ? undefined : code));
    if (history[code]) return;
    setHistory((current) => ({ ...current, [code]: 'loading' }));
    loadMaterialHistory(code)
      .then((rows) => setHistory((current) => ({ ...current, [code]: rows })))
      .catch(() => setHistory((current) => ({ ...current, [code]: 'error' })));
  };
  const label = (value: InventoryItem['kind']) => KIND_LABEL[value];

  /**
   * Lựa chọn cho ô "Vị trí".
   *
   * MẶC ĐỊNH là danh sách kho — chỗ mặc định của một vật tư là nằm trong một kho
   * nào đó. Các giá trị admin khai thêm ("mượn thí nghiệm", "gửi đi sửa") nối
   * vào sau, vì chúng là ngoại lệ so với mặc định đó.
   */
  const whereOptions = useMemo(() => {
    // Đã khai trong Cài đặt thì danh mục đó là nguồn duy nhất — nếu vẫn nối thêm
    // tên kho thì admin không bỏ được một kho khỏi ô chọn, tức danh mục họ khai
    // không thật sự quyết định gì.
    if (usageStates.length > 0) return [...usageStates];
    return warehouses.map((warehouse) => warehouse.name);
  }, [warehouses, usageStates]);

  /** Tồn theo kho, gom theo mã để bung dưới mỗi dòng. */
  const warehouseCodeById = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.code])),
    [warehouses],
  );

  const stockByCode = useMemo(() => {
    const map = new Map<string, typeof stock>();
    for (const row of stock) {
      if (!row.materialCode) continue;
      map.set(row.materialCode, [...(map.get(row.materialCode) ?? []), row]);
    }
    return map;
  }, [stock]);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editDraft, setEditDraft] = useState<{ type: string; status: AssetStatus | ''; usageState: string }>({
    type: '',
    status: '',
    usageState: '',
  });

  const handleStartEdit = (item: InventoryItem, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingItem(item);
    setEditDraft({
      type: item.type ?? '',
      status: item.status ?? '',
      usageState: item.usageState ?? '',
    });
  };

  const handleSaveEdit = () => {
    if (!editingItem || !onPatch) return;
    onPatch(editingItem, {
      type: editDraft.type || undefined,
      status: (editDraft.status as AssetStatus) || undefined,
      usageState: editDraft.usageState || undefined,
    });
    setEditingItem(null);
  };

  const [root, setRoot] = useState('all');
  const [query, setQuery] = useState(initialQuery ?? '');

  // Đồng bộ khi bên ngoài đổi mã cần tìm — bấm một mã khác trên dải cảnh báo
  // phải đổi bộ lọc, không phải giữ nguyên mã cũ.
  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
  }, [initialQuery]);

  /** Các nhánh gốc có mặt trong dữ liệu — để lọc theo trạm/nhà máy. */
  const roots = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.rootCode && item.rootName) map.set(item.rootCode, item.rootName);
    }
    return [...map.entries()].sort((left, right) => left[1].localeCompare(right[1], 'vi'));
  }, [items]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (kind !== 'all' && item.kind !== kind) return false;
      if (root !== 'all' && item.rootCode !== root) return false;
      if (!needle) return true;
      return (
        item.code.toLowerCase().includes(needle) ||
        item.name.toLowerCase().includes(needle) ||
        (item.installedAtName ?? '').toLowerCase().includes(needle)
      );
    });
  }, [items, kind, root, query]);

  /** Tồn thực và phần đã giữ, cộng qua mọi kho của một mã. */
  const onHand = (item: InventoryItem) =>
    (stockByCode.get(item.code) ?? []).reduce((sum, row) => sum + row.quantity, 0);
  const reserved = (item: InventoryItem) =>
    (stockByCode.get(item.code) ?? []).reduce((sum, row) => sum + row.quantityReserved, 0);

  /**
   * Số đang nằm ngoài hiện trường — đã lắp lên một vật tư khác.
   *
   * Không nằm trong kho nên không tính vào tồn, nhưng vẫn là tài sản của đơn vị
   * nên phải cộng vào tổng sở hữu. Thiếu cột này thì "lắp 5 cái" và "còn 5 cái
   * trong kho" hiện ra hai số giống nhau mà không phân biệt được.
   */
  const inUse = (item: InventoryItem) =>
    (installed ?? [])
      .filter((line) => line.materialCode === item.code)
      .reduce((sum, line) => sum + line.quantity, 0);

  const [pageSize, setPageSize] = useState<number>(15);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const totalRecords = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safeCurrentPage, pageSize]);

  return (
    <section className={styles.standardTableCard}>
      {/* VÙNG 1: HEADER CONTROLS (TÌM KIẾM -> PHÂN LOẠI TAB -> BỘ LỌC -> NÚT THÊM VẬT TƯ) */}
      <div className={styles.tableControlsBar}>
        <div className={styles.tableControlsLeft}>
          {/* 1. Ô Tìm kiếm */}
          <div className={styles.tableSearchBox}>
            <span className={styles.tableSearchIcon}>
              <Search size={14} strokeWidth={2} />
            </span>
            <input
              type="search"
              placeholder="Tìm theo mã, tên hoặc vị trí lắp đặt…"
              value={query}
              aria-label="Tìm vật tư"
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentPage(1);
              }}
            />
          </div>

          {/* 2. Phân loại Tab */}
          <div className={styles.kindSegmentedTabs}>
            {(['all', 'STOCK', 'ASSET'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`${styles.kindSegmentedBtn} ${kind === value ? styles.kindSegmentedBtnActive : ''}`}
                onClick={() => {
                  setKind(value);
                  setCurrentPage(1);
                }}
              >
                {value === 'all' ? 'Tất cả' : label(value)}
                <span className={styles.kindCount}>
                  {value === 'all'
                    ? items.length
                    : items.filter((item) => item.kind === value).length}
                </span>
              </button>
            ))}
          </div>

          {/* 3. Bộ lọc vị trí */}
          {roots.length > 0 ? (
            <select
              className={styles.tableSelectFilter}
              value={root}
              onChange={(event) => {
                setRoot(event.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="all">Mọi vị trí</option>
              {roots.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}

          {/* Nút Xoá lọc */}
          {query || root !== 'all' || kind !== 'all' ? (
            <button
              type="button"
              className={styles.tableResetBtn}
              title="Xóa bộ lọc"
              onClick={() => {
                setQuery('');
                setRoot('all');
                setKind('all');
                setCurrentPage(1);
              }}
            >
              Xoá bộ lọc
            </button>
          ) : null}
        </div>

        {/* 4. Cụm nút Thao tác bên phải: Nút Thêm vật tư */}
        {onAddMaterial ? (
          <div className={styles.tableControlsRight}>
            <button
              type="button"
              className={styles.addMaterialBtn}
              onClick={onAddMaterial}
              disabled={busy}
            >
              + Thêm vật tư
            </button>
          </div>
        ) : null}
      </div>

      {/* VÙNG 2: THÂN BẢNG DỮ LIỆU */}
      <div className={styles.tableResponsiveWrap}>
        <table className={styles.standardTable}>
          <thead>
            <tr>
              <th style={{ width: '220px' }}>Mã / Tên vật tư</th>
              <th style={{ width: '130px' }}>Loại danh mục</th>
              <th style={{ width: '130px' }}>Tình trạng</th>
              <th style={{ width: '160px' }}>Vị trí sử dụng</th>
              <th style={{ width: '100px' }} className={styles.right}>Tổng sở hữu</th>
              <th style={{ width: '100px' }} className={styles.right}>Đang sử dụng</th>
              <th style={{ width: '90px' }} className={styles.right}>Đang giữ</th>
              <th style={{ width: '90px' }} className={styles.right}>Khả dụng</th>
              {onPatch ? <th style={{ width: '100px' }} className={styles.right}>Thao tác</th> : null}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((item) => {
              const material = materialByCode?.get(item.code);
              const expanded = openCode === item.code;
              return (
                <Fragment key={item.code}>
                  <tr
                    className={styles.clickable}
                    onClick={busy ? undefined : () => open(item.code)}
                  >
                    <td className={styles.code}>
                      <strong className={styles.codeLabel}>{item.code}</strong>
                      <span className={styles.sub}>{item.name}</span>
                    </td>
                    <td>
                      {item.type ? (
                        <span className={styles.typeBadge}>{item.type}</span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td>
                      {material?.isSerialized ? (
                        <span className={styles.muted}>theo sê-ri</span>
                      ) : item.status ? (
                        <span className={`${styles.statusBadge} ${styles[`status_${item.status}`]}`}>
                          {item.status}
                        </span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td>
                      {material?.isSerialized ? (
                        <span className={styles.muted}>theo sê-ri</span>
                      ) : item.usageState ? (
                        <span className={styles.locationTag}>{item.usageState}</span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={`${styles.numeric} ${styles.right}`}>
                      <strong>{formatNumber(onHand(item) + inUse(item))}</strong> {item.unit ?? ''}
                    </td>
                    <td className={`${styles.numeric} ${styles.right}`}>
                      {inUse(item) > 0 ? formatNumber(inUse(item)) : <span className={styles.muted}>0</span>}
                    </td>
                    <td className={`${styles.numeric} ${styles.right}`}>
                      {reserved(item) > 0 ? formatNumber(reserved(item)) : <span className={styles.muted}>0</span>}
                    </td>
                    <td className={`${styles.numeric} ${styles.right}`}>
                      {formatNumber(onHand(item) - reserved(item))}
                    </td>
                    {onPatch ? (
                      <td className={styles.right} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={styles.editRowBtn}
                          disabled={busy}
                          title={`Chỉnh sửa thông tin ${item.code}`}
                          onClick={(e) => handleStartEdit(item, e)}
                        >
                          Sửa
                        </button>
                      </td>
                    ) : null}
                  </tr>
                  {expanded ? (
                    <tr>
                      <td colSpan={onPatch ? 9 : 8} className={styles.itemDetail}>
                        {(stockByCode.get(item.code) ?? []).length > 0 ? (
                          <ul className={styles.perWarehouse}>
                            {(stockByCode.get(item.code) ?? []).map((row) => (
                              <li key={row.id}>
                                <strong>{row.warehouseCode}</strong>
                                <span>
                                  {formatNumber(row.quantity)} {item.unit ?? ''}
                                </span>
                                {row.quantityReserved > 0 ? (
                                  <span className={styles.muted}>
                                    giữ {formatNumber(row.quantityReserved)}
                                  </span>
                                ) : null}
                                <span className={styles.muted}>
                                  khả dụng {formatNumber(row.available)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className={styles.muted}>Không có dòng tồn ở kho nào.</p>
                        )}

                        {material ? (
                          <SerialPanel
                            material={material}
                            statuses={statuses}
                            usageStates={usageStates}
                            busy={busy}
                          />
                        ) : null}
                        <MaterialHistory
                          state={history[item.code]}
                          unit={item.unit}
                          warehouseCodeById={warehouseCodeById}
                        />

                        {material && onRetire ? (
                          <button
                            type="button"
                            className={styles.linkButton}
                            disabled={busy}
                            onClick={() => onRetire(material)}
                          >
                            Ngừng dùng mã này
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  Không có mục nào khớp bộ lọc tìm kiếm.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* VÙNG 3: FOOTER CHÂN BẢNG (ĐỒNG BỘ CHUẨN WORKSPACE) */}
      <div className={styles.tableFooterBar}>
        <div className={styles.tableFooterLeft}>
          <span className={styles.tableTotalRecords}>
            Hiển thị <strong>{totalRecords > 0 ? (safeCurrentPage - 1) * pageSize + 1 : 0}–{Math.min(safeCurrentPage * pageSize, totalRecords)}</strong> / <strong>{totalRecords}</strong> mục
          </span>
          <label className={styles.tablePageSizeLabel}>
            <span>Hiển thị:</span>
            <select
              className={styles.tablePageSizeSelect}
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value) || 15);
                setCurrentPage(1);
              }}
            >
              <option value={15}>15 / trang</option>
              <option value={30}>30 / trang</option>
              <option value={45}>45 / trang</option>
              <option value={60}>60 / trang</option>
            </select>
          </label>
        </div>

        <div className={styles.tableFooterRight}>
          <div className={styles.tablePaginationGroup}>
            <button
              type="button"
              className={styles.tablePageBtn}
              disabled={safeCurrentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              title="Trang trước"
            >
              ← Trước
            </button>
            <span className={styles.tablePageIndicator}>
              {safeCurrentPage} / {totalPages}
            </span>
            <button
              type="button"
              className={styles.tablePageBtn}
              disabled={safeCurrentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              title="Trang sau"
            >
              Sau →
            </button>
          </div>
        </div>
      </div>

      {/* POPUP MODAL CHỈNH SỬA THÔNG TIN RECORD */}
      {editingItem ? (
        <div className={styles.modalOverlay} onClick={() => setEditingItem(null)}>
          <div className={styles.modalDialog} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <span>Cập nhật vật tư</span>
                <h2>{editingItem.name}</h2>
                <p>
                  Mã: <code>{editingItem.code}</code> · Loại quản lý: <strong>{editingItem.kind === 'ASSET' ? 'Thiết bị lắp đặt' : 'Vật tư trong kho'}</strong>
                </p>
              </div>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setEditingItem(null)}
                aria-label="Đóng"
              >
                
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveEdit();
              }}
            >
              <div className={styles.modalBody}>
                <div className={styles.formGroup}>
                  <label htmlFor="edit-item-type">Loại danh mục</label>
                  <select
                    id="edit-item-type"
                    value={editDraft.type}
                    onChange={(e) => setEditDraft((d) => ({ ...d, type: e.target.value }))}
                  >
                    <option value="">— Chưa phân loại —</option>
                    {withCurrent(types, editDraft.type).map((val) => (
                      <option key={val} value={val}>
                        {val}
                      </option>
                    ))}
                  </select>
                  <small>Phân nhóm nghiệp vụ theo cấu hình danh mục của hệ thống.</small>
                </div>

                {!materialByCode?.get(editingItem.code)?.isSerialized ? (
                  <>
                    <div className={styles.formGroup}>
                      <label htmlFor="edit-item-status">Tình trạng vận hành</label>
                      <select
                        id="edit-item-status"
                        value={editDraft.status}
                        onChange={(e) =>
                          setEditDraft((d) => ({ ...d, status: e.target.value as AssetStatus }))
                        }
                      >
                        <option value="">— Chưa xác định —</option>
                        {withCurrent(statuses, editDraft.status).map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.formGroup}>
                      <label htmlFor="edit-item-where">Vị trí sử dụng / Trạng thái kho</label>
                      <select
                        id="edit-item-where"
                        value={editDraft.usageState}
                        onChange={(e) => setEditDraft((d) => ({ ...d, usageState: e.target.value }))}
                      >
                        <option value="">— Chưa xác định —</option>
                        {withCurrent(whereOptions, editDraft.usageState).map((wh) => (
                          <option key={wh} value={wh}>
                            {wh}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <div className={styles.noticeBox}>
                    ℹVật tư này được quản lý theo số sê-ri cá thể. Tình trạng và vị trí được cập nhật trực tiếp theo từng số sê-ri trong chi tiết dòng.
                  </div>
                )}
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.modalCancelBtn}
                  onClick={() => setEditingItem(null)}
                  disabled={busy}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className={styles.modalSaveBtn}
                  disabled={busy}
                >
                  {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
