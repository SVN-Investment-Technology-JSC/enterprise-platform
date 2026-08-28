'use client';

import type {
  Asset,
  AssetStatus,
  AssetTaskItem,
  InventoryCatalogSettings,
  UpdateAssetRequest,
} from '@enterprise-platform/contracts-inventory';
import { useMemo, useState } from 'react';
import { updateItemProfile } from '../inventory-api';
import {
  formatNumber,
  ASSET_CRITICALITY_LABEL,
  ASSET_STATUS_LABEL,
} from '../inventory-labels';
import styles from '../inventory.module.scss';

/**
 * Đọc một thông số về dạng `{ value, unit }`.
 *
 * `specs` là jsonb tự do và dữ liệu cũ lưu giá trị TRẦN (chuỗi hoặc số). Phải
 * đọc được cả hai dạng, nếu không mọi thông số đã khai trước đây sẽ hiện thành
 * `[object Object]` hoặc biến mất.
 */
function readSpec(raw: unknown): { value: string; unit: string } {
  if (raw && typeof raw === 'object' && 'value' in raw) {
    const item = raw as { value?: unknown; unit?: unknown };
    return { value: String(item.value ?? ''), unit: String(item.unit ?? '') };
  }
  return { value: String(raw ?? ''), unit: '' };
}

/** Một dòng thông số để hiển thị: giá trị và đơn vị đã tách. */
function formatSpec(raw: unknown): string {
  const { value, unit } = readSpec(raw);
  return unit ? `${value} ${unit}` : value;
}

