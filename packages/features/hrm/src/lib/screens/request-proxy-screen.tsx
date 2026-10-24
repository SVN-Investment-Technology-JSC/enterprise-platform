'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmEmployeeOptions, hrmFetch } from '../hrm-api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { PageTitle } from '../ui/page-title';
import { InfoNote } from '../ui/settings-kit';
import { toast } from '../ui/toast';

export type ProxyScopeType = 'SUBORDINATES' | 'SAME_UNIT' | 'UNIT_LIST' | 'EMPLOYEE_LIST' | 'ALL';
export type ProxyRuleKind = 'leave' | 'ot' | 'business_trip' | 'correction';

export interface ProxyRuleView {
  id: string;
  name: string;
  granteeUserId: string | null;
  granteeEmployeeId: string | null;
  granteeName: string | null;
  requestKinds: ProxyRuleKind[];
  scopeType: ProxyScopeType;
  unitIds: string[];
  employeeIds: string[];
  active: boolean;
}

interface UnitOption {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
}

export const KIND_LABEL: Record<ProxyRuleKind, string> = { leave: 'Nghỉ phép', ot: 'Tăng ca', business_trip: 'Công tác', correction: 'Giải trình công' };
export const SCOPE_LABEL: Record<ProxyScopeType, string> = {
  SUBORDINATES: 'Cấp dưới theo sơ đồ tổ chức',
  SAME_UNIT: 'Cùng đơn vị với người tạo hộ',
  UNIT_LIST: 'Các đơn vị chỉ định (gồm đơn vị con)',
  EMPLOYEE_LIST: 'Nhân viên chỉ định',
  ALL: 'Toàn bộ nhân viên',
};

interface Draft {
  id: string | null;
  name: string;
  granteeEmployeeId: string;
  requestKinds: ProxyRuleKind[];
  scopeType: ProxyScopeType;
  unitIds: string[];
  employeeIds: string[];
  active: boolean;
}

const emptyDraft = (): Draft => ({
  id: null,
  name: '',
  granteeEmployeeId: '',
  requestKinds: ['leave', 'ot', 'business_trip', 'correction'],
  scopeType: 'SUBORDINATES',
  unitIds: [],
  employeeIds: [],
  active: true,
});

/** Thông báo lỗi của bản nháp cấu hình, hoặc null khi hợp lệ. */
export function proxyDraftError(draft: Draft): string | null {
  if (!draft.name.trim()) return 'Nhập tên cấu hình';
  if (!draft.requestKinds.length) return 'Chọn ít nhất một loại đơn';
  if (draft.scopeType === 'UNIT_LIST' && !draft.unitIds.length) return 'Chọn ít nhất một đơn vị';
  if (draft.scopeType === 'EMPLOYEE_LIST' && !draft.employeeIds.length) return 'Chọn ít nhất một nhân viên';
  return null;
}

/** Mô tả ngắn phạm vi của một cấu hình (để hiện trên bảng). */
export function describeScope(rule: ProxyRuleView, units: readonly UnitOption[], employees: ReadonlyMap<string, string>): string {
  if (rule.scopeType === 'UNIT_LIST')
    return `${SCOPE_LABEL.UNIT_LIST}: ${rule.unitIds.map((id) => units.find((u) => u.id === id)?.name ?? id).join(', ')}`;
  if (rule.scopeType === 'EMPLOYEE_LIST')
    return `${SCOPE_LABEL.EMPLOYEE_LIST}: ${rule.employeeIds.map((id) => employees.get(id) ?? id).join(', ')}`;
  return SCOPE_LABEL[rule.scopeType];
}

function Chips({ items, onRemove }: { items: { value: string; label: string }[]; onRemove: (value: string) => void }) {
  if (!items.length) return <p className="text-xs text-slate-400">Chưa chọn.</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item.value} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {item.label}
          <button type="button" aria-label={`Bỏ ${item.label}`} className="text-slate-400 hover:text-slate-700" onClick={() => onRemove(item.value)}>
            <X className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Cấu hình phạm vi tạo đơn hộ (nghỉ phép, tăng ca, công tác): ai được tạo hộ cho ai. Người có quyền tạo hộ mà chưa có
 * cấu hình nào áp thì chỉ tạo hộ cho cấp dưới theo sơ đồ tổ chức; người có quyền "toàn tenant" không bị giới hạn.
 */
