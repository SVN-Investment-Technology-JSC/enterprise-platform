'use client';

import type {
  Asset,
  AssetTaskItem,
  InventoryCatalogSettings,
  UpdateAssetRequest,
} from '@enterprise-platform/contracts-inventory';
import { useState } from 'react';
import { updateAsset } from '../inventory-api';
import {
  formatNumber,
  ASSET_CRITICALITY_LABEL,
  ASSET_STATUS_LABEL,
  ASSET_TYPE_LABEL,
} from '../inventory-labels';
import styles from '../inventory.module.scss';

export function AssetDetail({
  asset,
  busy,
  catalog,
  onSaved,
  onRetire,
}: {
  asset: Asset;
  busy?: boolean;
  /** Cấu hình module: trường nào được hiện. Bỏ trống thì hiện hết. */
  catalog?: InventoryCatalogSettings;
  onSaved: () => void;
  onRetire?: (asset: Asset) => void;
}) {
  // Chưa nạp được cấu hình thì hiện hết, thay vì ẩn nhầm dữ liệu đang có.
  const showPrice = catalog?.priceFieldsEnabled ?? true;
  const showWarranty = catalog?.warrantyFieldsEnabled ?? true;
  const [editing, setEditing] = useState<'specs' | 'tasks'>();
  const [specRows, setSpecRows] = useState<{ key: string; value: string }[]>([]);
  const [taskRows, setTaskRows] = useState<AssetTaskItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  /** Hết hạn bảo hành thì tô cảnh báo — con số này chỉ có ích khi nhìn ra ngay. */
  const warrantyExpired =
    asset.warrantyUntil !== undefined && asset.warrantyUntil < new Date().toISOString().slice(0, 10);

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
      <div className={styles.detailHead}>
        <div>
          <h2>{asset.name}</h2>
          <p>
            {asset.code} · {ASSET_TYPE_LABEL[asset.type]}
          </p>
        </div>
        <div className={styles.factRow}>
          <div className={styles.fact}>
            <span>Tình trạng</span>
            <strong>{ASSET_STATUS_LABEL[asset.status]}</strong>
          </div>
          <div className={styles.fact}>
            <span>Độ quan trọng</span>
            <strong>{ASSET_CRITICALITY_LABEL[asset.criticality]}</strong>
          </div>
          <div className={styles.fact}>
            <span>Số serial</span>
            <strong>{asset.serialNumber ?? '—'}</strong>
          </div>
          <div className={styles.fact}>
            <span>Mã QR</span>
            <strong>{asset.qrCode ?? '—'}</strong>
          </div>
          <div className={styles.fact}>
            <span>Đơn vị</span>
            <strong>{asset.unit ?? '—'}</strong>
          </div>
          {showPrice ? (
            <div className={styles.fact}>
              <span>Giá mua</span>
              {/* Chưa khai báo hiện gạch ngang, không hiện 0 — hai chuyện khác nhau. */}
              <strong>
                {asset.purchasePrice === undefined
                  ? '—'
                  : `${formatNumber(asset.purchasePrice)}${asset.currency ? ` ${asset.currency}` : ''}`}
              </strong>
            </div>
          ) : null}
          {showWarranty ? (
            <div className={styles.fact}>
              <span>Bảo hành đến</span>
              <strong className={warrantyExpired ? styles.factWarn : undefined}>
                {asset.warrantyUntil ?? '—'}
              </strong>
            </div>
          ) : null}
          {onRetire ? (
            <button
              type="button"
              className={styles.dangerButton}
              disabled={busy}
              onClick={() => onRetire(asset)}
            >
              Thanh lý
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      <div className={styles.detailPanels}>
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