export function AssetDetail({
  asset,
  busy,
  catalog,
  units = [],
  onSaved,
  onRetire,
}: {
  asset: Asset;
  busy?: boolean;
  /** Cấu hình module: trường nào được hiện. Bỏ trống thì hiện hết. */
  catalog?: InventoryCatalogSettings;
  /** Danh mục đơn vị tính, khai trong Cài đặt. */
  units?: readonly string[];
  onSaved: () => void;
  onRetire?: (asset: Asset) => void;
}) {
  // Chưa nạp được cấu hình thì hiện hết, thay vì ẩn nhầm dữ liệu đang có.
  const showPrice = catalog?.priceFieldsEnabled ?? true;

  /**
   * Trạng thái được phép chọn, theo cấu hình admin.
   *
   * `enabledStatuses` rỗng nghĩa là "dùng hết", không phải "không trạng thái
   * nào" — xem AssetCatalogEditor. Trạng thái hiện tại của vật tư luôn được giữ
   * trong danh sách, kể cả khi admin vừa tắt nó: nếu không, mở hồ sơ ra là ô
   * chọn nhảy sang giá trị khác và một lần lưu vô tình đổi luôn tình trạng.
   */
  const statusOptions = useMemo(() => {
    const enabled = catalog?.enabledStatuses ?? [];
    const base = (enabled.length > 0 ? enabled : Object.keys(ASSET_STATUS_LABEL)) as AssetStatus[];
    return base.includes(asset.status) ? base : [...base, asset.status];
  }, [catalog, asset.status]);

  /** Bản nháp hồ sơ: sê-ri, tình trạng, giá, bảo hành. */
  const [profile, setProfile] = useState({
    serialNumber: '',
    qrCode: '',
    status: asset.status,
    manufactureYear: '',
    supplier: '',
    manufacturer: '',
    usageState: asset.usageState ?? '',
    unit: asset.unit ?? '',
    purchasePrice: '',
    currency: '',
    warrantyUntil: '',
  });

  const openProfile = () => {
    setProfile({
      serialNumber: asset.serialNumber ?? '',
      qrCode: asset.qrCode ?? '',
      status: asset.status,
      manufactureYear: asset.manufactureYear === undefined ? '' : String(asset.manufactureYear),
      supplier: asset.supplier ?? '',
      manufacturer: asset.manufacturer ?? '',
      usageState: asset.usageState ?? '',
      unit: asset.unit ?? '',
      purchasePrice: asset.purchasePrice === undefined ? '' : String(asset.purchasePrice),
      currency: asset.currency ?? '',
      warrantyUntil: asset.warrantyUntil ?? '',
    });
    setEditing('profile');
  };
  const showWarranty = catalog?.warrantyFieldsEnabled ?? true;
  const [editing, setEditing] = useState<'specs' | 'tasks' | 'profile'>();
  const [specRows, setSpecRows] = useState<{ key: string; value: string; unit: string }[]>([]);
  const [taskRows, setTaskRows] = useState<AssetTaskItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  /** Hết hạn bảo hành thì tô cảnh báo — con số này chỉ có ích khi nhìn ra ngay. */
  const warrantyExpired =
    asset.warrantyUntil !== undefined && asset.warrantyUntil < new Date().toISOString().slice(0, 10);

  /**
   * Hồ sơ ở dạng chỉ đọc — cùng đúng bộ trường mà nút "Sửa" mở ra.
   *
   * Cố ý khớp một-một với form: một khối đọc hiển thị ít trường hơn khối sửa sẽ
   * khiến người dùng tưởng trường vắng mặt là không khai được.
   */
  /**
   * Trạng thái sử dụng do tenant khai trong Cài đặt.
   *
   * Giá trị đang gắn trên vật tư luôn được giữ trong danh sách kể cả khi admin
   * vừa xoá nó khỏi danh mục: nếu không, mở hồ sơ ra là ô chọn nhảy về rỗng và
   * một lần Lưu vô tình xoá mất thông tin đang có.
   */
  const usageOptions = useMemo(() => {
    const declared = catalog?.usageStates ?? [];
    if (!asset.usageState) return declared;
    return declared.includes(asset.usageState) ? declared : [...declared, asset.usageState];
  }, [catalog, asset.usageState]);

  /**
   * Đơn vị được phép chọn.
   *
   * Đơn vị đang gắn luôn nằm trong danh sách kể cả khi admin vừa bỏ nó khỏi
   * danh mục: nếu không, mở hồ sơ ra là ô nhảy về rỗng và một lần Lưu xoá mất
   * đơn vị của cả số tồn đang có.
   */
  const unitOptions = useMemo(() => {
    if (!asset.unit) return [...units];
    return units.includes(asset.unit) ? [...units] : [...units, asset.unit];
  }, [units, asset.unit]);

  const profileFacts = useMemo(() => {
    const rows: { label: string; value: string }[] = [
      { label: 'Số sê-ri', value: asset.serialNumber ?? '' },
      { label: 'Đơn vị tính', value: asset.unit ?? '' },
      { label: 'Mã QR', value: asset.qrCode ?? '' },
      { label: 'Tình trạng', value: ASSET_STATUS_LABEL[asset.status] },
      ...(usageOptions.length > 0
        ? [{ label: 'Vị trí', value: asset.usageState ?? '' }]
        : []),
      {
        label: 'Năm sản xuất',
        value: asset.manufactureYear === undefined ? '' : String(asset.manufactureYear),
      },
      { label: 'Nhà sản xuất', value: asset.manufacturer ?? '' },
      { label: 'Nhà cung cấp', value: asset.supplier ?? '' },
    ];
    if (showPrice) {
      rows.push({
        label: 'Giá mua',
        // Chưa khai khác 0 đồng — để rỗng cho nhánh '—' phía dưới xử lý.
        value:
          asset.purchasePrice === undefined
            ? ''
            : `${formatNumber(asset.purchasePrice)}${asset.currency ? ` ${asset.currency}` : ''}`,
      });
    }
    if (showWarranty) {
      rows.push({ label: 'Bảo hành đến', value: asset.warrantyUntil ?? '' });
    }
    return rows;
  }, [asset, showPrice, showWarranty, usageOptions]);

  const specs = Object.entries(asset.specs ?? {});
  const taskTemplate = asset.taskTemplate ?? [];

  const openSpecs = () => {
    setSpecRows(specs.map(([key, value]) => ({ key, ...readSpec(value) })));
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
      // Đường ghi CHUNG: hộp thoại này mở cho cả mã kho lẫn mã đã lắp, mà
      // `updateAsset` đi qua view chỉ nhận mã đã lắp.
      await updateItemProfile(asset.code, patch);
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
          <p>{asset.code}</p>
        </div>
        <div className={styles.factRow}>
          <div className={styles.fact}>
            <span>Tình trạng</span>
            <strong>{ASSET_STATUS_LABEL[asset.status]}</strong>
          </div>
          {asset.usageState ? (
            <div className={styles.fact}>
              <span>Vị trí</span>
              <strong>{asset.usageState}</strong>
            </div>
          ) : null}
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
            <h2>Hồ sơ vật tư</h2>
            {editing !== 'profile' ? (
              <button type="button" className={styles.linkButton} onClick={openProfile}>
                Sửa
              </button>
            ) : null}
          </div>

          {editing === 'profile' ? (
            <div className={styles.editList}>
              <label className={styles.fieldRow}>
                Số sê-ri
                {/* Tình trạng đi theo CÁ THỂ, mà cá thể nhận diện bằng sê-ri —
                    nên hai trường này đứng cạnh nhau. */}
                <input
                  value={profile.serialNumber}
                  placeholder="Bỏ trống nếu không có"
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, serialNumber: event.target.value }))
                  }
                />
              </label>

              <label className={styles.fieldRow}>
                Mã QR
                <input
                  value={profile.qrCode}
                  placeholder="Bỏ trống nếu không có"
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, qrCode: event.target.value }))
                  }
                />
              </label>

              <label className={styles.fieldRow}>
                Đơn vị tính
                {/* Thiếu đơn vị thì KHÔNG nhập về kho được — ràng buộc
                    `materials_stock_requires_category` bắt mọi dòng trong kho
                    phải có đơn vị. Thiết bị tạo từ cây không đi qua form vật tư
                    nên trước đây không có chỗ nào khai, và lỗi chỉ lộ ra lúc
                    bấm thanh lý. */}
                <select
                  value={profile.unit}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, unit: event.target.value }))
                  }
                >
                  <option value="">— Chưa chọn —</option>
                  {unitOptions.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.fieldRow}>
                Tình trạng
                <select
                  value={profile.status}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      status: event.target.value as AssetStatus,
                    }))
                  }
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {ASSET_STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              </label>

              {/* Chỉ hiện khi tenant đã khai danh mục. Một ô chọn rỗng không
                  giúp được gì, chỉ làm form dài thêm. */}
              {usageOptions.length > 0 ? (
                <label className={styles.fieldRow}>
                  Vị trí
                  <select
                    value={profile.usageState}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, usageState: event.target.value }))
                    }
                  >
                    <option value="">— Chưa xác định —</option>
                    {usageOptions.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className={styles.fieldRow}>
                Năm sản xuất
                {/* Chỉ NĂM: người dùng thường không biết ngày chính xác, ép nhập
                    ngày đầy đủ sẽ sinh ra hàng loạt ngày 01/01 giả. */}
                <input
                  type="number"
                  min={1900}
                  max={2200}
                  value={profile.manufactureYear}
                  placeholder="VD: 2019"
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, manufactureYear: event.target.value }))
                  }
                />
              </label>

              <label className={styles.fieldRow}>
                Nhà sản xuất
                <input
                  value={profile.manufacturer}
                  placeholder="Ai làm ra nó"
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, manufacturer: event.target.value }))
                  }
                />
              </label>

              <label className={styles.fieldRow}>
                Nhà cung cấp
                {/* Khác nhà sản xuất: một đại lý bán hàng của nhiều hãng. */}
                <input
                  value={profile.supplier}
                  placeholder="Mua của ai"
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, supplier: event.target.value }))
                  }
                />
              </label>

              {showPrice ? (
                <label className={styles.fieldRow}>
                  Giá mua
                  <span className={styles.priceGroup}>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={profile.purchasePrice}
                      placeholder="Bỏ trống nếu chưa khai"
                      onChange={(event) =>
                        setProfile((current) => ({
                          ...current,
                          purchasePrice: event.target.value,
                        }))
                      }
                    />
                    <input
                      className={styles.currencyInput}
                      value={profile.currency}
                      placeholder="VND"
                      aria-label="Tiền tệ"
                      onChange={(event) =>
                        setProfile((current) => ({ ...current, currency: event.target.value }))
                      }
                    />
                  </span>
                </label>
              ) : null}

              {showWarranty ? (
                <label className={styles.fieldRow}>
                  Bảo hành đến
                  <input
                    type="date"
                    value={profile.warrantyUntil}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, warrantyUntil: event.target.value }))
                    }
                  />
                </label>
              ) : null}

              <div className={styles.editActions}>
                <button
                  type="button"
                  className={`${styles.action} ${styles.actionPrimary}`}
                  disabled={saving}
                  onClick={() =>
                    save({
                      serialNumber: profile.serialNumber.trim() || undefined,
                      qrCode: profile.qrCode.trim() || undefined,
                      status: profile.status,
                      unit: profile.unit || undefined,
                      usageState: profile.usageState || undefined,
                      manufactureYear: profile.manufactureYear.trim()
                        ? Number(profile.manufactureYear)
                        : undefined,
                      supplier: profile.supplier.trim() || undefined,
                      manufacturer: profile.manufacturer.trim() || undefined,
                      // Ô trống nghĩa là CHƯA KHAI, khác hẳn 0 — gửi undefined
                      // để server giữ nguyên thay vì ghi đè bằng số không.
                      purchasePrice: profile.purchasePrice.trim()
                        ? Number(profile.purchasePrice)
                        : undefined,
                      currency: profile.currency.trim() || undefined,
                      warrantyUntil: profile.warrantyUntil || undefined,
                    })
                  }
                >
                  Lưu hồ sơ
                </button>
                <button
                  type="button"
                  className={styles.action}
                  disabled={saving}
                  onClick={() => setEditing(undefined)}
                >
                  Huỷ
                </button>
              </div>
            </div>
          ) : (
            /* Không ở chế độ sửa thì vẫn phải ĐỌC được hồ sơ. Trước đây khối này
               rỗng hoàn toàn, nên năm sản xuất, nhà sản xuất và nhà cung cấp —
               ba trường không có mặt ở dải tóm tắt phía trên — chỉ nhìn thấy
               được bằng cách bấm Sửa. */
            <div className={styles.specList}>
              {profileFacts.map((fact) => (
                <div key={fact.label} className={styles.specRow}>
                  <span>{fact.label}</span>
                  <strong>{fact.value || '—'}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

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
                  {/* Đơn vị của THÔNG SỐ (kV, MVA, mm²) — khác hẳn đơn vị tính
                      của kho (Cái, Lít), nên để nhập tự do chứ không lấy từ
                      danh mục đơn vị tính. */}
                  <input
                    className={styles.specUnit}
                    placeholder="Đơn vị"
                    value={row.unit}
                    aria-label={`Đơn vị của ${row.key || 'thông số'}`}
                    onChange={(event) =>
                      setSpecRows((rows) =>
                        rows.map((item, position) =>
                          position === index ? { ...item, unit: event.target.value } : item,
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
                onClick={() => setSpecRows((rows) => [...rows, { key: '', value: '', unit: '' }])}
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
                          .map((row) => [
                            row.key.trim(),
                            // Không có đơn vị thì lưu giá trị TRẦN, giữ đúng
                            // hình dạng dữ liệu cũ; có đơn vị mới bọc thành
                            // object. Bọc hết sẽ làm phình mọi thông số không
                            // cần đơn vị (số sê-ri, hãng sản xuất).
                            row.unit.trim()
                              ? { value: row.value, unit: row.unit.trim() }
                              : row.value,
                          ]),
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
                  <strong>{formatSpec(value)}</strong>
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
