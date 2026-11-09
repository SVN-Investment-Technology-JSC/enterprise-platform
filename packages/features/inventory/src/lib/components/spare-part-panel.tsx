'use client';

import type {
  AssetBomLine,
  InstalledMaterial,
  Material,
} from '@enterprise-platform/contracts-inventory';
import { Popconfirm, toast } from '@enterprise-platform/shared-ui';
import { useInventoryPermissions } from '../inventory-permissions';
import { useCallback, useEffect, useState } from 'react';
import { addAssetSparePart, loadAssetSpareParts, removeAssetSparePart } from '../inventory-api';
import { formatNumber, getUnitQuantityConfig } from '../inventory-labels';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';

const TREE_BADGE =
  'inline-flex items-center gap-1 rounded border border-green-200 bg-green-50 px-1.5 py-px text-xs font-semibold text-green-700';
const TREE_BADGE_OFF =
  'inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-px text-xs font-medium text-slate-500';

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
    setIsEditing(false);
    setDraftLines([]);
    setMaterialCode('');
    setSearchTerm('');
    setIsDropdownOpen(false);
    setCritical(false);
    setError(undefined);
    void reload();
  }, [reload, assetCode]);

  const { canManage } = useInventoryPermissions();
  const disabled = !canManage || busy || saving;

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
   * Chỉ hiển thị các node con thuộc sơ đồ cây của thiết bị đang làm (childMaterials).
   */
  const options = childMaterials
    .map((c) => ({
      code: c.materialCode,
      name: c.materialName,
      unit: c.unit,
      isTreeChild: true,
      unitCode: c.unitCode,
    }))
    .filter((item) => !(lines ?? []).some((line) => line.materialCode === item.code));

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
    setCritical(false);
  };

  const handleAddOption = (code: string) => {
    if (draftLines.some((d) => d.materialCode === code)) {
      toast.error('Vật tư này đã có trong danh sách BOM.');
      return;
    }
    const child = getTreeNode(code);
    const defaultQty = child?.quantity ? Number(child.quantity) : 1;
    const canBeCritical = isNodeInTree(code);
    setDraftLines((prev) => [
      ...prev,
      {
        materialCode: code,
        standardQuantity: Number.isFinite(defaultQty) && defaultQty > 0 ? defaultQty : 1,
        isCriticalSpare: canBeCritical ? Boolean(critical) : false,
      },
    ]);
    setMaterialCode('');
    setSearchTerm('');
    setIsDropdownOpen(false);
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
      toast.error(cause instanceof Error ? cause.message : 'Không lưu được danh sách BOM.');
    } finally {
      setSaving(false);
    }
  };


  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-[1.2rem] shadow-sm">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-base font-bold text-slate-900">Vật tư trọng yếu (Phụ tùng BOM)</h3>
          <p className="mt-0.5 mb-0 text-xs text-slate-500">
            Hiển thị theo các node con trong sơ đồ cây. Chỉ các node con đã lắp trên cây mới có thể gán cờ “Trọng yếu”.
          </p>
        </div>
        {!isEditing ? (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={startEditing}
          >
            {(lines ?? []).length === 0 ? '+ Khai báo' : 'Chỉnh sửa'}
          </Button>
        ) : null}
      </header>

      {error ? (
        <p role="alert" className="mb-4 rounded-[0.65rem] border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </p>
      ) : null}

      {isEditing ? (
        <div className="flex flex-col gap-[0.85rem] rounded-lg border-[1.5px] border-blue-300 bg-slate-50 p-4 shadow-sm">
          <div className="flex flex-col gap-1 border-b border-dashed border-slate-300 pb-2">
            <span className="inline-flex items-center gap-[0.35rem] text-sm font-bold text-blue-700">Chế độ chỉnh sửa phụ tùng BOM</span>
            <p className="m-0 text-[13px] leading-snug text-slate-500">
              Khai báo các vật tư thay thế, định mức sử dụng và tính chất trọng yếu. Chỉ node con thuộc sơ đồ cây mới được bật tính năng <strong>Trọng yếu</strong>. Nhấn <strong>Lưu phụ tùng (BOM)</strong> để áp dụng.
            </p>
          </div>

          <TableWrap className="rounded-md border border-slate-200 bg-white">
            <Table className="table-fixed">
              <TableHead>
                <TableRow className="hover:bg-slate-50">
                  <TableHeaderCell className="w-[38%] px-2.5 py-2">Tên vật tư con / Mã</TableHeaderCell>
                  <TableHeaderCell className="w-[22%] px-2.5 py-2">Vị trí sơ đồ cây</TableHeaderCell>
                  <TableHeaderCell className="w-[18%] px-2.5 py-2">Định mức số lượng</TableHeaderCell>
                  <TableHeaderCell className="w-[14%] px-2.5 py-2">Trọng yếu</TableHeaderCell>
                  <TableHeaderCell className="w-[8%] px-1.5 py-2 text-center">Thao tác</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {draftLines.map((draft, index) => {
                  const mat = materials.find((m) => m.code === draft.materialCode);
                  const childNode = getTreeNode(draft.materialCode);
                  const inTree = Boolean(childNode);
                  const name = mat?.name ?? childNode?.materialName ?? draft.materialCode;
                  const unit = mat?.unit ?? childNode?.unit ?? '';
                  return (
                    <TableRow key={draft.materialCode}>
                      <TableCell className="px-2.5 py-1.5">
                        <strong>{name}</strong>
                        <div className="text-xs text-slate-500">
                          <code>{draft.materialCode}</code>
                          {' · '}
                          <span>trong kho: {formatNumber(stockOf(draft.materialCode))} {unit}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-2.5 py-1.5">
                        {inTree && childNode ? (
                          <span className={TREE_BADGE}>
                            Node con: <code>{childNode.unitCode}</code>
                          </span>
                        ) : (
                          <span
                            className={TREE_BADGE_OFF}
                            title="Chưa lắp vào cây tài sản, không thể gán trọng yếu"
                          >
                            Chưa thuộc cây con
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <Input
                            className="h-8 w-[75px] text-[13px]"
                            type="number"
                            min={getUnitQuantityConfig(unit).min}
                            step={getUnitQuantityConfig(unit).step}
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
                          <span className="text-xs text-slate-500">{unit}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-2.5 py-1.5">
                        <label
                          className={cn(
                            'inline-flex select-none items-center gap-1.5 text-[13px]',
                            inTree ? 'cursor-pointer' : 'cursor-not-allowed opacity-45',
                          )}
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
                          <span className={draft.isCriticalSpare ? 'font-semibold' : 'font-normal'}>Trọng yếu</span>
                        </label>
                      </TableCell>
                      <TableCell className="text-center">
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
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            title="Xoá dòng này"
                          >
                            Xoá
                          </Button>
                        </Popconfirm>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {draftLines.length === 0 ? (
                  <TableEmpty colSpan={5}>
                    Chưa có phụ tùng nào trong danh sách. Thêm vật tư ở form bên dưới.
                  </TableEmpty>
                ) : null}
              </TableBody>
            </Table>
          </TableWrap>

          {/* Form thêm nhanh dòng mới vào draft có ô tìm kiếm/lọc trực tiếp */}
          <div className="relative mt-1.5 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-2.5 py-2">
            <div className="relative min-w-[220px] flex-1">
              <Input
                type="text"
                className="h-8 text-[13px]"
                disabled={disabled || options.length === 0}
                placeholder={
                  childMaterials.length === 0
                    ? 'Thiết bị chưa có node con nào trên sơ đồ cây…'
                    : 'Tìm và chọn vật tư con trên cây để thêm ngay vào bảng…'
                }
                value={searchTerm}
                onFocus={() => {
                  setSearchTerm('');
                  setIsDropdownOpen(true);
                }}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setIsDropdownOpen(true);
                  if (materialCode) setMaterialCode('');
                }}
              />
              {isDropdownOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-[99]"
                    onClick={() => setIsDropdownOpen(false)}
                  />
                  <div className="absolute top-full right-0 left-0 z-[100] mt-1 max-h-[200px] overflow-y-auto rounded-[5px] border border-blue-300 bg-white shadow-lg">
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
                          className="flex cursor-pointer items-center justify-between border-b border-slate-100 bg-white px-2.5 py-[7px] text-[13px] hover:bg-blue-50"
                          onClick={() => {
                            handleAddOption(opt.code);
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-[3px] bg-green-100 px-[5px] py-px text-xs font-semibold text-green-800">
                              Node con ({opt.unitCode})
                            </span>
                            <strong>{opt.name}</strong> <code className="text-blue-600">({opt.code})</code>
                          </div>
                          {opt.unit ? <span className="text-xs text-slate-500">{opt.unit}</span> : null}
                        </div>
                      ))}
                    {options.filter((opt) => !draftLines.some((d) => d.materialCode === opt.code)).length === 0 ? (
                      <div className="p-2.5 text-center text-[13px] text-slate-500">
                        Không có node con nào khả dụng để thêm.
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div />
            <div className="flex items-center gap-[0.6rem]">
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={cancelEditing}
              >
                Hủy bỏ
              </Button>
              <Button
                type="button"
                disabled={disabled}
                onClick={() => void handleSaveAll()}
              >
                {saving ? 'Đang lưu…' : 'Lưu phụ tùng (BOM)'}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {lines && lines.length > 0 ? (
            <div className="mb-3 flex flex-col gap-[0.6rem]">
              {lines.map((line) => {
                const onHand = stockOf(line.materialCode);
                const free = freeOf(line.materialCode);
                const isOutOfStock = onHand <= 0;
                const childNode = getTreeNode(line.materialCode);
                const inTree = Boolean(childNode);

                return (
                  <div
                    key={line.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-[0.95rem] py-3 shadow-sm transition-all hover:-translate-y-px hover:border-slate-300 hover:shadow-md"
                  >
                    <div className="flex flex-1 items-center gap-[0.85rem]">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50">
                        <span className="text-base"></span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{line.materialName}</span>
                          <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-[0.1rem] font-mono text-[13px] font-semibold text-slate-600">{line.materialCode}</span>
                          {inTree && childNode ? (
                            <span className={TREE_BADGE}>
                              Node con: {childNode.unitCode}
                            </span>
                          ) : (
                            <span className={TREE_BADGE_OFF}>
                              Chưa thuộc cây
                            </span>
                          )}
                          {line.isCriticalSpare && inTree ? (
                            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-[0.45rem] py-[0.1rem] text-xs font-bold text-amber-700">Trọng yếu</span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
                          <span className="text-slate-700">
                            Định mức: <strong>{formatNumber(line.standardQuantity)} {line.unit}</strong>
                          </span>
                          <span className="text-slate-300">•</span>
                          <span
                            className={cn(
                              'inline-flex items-center rounded border px-1.5 py-px text-xs font-semibold',
                              isOutOfStock
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : 'border-green-200 bg-green-50 text-green-800',
                            )}
                          >
                            {isOutOfStock ? 'Hết hàng trong kho' : `Tồn kho: ${formatNumber(onHand)} ${line.unit}`}
                          </span>
                          {free !== onHand ? (
                            <span className="text-xs text-slate-500">
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
            <p className="m-0 py-8 text-center text-slate-500">Chưa cấu hình phụ tùng trọng yếu (BOM) nào cho thiết bị.</p>
          ) : null}

          {options.length === 0 && (lines ?? []).length === 0 ? (
            <p className="m-0 mb-1 text-[13px] leading-normal text-slate-500">
              Chưa có vật tư con nào đang lắp trên {assetCode}. Dùng nút “+” trên sơ đồ cây để lắp vật tư từ
              kho vào đây trước, rồi mới chọn vật tư nào là trọng yếu.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
