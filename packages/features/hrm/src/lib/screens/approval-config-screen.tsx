'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Banknote,
  Briefcase,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  GitBranch,
  History,
  Pencil,
  RotateCcw,
  Save,
  type LucideIcon,
} from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  ApprovalRouteConfigItem,
  ApprovalRouteConfigResult,
  HrmRequestKind,
  SetApprovalRoutePayload,
} from '@enterprise-platform/contracts-hrm';
import { HrmApiError, hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from '../ui/button';
import { ApprovalPolicyCard } from '../ui/approval-policy-card';
import { ConfigHistoryDrawer } from '../ui/config-history-drawer';
import { PageTitle } from '../ui/page-title';
import {
  IconTile,
  InfoNote,
  StatusPill,
  type KitTone,
} from '../ui/settings-kit';
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

/** Biểu tượng và màu của từng loại đơn (loại lạ dùng biểu tượng chung). */
const KIND_META: Record<string, { icon: LucideIcon; tone: KitTone }> = {
  leave: { icon: CalendarDays, tone: 'blue' },
  ot: { icon: Clock, tone: 'violet' },
  business_trip: { icon: Briefcase, tone: 'green' },
  shift_change: { icon: ArrowLeftRight, tone: 'blue' },
  correction: { icon: FileText, tone: 'amber' },
  advance: { icon: Banknote, tone: 'red' },
  profile_correction: { icon: Pencil, tone: 'blue' },
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

/**
 * Mặc định chỉ mở các loại đơn có lý do đáng chú ý (có cấu hình riêng hoặc đang mâu thuẫn);
 * lý do chỉ theo cấu hình chung thì thu gọn cho gọn.
 */
export const isGroupAutoOpen = (group: ApprovalGroup) =>
  group.reasons.some((r) => !r.inherited || r.conflict);

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

/**
 * Lưới của một dòng cấu hình: hẹp thì xếp dọc (thẻ), từ @xl tên chiếm cả hàng và hai ô chọn nằm cạnh nhau,
 * từ @3xl thành bốn cột (tên, cách duyệt, quy trình, thao tác). Dòng tiêu đề dùng đúng lưới này để thẳng cột.
 */
const ROW_GRID =
  'grid grid-cols-1 items-start gap-x-3 gap-y-2 @xl:grid-cols-2 @3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.7fr)]';

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
    open: boolean;
    /** Số lý do đang ẩn (thu gọn) có thay đổi chưa lưu hoặc mâu thuẫn. */
    hiddenDirty: number;
    hiddenConflict: number;
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
  const meta = KIND_META[item.requestKind];

  const nameBlock = group ? (
    <>
      <IconTile icon={meta?.icon ?? GitBranch} tone={meta?.tone ?? 'slate'} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-slate-900">
          {item.label}
        </span>
        <span className="block text-[11px] text-slate-500">
          {group.reasonCount === 0
            ? 'Không có lý do riêng'
            : `${group.reasonCount} lý do${
                group.ownCount > 0
                  ? `, ${group.ownCount} có cấu hình riêng`
                  : ''
              }`}
        </span>
      </span>
    </>
  ) : (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-xs font-semibold text-slate-800">
        {item.reasonName ?? item.reasonCode}
      </span>
      <span className="block font-mono text-[11px] text-slate-500">
        {item.reasonCode}
      </span>
    </span>
  );

  const pills = (
    <>
      {reason && !dirty && item.inherited && (
        <StatusPill tone="slate">Theo cấu hình chung</StatusPill>
      )}
      {item.conflict && (
        <span title="Có nhiều cấu hình mâu thuẫn; gửi đơn bị chặn cho tới khi chọn lại cách duyệt và lưu.">
          <StatusPill tone="red">Cấu hình mâu thuẫn</StatusPill>
        </span>
      )}
      {savedProcedureBroken && (
        <span title="Procedure không khả dụng nên đơn theo quy trình không gửi được; chuyển về Quản lý trực tiếp.">
          <StatusPill tone="amber">Procedure không khả dụng</StatusPill>
        </span>
      )}
      {dirty && <StatusPill tone="blue">Chưa lưu</StatusPill>}
      {group && group.hiddenDirty > 0 && (
        <StatusPill tone="blue">{group.hiddenDirty} lý do chưa lưu</StatusPill>
      )}
      {group && group.hiddenConflict > 0 && (
        <StatusPill tone="red">{group.hiddenConflict} lý do mâu thuẫn</StatusPill>
      )}
    </>
  );

  return (
    <div
      data-testid={`approval-row-${routeKey(item)}`}
      className={`${ROW_GRID} px-3 py-3 @xl:px-4 ${
        reason ? 'bg-white' : 'bg-slate-50/70'
      }`}
    >
      <div className="min-w-0 @xl:col-span-2 @3xl:col-span-1">
        <div className={reason ? 'pl-3 @3xl:pl-10' : ''}>
          {group && group.reasonCount > 0 ? (
            <button
              type="button"
              aria-expanded={group.open}
              aria-label={`${group.open ? 'Thu gọn' : 'Mở'} lý do của ${item.label}`}
              onClick={group.onToggle}
              className="-m-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center gap-2.5 rounded-lg p-1 text-left hover:bg-slate-100"
            >
              {nameBlock}
              {group.open ? (
                <ChevronDown className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
              )}
            </button>
          ) : (
            <div className="flex items-center gap-2.5">{nameBlock}</div>
          )}
          <div className="mt-1 flex flex-wrap gap-1">{pills}</div>
        </div>
      </div>

      <div className="min-w-0">
        <span className="mb-1 block text-[11px] font-medium text-slate-500 @3xl:sr-only">
          Cách duyệt
        </span>
        <div role="group" aria-label={`Cách duyệt của ${item.label}`}>
          <SearchableSelect
            options={choiceOptions}
            value={shown.choice}
            clearable={false}
            disabled={saving}
            placeholder="Chọn cách duyệt"
            onChange={(value) => value && onChoice(value as RouteChoice)}
          />
        </div>
      </div>

      <div className="min-w-0">
        <span className="mb-1 block text-[11px] font-medium text-slate-500 @3xl:sr-only">
          Quy trình
        </span>
        {shown.choice === 'PROCEDURE' ? (
          <div className="space-y-1">
            <div role="group" aria-label={`Quy trình của ${item.label}`}>
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
          <p className="flex min-h-9 items-center text-xs text-slate-600">
            <span>
              Đang theo cấu hình chung:{' '}
              <strong className="font-semibold text-slate-800">
                {describeRoute(item)}
              </strong>
            </span>
          </p>
        ) : (
          <p className="flex min-h-9 items-center text-xs text-slate-600">
            Quản lý trực tiếp của người làm đơn duyệt
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 @xl:col-span-2 @3xl:col-span-1">
        {dirty && (
          <>
            <Button
              disabled={saving || anySaving || !saveable}
              onClick={onSave}
              aria-label={`Lưu cách duyệt của ${item.label}`}
              title={saveable ? undefined : 'Chọn quy trình trước khi lưu'}
              className="h-9 gap-1 bg-blue-600 px-3 text-xs text-white hover:bg-blue-700"
            >
              <Save className="size-3.5" />
              {saving ? 'Đang lưu...' : 'Lưu'}
            </Button>
            <Button
              variant="outline"
              disabled={saving}
              onClick={onReset}
              aria-label={`Hoàn tác thay đổi của ${item.label}`}
              title="Hoàn tác thay đổi"
              className="h-9 gap-1 px-3 text-xs"
            >
              <RotateCcw className="size-3.5" />
              <span className="@3xl:sr-only">Hoàn tác</span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Cấu hình cách duyệt đơn: theo từng loại đơn và có thể riêng cho từng lý do.
 * Hai cách: Quản lý trực tiếp (mặc định) hoặc Theo quy trình (Procedure Engine). Đổi lựa chọn xong bấm Lưu ở dòng đó.
 */
export default function ApprovalConfigScreen() {
  const { can, loading: permissionsLoading } = useHrmPermissions();
  const canManage = can('hrm.automation.manage');
  const canAudit = can('hrm.audit.read');
  const canPolicy = can('hrm.integration.manage');
  const [config, setConfig] = useState<ApprovalRouteConfigResult | null>(null);
  /** undefined: đang tải; null: không tải được; mảng: danh sách quy trình đã công bố. */
  const [definitions, setDefinitions] = useState<
    ProcedureDefinitionOption[] | null | undefined
  >(undefined);
  const [definitionsError, setDefinitionsError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, RouteDraft>>({});
  /** null: chưa ai bấm mở/thu gọn, dùng mặc định theo `isGroupAutoOpen`; có giá trị: các loại đơn đang mở lý do. */
  const [openKinds, setOpenKinds] = useState<ReadonlySet<HrmRequestKind> | null>(null);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

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
  const dirtyCount = Object.keys(drafts).length;
  const canPickProcedure =
    procedureAvailable === true && Array.isArray(definitions);

  function setDraft(item: ApprovalRouteConfigItem, draft: RouteDraft) {
    const key = routeKey(item);
    // Bắt đầu sửa thì giữ nguyên các loại đơn đang mở, để dòng vừa lưu không biến mất khi mặc định đổi theo dữ liệu.
    if (openKinds === null) setOpenKinds(currentOpen());
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

  const groupsWithReasons = groups.filter((g) => g.reasons.length > 0);
  const isOpen = (group: ApprovalGroup) =>
    openKinds
      ? openKinds.has(group.general.requestKind)
      : isGroupAutoOpen(group);
  const currentOpen = () =>
    new Set(
      groupsWithReasons.filter(isOpen).map((g) => g.general.requestKind),
    );

  function toggleGroup(kind: HrmRequestKind) {
    const next = new Set(currentOpen());
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setOpenKinds(next);
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

  const allOpen =
    groupsWithReasons.length > 0 && groupsWithReasons.every(isOpen);

  return (
    <div className="@container mx-auto max-w-[1400px] space-y-4">
      <PageTitle
        title="Quy trình duyệt"
        description="Thiết lập quy trình phê duyệt đơn từ."
        badge={
          dirtyCount > 0 ? (
            <StatusPill tone="blue">{dirtyCount} thay đổi chưa lưu</StatusPill>
          ) : undefined
        }
        actions={
          canAudit ? (
            <Button
              variant="outline"
              onClick={() => setHistoryOpen(true)}
              className="h-9 gap-1.5 px-3 text-xs font-semibold"
            >
              <History className="size-4" aria-hidden="true" />
              Lịch sử thay đổi
            </Button>
          ) : undefined
        }
      />

      <InfoNote tone="blue">
        <p>
          <strong className="font-semibold text-slate-800">
            Quản lý trực tiếp (mặc định):
          </strong>{' '}
          đơn đi lên quản lý trực tiếp của người làm đơn. Người duyệt là quản lý
          trực tiếp và người có quyền duyệt toàn bộ.
        </p>
        <p className="mt-1">
          <strong className="font-semibold text-slate-800">Theo quy trình:</strong>{' '}
          đơn chạy một quy trình của Procedure Engine. Người duyệt do quy trình
          chỉ định theo từng bước. Cấu hình mới chỉ áp dụng cho đơn gửi sau; đơn
          đã gửi giữ nguyên.
        </p>
        <p className="mt-1">
          Lý do không có cấu hình riêng thì theo cấu hình chung của loại đơn.
        </p>
      </InfoNote>

      {procedureAvailable === false && (
        <InfoNote tone="amber" role="alert">
          Procedure Engine không khả dụng: chỉ chọn được cách Quản lý trực tiếp.
          Dòng nào đang cấu hình Theo quy trình sẽ không gửi được đơn cho tới khi
          chuyển về Quản lý trực tiếp.
        </InfoNote>
      )}
      {procedureAvailable === true && definitionsError && (
        <InfoNote tone="amber" role="alert">
          Không tải được danh sách quy trình nên chưa chọn được cách Theo quy
          trình. {definitionsError}
        </InfoNote>
      )}
      {conflictCount > 0 && (
        <InfoNote tone="red" role="alert">
          <span className="font-medium">
            Có {conflictCount} dòng cấu hình mâu thuẫn. Đơn thuộc dòng đó chưa
            gửi được cho tới khi chọn lại cách duyệt và lưu.
          </span>
        </InfoNote>
      )}
      {warnings.length > 0 && (
        <InfoNote tone="amber" role="status">
          <p className="mb-1 font-semibold">Cảnh báo cấu hình</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </InfoNote>
      )}
      {error && (
        <InfoNote tone="red" role="alert">
          {error}
        </InfoNote>
      )}

      <section
        aria-label="Cách duyệt theo loại đơn và lý do"
        className="min-w-0 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">
            Cách duyệt theo loại đơn và lý do
          </h2>
          {groupsWithReasons.length > 0 && (
            <Button
              variant="outline"
              onClick={() =>
                setOpenKinds(
                  allOpen
                    ? new Set()
                    : new Set(groupsWithReasons.map((g) => g.general.requestKind)),
                )
              }
              className="h-9 px-3 text-xs"
            >
              {allOpen ? 'Thu gọn tất cả lý do' : 'Mở tất cả lý do'}
            </Button>
          )}
        </div>

        {config === null ? (
          <p className="rounded-xl border border-slate-200 bg-white py-8 text-center text-xs text-slate-500">
            {error
              ? 'Không tải được cấu hình duyệt đơn.'
              : 'Đang tải cấu hình duyệt đơn...'}
          </p>
        ) : (
          <>
            <div
              aria-hidden="true"
              className={`${ROW_GRID} hidden rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 @3xl:grid`}
            >
              <span>Loại đơn / lý do</span>
              <span>Cách duyệt</span>
              <span>Quy trình</span>
              <span className="text-right">Thao tác</span>
            </div>
            {groups.map((group) => {
              const kind = group.general.requestKind;
              const open = isOpen(group);
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
                <div
                  key={kind}
                  className="min-w-0 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white"
                >
                  <RouteRow
                    {...rowProps(group.general)}
                    group={{
                      reasonCount: group.reasons.length,
                      ownCount: group.reasons.filter((r) => !r.inherited).length,
                      open,
                      hiddenDirty: open
                        ? 0
                        : group.reasons.filter((r) => drafts[routeKey(r)]).length,
                      hiddenConflict: open
                        ? 0
                        : group.reasons.filter((r) => r.conflict).length,
                      onToggle: () => toggleGroup(kind),
                    }}
                  />
                  {open &&
                    group.reasons.map((item) => (
                      <RouteRow key={routeKey(item)} {...rowProps(item)} />
                    ))}
                </div>
              );
            })}
          </>
        )}
      </section>

      {canPolicy && <ApprovalPolicyCard />}

      {canAudit && (
        <ConfigHistoryDrawer
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          description="Các lần đổi cách duyệt đơn và chính sách tự duyệt, mới nhất ở trên."
          actionPrefixes={['PROCEDURE_BINDING_CONFIGURED', 'APPROVAL_POLICY_CHANGED']}
        />
      )}
    </div>
  );
}
