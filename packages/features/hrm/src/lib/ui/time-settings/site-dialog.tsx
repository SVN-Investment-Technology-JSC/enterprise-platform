'use client';
/**
 * Hộp thoại thêm hoặc sửa địa điểm chấm công: tọa độ và bán kính (GPS), danh sách IP tùy chọn, và phòng ban được chấm công
 * tại đây (gán cho một đơn vị thì mọi đơn vị con kế thừa). Một cột khi hẹp, vĩ độ và kinh độ cạnh nhau khi đủ rộng.
 * Chỉ lo giao diện: việc gửi nằm ở màn hình cha.
 */
import { useId, useMemo, useState } from 'react';
import { Tree } from 'antd';
import { Search } from 'lucide-react';
import { Button } from '../button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { Input } from '../input';
import { SettingsField, SettingsSwitch } from '../settings-kit';
import {
  buildUnitTree,
  normalizeMarks,
  parseIpText,
  toggleUnit,
  treeKeys,
  unitCovered,
  type SiteAssignment,
  type UnitMarks,
  type UnitOption,
} from './time-settings-model';

export interface SiteFormState {
  /** Có thì là sửa địa điểm này. */
  id: string | null;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /** Mỗi dòng một IP hoặc CIDR; để trống là không kiểm IP. */
  ipText: string;
  /** Gán cho toàn công ty (các đơn vị không có dấu riêng đều được chấm công). */
  companyWide: boolean;
  /** Đơn vị được tick; mọi đơn vị con kế thừa. */
  unitIds: string[];
  /** Đơn vị bị bỏ tick làm ngoại lệ, nằm dưới một đơn vị đã tick (hoặc dưới toàn công ty). */
  excludedUnitIds: string[];
  /** Phân công theo chức danh/nhân viên đã có từ trước: giữ nguyên khi lưu, không hiển thị để sửa ở đây. */
  keptAssignments: SiteAssignment[];
  /** Lý do thay đổi, bắt buộc khi sửa. */
  reason: string;
}

export const emptySiteForm = (): SiteFormState => ({
  id: null,
  name: '',
  latitude: 0,
  longitude: 0,
  radiusMeters: 100,
  ipText: '',
  companyWide: false,
  unitIds: [],
  excludedUnitIds: [],
  keptAssignments: [],
  reason: '',
});