export default function RequestProxyScreen() {
  const [rules, setRules] = useState<ProxyRuleView[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [employees, setEmployees] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hrmFetch<{ data: ProxyRuleView[]; units: UnitOption[] }>('/request-proxy/rules');
      setRules(res.data);
      setUnits(res.units);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được cấu hình tạo đơn hộ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void hrmEmployeeOptions()
      .then((list) => setEmployees(list.map((e) => ({ value: e.value, label: e.label }))))
      .catch(() => setEmployees([]));
  }, [load]);

  const employeeNames = useMemo(() => new Map(employees.map((e) => [e.value, e.label])), [employees]);
  const unitOptions = useMemo(() => units.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` })), [units]);
  const problem = draft ? proxyDraftError(draft) : null;

  async function save() {
    if (!draft || problem) return;
    setBusy(true);
    try {
      await hrmFetch(draft.id ? `/request-proxy/rules/${draft.id}` : '/request-proxy/rules', {
        method: draft.id ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          granteeEmployeeId: draft.granteeEmployeeId || null,
          requestKinds: draft.requestKinds,
          scopeType: draft.scopeType,
          unitIds: draft.unitIds,
          employeeIds: draft.employeeIds,
          active: draft.active,
        }),
      });
      toast.success('Đã lưu cấu hình tạo đơn hộ');
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Không lưu được cấu hình');
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: ProxyRuleView) {
    try {
      await hrmFetch(`/request-proxy/rules/${rule.id}`, { method: 'DELETE' });
      toast.success('Đã xóa cấu hình');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Không xóa được cấu hình');
    }
  }

  const edit = (rule: ProxyRuleView) =>
    setDraft({
      id: rule.id,
      name: rule.name,
      granteeEmployeeId: rule.granteeEmployeeId ?? '',
      requestKinds: rule.requestKinds,
      scopeType: rule.scopeType,
      unitIds: rule.unitIds,
      employeeIds: rule.employeeIds,
      active: rule.active,
    });

  return (
    <div className="space-y-4" data-testid="request-proxy">
      <PageTitle
        title="Tạo đơn hộ"
        description="Quy định ai được tạo hộ nghỉ phép, tăng ca, công tác cho nhân viên nào."
        actions={
          <Button size="sm" className="gap-1" onClick={() => setDraft(emptyDraft())}>
            <Plus className="size-3.5" />
            Thêm cấu hình
          </Button>
        }
      />
      <InfoNote>
        Người cần được cấp quyền <b>Tạo đơn hộ</b> ở màn Quyền và vai trò. Chưa có cấu hình nào áp cho một người thì họ chỉ tạo
        hộ cho cấp dưới theo sơ đồ tổ chức. Nhiều cấu hình cùng áp thì lấy hợp các phạm vi. Người tạo hộ không duyệt được đơn do
        chính mình tạo hộ.
      </InfoNote>
      {error ? (
        <InfoNote tone="red" role="alert">
          {error}{' '}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Tải lại
          </button>
        </InfoNote>
      ) : null}

      <section aria-label="Cấu hình tạo đơn hộ" className="rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
              <th className="px-4 py-2">Tên</th>
              <th className="px-4 py-2">Áp cho</th>
              <th className="px-4 py-2">Loại đơn</th>
              <th className="px-4 py-2">Phạm vi nhân viên</th>
              <th className="w-28 px-4 py-2">Trạng thái</th>
              <th className="w-24 px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b border-slate-100 align-top last:border-0">
                <td className="px-4 py-2 font-medium text-slate-900">{rule.name}</td>
                <td className="px-4 py-2 text-slate-700">{rule.granteeName ?? 'Mọi người có quyền tạo hộ'}</td>
                <td className="px-4 py-2 text-slate-700">{rule.requestKinds.map((k) => KIND_LABEL[k]).join(', ')}</td>
                <td className="px-4 py-2 text-slate-700">{describeScope(rule, units, employeeNames)}</td>
                <td className="px-4 py-2">
                  <Badge variant="outline" className={rule.active ? 'border-emerald-200 text-emerald-700' : 'text-slate-500'}>
                    {rule.active ? 'Đang áp dụng' : 'Tạm tắt'}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={`Sửa ${rule.name}`} onClick={() => edit(rule)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Popconfirm
                      title="Xóa cấu hình này?"
                      description="Người dùng đang dùng cấu hình này sẽ quay về phạm vi mặc định (cấp dưới)."
                      okText="Xóa"
                      cancelText="Quay lại"
                      onConfirm={() => remove(rule)}
                    >
                      <Button variant="ghost" size="icon-sm" aria-label={`Xóa ${rule.name}`}>
                        <Trash2 className="size-3.5 text-rose-600" />
                      </Button>
                    </Popconfirm>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && !rules.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-xs text-slate-500">
                  Chưa có cấu hình nào: mọi người có quyền tạo hộ chỉ tạo hộ cho cấp dưới.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-w-xl bg-white p-0">
          {draft ? (
            <div className="flex flex-col">
              <DialogHeader className="border-b border-slate-200 bg-slate-50 p-5">
                <DialogTitle className="text-base font-bold">{draft.id ? 'Sửa cấu hình tạo hộ' : 'Thêm cấu hình tạo hộ'}</DialogTitle>
                <DialogDescription className="text-xs text-slate-500">Chọn người được tạo hộ, loại đơn và phạm vi nhân viên.</DialogDescription>
              </DialogHeader>
              <div className="max-h-[65vh] space-y-4 overflow-y-auto p-5 text-xs">
                <div className="space-y-1">
                  <span className="font-semibold text-slate-700">Tên cấu hình</span>
                  <Input aria-label="Tên cấu hình" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <span className="font-semibold text-slate-700">Áp cho</span>
                  <SearchableSelect
                    height={36}
                    options={employees}
                    value={draft.granteeEmployeeId}
                    onChange={(v) => setDraft({ ...draft, granteeEmployeeId: v || '' })}
                    placeholder="Mọi người có quyền tạo hộ"
                    emptyText="Không tìm thấy nhân viên"
                  />
                </div>
                <fieldset className="space-y-1">
                  <legend className="font-semibold text-slate-700">Loại đơn</legend>
                  <div className="flex flex-wrap gap-4">
                    {(Object.keys(KIND_LABEL) as ProxyRuleKind[]).map((kind) => (
                      <label key={kind} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={draft.requestKinds.includes(kind)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              requestKinds: e.target.checked ? [...draft.requestKinds, kind] : draft.requestKinds.filter((k) => k !== kind),
                            })
                          }
                        />
                        {KIND_LABEL[kind]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="space-y-1">
                  <span className="font-semibold text-slate-700">Phạm vi nhân viên</span>
                  <SearchableSelect
                    height={36}
                    options={(Object.keys(SCOPE_LABEL) as ProxyScopeType[]).map((s) => ({ value: s, label: SCOPE_LABEL[s] }))}
                    value={draft.scopeType}
                    onChange={(v) => v && setDraft({ ...draft, scopeType: v as ProxyScopeType })}
                    clearable={false}
                  />
                </div>
                {draft.scopeType === 'UNIT_LIST' ? (
                  <div className="space-y-2">
                    <SearchableSelect
                      height={32}
                      options={unitOptions.filter((o) => !draft.unitIds.includes(o.value))}
                      value=""
                      placeholder="Thêm đơn vị theo tên hoặc mã…"
                      emptyText="Không tìm thấy đơn vị"
                      onChange={(id) => id && setDraft({ ...draft, unitIds: [...draft.unitIds, id] })}
                      clearable={false}
                    />
                    <Chips
                      items={draft.unitIds.map((id) => ({ value: id, label: unitOptions.find((o) => o.value === id)?.label ?? id }))}
                      onRemove={(id) => setDraft({ ...draft, unitIds: draft.unitIds.filter((x) => x !== id) })}
                    />
                  </div>
                ) : null}
                {draft.scopeType === 'EMPLOYEE_LIST' ? (
                  <div className="space-y-2">
                    <SearchableSelect
                      height={32}
                      options={employees.filter((o) => !draft.employeeIds.includes(o.value))}
                      value=""
                      placeholder="Thêm nhân viên theo tên hoặc mã…"
                      emptyText="Không tìm thấy nhân viên"
                      onChange={(id) => id && setDraft({ ...draft, employeeIds: [...draft.employeeIds, id] })}
                      clearable={false}
                    />
                    <Chips
                      items={draft.employeeIds.map((id) => ({ value: id, label: employeeNames.get(id) ?? id }))}
                      onRemove={(id) => setDraft({ ...draft, employeeIds: draft.employeeIds.filter((x) => x !== id) })}
                    />
                  </div>
                ) : null}
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                  Đang áp dụng
                </label>
                {problem ? (
                  <p role="alert" className="text-xs font-semibold text-red-700">
                    {problem}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
                <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
                  Hủy
                </Button>
                <Button size="sm" disabled={busy || Boolean(problem)} onClick={() => void save()}>
                  Lưu cấu hình
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
