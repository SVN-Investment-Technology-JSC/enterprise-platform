'use client';

import type {
  AssetBomLine,
  InstalledMaterial,
  Material,
} from '@enterprise-platform/contracts-inventory';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useState } from 'react';
import { addAssetSparePart, loadAssetSpareParts, removeAssetSparePart } from '../inventory-api';
import { formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

/**
 * Vật tư TRỌNG YẾU của một thiết bị / tài sản (Phụ tùng BOM).
 *
 * Hiển thị và quản lý phụ tùng theo các node con trong sơ đồ cây (childMaterials).
 * Chỉ các node con thực tế có trong sơ đồ cây mới được kích hoạt/gán tính chất "Trọng yếu" (isCriticalSpare).
 * Các vật tư chưa được lắp vào cây sẽ không thể gán cờ Trọng yếu cho đến khi được thêm vào sơ đồ cây.
 */
export function SparePartPanel({
  assetCode,
  materials,
  childMaterials = [],
  onHandByCode,
  availableByCode,
  busy,
}: {
  assetCode: string;
  materials: readonly Material[];
  /** Vật tư con đang lắp trên thiết bị này trong sơ đồ cây — nguồn tham chiếu chính. */
  childMaterials?: readonly InstalledMaterial[];
  /** Hàng thật trong kho, gộp mọi kho, theo mã. */
  onHandByCode?: ReadonlyMap<string, number>;
  /** Khả dụng (đã trừ phần giữ chỗ), để hiện kèm khi hai số lệch nhau. */
  availableByCode?: ReadonlyMap<string, number>;
  busy?: boolean;
}) {
  const [lines, setLines] = useState<AssetBomLine[]>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [materialCode, setMaterialCode] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [critical, setCritical] = useState(false);

  const reload = useCallback(async () => {
    try {
      setLines(await loadAssetSpareParts(assetCode));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được danh sách vật tư trọng yếu.');
    }
  }, [assetCode]);

  useEffect(() => {
    setLines(undefined);
    void reload();
  }, [reload]);

  const disabled = busy || saving;

  /** Hàng thật trong kho của một mã; chưa đọc được thì coi như 0. */
  const stockOf = (code: string) => onHandByCode?.get(code) ?? 0;
  /** Khả dụng của mã đó — chỉ hiện khi nó khác số trong kho. */
  const freeOf = (code: string) => availableByCode?.get(code) ?? 0;

  /** Kiểm tra xem một mã vật tư có tồn tại trong các node con của sơ đồ cây không */
  const isNodeInTree = useCallback(
    (code: string) => childMaterials.some((c) => c.materialCode === code),
    [childMaterials],
  );

  /** Lấy thông tin node con tương ứng trên sơ đồ cây */
  const getTreeNode = useCallback(
    (code: string) => childMaterials.find((c) => c.materialCode === code),
    [childMaterials],
  );

  /**
   * Danh sách options chọn vật tư:
   * Ưu tiên và hiển thị rõ các node con từ sơ đồ cây (childMaterials),
   * kèm các vật tư khác từ kho nếu cần, phân loại trạng thái có trong cây hay không.
   */
  const options = (
    childMaterials.length > 0
      ? [
          ...childMaterials.map((c) => ({
            code: c.materialCode,
            name: c.materialName,
            unit: c.unit,
            isTreeChild: true,
            unitCode: c.unitCode,
          })),
          ...materials
            .filter((m) => !childMaterials.some((c) => c.materialCode === m.code))
            .map((m) => ({
              code: m.code,
              name: m.name,
              unit: m.unit,
              isTreeChild: false,
              unitCode: undefined,
            })),
        ]
      : materials.map((m) => ({
          code: m.code,
          name: m.name,
          unit: m.unit,
          isTreeChild: false,
          unitCode: undefined,
        }))
  ).filter((item) => !(lines ?? []).some((line) => line.materialCode === item.code));

  const [isEditing, setIsEditing] = useState(false);
  const [draftLines, setDraftLines] = useState<
    { materialCode: string; standardQuantity: number; isCriticalSpare: boolean }[]
  >([]);

  const startEditing = () => {
    setDraftLines(
      (lines ?? []).map((l) => ({
        materialCode: l.materialCode,
        standardQuantity: l.standardQuantity,
        // Nếu không thuộc node con trên cây thì không cho gán trọng yếu
        isCriticalSpare: isNodeInTree(l.materialCode) ? l.isCriticalSpare : false,
      })),
    );
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setDraftLines([]);
    setMaterialCode('');
    setQuantity('1');
    setCritical(false);
  };

  const handleAddDraft = () => {
    const parsed = Number(quantity);
    if (!materialCode || !Number.isFinite(parsed) || parsed <= 0) {
      setError('Chọn vật tư và nhập định mức là số dương.');
      return;
    }
    if (draftLines.some((d) => d.materialCode === materialCode)) {
      setError('Vật tư này đã có trong danh sách BOM.');
      return;
    }
    const canBeCritical = isNodeInTree(materialCode);
    setDraftLines((prev) => [
      ...prev,
      {
        materialCode,
        standardQuantity: parsed,
        isCriticalSpare: canBeCritical ? critical : false,
      },
    ]);
    setMaterialCode('');
    setQuantity('1');
    setCritical(false);
    setError(undefined);
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const currentLines = lines ?? [];

      // 1. Xóa các dòng bị gỡ khỏi draft HOẶC có thay đổi về isCriticalSpare / standardQuantity
      for (const current of currentLines) {
        const matchingDraft = draftLines.find((d) => d.materialCode === current.materialCode);
        const canBeCritical = isNodeInTree(current.materialCode);
        const targetCritical = canBeCritical ? Boolean(matchingDraft?.isCriticalSpare) : false;

        const isRemoved = !matchingDraft;
        const isChanged =
          matchingDraft &&
          (matchingDraft.standardQuantity !== current.standardQuantity ||
            targetCritical !== Boolean(current.isCriticalSpare));

        if (isRemoved || isChanged) {
          await removeAssetSparePart(assetCode, current.id);
        }
      }

      // 2. Thêm mới các dòng chưa có hoặc các dòng vừa được xoá để cập nhật giá trị mới
      for (const draft of draftLines) {
        const existing = currentLines.find((l) => l.materialCode === draft.materialCode);
        const canBeCritical = isNodeInTree(draft.materialCode);
        const effectiveCritical = canBeCritical ? draft.isCriticalSpare : false;

        const isChanged =
          existing &&
          (existing.standardQuantity !== draft.standardQuantity ||
            Boolean(existing.isCriticalSpare) !== effectiveCritical);

        if (!existing || isChanged) {
          await addAssetSparePart(assetCode, {
            materialCode: draft.materialCode,
            standardQuantity: draft.standardQuantity,
            isCriticalSpare: effectiveCritical,
          });
        }
      }

      await reload();
      setIsEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được danh sách BOM.');
    } finally {
      setSaving(false);
    }
  };


  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <div>
          <h3>Vật tư trọng yếu (Phụ tùng BOM)</h3>
          <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: '#64748b' }}>
            Hiển thị theo các node con trong sơ đồ cây. Chỉ các node con đã lắp trên cây mới có thể gán cờ “Trọng yếu”.
          </p>
        </div>
        {!isEditing ? (
          <button
            type="button"
            className={styles.btnSecondary}
            style={{ padding: '4px 10px', fontSize: '12px' }}
            disabled={disabled}
            onClick={startEditing}
          >
            {(lines ?? []).length === 0 ? '+ Khai báo' : 'Chỉnh sửa'}
          </button>
        ) : null}
      </header>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {isEditing ? (
        <div className={styles.inlineEditContainer}>
          <div className={styles.inlineEditHeader}>
            <span className={styles.inlineEditBadge}>Chế độ chỉnh sửa phụ tùng BOM</span>
            <p className={styles.inlineEditHint}>
              Khai báo các vật tư thay thế, định mức sử dụng và tính chất trọng yếu. Chỉ node con thuộc sơ đồ cây mới được bật tính năng <strong>Trọng yếu</strong>. Nhấn <strong>Lưu phụ tùng (BOM)</strong> để áp dụng.
            </p>
          </div>

          <div className={styles.inlineEditTableWrap}>
            <table className={styles.inlineEditTable} style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: '38%', padding: '8px 10px' }}>Tên vật tư con / Mã</th>
                  <th style={{ width: '22%', padding: '8px 10px' }}>Vị trí sơ đồ cây</th>
                  <th style={{ width: '18%', padding: '8px 10px' }}>Định mức số lượng</th>
                  <th style={{ width: '14%', padding: '8px 10px' }}>Trọng yếu</th>
                  <th style={{ width: '8%', textAlign: 'center', padding: '8px 6px' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {draftLines.map((draft, index) => {
                  const mat = materials.find((m) => m.code === draft.materialCode);
                  const childNode = getTreeNode(draft.materialCode);
                  const inTree = Boolean(childNode);
                  const name = mat?.name ?? childNode?.materialName ?? draft.materialCode;
                  const unit = mat?.unit ?? childNode?.unit ?? '';
                  return (
                    <tr key={draft.materialCode}>
                      <td style={{ padding: '6px 10px' }}>
                        <strong>{name}</strong>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          <code>{draft.materialCode}</code>
                          {' · '}
                          <span>trong kho: {formatNumber(stockOf(draft.materialCode))} {unit}</span>
                        </div>
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        {inTree && childNode ? (
                          <span className={styles.treeNodeBadge}>
                            Node con: <code>{childNode.unitCode}</code>
                          </span>
                        ) : (
                          <span
                            className={styles.treeNodeBadgeNotInstalled}
                            title="Chưa lắp vào cây tài sản, không thể gán trọng yếu"
                          >
                            Chưa thuộc cây con
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <input
                            className={styles.inlineEditInput}
                            type="number"
                            min="0.001"
                            step="0.001"
                            style={{ width: '75px' }}
                            value={draft.standardQuantity}
                            onChange={(e) =>
                              setDraftLines((prev) =>
                                prev.map((item, p) =>
                                  p === index
                                    ? { ...item, standardQuantity: Number(e.target.value) || 1 }
                                    : item,
                                ),
                              )
                            }
                          />
                          <span style={{ fontSize: '11.5px', color: '#64748b' }}>{unit}</span>
                        </div>
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <label
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '12px',
                            cursor: inTree ? 'pointer' : 'not-allowed',
                            opacity: inTree ? 1 : 0.45,
                            userSelect: 'none',
                          }}
                          title={
                            inTree
                              ? 'Gán là vật tư phụ tùng trọng yếu'
                              : 'Chỉ có thể gán trọng yếu cho các node con có trong sơ đồ cây'
                          }
                        >
                          <input
                            type="checkbox"
                            disabled={!inTree}
                            checked={inTree && draft.isCriticalSpare}
                            onChange={(e) =>
                              setDraftLines((prev) =>
                                prev.map((item, p) =>
                                  p === index
                                    ? { ...item, isCriticalSpare: e.target.checked }
                                    : item,
                                ),
                              )
                            }
                          />
                          <span style={{ fontWeight: draft.isCriticalSpare ? 600 : 400 }}>Trọng yếu</span>
                        </label>
                      </td>
                      <td className={styles.center}>
                        <Popconfirm
                          title="Xoá phụ tùng này khỏi bảng BOM?"
                          description={`Vật tư "${name}" (${draft.materialCode}) sẽ bị gỡ bỏ.`}
                          okText="Đồng ý xoá"
                          cancelText="Huỷ"
                          okType="danger"
                          placement="top-end"
                          onConfirm={() =>
                            setDraftLines((prev) => prev.filter((_, p) => p !== index))
                          }
                        >
                          <button
                            type="button"
                            className={styles.deleteActionBtn}
                            title="Xoá dòng này"
                          >
                            Xoá
                          </button>
                        </Popconfirm>
                      </td>
                    </tr>
                  );
                })}
                {draftLines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={styles.inlineEmptyCell}>
                      Chưa có phụ tùng nào trong danh sách. Thêm vật tư ở form bên dưới.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* Form thêm nhanh dòng mới vào draft có ô tìm kiếm/lọc trực tiếp */}
          <div className={styles.spareForm} style={{ marginTop: '6px', padding: '8px 10px', background: '#ffffff', borderRadius: '6px', border: '1px dashed #cbd5e1', position: 'relative' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
              <input
                type="text"
                disabled={disabled}
                placeholder="Nhập tên hoặc mã vật tư (ưu tiên node con trên cây)…"
                value={
                  materialCode && !isDropdownOpen
                    ? `${options.find((o) => o.code === materialCode)?.name ?? materialCode} (${materialCode})`
                    : searchTerm
                }
                onFocus={() => {
                  setSearchTerm('');
                  setIsDropdownOpen(true);
                }}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setIsDropdownOpen(true);
                  if (materialCode) setMaterialCode('');
                }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px 10px',
                  fontSize: '12.5px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '5px',
                  outline: 'none',
                }}
              />
              {isDropdownOpen ? (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                    onClick={() => setIsDropdownOpen(false)}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      zIndex: 100,
                      maxHeight: '200px',
                      overflowY: 'auto',
                      background: '#ffffff',
                      border: '1px solid #93c5fd',
                      borderRadius: '5px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      marginTop: '4px',
                    }}
                  >
                    {options
                      .filter((opt) => !draftLines.some((d) => d.materialCode === opt.code))
                      .filter((opt) => {
                        if (!searchTerm.trim()) return true;
                        const term = searchTerm.toLowerCase();
                        return opt.name.toLowerCase().includes(term) || opt.code.toLowerCase().includes(term);
                      })
                      .map((opt) => (
                        <div
                          key={opt.code}
                          style={{
                            padding: '7px 10px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            borderBottom: '1px solid #f1f5f9',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#eff6ff';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#ffffff';
                          }}
                          onClick={() => {
                            setMaterialCode(opt.code);
                            setSearchTerm('');
                            setIsDropdownOpen(false);
                            const child = getTreeNode(opt.code);
                            if (child) setQuantity(String(child.quantity));
                            if (!opt.isTreeChild) {
                              setCritical(false);
                            }
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {opt.isTreeChild ? (
                              <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#dcfce7', color: '#166534', fontWeight: 600 }}>
                                Node con cây ({opt.unitCode})
                              </span>
                            ) : (
                              <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#f1f5f9', color: '#64748b' }}>
                                Kho
                              </span>
                            )}
                            <strong>{opt.name}</strong> <code style={{ color: '#2563eb' }}>({opt.code})</code>
                          </div>
                          {opt.unit ? <span style={{ color: '#64748b', fontSize: '11px' }}>{opt.unit}</span> : null}
                        </div>
                      ))}
                  </div>
                </>
              ) : null}
            </div>

            <input
              type="number"
              min="0"
              step="0.001"
              value={quantity}
              disabled={disabled}
              placeholder="Định mức"
              aria-label="Định mức"
              style={{ width: '85px' }}
              onChange={(event) => setQuantity(event.target.value)}
            />
            {(() => {
              const inTree = Boolean(materialCode && isNodeInTree(materialCode));
              return (
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                    cursor: inTree ? 'pointer' : 'not-allowed',
                    opacity: inTree ? 1 : 0.45,
                  }}
                  title={
                    inTree
                      ? 'Gán là vật tư trọng yếu'
                      : 'Chỉ có thể gán nút Trọng yếu ở các node con có trong sơ đồ cây'
                  }
                >
                  <input
                    type="checkbox"
                    checked={inTree && critical}
                    disabled={disabled || !inTree}
                    onChange={(event) => setCritical(event.target.checked)}
                  />
                  Trọng yếu
                </label>
              );
            })()}
            <button
              type="button"
              className={styles.inlineAddRowBtn}
              disabled={disabled || !materialCode}
              onClick={handleAddDraft}
            >
              + Thêm vào bảng
            </button>
          </div>

          <div className={styles.inlineActionRow}>
            <div />
            <div className={styles.inlineSaveGroup}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                disabled={disabled}
                onClick={cancelEditing}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className={styles.modalSaveBtn}
                disabled={disabled}
                onClick={() => void handleSaveAll()}
              >
                {saving ? 'Đang lưu…' : 'Lưu phụ tùng (BOM)'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {lines && lines.length > 0 ? (
            <div className={styles.spareCardGrid}>
              {lines.map((line) => {
                const onHand = stockOf(line.materialCode);
                const free = freeOf(line.materialCode);
                const isOutOfStock = onHand <= 0;
                const childNode = getTreeNode(line.materialCode);
                const inTree = Boolean(childNode);

                return (
                  <div key={line.id} className={styles.spareItemCard}>
                    <div className={styles.spareCardLeft}>
                      <div className={styles.spareCardIconWrap}>
                        <span className={styles.spareCardIcon}></span>
                      </div>
                      <div className={styles.spareCardInfo}>
                        <div className={styles.spareCardTitleRow}>
                          <span className={styles.spareCardName}>{line.materialName}</span>
                          <span className={styles.spareCardCodeTag}>{line.materialCode}</span>
                          {inTree && childNode ? (
                            <span className={styles.treeNodeBadge} style={{ fontSize: '11px', padding: '1px 6px' }}>
                              Node con: {childNode.unitCode}
                            </span>
                          ) : (
                            <span className={styles.treeNodeBadgeNotInstalled} style={{ fontSize: '11px', padding: '1px 6px' }}>
                              Chưa thuộc cây
                            </span>
                          )}
                          {line.isCriticalSpare && inTree ? (
                            <span className={styles.criticalBadge}>Trọng yếu</span>
                          ) : null}
                        </div>
                        <div className={styles.spareCardMeta}>
                          <span className={styles.spareQuotaTag}>
                            Định mức: <strong>{formatNumber(line.standardQuantity)} {line.unit}</strong>
                          </span>
                          <span className={styles.metaDot}>•</span>
                          <span className={isOutOfStock ? styles.stockBadgeDanger : styles.stockBadgeSuccess}>
                            {isOutOfStock ? 'Hết hàng trong kho' : `Tồn kho: ${formatNumber(onHand)} ${line.unit}`}
                          </span>
                          {free !== onHand ? (
                            <span className={styles.spareFreeStock}>
                              (Khả dụng: {formatNumber(free)})
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : lines ? (
            <p className={styles.empty}>Chưa cấu hình phụ tùng trọng yếu (BOM) nào cho thiết bị.</p>
          ) : null}

          {options.length === 0 && (lines ?? []).length === 0 ? (
            <p className={styles.hint}>
              Chưa có vật tư con nào đang lắp trên {assetCode}. Dùng nút “+” trên sơ đồ cây để lắp vật tư từ
              kho vào đây trước, rồi mới chọn vật tư nào là trọng yếu.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

