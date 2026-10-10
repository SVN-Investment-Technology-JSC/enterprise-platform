'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  HrmCorePerson,
  InitializeHrmEmployeesRequest,
} from '@enterprise-platform/contracts-hrm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { normalizeSearchText } from '../hrm-employee-view';
import { Button } from './button';
import { Input } from './input';
import { DatePickerInput } from './date-picker-input';
import { toast } from './toast';
import { AlertCircle, ListChecks, Loader2, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './dialog';

const MAX_ITEMS = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_OPTIONS = [
  { value: 'PROBATION', label: 'Thử việc' },
  { value: 'OFFICIAL', label: 'Chính thức' },
  { value: 'ON_LEAVE', label: 'Tạm nghỉ' },
];

/** Khoá duy nhất của người ở Core: nhân sự (employee) hoặc tài khoản chưa có nhân sự (user). */
function personKey(person: HrmCorePerson): string {
  return person.source === 'employee'
    ? `employee:${person.employeeId ?? ''}`
    : `user:${person.userId ?? ''}`;
}

function toInt(text: string, fallback: number, min: number, max: number) {
  const value = Number.parseInt(text, 10);
  if (Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function BulkInitializeEmployeesDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [people, setPeople] = useState<HrmCorePerson[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [prefix, setPrefix] = useState('NV');
  const [startText, setStartText] = useState('1');
  const [widthText, setWidthText] = useState('3');
  const [joinDate, setJoinDate] = useState('');
  const [status, setStatus] = useState('OFFICIAL');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Mã đã sửa tay theo từng dòng: không bị sinh lại khi đổi tham số chung. */
  const [manualCodes, setManualCodes] = useState<Record<string, string>>({});
  /** Ngày vào làm đã sửa tay theo từng dòng: mặc định theo ngày chung. */
  const [rowDates, setRowDates] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [invalidKeys, setInvalidKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let active = true;
    setError('');
    setInvalidKeys(new Set());
    setPrefix('NV');
    setStartText('1');
    setWidthText('3');
    setJoinDate('');
    setStatus('OFFICIAL');
    setManualCodes({});
    setRowDates({});
    setSearch('');
    setSelected(new Set());
    setPeople([]);
    setLoadingPeople(true);
    hrmFetch<{ data: HrmCorePerson[] }>('/employees/core-people')
      .then((result) => {
        if (!active) return;
        const list = result.data ?? [];
        setPeople(list);
        setSelected(new Set(list.map(personKey)));
      })
      .catch((err) => {
        if (active)
          setError(
            err instanceof Error
              ? err.message
              : 'Không tải được danh sách nhân sự ở Core',
          );
      })
      .finally(() => {
        if (active) setLoadingPeople(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  // Mã tự sinh theo thứ tự của các dòng được chọn (tiền tố + số tăng dần, đệm 0)
  const autoCodes = useMemo(() => {
    const start = toInt(startText, 1, 0, 999999999);
    const width = toInt(widthText, 3, 1, 10);
    const map: Record<string, string> = {};
    let index = 0;
    for (const person of people) {
      const key = personKey(person);
      if (!selected.has(key)) continue;
      map[key] = `${prefix.trim()}${String(start + index).padStart(width, '0')}`;
      index += 1;
    }
    return map;
  }, [people, selected, prefix, startText, widthText]);

  const codeOf = (key: string) => manualCodes[key] ?? autoCodes[key] ?? '';
  const dateOf = (key: string) => rowDates[key] ?? joinDate;

  const visiblePeople = useMemo(() => {
    const needle = normalizeSearchText(search);
    if (!needle) return people;
    return people.filter((person) =>
      normalizeSearchText(`${person.fullName} ${person.email ?? ''}`).includes(
        needle,
      ),
    );
  }, [people, search]);

  const allVisibleSelected =
    visiblePeople.length > 0 &&
    visiblePeople.every((person) => selected.has(personKey(person)));

  const toggleAllVisible = () => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const person of visiblePeople) {
        if (allVisibleSelected) next.delete(personKey(person));
        else next.add(personKey(person));
      }
      return next;
    });
  };

  const toggleOne = (key: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const noPeople = !loadingPeople && !error && people.length === 0;
  const selectedCount = selected.size;

  const submit = async () => {
    if (saving) return;
    const chosen = people.filter((person) => selected.has(personKey(person)));
    if (chosen.length === 0) {
      setInvalidKeys(new Set());
      setError('Vui lòng chọn ít nhất một người.');
      return;
    }
    if (chosen.length > MAX_ITEMS) {
      setInvalidKeys(new Set());
      setError(`Mỗi lần chỉ khởi tạo tối đa ${MAX_ITEMS} người.`);
      return;
    }
    if (!ISO_DATE.test(joinDate)) {
      setInvalidKeys(new Set());
      setError('Vui lòng nhập ngày vào làm chung.');
      return;
    }
    const badKeys = new Set<string>();
    const seen = new Map<string, string>();
    const messages: string[] = [];
    for (const person of chosen) {
      const key = personKey(person);
      const code = codeOf(key).trim();
      if (!code) {
        badKeys.add(key);
        messages.push(`Mã nhân viên của ${person.fullName} đang để trống.`);
        continue;
      }
      const owner = seen.get(code);
      if (owner !== undefined) {
        badKeys.add(key);
        badKeys.add(owner);
        messages.push(`Mã ${code} bị trùng trong danh sách.`);
      } else {
        seen.set(code, key);
      }
      if (!ISO_DATE.test(dateOf(key))) {
        badKeys.add(key);
        messages.push(`Ngày vào làm của ${person.fullName} chưa hợp lệ.`);
      }
    }
    if (messages.length > 0) {
      setInvalidKeys(badKeys);
      const shown = messages.slice(0, 3).join(' ');
      setError(
        messages.length > 3
          ? `${shown} (và ${messages.length - 3} lỗi khác)`
          : shown,
      );
      return;
    }
    const body: InitializeHrmEmployeesRequest = {
      items: chosen.map((person) => {
        const key = personKey(person);
        return {
          employeeCode: codeOf(key).trim(),
          joinDate: dateOf(key),
          employmentStatus: status as 'PROBATION' | 'OFFICIAL' | 'ON_LEAVE',
          ...(person.source === 'employee'
            ? { employeeId: person.employeeId ?? undefined }
            : { userId: person.userId ?? undefined }),
        };
      }),
    };
    setSaving(true);
    setError('');
    setInvalidKeys(new Set());
    try {
      const result = await hrmFetch<{
        data: { created: number; employeeIds: string[] };
      }>('/employees/initialize-bulk', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      toast.success({
        title: 'Đã khởi tạo hồ sơ HRM',
        description: `Đã khởi tạo ${result.data?.created ?? chosen.length} hồ sơ từ Core.`,
      });
      try {
        await onDone();
      } catch {
        // Hồ sơ đã tạo xong; lỗi tải lại danh sách không chặn việc đóng hộp thoại.
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Không khởi tạo được hồ sơ hàng loạt',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !saving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[960px] max-h-[90vh] p-0 flex flex-col overflow-hidden bg-white shadow-2xl rounded-xl">
        <DialogHeader className="shrink-0 p-5 border-b border-slate-200 bg-slate-50/80 flex flex-row items-start gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5 border border-blue-100">
            <ListChecks className="size-5" />
          </div>
          <div className="space-y-1">
            <DialogTitle className="text-base font-bold text-slate-900">
              Nạp nhân sự từ Core
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 leading-relaxed">
              Tạo hồ sơ HRM cho nhiều người đã khai báo ở Core trong một lần.
              Họ tên, email lấy từ Core; mã nhân viên và ngày vào làm có thể
              chỉnh từng dòng.
            </DialogDescription>
          </div>
        </DialogHeader>
        <form
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 text-xs">
            {noPeople ? (
              <div
                role="status"
                className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-xs leading-relaxed"
              >
                Mọi người đã khai báo ở Core đều đã có hồ sơ HRM. Thêm người mới
                tại Core, mục{' '}
                <a
                  href="/users"
                  className="font-semibold text-blue-600 hover:underline"
                >
                  Người dùng
                </a>
                .
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="bulk-employee-prefix"
                      className="font-semibold text-slate-700 block text-xs"
                    >
                      Tiền tố mã nhân viên
                    </label>
                    <Input
                      id="bulk-employee-prefix"
                      aria-label="Tiền tố mã nhân viên"
                      value={prefix}
                      maxLength={20}
                      autoComplete="off"
                      className="text-xs h-9"
                      onChange={(event) => setPrefix(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="bulk-employee-start"
                      className="font-semibold text-slate-700 block text-xs"
                    >
                      Số bắt đầu
                    </label>
                    <Input
                      id="bulk-employee-start"
                      aria-label="Số bắt đầu"
                      type="number"
                      min={0}
                      value={startText}
                      className="text-xs h-9"
                      onChange={(event) => setStartText(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="bulk-employee-width"
                      className="font-semibold text-slate-700 block text-xs"
                    >
                      Độ rộng số
                    </label>
                    <Input
                      id="bulk-employee-width"
                      aria-label="Độ rộng số"
                      type="number"
                      min={1}
                      max={10}
                      value={widthText}
                      className="text-xs h-9"
                      onChange={(event) => setWidthText(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-semibold text-slate-700 text-xs">
                      Ngày vào làm chung <span className="text-rose-500">*</span>
                    </p>
                    <DatePickerInput
                      aria-label="Ngày vào làm chung"
                      value={joinDate}
                      onChange={setJoinDate}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-semibold text-slate-700 text-xs">
                      Trạng thái chung
                    </p>
                    <SearchableSelect
                      value={status}
                      onChange={(value) => setStatus(value || 'OFFICIAL')}
                      clearable={false}
                      options={STATUS_OPTIONS}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
                    <Input
                      aria-label="Tìm theo tên hoặc email"
                      placeholder="Tìm theo tên hoặc email"
                      value={search}
                      autoComplete="off"
                      className="text-xs h-9 pl-8"
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      data-testid="bulk-selected-count"
                      className="text-xs font-medium text-slate-600"
                    >
                      Đã chọn {selectedCount} / {people.length}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={visiblePeople.length === 0}
                      onClick={toggleAllVisible}
                      className="text-xs h-8"
                    >
                      {allVisibleSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </Button>
                  </div>
                </div>

                <div className="max-h-[42vh] overflow-auto rounded-lg border border-slate-200">
                  {loadingPeople ? (
                    <div className="p-6 flex items-center justify-center gap-2 text-slate-500">
                      <Loader2 className="size-4 animate-spin" />
                      <span>Đang tải danh sách…</span>
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600">
                        <tr className="border-b border-slate-200 text-left">
                          <th className="w-10 px-3 py-2 font-semibold" />
                          <th className="px-3 py-2 font-semibold">
                            Họ tên · Email
                          </th>
                          <th className="w-44 px-3 py-2 font-semibold">
                            Mã nhân viên
                          </th>
                          <th className="w-44 px-3 py-2 font-semibold">
                            Ngày vào làm
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiblePeople.map((person) => {
                          const key = personKey(person);
                          const isSelected = selected.has(key);
                          const bad = invalidKeys.has(key);
                          return (
                            <tr
                              key={key}
                              className={`border-b border-slate-100 last:border-b-0 ${
                                bad ? 'bg-rose-50/60' : ''
                              } ${isSelected ? '' : 'text-slate-400'}`}
                            >
                              <td className="px-3 py-1.5">
                                <input
                                  type="checkbox"
                                  aria-label={`Chọn ${person.fullName}`}
                                  checked={isSelected}
                                  onChange={() => toggleOne(key)}
                                  className="size-3.5 accent-blue-600"
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <p className="font-semibold text-slate-800">
                                  {person.fullName}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {person.email || 'Chưa có email'}
                                </p>
                              </td>
                              <td className="px-3 py-1.5">
                                <Input
                                  aria-label={`Mã nhân viên của ${person.fullName}`}
                                  value={codeOf(key)}
                                  disabled={!isSelected}
                                  maxLength={50}
                                  autoComplete="off"
                                  aria-invalid={bad || undefined}
                                  className={`text-xs h-8 font-mono ${
                                    bad ? 'border-rose-400' : ''
                                  }`}
                                  onChange={(event) =>
                                    setManualCodes((previous) => ({
                                      ...previous,
                                      [key]: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <DatePickerInput
                                  aria-label={`Ngày vào làm của ${person.fullName}`}
                                  value={dateOf(key)}
                                  disabled={!isSelected}
                                  onChange={(value) =>
                                    setRowDates((previous) => {
                                      const next = { ...previous };
                                      // Trùng ngày chung thì coi như chưa sửa tay
                                      if (value === joinDate) delete next[key];
                                      else next[key] = value;
                                      return next;
                                    })
                                  }
                                />
                              </td>
                            </tr>
                          );
                        })}
                        {visiblePeople.length === 0 && (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-3 py-6 text-center text-slate-500"
                            >
                              Không có người nào khớp.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
            {error && (
              <div
                role="alert"
                className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center gap-2"
              >
                <AlertCircle className="size-4 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}
          </div>
          <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
              className="text-xs h-8"
            >
              Hủy bỏ
            </Button>
            <Button
              type="submit"
              disabled={saving || noPeople || loadingPeople}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 font-semibold shadow-xs flex items-center gap-1.5"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {saving
                ? 'Đang khởi tạo…'
                : `Khởi tạo ${selectedCount} hồ sơ`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
