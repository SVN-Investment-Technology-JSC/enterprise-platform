'use client';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Info,
  RotateCcw,
  Save,
} from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  ApprovalRouteConfigItem,
  ApprovalRouteConfigResult,
  SetApprovalRoutePayload,
} from '@enterprise-platform/contracts-hrm';
import { HrmApiError, hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { toast } from '../ui/toast';

/** Lựa chọn cách duyệt của một dòng. INHERIT chỉ có ở dòng theo lý do: bỏ cấu hình riêng, theo cấu hình chung của loại đơn. */
export type RouteChoice = 'INHERIT' | 'DIRECT' | 'PROCEDURE';

/** Thay đổi chưa lưu của một dòng. */
export interface RouteDraft {
  choice: RouteChoice;
  /** Id quy trình đã công bố; chỉ dùng khi `choice` là PROCEDURE. */
  procedureId: string;
}

interface ProcedureDefinitionOption {
  id: string;
  code: string;
  name: string;
}

interface ApprovalGroup {
  /** Dòng chính của loại đơn (cấu hình chung). */
  general: ApprovalRouteConfigItem;
  /** Các dòng con theo từng lý do (rỗng với ứng lương, đính chính hồ sơ). */
  reasons: ApprovalRouteConfigItem[];
}

const CHOICE_LABELS: Record<RouteChoice, string> = {
  INHERIT: 'Theo cấu hình chung',
  DIRECT: 'Quản lý trực tiếp',
  PROCEDURE: 'Theo quy trình',
};

/** Khóa duy nhất của một dòng: loại đơn và mã lý do (rỗng với dòng chung). */
export const routeKey = (item: ApprovalRouteConfigItem) =>
  `${item.requestKind}:${item.reasonCode ?? ''}`;

/** Dòng theo lý do (dòng con), khác dòng chung của loại đơn. */
export const isReasonRow = (item: ApprovalRouteConfigItem) =>
  Boolean(item.reasonCode);

/** Cách duyệt đang lưu trên server của một dòng. */
export function savedRoute(item: ApprovalRouteConfigItem): RouteDraft {
  const choice: RouteChoice =
    isReasonRow(item) && item.inherited ? 'INHERIT' : item.mode;
  return {
    choice,
    procedureId:
      choice === 'PROCEDURE' ? (item.procedureDefinitionId ?? '') : '',
  };
}

/** Bản nháp khác với cấu hình đang lưu. */
export function isRouteDirty(
  item: ApprovalRouteConfigItem,
  draft: RouteDraft,
): boolean {
  const saved = savedRoute(item);
  return (
    draft.choice !== saved.choice ||
    (draft.choice === 'PROCEDURE' && draft.procedureId !== saved.procedureId)
  );
}

/** Theo quy trình mà chưa chọn quy trình thì chưa lưu được. */
export const isRouteSaveable = (draft: RouteDraft) =>
  draft.choice !== 'PROCEDURE' || draft.procedureId !== '';

/** Body của PUT /approval-config; chặn PROCEDURE khi chưa chọn quy trình. */
export function routePayload(
  item: ApprovalRouteConfigItem,
  draft: RouteDraft,
): SetApprovalRoutePayload {
  if (!isRouteSaveable(draft))
    throw new Error('Chọn quy trình trước khi lưu cách duyệt Theo quy trình.');
  return {
    requestKind: item.requestKind,
    ...(item.reasonCode ? { reasonCode: item.reasonCode } : {}),
    mode: draft.choice,
    ...(draft.choice === 'PROCEDURE'
      ? { procedureDefinitionId: draft.procedureId }
      : {}),
  };
}

/** Gom dòng chính của từng loại đơn cùng các dòng lý do của nó, giữ thứ tự server trả về. */
export function groupApprovalItems(
  items: readonly ApprovalRouteConfigItem[],
): ApprovalGroup[] {
  const groups: ApprovalGroup[] = [];
  for (const item of items) {
    if (!isReasonRow(item)) {
      groups.push({ general: item, reasons: [] });
      continue;
    }
    groups
      .find((g) => g.general.requestKind === item.requestKind)
      ?.reasons.push(item);
  }
  return groups;
}

/** Mô tả cách duyệt đang áp dụng của một dòng (dùng cho dòng theo cấu hình chung). */
function describeRoute(item: ApprovalRouteConfigItem): string {
  if (item.mode === 'DIRECT') return 'Quản lý trực tiếp';
  return item.procedureName
    ? `Quy trình ${item.procedureName}`
    : 'Quy trình (không đọc được tên)';
}

function procedureOptionsOf(
  item: ApprovalRouteConfigItem,
  definitions: readonly ProcedureDefinitionOption[] | null | undefined,
) {
  const options = (definitions ?? []).map((d) => ({
    value: d.id,
    label: `${d.code} · ${d.name}`,
  }));
  const current = item.procedureDefinitionId;
  // Quy trình đã gắn nhưng không còn trong danh sách đã công bố: vẫn hiện để biết đang gắn gì.
  if (current && !options.some((o) => o.value === current))
    options.unshift({
      value: current,
      label:
        item.procedureName ??
        'Quy trình đã gắn (không còn trong danh sách đã công bố)',
    });
  return options;
}

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Thao tác thất bại';

interface RowProps {
  item: ApprovalRouteConfigItem;
  draft?: RouteDraft;
  saving: boolean;
  anySaving: boolean;
  canPickProcedure: boolean;
  definitions: readonly ProcedureDefinitionOption[] | null | undefined;
  procedureAvailable: boolean;
  group?: {
    reasonCount: number;
    ownCount: number;
    collapsed: boolean;
    onToggle: () => void;
  };
  onChoice: (choice: RouteChoice) => void;
  onProcedure: (id: string) => void;
  onSave: () => void;
  onReset: () => void;
}

function RouteRow({
  item,
  draft,
  saving,
  anySaving,
  canPickProcedure,
  definitions,
  procedureAvailable,
  group,
  onChoice,
  onProcedure,
  onSave,
  onReset,
}: RowProps) {
  const reason = isReasonRow(item);
  const shown = draft ?? savedRoute(item);
  const dirty = draft !== undefined;
  const saveable = isRouteSaveable(shown);
  const choiceOptions = [
    ...(reason ? [{ value: 'INHERIT', label: CHOICE_LABELS.INHERIT }] : []),
    { value: 'DIRECT', label: CHOICE_LABELS.DIRECT },
    {
      value: 'PROCEDURE',
      label: CHOICE_LABELS.PROCEDURE,
      disabled: !canPickProcedure,
    },
  ];
  const savedProcedureBroken =
    !dirty && item.mode === 'PROCEDURE' && !procedureAvailable;

  return (
    <tr
      data-testid={`approval-row-${routeKey(item)}`}
      className={`border-b border-slate-100 align-top ${
        reason ? 'bg-white' : 'bg-slate-50/70'
      }`}
    >
      <td className="px-3 py-2.5">
        {group ? (
          <div className="flex items-start gap-1.5">
            {group.reasonCount > 0 ? (
              <button
                type="button"
                aria-expanded={!group.collapsed}
                aria-label={`${group.collapsed ? 'Mở' : 'Thu gọn'} lý do của ${item.label}`}
                onClick={group.onToggle}
                className="mt-0.5 rounded p-0.5 text-slate-500 hover:bg-slate-200"
              >
                {group.collapsed ? (
                  <ChevronRight className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </button>
            ) : (
              <span className="size-5" aria-hidden="true" />
            )}
            <div>
              <div className="text-sm font-bold text-slate-900">
                {item.label}
              </div>
              <div className="text-[11px] text-slate-500">
                {group.reasonCount === 0
                  ? 'Không có lý do riêng'
                  : `${group.reasonCount} lý do${
                      group.ownCount > 0
                        ? `, ${group.ownCount} có cấu hình riêng`
                        : ''
                    }`}
              </div>
            </div>
          </div>
        ) : (
          <div className="pl-9">
            <div className="text-xs font-semibold text-slate-800">
              {item.reasonName ?? item.reasonCode}
            </div>
            <div className="font-mono text-[11px] text-slate-500">
              {item.reasonCode}
            </div>
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div
          role="group"
          aria-label={`Cách duyệt của ${item.label}`}
          className="min-w-[210px]"
        >
          <SearchableSelect
            options={choiceOptions}
            value={shown.choice}
            clearable={false}
            disabled={saving}
            placeholder="Chọn cách duyệt"
            onChange={(value) => value && onChoice(value as RouteChoice)}
          />
        </div>
      </td>
      <td className="px-3 py-2.5">
        {shown.choice === 'PROCEDURE' ? (
          <div className="space-y-1">
            <div
              role="group"
              aria-label={`Quy trình của ${item.label}`}
              className="min-w-[260px]"
            >
              <SearchableSelect
                options={procedureOptionsOf(item, definitions)}
                value={shown.procedureId}
                clearable={false}
                disabled={saving || !canPickProcedure}
                placeholder="Chọn quy trình đã công bố"
                onChange={(value) => value && onProcedure(value)}
              />
            </div>
            {!saveable && (
              <p className="text-[11px] font-medium text-amber-700">
                Chọn quy trình để lưu.
              </p>
            )}
          </div>
        ) : shown.choice === 'INHERIT' ? (
          <span className="text-xs text-slate-600">
            Đang theo cấu hình chung:{' '}
            <strong className="font-semibold text-slate-800">
              {describeRoute(item)}
            </strong>
          </span>
        ) : (
          <span className="text-xs text-slate-600">
            Quản lý trực tiếp của người làm đơn duyệt
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          {reason && !dirty && item.inherited && (
            <Badge className="border-slate-200 bg-slate-100 text-slate-600">
              Theo cấu hình chung
            </Badge>
          )}
          {item.conflict && (
            <Badge
              title="Có nhiều cấu hình mâu thuẫn; gửi đơn bị chặn cho tới khi chọn lại cách duyệt và lưu."
              className="border-red-200 bg-red-50 text-red-700"
            >
              Cấu hình mâu thuẫn
            </Badge>
          )}
          {savedProcedureBroken && (
            <Badge
              title="Procedure không khả dụng nên đơn theo quy trình không gửi được; chuyển về Quản lý trực tiếp."
              className="border-amber-200 bg-amber-50 text-amber-700"
            >
              Procedure không khả dụng
            </Badge>
          )}
          {dirty && (
            <Badge className="border-blue-200 bg-blue-50 text-blue-700">
              Chưa lưu
            </Badge>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5">
        {dirty && (
          <div className="flex gap-1.5">
            <Button
              size="xs"
              disabled={saving || anySaving || !saveable}
              onClick={onSave}
              aria-label={`Lưu cách duyệt của ${item.label}`}
              title={saveable ? undefined : 'Chọn quy trình trước khi lưu'}
              className="h-7 gap-1 bg-blue-600 px-2 text-xs text-white hover:bg-blue-700"
            >
              <Save className="size-3" />
              {saving ? 'Đang lưu...' : 'Lưu'}
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={saving}
              onClick={onReset}
              aria-label={`Hoàn tác thay đổi của ${item.label}`}
              className="h-7 gap-1 px-2 text-xs"
            >
              <RotateCcw className="size-3" />
              Hoàn tác
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Cấu hình cách duyệt đơn: theo từng loại đơn và có thể riêng cho từng lý do.
 * Hai cách: Quản lý trực tiếp (mặc định) hoặc Theo quy trình (Procedure Engine). Đổi lựa chọn xong bấm Lưu ở dòng đó.
 */
export default function ApprovalConfigScreen() {
  const { can, loading: permissionsLoading } = useHrmPermissions();
  const canManage = can('hrm.automation.manage');
  const [config, setConfig] = useState<ApprovalRouteConfigResult | null>(null);
  /** undefined: đang tải; null: không tải được; mảng: danh sách quy trình đã công bố. */
  const [definitions, setDefinitions] = useState<
    ProcedureDefinitionOption[] | null | undefined
  >(undefined);
  const [definitionsError, setDefinitionsError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, RouteDraft>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<readonly string[]>([]);

  const load = useCallback(async () => {
    const result = await hrmFetch<{ data: ApprovalRouteConfigResult }>(
      '/approval-config',
    );
    setConfig(result.data);
  }, []);

  // Phụ thuộc giá trị boolean: hàm can() đổi danh tính mỗi lần render sẽ gây tải lặp vô hạn.
  useEffect(() => {
    if (!canManage) return;
    void load().catch((e) => setError(errorText(e)));
  }, [canManage, load]);

  const procedureAvailable = config?.procedureAvailable;
  useEffect(() => {
    if (!canManage || procedureAvailable !== true) return;
    let cancelled = false;
    hrmFetch<{ data: ProcedureDefinitionOption[] }>(
      '/operations/procedure-definitions',
    )
      .then((result) => {
        if (cancelled) return;
        setDefinitions(result.data);
        setDefinitionsError('');
      })
      .catch((e) => {
        if (cancelled) return;
        setDefinitions(null);
        setDefinitionsError(
          e instanceof HrmApiError && e.status === 403
            ? 'Tài khoản chưa có quyền xem danh sách quy trình (quyền cấu hình kết nối và theo dõi tích hợp).'
            : errorText(e),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, procedureAvailable]);

  const groups = useMemo(
    () => groupApprovalItems(config?.items ?? []),
    [config],
  );
  const conflictCount = (config?.items ?? []).filter((i) => i.conflict).length;
  const canPickProcedure =
    procedureAvailable === true && Array.isArray(definitions);

  function setDraft(item: ApprovalRouteConfigItem, draft: RouteDraft) {
    const key = routeKey(item);
    setDrafts((current) => {
      const next = { ...current };
      if (isRouteDirty(item, draft)) next[key] = draft;
      else delete next[key];
      return next;
    });
  }

  function changeChoice(item: ApprovalRouteConfigItem, choice: RouteChoice) {
    setDraft(item, {
      choice,
      procedureId:
        choice === 'PROCEDURE' ? (item.procedureDefinitionId ?? '') : '',
    });
  }

  function changeProcedure(item: ApprovalRouteConfigItem, procedureId: string) {
    setDraft(item, { choice: 'PROCEDURE', procedureId });
  }

  function reset(item: ApprovalRouteConfigItem) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[routeKey(item)];
      return next;
    });
  }

  async function save(item: ApprovalRouteConfigItem) {
    const key = routeKey(item);
    const draft = drafts[key];
    if (!draft) return;
    setError('');
    setSavingKey(key);
    try {
      const result = await hrmFetch<{ data: ApprovalRouteConfigResult }>(
        '/approval-config',
        { method: 'PUT', body: JSON.stringify(routePayload(item, draft)) },
      );
      setConfig(result.data);
      setWarnings(result.data.warnings ?? []);
      reset(item);
      toast.success(`Đã lưu cách duyệt: ${item.label}`);
    } catch (e) {
      setError(errorText(e));
      toast.error(errorText(e));
    } finally {
      setSavingKey('');
    }
  }

  function toggleGroup(kind: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  if (!permissionsLoading && !canManage) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-[1600px] rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500"
      >
        Bạn không có quyền cấu hình cách duyệt đơn.
      </div>
    );
  }

  const groupsWithReasons = groups.filter((g) => g.reasons.length > 0);
  const allCollapsed =
    groupsWithReasons.length > 0 &&
    groupsWithReasons.every((g) => collapsed.has(g.general.requestKind));

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs xl:flex-row xl:items-center">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <GitBranch className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Duyệt đơn
            </h1>
            <p className="max-w-[85ch] text-xs text-slate-500">
              Chọn cách duyệt cho từng loại đơn và, khi cần, riêng cho từng lý
              do. Lý do không có cấu hình riêng thì theo cấu hình chung của loại
              đơn.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-700">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Info className="size-4 text-blue-600" aria-hidden="true" />
            Quản lý trực tiếp (mặc định)
          </p>
          <p>
            Đơn đi thẳng lên quản lý trực tiếp của người làm đơn, suy ra từ sơ
            đồ tổ chức. Người duyệt là quản lý trực tiếp và người có quyền duyệt
            toàn bộ.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-700">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Info className="size-4 text-blue-600" aria-hidden="true" />
            Theo quy trình
          </p>
          <p>
            Đơn khởi tạo một quy trình duyệt của Procedure Engine. Người duyệt
            do quy trình chỉ định theo từng bước. Cấu hình mới chỉ áp dụng cho
            đơn gửi sau; đơn đã gửi giữ nguyên.
          </p>
        </div>
      </div>

      {procedureAvailable === false && (
        <div
          role="alert"
          className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Procedure Engine không khả dụng: chỉ chọn được cách Quản lý trực
            tiếp. Dòng nào đang cấu hình Theo quy trình sẽ không gửi được đơn
            cho tới khi chuyển về Quản lý trực tiếp.
          </span>
        </div>
      )}
      {procedureAvailable === true && definitionsError && (
        <div
          role="alert"
          className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Không tải được danh sách quy trình nên chưa chọn được cách Theo quy
            trình. {definitionsError}
          </span>
        </div>
      )}
      {conflictCount > 0 && (
        <div
          role="alert"
          className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Có {conflictCount} dòng cấu hình mâu thuẫn. Đơn thuộc dòng đó chưa
            gửi được cho tới khi chọn lại cách duyệt và lưu.
          </span>
        </div>
      )}
      {warnings.length > 0 && (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
        >
          <p className="mb-1 font-semibold">Cảnh báo cấu hình</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"
        >
          {error}
        </div>
      )}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Cách duyệt theo loại đơn và lý do
          </span>
          {groupsWithReasons.length > 0 && (
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                setCollapsed(
                  allCollapsed
                    ? new Set()
                    : new Set(groupsWithReasons.map((g) => g.general.requestKind)),
                )
              }
              className="h-7 px-2 text-xs"
            >
              {allCollapsed ? 'Mở tất cả lý do' : 'Thu gọn tất cả lý do'}
            </Button>
          )}
        </div>

        {config === null ? (
          <p className="py-8 text-center text-xs text-slate-500">
            {error ? 'Không tải được cấu hình duyệt đơn.' : 'Đang tải cấu hình duyệt đơn...'}
          </p>
        ) : (
          <div className="max-h-[calc(100vh-460px)] min-h-[320px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[1000px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="w-[24%] px-3 py-2">
                    Loại đơn / lý do
                  </th>
                  <th scope="col" className="w-[240px] px-3 py-2">
                    Cách duyệt
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Quy trình
                  </th>
                  <th scope="col" className="w-[190px] px-3 py-2">
                    Trạng thái
                  </th>
                  <th scope="col" className="w-[170px] px-3 py-2">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const kind = group.general.requestKind;
                  const isCollapsed = collapsed.has(kind);
                  const rowProps = (item: ApprovalRouteConfigItem) => ({
                    item,
                    draft: drafts[routeKey(item)],
                    saving: savingKey === routeKey(item),
                    anySaving: savingKey !== '',
                    canPickProcedure,
                    definitions,
                    procedureAvailable: procedureAvailable !== false,
                    onChoice: (choice: RouteChoice) => changeChoice(item, choice),
                    onProcedure: (id: string) => changeProcedure(item, id),
                    onSave: () => void save(item),
                    onReset: () => reset(item),
                  });
                  return (
                    <Fragment key={kind}>
                      <RouteRow
                        {...rowProps(group.general)}
                        group={{
                          reasonCount: group.reasons.length,
                          ownCount: group.reasons.filter((r) => !r.inherited)
                            .length,
                          collapsed: isCollapsed,
                          onToggle: () => toggleGroup(kind),
                        }}
                      />
                      {!isCollapsed &&
                        group.reasons.map((item) => (
                          <RouteRow key={routeKey(item)} {...rowProps(item)} />
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
