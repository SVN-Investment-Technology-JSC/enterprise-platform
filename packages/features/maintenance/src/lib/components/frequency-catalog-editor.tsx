'use client';

import type {
  MaintenanceFrequencyCatalog,
  MaintenanceFrequencyOption,
} from '@enterprise-platform/contracts-maintenance';
import { MinimalPopupForm, Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  AlertCircle,
  Calendar,
  Clock,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { TablePagerBar } from '../ui/table-pager-bar';
import { Tip } from '../ui/tooltip';
import { SELECT_CLASS } from '../ui/select-class';
import { cn } from '../utils';

const UNIT_LABEL: Readonly<Record<MaintenanceFrequencyOption['intervalUnit'], string>> = {
  day: 'ngày',
  week: 'tuần',
  month: 'tháng',
  year: 'năm',
};

const UNIT_OPTIONS = (['day', 'week', 'month', 'year'] as const).map((unit) => ({
  value: unit,
  label: UNIT_LABEL[unit],
}));

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'active', label: 'Đang kích hoạt' },
  { value: 'inactive', label: 'Đang tắt' },
  { value: 'in_use', label: 'Đang có lịch gán' },
  { value: 'unused', label: 'Chưa có lịch gán' },
];

const PAGE_SIZES = [5, 10, 15, 30];

const TH =
  'whitespace-nowrap border-b border-border bg-muted px-3 py-2.5 text-left text-xs font-bold text-slate-600';
const TD = 'border-b border-slate-100 px-3 py-2.5 align-middle';
const FIELD_LABEL = 'text-sm font-semibold text-slate-700';

