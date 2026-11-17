'use client';
import { useInventoryPermissions } from '../inventory-permissions';

import type { Material, SerialTracking } from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useState } from 'react';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { loadSerials, registerSerials, updateSerial } from '../inventory-api';
import { ASSET_STATUS_LABEL } from '../inventory-labels';
import { Button } from '../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';
import { Textarea } from '../ui/textarea';

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
      if (result.added < serialNumbers.length) {
        toast.warning(`Đã thêm ${result.added}/${serialNumbers.length} — số còn lại đã có sẵn.`);
      }
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Không khai được sê-ri.');
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
      toast.error(cause instanceof Error ? cause.message : 'Không lưu được.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-2">
        <strong className="text-sm font-semibold text-slate-900">Cá thể theo sê-ri</strong>
        <span className="text-[13px] text-slate-500">{rows ? `${rows.length} cá thể` : 'Đang tải…'}</span>
      </header>

      {error ? (
        <p role="alert" className="m-0 rounded-[0.65rem] border border-[#f0c2c2] bg-[#fdf2f2] px-4 py-[0.8rem] text-[#a12b2b]">
          {error}
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <TableWrap className="rounded-xl border border-slate-200 bg-white">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Số sê-ri</TableHeaderCell>
              <TableHeaderCell>Tình trạng</TableHeaderCell>
              <TableHeaderCell>Vị trí</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono font-bold tracking-[0.03em] text-slate-800">{row.serialNumber}</TableCell>
                <TableCell>
                  <div role="group" aria-label={`Tình trạng của ${row.serialNumber}`}>
                  <SearchableSelect
                    value={row.currentStatus}
                    disabled={disabled}
                    clearable={false}
                    height={32}
                    onChange={(value) => void patch(row.serialNumber, { currentStatus: value })}
                    options={withCurrent(statuses, row.currentStatus).map((status) => ({
                      value: status,
                      label: ASSET_STATUS_LABEL[status as keyof typeof ASSET_STATUS_LABEL] ?? status,
                    }))}
                  />
                  </div>
                </TableCell>
                <TableCell>
                  {usageStates.length === 0 ? (
                    <span className="text-slate-500">Chưa khai danh mục trong Cài đặt</span>
                  ) : (
                    <div role="group" aria-label={`Vị trí sử dụng của ${row.serialNumber}`}>
                    <SearchableSelect
                      value={row.locationType}
                      disabled={disabled}
                      height={32}
                      placeholder="— Chưa xác định —"
                      onChange={(value) => void patch(row.serialNumber, { locationType: value })}
                      options={withCurrent(usageStates, row.locationType).map((state) => ({
                        value: state,
                        label: state,
                      }))}
                    />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </TableWrap>
      ) : rows ? (
        <p className="m-0 py-8 text-center text-slate-500">Chưa khai sê-ri nào cho mã này.</p>
      ) : null}

      <div className="flex flex-col items-start gap-2">
        <Textarea
          rows={2}
          value={draft}
          disabled={disabled}
          aria-label="Số sê-ri mới"
          placeholder="Mỗi sê-ri một dòng, hoặc ngăn bằng dấu phẩy"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="button" disabled={disabled || !draft.trim()} onClick={() => void add()}>
          Khai sê-ri
        </Button>
      </div>
      {/* T8-11: khai ở đây không đưa sê-ri vào kho, nói rõ để người dùng không
          tưởng đã có hàng để xuất. */}
      <p className="m-0 text-[0.8125rem] leading-normal text-slate-500">
        Khai sê-ri ở đây chỉ ghi danh mục cá thể, chưa tính vào tồn kho. Muốn sê-ri vào kho,
        nhập qua phiếu nhập kho kèm số sê-ri.
      </p>
    </section>
  );
}

/** Danh mục kèm giá trị đang dùng, để một lần sửa không xoá mất dữ liệu cũ. */
function withCurrent(options: readonly string[], current: string): string[] {
  if (!current || options.includes(current)) return [...options];
  return [...options, current];
}
