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

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <h2>Kho &amp; vật tư</h2>
        <span className={styles.badge}>{rows.length}/{items.length}</span>
      </header>

      <div className={styles.itemFilters}>
        <div className={styles.kindTabs}>
          {(['all', 'STOCK', 'ASSET'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={kind === value ? styles.kindOn : undefined}
              onClick={() => setKind(value)}
            >
              {value === 'all' ? 'Tất cả' : label(value)}
              <span>
                {value === 'all'
                  ? items.length
                  : items.filter((item) => item.kind === value).length}
              </span>
            </button>
          ))}
        </div>

        {roots.length > 0 ? (
          <label>
            Vị trí
            <select value={root} onChange={(event) => setRoot(event.target.value)}>
              <option value="all">Mọi vị trí</option>
              {roots.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <input
          type="search"
          placeholder="Tìm theo mã, tên hoặc vị trí lắp đặt…"
          value={query}
          aria-label="Tìm vật tư"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Mã / Tên</th>
            <th>Loại</th>
            <th>Tình trạng</th>
            <th>Vị trí</th>
            <th className={styles.right}>Tổng sở hữu</th>
            <th className={styles.right}>Đang sử dụng</th>
            <th className={styles.right}>Đang giữ</th>
            <th className={styles.right}>Khả dụng</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const material = materialByCode?.get(item.code);
            const expanded = openCode === item.code;
            return (
              <Fragment key={item.code}>
                <tr
                  className={styles.clickable}
                  onClick={busy ? undefined : () => open(item.code)}
                >
                  <td className={styles.code}>
                    {/* Mã là đường vào hồ sơ. Trước đây chỉ cây thiết bị mới mở
                        được hồ sơ, nên mã còn trong kho không có chỗ nào xem
                        sê-ri, thông số hay tài liệu của nó. */}
                    {onOpenProfile ? (
                      <button
                        type="button"
                        className={styles.codeLink}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenProfile(item.code);
                        }}
                      >
                        {item.code}
                      </button>
                    ) : (
                      item.code
                    )}
                    <span className={styles.sub}>{item.name}</span>
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    {/* Loại là phân loại NGHIỆP VỤ do tenant tự khai, khác hẳn
                        `kind` (trong kho / đã lắp) — cái đó suy ra từ cấu trúc
                        cây và chỉ đổi được bằng lệnh nhập xuất, nên nó nằm ở
                        hàng chip lọc phía trên chứ không phải ô chọn ở đây. */}
                    <select
                      value={item.type ?? ''}
                      disabled={busy || !onPatch || types.length === 0}
                      aria-label={`Loại của ${item.code}`}
                      title={types.length === 0 ? 'Khai danh mục Loại trong Cài đặt trước.' : undefined}
                      onChange={(event) => onPatch?.(item, { type: event.target.value })}
                    >
                      <option value="">—</option>
                      {withCurrent(types, item.type).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </td>
                  {/* Mã theo dõi theo cá thể thì tình trạng và vị trí nằm trên
                      TỪNG sê-ri, không phải trên mã — nói rõ thay vì hiện một
                      giá trị chung sai cho mọi cá thể. */}
                  {/* Mã theo dõi theo cá thể thì hai ô này KHÔNG sửa ở mức mã:
                      tình trạng nằm trên từng sê-ri, ghi đè ở đây là gán cùng
                      một giá trị cho mọi cá thể. Bấm vào dòng để sửa theo sê-ri. */}
                  <td onClick={(event) => event.stopPropagation()}>
                    {material?.isSerialized ? (
                      <span className={styles.muted}>theo sê-ri</span>
                    ) : (
                      <select
                        value={item.status ?? ''}
                        disabled={busy || !onPatch}
                        aria-label={`Tình trạng của ${item.code}`}
                        onChange={(event) =>
                          onPatch?.(item, { status: event.target.value as AssetStatus })
                        }
                      >
                        <option value="">—</option>
                        {withCurrent(statuses, item.status).map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    {material?.isSerialized ? (
                      <span className={styles.muted}>theo sê-ri</span>
                    ) : (
                      <select
                        value={item.usageState ?? ''}
                        disabled={busy || !onPatch}
                        aria-label={`Vị trí sử dụng của ${item.code}`}
                        onChange={(event) => onPatch?.(item, { usageState: event.target.value })}
                      >
                        <option value="">—</option>
                        {withCurrent(whereOptions, item.usageState).map((state) => (
                          <option key={state} value={state}>
                            {state}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  {/* Bốn con số trả lời bốn câu khác nhau. Trước đây chỉ có
                      "tồn thực" và "khả dụng", nên một mã lắp 5 cái ngoài hiện
                      trường và còn 5 cái trong kho hiện ra hai số 5 mà không
                      nói cái nào là cái nào. */}
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
                </tr>
                {expanded ? (
                  <tr>
                    <td colSpan={8} className={styles.itemDetail}>
                      {/* Tồn theo TỪNG kho — thứ mà một dòng gộp không nói được:
                          3000 mét cáp nằm ở hai kho khác nhau thì lệnh xuất phải
                          biết lấy ở đâu. Đây là nội dung của bảng "Tồn kho" cũ,
                          đưa về đúng chỗ của nó thay vì đứng thành bảng riêng. */}
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
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className={styles.muted}>
                Không có mục nào khớp bộ lọc.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