/** Bỏ dấu và chuẩn hoá nhãn thành mã. */
function toCode(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface FrequencyCatalogEditorProps {
  readonly value: MaintenanceFrequencyCatalog;
  /** Mã tần suất đang được ít nhất một lịch dùng. */
  readonly usedCodes: ReadonlySet<string>;
  readonly disabled?: boolean;
  readonly onChange: (next: MaintenanceFrequencyCatalog) => void;
}

export function FrequencyCatalogEditor({
  value,
  usedCodes,
  disabled,
  onChange,
}: FrequencyCatalogEditorProps) {
  const [filterText, setFilterText] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Trạng thái modal thêm mới
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCount, setNewCount] = useState(1);
  const [newUnit, setNewUnit] = useState<MaintenanceFrequencyOption['intervalUnit']>('month');
  const [newIsActive, setNewIsActive] = useState(true);
  const [addError, setAddError] = useState<string>();

  const setOptions = (options: MaintenanceFrequencyOption[]) =>
    onChange({ options: options.map((option, index) => ({ ...option, sortOrder: index + 1 })) });

  const patch = (index: number, change: Partial<MaintenanceFrequencyOption>) => {
    const next = [...value.options];
    next[index] = { ...next[index], ...change };
    setOptions(next);
  };

  const openAddModal = () => {
    setNewLabel('');
    setNewCount(1);
    setNewUnit('month');
    setNewIsActive(true);
    setAddError(undefined);
    setIsAddOpen(true);
  };

  const handleAddSubmit = () => {
    const trimmedLabel = newLabel.trim();
    if (!trimmedLabel) {
      setAddError('Vui lòng nhập tên tần suất bảo trì.');
      return;
    }

    if (value.options.some((o) => o.label.toLowerCase() === trimmedLabel.toLowerCase())) {
      setAddError('Tên tần suất này đã tồn tại.');
      return;
    }

    const taken = new Set(value.options.map((option) => option.code));
    const stem = toCode(trimmedLabel) || 'tan-suat';
    let code = stem;
    let suffix = 2;
    while (taken.has(code)) code = `${stem}-${suffix++}`;

    setOptions([
      ...value.options,
      {
        code,
        label: trimmedLabel,
        intervalUnit: newUnit,
        intervalCount: Math.max(1, newCount),
        sortOrder: value.options.length + 1,
        isActive: newIsActive,
      },
    ]);

    setIsAddOpen(false);
  };

  // Thống kê nhanh
  const totalCount = value.options.length;
  const activeCount = value.options.filter((o) => o.isActive).length;
  const inUseCount = value.options.filter((o) => usedCodes.has(o.code)).length;

  // Lọc dữ liệu
  const filteredOptions = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    return value.options.filter((option) => {
      const inUse = usedCodes.has(option.code);
      if (filterStatus === 'active' && !option.isActive) return false;
      if (filterStatus === 'inactive' && option.isActive) return false;
      if (filterStatus === 'in_use' && !inUse) return false;
      if (filterStatus === 'unused' && inUse) return false;

      if (!query) return true;
      return (
        option.label.toLowerCase().includes(query) ||
        option.code.toLowerCase().includes(query) ||
        UNIT_LABEL[option.intervalUnit].toLowerCase().includes(query)
      );
    });
  }, [value.options, filterText, filterStatus, usedCodes]);

  // Phân trang
  const totalRecords = filteredOptions.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRecords);
  const paginatedOptions = filteredOptions.slice(startIndex, endIndex);

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Thẻ thống kê tổng quan */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="inline-flex items-center gap-2 rounded-md border border-border bg-slate-100 px-3 py-1.5 text-[0.8125rem] text-slate-600">
          <Clock size={14} />
          <span>Tổng số tần suất:</span>
          <strong className="tabular-nums text-foreground">{totalCount}</strong>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-[0.8125rem] text-blue-700">
          <Calendar size={14} />
          <span>Đang kích hoạt:</span>
          <strong className="tabular-nums text-foreground">{activeCount}</strong>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-[0.8125rem] text-green-700">
          <AlertCircle size={14} />
          <span>Đang có lịch dùng:</span>
          <strong className="tabular-nums text-foreground">{inUseCount}</strong>
        </div>
      </div>

      <div className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm">
        {/* Vùng 1: thanh tìm kiếm, bộ lọc */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex flex-1 flex-wrap items-center gap-2.5">
            <div className="relative min-w-[180px] max-w-[320px] flex-1 basis-60">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <Input
                className="h-9 rounded-md pl-8 text-sm"
                value={filterText}
                placeholder="Tìm mã hoặc tên tần suất…"
                aria-label="Tìm kiếm tần suất"
                onChange={(e) => {
                  setFilterText(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>

            <div className="w-[200px] shrink-0">
              <SearchableSelect
                className={SELECT_CLASS}
              height={36}
              searchInDropdown
              hideDropdownSearch
              clearable={false}
              value={filterStatus}
              options={STATUS_FILTER_OPTIONS}
              onChange={(v) => {
                setFilterStatus(v || 'all');
                setCurrentPage(1);
              }}
              />
            </div>

            {filterText || filterStatus !== 'all' ? (
              <Button
                variant="outline"
                size="lg"
                className="rounded-md px-3"
                onClick={() => {
                  setFilterText('');
                  setFilterStatus('all');
                  setCurrentPage(1);
                }}
              >
                <RotateCcw />
                <span>Đặt lại</span>
              </Button>
            ) : null}
          </div>

          <Button size="lg" className="rounded-md px-3" disabled={disabled} onClick={openAddModal}>
            <Plus strokeWidth={2.5} />
            <span>Thêm tần suất</span>
          </Button>
        </div>

        {/* Vùng 2: thân bảng */}
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr>
                <th className={cn(TH, 'w-[56px] text-center')}>STT</th>
                <th className={cn(TH, 'w-[80px] text-center')}>Bật/Tắt</th>
                <th className={TH}>Mã tần suất</th>
                <th className={TH}>Tên hiển thị</th>
                <th className={TH}>Chu kỳ lặp lại</th>
                <th className={TH}>Tình trạng sử dụng</th>
                <th className={cn(TH, 'w-[80px] text-center')}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {paginatedOptions.map((option, pageIdx) => {
                const globalIndex = value.options.findIndex((o) => o.code === option.code);
                const inUse = usedCodes.has(option.code);
                const stt = startIndex + pageIdx + 1;

                return (
                  <tr
                    key={option.code}
                    className={cn('hover:bg-muted', !option.isActive && 'opacity-80')}
                  >
                    <td className={cn(TD, 'text-center text-[0.8125rem] tabular-nums text-muted-foreground')}>
                      {stt}
                    </td>
                    <td className={cn(TD, 'text-center')}>
                      <Tip content={option.isActive ? 'Tắt tần suất này' : 'Bật tần suất này'}>
                        <label className="inline-flex cursor-pointer items-center justify-center">
                          <Checkbox
                            checked={option.isActive}
                            disabled={disabled}
                            aria-label={`Bật tắt ${option.label}`}
                            onCheckedChange={(checked) => patch(globalIndex, { isActive: checked })}
                          />
                        </label>
                      </Tip>
                    </td>
                    <td className={TD}>
                      <Tip content="Mã định danh duy nhất tham chiếu trong lịch">
                        <span
                          className="inline-block rounded border border-blue-100 bg-blue-50 px-2 py-0.5 font-mono text-[0.8125rem] font-bold text-blue-800"
                        >
                          {option.code}
                        </span>
                      </Tip>
                    </td>
                    <td className={TD}>
                      <Input
                        className="h-9 rounded-md text-sm"
                        value={option.label}
                        disabled={disabled}
                        placeholder="Tên tần suất…"
                        aria-label={`Tên tần suất ${option.code}`}
                        onChange={(e) => patch(globalIndex, { label: e.target.value })}
                      />
                    </td>
                    <td className={TD}>
                      <div className="flex items-center gap-2">
                        <span className="text-[0.8125rem] text-muted-foreground">Mỗi</span>
                        <Input
                          type="number"
                          min={1}
                          className="h-9 w-[72px] rounded-md text-sm"
                          value={option.intervalCount}
                          disabled={disabled}
                          aria-label={`Số kỳ của ${option.label}`}
                          onChange={(e) =>
                            patch(globalIndex, {
                              intervalCount: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                        />
                        <div
                          role="group"
                          aria-label={`Đơn vị chu kỳ của ${option.label}`}
                          className="w-[120px]"
                        >
                          <SearchableSelect className={SELECT_CLASS}
                            height={36}
                            searchInDropdown
                            hideDropdownSearch
                            clearable={false}
                            disabled={disabled}
                            value={option.intervalUnit}
                            options={UNIT_OPTIONS}
                            onChange={(v) =>
                              patch(globalIndex, {
                                intervalUnit: (v || option.intervalUnit) as MaintenanceFrequencyOption['intervalUnit'],
                              })
                            }
                          />
                        </div>
                      </div>
                    </td>
                    <td className={TD}>
                      {inUse ? (
                        <Tip content="Đang có lịch bảo trì sử dụng tần suất này">
                          <span
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700"
                          >
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            <span>Đang dùng</span>
                          </span>
                        </Tip>
                      ) : (
                        <Tip content="Chưa có lịch bảo trì nào liên kết với tần suất này">
                          <span
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                          >
                            <span className="size-1.5 rounded-full bg-slate-400" />
                            <span>Chưa gán</span>
                          </span>
                        </Tip>
                      )}
                    </td>
                    <td className={cn(TD, 'text-center')}>
                      <Tip
                        content={
                          inUse
                            ? 'Đang có lịch dùng tần suất này — tắt thay vì xoá, nếu không lịch đó mất cách tính ngày đến hạn.'
                            : 'Xoá tần suất khỏi danh mục'
                        }
                      >
                        <span className="inline-flex">
                          <Popconfirm
                            title={`Xoá tần suất "${option.label}"?`}
                            description={
                              inUse
                                ? 'Tần suất này đang có lịch sử dụng nên không thể xoá. Hãy chuyển trạng thái sang Tắt thay vì xoá.'
                                : 'Hành động này sẽ loại bỏ tần suất khỏi danh mục chu kỳ bảo trì.'
                            }
                            okText="Xoá"
                            cancelText="Huỷ"
                            okType="danger"
                            disabled={disabled || inUse}
                            placement="top-end"
                            onConfirm={() => {
                              setOptions(value.options.filter((o) => o.code !== option.code));
                            }}
                          >
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500"
                              disabled={disabled || inUse}
                              aria-label={`Xoá ${option.label}`}
                            >
                              <Trash2 />
                            </Button>
                          </Popconfirm>
                        </span>
                      </Tip>
                    </td>
                  </tr>
                );
              })}
              {paginatedOptions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Không tìm thấy tần suất bảo trì nào phù hợp với bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Vùng 3: chân bảng */}
        <TablePagerBar
          summary={
            <>
              Hiển thị{' '}
              <strong>
                {totalRecords > 0 ? startIndex + 1 : 0}–{endIndex}
              </strong>{' '}
              / <strong>{totalRecords}</strong> tần suất
            </>
          }
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZES}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setCurrentPage(1);
          }}
        >
          <Button
            variant="outline"
            size="lg"
            className="rounded-md px-3"
            disabled={safeCurrentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            ← Trước
          </Button>
          <span className="px-1 text-sm font-bold text-foreground">
            {safeCurrentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="lg"
            className="rounded-md px-3"
            disabled={safeCurrentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >
            Sau →
          </Button>
        </TablePagerBar>
      </div>

      {/* Minimal Popup Form Thêm Tần Suất Mới */}
      <MinimalPopupForm
        isOpen={isAddOpen}
        title="Thêm tần suất bảo trì mới"
        subtitle="Định nghĩa chu kỳ và khoảng thời gian tính hạn lặp lại cho lịch bảo trì."
        onClose={() => setIsAddOpen(false)}
      >
        <div className="flex flex-col gap-4 pb-1 pt-2">
          {addError && <p className="m-0 text-sm text-red-600">{addError}</p>}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="freq-label" className={FIELD_LABEL}>
              Tên tần suất hiển thị *
            </label>
            <Input
              id="freq-label"
              className="h-9 rounded-md text-sm"
              value={newLabel}
              placeholder="VD: Định kỳ 2 tuần, Kiểm tra quý 3…"
              autoFocus
              onChange={(e) => {
                setNewLabel(e.target.value);
                if (addError) setAddError(undefined);
              }}
            />
            <p className="m-0 text-[0.8125rem] leading-snug text-muted-foreground">
              Mã hệ thống tự sinh: <code>{toCode(newLabel) || 'tan-suat-moi'}</code>
            </p>
          </div>

          <div className="grid grid-cols-[1fr_1.5fr] gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="freq-count" className={FIELD_LABEL}>
                Số lượng kỳ *
              </label>
              <Input
                id="freq-count"
                type="number"
                min={1}
                className="h-9 rounded-md text-sm"
                value={newCount}
                onChange={(e) => setNewCount(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL} id="freq-unit-label">
                Đơn vị chu kỳ *
              </span>
              <div role="group" aria-labelledby="freq-unit-label">
                <SearchableSelect className={SELECT_CLASS}
                  height={36}
                  searchInDropdown
                  hideDropdownSearch
                  clearable={false}
                  value={newUnit}
                  options={UNIT_OPTIONS}
                  onChange={(v) =>
                    setNewUnit((v || newUnit) as MaintenanceFrequencyOption['intervalUnit'])
                  }
                />
              </div>
            </div>
          </div>

          <label className="mt-1 inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
            <Checkbox checked={newIsActive} onCheckedChange={(checked) => setNewIsActive(checked)} />
            <span>Kích hoạt tần suất ngay sau khi tạo</span>
          </label>

          <div className="mt-3 flex justify-end gap-2.5 border-t border-border pt-4">
            <Button variant="outline" size="lg" className="rounded-md px-4" onClick={() => setIsAddOpen(false)}>
              Huỷ
            </Button>
            <Button size="lg" className="rounded-md px-4" onClick={handleAddSubmit}>
              Thêm tần suất
            </Button>
          </div>
        </div>
      </MinimalPopupForm>
    </div>
  );
}
