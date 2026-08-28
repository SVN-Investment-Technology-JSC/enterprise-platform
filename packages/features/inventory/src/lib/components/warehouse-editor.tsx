'use client';

import type { Warehouse } from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useState } from 'react';
import { createWarehouse, loadAllWarehouses, updateWarehouse } from '../inventory-api';
import styles from '../inventory.module.scss';

/**
 * Danh sách kho, khai ngay trong Cài đặt.
 *
 * Trước đây kho chỉ có đường ĐỌC — muốn thêm một kho phải sửa dữ liệu seed. Mà
 * kho là thứ đầu tiên một đơn vị mới cần khai, trước cả vật tư.
 *
 * Không có nút xoá: mã kho nằm trong mọi bút toán của sổ cái, xoá đi là làm mồ
 * côi toàn bộ lịch sử nhập xuất của kho đó. Ngừng dùng thì kho biến khỏi các ô
 * chọn nhưng lịch sử vẫn đọc được — và kho còn hàng thì server từ chối ngừng.
 */
export function WarehouseEditor({ disabled }: { disabled?: boolean }) {
  const [rows, setRows] = useState<Warehouse[]>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');

  const reload = useCallback(async () => {
    try {
      setRows(await loadAllWarehouses());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đọc được danh sách kho.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const busy = disabled || saving;

  const run = async (action: () => Promise<unknown>) => {
    setSaving(true);
    setError(undefined);
    try {
      await action();
      await reload();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    const ok = await run(() =>
      createWarehouse({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        location: location.trim() || undefined,
      }),
    );
    if (ok) {
      setCode('');
      setName('');
      setLocation('');
    }
  };

  return (
    <div className={styles.warehouseEditor}>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Mã</th>
            <th>Tên kho</th>
            <th>Vị trí</th>
            <th>Đang dùng</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((warehouse) => (
            <tr key={warehouse.code} className={warehouse.isActive ? undefined : styles.muted}>
              <td className={styles.code}>{warehouse.code}</td>
              <td>
                <input
                  value={warehouse.name}
                  disabled={busy}
                  aria-label={`Tên kho ${warehouse.code}`}
                  onChange={(event) =>
                    setRows((current) =>
                      (current ?? []).map((item) =>
                        item.code === warehouse.code ? { ...item, name: event.target.value } : item,
                      ),
                    )
                  }
                  onBlur={(event) =>
                    void run(() => updateWarehouse(warehouse.code, { name: event.target.value }))
                  }
                />
              </td>
              <td>
                <input
                  value={warehouse.location ?? ''}
                  disabled={busy}
                  placeholder="Địa chỉ, khu vực…"
                  aria-label={`Vị trí kho ${warehouse.code}`}
                  onChange={(event) =>
                    setRows((current) =>
                      (current ?? []).map((item) =>
                        item.code === warehouse.code
                          ? { ...item, location: event.target.value }
                          : item,
                      ),
                    )
                  }
                  onBlur={(event) =>
                    void run(() =>
                      updateWarehouse(warehouse.code, { location: event.target.value }),
                    )
                  }
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={warehouse.isActive}
                  disabled={busy}
                  aria-label={`Đang dùng kho ${warehouse.code}`}
                  title="Kho còn hàng thì không ngừng dùng được — chuyển hàng đi trước."
                  onChange={(event) =>
                    void run(() =>
                      updateWarehouse(warehouse.code, { isActive: event.target.checked }),
                    )
                  }
                />
              </td>
            </tr>
          ))}
          {rows && rows.length === 0 ? (
            <tr>
              <td colSpan={4} className={styles.muted}>
                Chưa khai kho nào.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className={styles.warehouseAdd}>
        <input
          value={code}
          disabled={busy}
          placeholder="Mã kho"
          aria-label="Mã kho mới"
          onChange={(event) => setCode(event.target.value)}
        />
        <input
          value={name}
          disabled={busy}
          placeholder="Tên kho"
          aria-label="Tên kho mới"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          value={location}
          disabled={busy}
          placeholder="Vị trí (tuỳ chọn)"
          aria-label="Vị trí kho mới"
          onChange={(event) => setLocation(event.target.value)}
        />
        <button type="button" disabled={busy || !code.trim() || !name.trim()} onClick={() => void add()}>
          Thêm kho
        </button>
      </div>
      {/* Mã là khoá nghiệp vụ: mọi bút toán trỏ vào kho qua nó, nên nói trước
          rằng đổi mã là không được, thay vì để người dùng phát hiện lúc bấm. */}
      <p className={styles.hint}>Mã kho không sửa được sau khi tạo vì sổ cái tham chiếu theo mã.</p>
    </div>
  );
}
