'use client';
import { useInventoryPermissions } from '../inventory-permissions';

import type { Material, SerialTracking } from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useState } from 'react';
import { loadSerials, registerSerials, updateSerial } from '../inventory-api';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { SERIAL_STATUS_LABEL } from '../inventory-labels';
import styles from '../inventory.module.scss';

/**
 * Cá thể theo sê-ri của một mã vật tư.
 *
 * Khi một mã được theo dõi theo sê-ri thì **tình trạng và "vị trí" nằm trên
 * từng cá thể**, không nằm trên mã. Năm cái rơ-le cùng mã có thể một cái đang
 * vận hành, một cái gửi đi sửa, ba cái nằm kho — ghi trạng thái ở mức mã thì cả
 * năm cái mang chung một câu trả lời sai.
 *
 * Mã KHÔNG theo sê-ri thì ngược lại: khối này không hiện, và hai ô đó nằm ở hồ
 * sơ của chính mã.
 */
export function SerialPanel({
  material,
  statuses,
  usageStates,
  busy,
}: {
  material: Material;
  /** Tình trạng được phép chọn, theo cấu hình admin. */
  statuses: readonly string[];
  /** Danh mục "vị trí", theo cấu hình admin. */
  usageStates: readonly string[];
  busy?: boolean;
}) {
  const { canManage } = useInventoryPermissions();
  const [rows, setRows] = useState<SerialTracking[]>();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      setRows(await loadSerials(material.code));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đọc được danh sách sê-ri.');
    }
  }, [material.code]);

  useEffect(() => {
    setRows(undefined);
    void reload();
  }, [reload]);

  // Mã không theo sê-ri thì không có cá thể nào để nói tới.
  if (!material.isSerialized) return null;

  const disabled = !canManage || busy || saving;

  const add = async () => {
    // Nhận cả xuống dòng, dấu phẩy và chấm phẩy: người dùng thường dán thẳng
    // một cột từ Excel hoặc gõ liền một dãy.
    const serialNumbers = draft
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (serialNumbers.length === 0) return;

    setSaving(true);
    try {
      const result = await registerSerials({ materialCode: material.code, serialNumbers });
      setDraft('');
      setError(
        result.added < serialNumbers.length
          ? `Đã thêm ${result.added}/${serialNumbers.length} — số còn lại đã có sẵn.`
          : undefined,
      );
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không khai được sê-ri.');
    } finally {
      setSaving(false);
    }
  };

  const patch = async (serialNumber: string, change: Parameters<typeof updateSerial>[2]) => {
    setSaving(true);
    try {
      await updateSerial(material.code, serialNumber, change);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.serialPanel}>
      <header>
        <strong>Cá thể theo sê-ri</strong>
        <span>{rows ? `${rows.length} cá thể` : 'Đang tải…'}</span>
      </header>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <table className={styles.serialTable}>
          <thead>
            <tr>
              <th>Số sê-ri</th>
              <th>Tình trạng</th>
              <th>Vị trí</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className={styles.code}>{row.serialNumber}</td>
                <td>
                  <SearchableSelect
                    value={row.currentStatus}
                    disabled={disabled}
                    options={withCurrent(statuses, row.currentStatus).map((status) => ({
                      value: status,
                      label: SERIAL_STATUS_LABEL[status] ?? status,
                    }))}
                    onChange={(value) => value && void patch(row.serialNumber, { currentStatus: value })}
                  />
                </td>
                <td>
                  {usageStates.length === 0 ? (
                    <span className={styles.muted}>Chưa khai danh mục trong Cài đặt</span>
                  ) : (
                    <SearchableSelect
                      value={row.locationType}
                      disabled={disabled}
                      clearable
                      placeholder="Chưa xác định"
                      options={withCurrent(usageStates, row.locationType).map((state) => ({
                        value: state,
                        label: state,
                      }))}
                      onChange={(value) => void patch(row.serialNumber, { locationType: value })}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : rows ? (
        <p className={styles.empty}>Chưa khai sê-ri nào cho mã này.</p>
      ) : null}

      <div className={styles.serialAdd}>
        <textarea
          rows={2}
          value={draft}
          disabled={disabled}
          aria-label="Số sê-ri mới"
          placeholder="Mỗi sê-ri một dòng, hoặc ngăn bằng dấu phẩy"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="button" disabled={disabled || !draft.trim()} onClick={() => void add()}>
          Khai sê-ri
        </button>
      </div>
    </section>
  );
}

/** Danh mục kèm giá trị đang dùng, để một lần sửa không xoá mất dữ liệu cũ. */
function withCurrent(options: readonly string[], current: string): string[] {
  if (!current || options.includes(current)) return [...options];
  return [...options, current];
}