export function SiteDialog({
  open,
  busy,
  site,
  units,
  setSite,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  site: SiteFormState;
  units: readonly UnitOption[];
  setSite: (next: SiteFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const uid = useId();
  const editing = site.id !== null;
  const marks: UnitMarks = { companyWide: site.companyWide, unitIds: site.unitIds, excludedUnitIds: site.excludedUnitIds };
  const applyMarks = (next: UnitMarks) =>
    setSite({ ...site, companyWide: next.companyWide, unitIds: [...next.unitIds], excludedUnitIds: [...next.excludedUnitIds] });
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string[] | null>(null);
  const tree = useMemo(() => buildUnitTree(units, query), [units, query]);
  const allKeys = useMemo(() => treeKeys(tree), [tree]);
  const rootKeys = useMemo(() => tree.map((n) => n.key), [tree]);
  // Ít đơn vị thì mở hết; nhiều thì mở các gốc; đang tìm kiếm thì mở hết để thấy kết quả.
  const expandedKeys = query.trim() ? allKeys : (expanded ?? (units.length <= 80 ? allKeys : rootKeys));
  const checkedKeys = useMemo(() => units.filter((u) => unitCovered(units, marks, u.id)).map((u) => u.id), [units, marks]);
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? id;
  const ips = parseIpText(site.ipText);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[92dvh] gap-0 bg-white p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-5 py-4 pr-12">
          <DialogTitle>{editing ? 'Cập nhật địa điểm chấm công' : 'Thêm địa điểm chấm công'}</DialogTitle>
          <DialogDescription>
            Nhân viên chấm công trong bán kính quanh tọa độ này được coi là hợp lệ; nếu khai báo IP thì phải đúng cả IP.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 @xl:p-5">
            <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
              <SettingsField label="Tên địa điểm" required htmlFor={`${uid}-name`} className="@sm:col-span-2">
                <Input
                  id={`${uid}-name`}
                  required
                  className="h-9 text-xs"
                  value={site.name}
                  onChange={(e) => setSite({ ...site, name: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="Vĩ độ" required htmlFor={`${uid}-lat`} hint="Từ -90 đến 90.">
                <Input
                  id={`${uid}-lat`}
                  required
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  className="h-9 text-xs"
                  value={site.latitude}
                  onChange={(e) => setSite({ ...site, latitude: Number(e.target.value) })}
                />
              </SettingsField>
              <SettingsField label="Kinh độ" required htmlFor={`${uid}-lng`} hint="Từ -180 đến 180.">
                <Input
                  id={`${uid}-lng`}
                  required
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                  className="h-9 text-xs"
                  value={site.longitude}
                  onChange={(e) => setSite({ ...site, longitude: Number(e.target.value) })}
                />
              </SettingsField>
              <SettingsField
                label="Bán kính (m)"
                required
                htmlFor={`${uid}-radius`}
                hint="Từ 1 đến 100000 m."
                className="@sm:col-span-2"
              >
                <Input
                  id={`${uid}-radius`}
                  required
                  type="number"
                  min={1}
                  max={100000}
                  className="h-9 text-xs"
                  value={site.radiusMeters}
                  onChange={(e) => setSite({ ...site, radiusMeters: Number(e.target.value) })}
                />
              </SettingsField>
              <SettingsField
                label="IP được phép (tùy chọn)"
                htmlFor={`${uid}-ips`}
                hint="Mỗi dòng một IP hoặc dải CIDR, ví dụ 203.0.113.5 hoặc 203.0.113.0/24. Để trống là không kiểm IP; có khai báo thì phải đạt cả vị trí lẫn IP."
                className="@sm:col-span-2"
              >
                <textarea
                  id={`${uid}-ips`}
                  rows={3}
                  value={site.ipText}
                  onChange={(e) => setSite({ ...site, ipText: e.target.value })}
                  placeholder="203.0.113.0/24"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20"
                />
                {ips.length > 0 ? <p className="mt-1 text-[11px] text-slate-500">{ips.length} IP/dải sẽ được lưu.</p> : null}
              </SettingsField>

              <div className="space-y-2.5 rounded-xl border border-slate-200 p-3 @sm:col-span-2">
                <div>
                  <p className="text-sm font-bold text-slate-900">Phòng ban chấm công tại đây</p>
                  <p className="text-[12px] leading-snug text-slate-500">
                    Tick một phòng ban để áp dụng cho cả các đơn vị con của nó. Có ngoại lệ thì bỏ tick đơn vị đó (bỏ tick cha thì cả nhánh không áp dụng).
                  </p>
                </div>
                <label className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
                  <span>Toàn công ty</span>
                  <SettingsSwitch
                    label="Áp dụng cho toàn công ty"
                    checked={site.companyWide}
                    onChange={(next) => applyMarks(normalizeMarks(units, { ...marks, companyWide: next }))}
                  />
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                  <Input
                    aria-label="Tìm phòng ban"
                    className="h-9 pl-8 text-xs"
                    placeholder="Tìm phòng ban theo tên hoặc mã…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                {tree.length > 0 ? (
                  <div
                    className="max-h-[min(20rem,38dvh)] min-h-28 overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg border border-slate-200 bg-white p-1.5 [&_.ant-tree]:text-xs [&_.ant-tree-node-content-wrapper]:min-w-0 [&_.ant-tree-node-content-wrapper]:whitespace-normal [&_.ant-tree-node-content-wrapper]:break-words [&_.ant-tree-title]:break-words [&_.ant-tree-treenode]:w-full [&_.ant-tree-treenode]:items-start"
                  >
                    <Tree
                      checkable
                      checkStrictly
                      selectable={false}
                      blockNode
                      virtual={false}
                      disabled={busy}
                      treeData={tree}
                      checkedKeys={checkedKeys}
                      expandedKeys={expandedKeys}
                      onExpand={(keys) => setExpanded(keys.map(String))}
                      onCheck={(_, info) => applyMarks(toggleUnit(units, marks, String(info.node.key), info.checked))}
                    />
                  </div>
                ) : (
                  <p className="text-[12px] text-slate-500">{units.length === 0 ? 'Chưa có phòng ban nào.' : 'Không tìm thấy phòng ban.'}</p>
                )}
                <p className="text-[12px] text-slate-600" role="status">
                  Áp dụng cho {checkedKeys.length}/{units.length} đơn vị.
                  {site.excludedUnitIds.length > 0 ? (
                    <> Ngoại lệ không áp dụng: <span className="font-semibold">{site.excludedUnitIds.map(unitName).join(', ')}</span>.</>
                  ) : null}
                </p>
              </div>

              {editing ? (
                <SettingsField label="Lý do thay đổi" required htmlFor={`${uid}-reason`} className="@sm:col-span-2">
                  <Input
                    id={`${uid}-reason`}
                    required
                    className="h-9 text-xs"
                    value={site.reason}
                    onChange={(e) => setSite({ ...site, reason: e.target.value })}
                  />
                </SettingsField>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose} className="h-9 px-4 text-xs">
              Hủy
            </Button>
            <Button type="submit" disabled={busy} className="h-9 px-4 text-xs font-semibold">
              {busy ? 'Đang lưu…' : 'Lưu địa điểm'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
