'use client';

import {
  INVENTORY_APPROVAL_GROUPS,
  INVENTORY_APPROVAL_GROUP_LABEL,
  type ApprovalPolicyChange,
  type ApprovalPositionOption,
  type InventoryApproverKey,
  type InventoryApproverRoute,
  type InventoryApprovalGroup,
  type InventoryApprovalMode,
  type InventoryDocumentApprovalSettings,
  type InventorySettingsSnapshot,
} from '@enterprise-platform/contracts-inventory';
import { Popconfirm, SearchableSelect, formatDate } from '@enterprise-platform/shared-ui';
import { ShieldAlert, Workflow, History } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { loadApprovalPolicyLog, loadApprovalPositions, saveInventorySetting } from '../inventory-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const MIN_REASON = 10;
const MAX_REASON = 500;

const DEFAULT_POLICY: InventoryDocumentApprovalSettings = {
  allowSelfApproval: false,
  mode: 'FIXED_APPROVER',
  overrides: {},
  approvers: {},
};

const MODE_LABEL: Record<InventoryApprovalMode, string> = {
  PROCEDURE: 'Theo quy trình',
  FIXED_APPROVER: 'Người duyệt cố định',
  NOT_APPLICABLE: 'Không áp dụng',
};

/** Ba cách duyệt. "Theo quy trình" chưa nối Procedure Engine nên chưa chọn được, server cũng từ chối. */
const MODE_OPTIONS = [
  { value: 'PROCEDURE', label: 'Theo quy trình', description: 'Chưa dùng được', disabled: true },
  { value: 'FIXED_APPROVER', label: 'Người duyệt cố định', description: 'Người có quyền duyệt kho duyệt trong Kho' },
  { value: 'NOT_APPLICABLE', label: 'Không áp dụng', description: 'Tạo phiếu là ghi sổ ngay, không qua duyệt' },
];

/** Dòng một nhóm: kế thừa mặc định hoặc chọn riêng, như dòng "Kế thừa" của cấu hình duyệt HRM. */
const INHERIT = 'INHERIT';
const GROUP_OPTIONS = [{ value: INHERIT, label: 'Theo mặc định' }, ...MODE_OPTIONS];

const SELF_OPTIONS = [
  { value: 'no', label: 'Chặn: người lập không tự duyệt' },
  { value: 'yes', label: 'Cho phép người lập tự duyệt' },
];

const CARD = 'flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white px-5 py-[1.1rem] shadow-sm';

function validateReason(reason: string): string {
  const length = reason.trim().length;
  if (length < MIN_REASON) return `Lý do cần tối thiểu ${MIN_REASON} ký tự.`;
  if (length > MAX_REASON) return `Lý do tối đa ${MAX_REASON} ký tự.`;
  return '';
}

type ApproverDraft = Partial<Record<InventoryApproverKey, InventoryApproverRoute>>;

/** Giữ khai báo người duyệt chỉ ở dòng thực sự dùng cách "Người duyệt cố định"; dòng đổi sang cách khác thì bỏ. */
function prunedApprovers(
  mode: InventoryApprovalMode,
  overrides: Partial<Record<InventoryApprovalGroup, InventoryApprovalMode>>,
  approvers: ApproverDraft,
): ApproverDraft {
  const result: ApproverDraft = {};
  if (mode === 'FIXED_APPROVER' && approvers.DEFAULT) result.DEFAULT = approvers.DEFAULT;
  for (const group of INVENTORY_APPROVAL_GROUPS) {
    if (overrides[group] === 'FIXED_APPROVER' && approvers[group]) result[group] = approvers[group];
  }
  return result;
}

/** Chọn chức danh duyệt và chức danh dự phòng, như hai ô của cấu hình duyệt trực tiếp ở HRM. */
function ApproverPickers({
  label,
  route,
  positions,
  positionsError,
  disabled,
  onChange,
}: {
  label: string;
  route: InventoryApproverRoute | undefined;
  positions: readonly ApprovalPositionOption[];
  positionsError: boolean;
  disabled: boolean;
  onChange: (next: InventoryApproverRoute | undefined) => void;
}) {
  const options = positions.map((position) => ({ value: position.id, label: position.name }));
  const fallbackOptions = options.filter((option) => option.value !== route?.positionId);
  return (
    <div className="col-span-full grid grid-cols-2 gap-3 pt-1 max-sm:grid-cols-1">
      <div role="group" aria-label={`Chức danh duyệt của ${label}`} className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">Chức danh duyệt</span>
        <SearchableSelect
          options={options}
          value={route?.positionId ?? ''}
          placeholder="Chọn chức danh duyệt (để trống: ai có quyền duyệt kho cũng duyệt được)"
          clearable
          disabled={disabled}
          onChange={(value) =>
            onChange(value ? { positionId: value, fallbackPositionId: route?.fallbackPositionId === value ? undefined : route?.fallbackPositionId } : undefined)
          }
        />
      </div>
      <div role="group" aria-label={`Chức danh dự phòng của ${label}`} className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">Chức danh dự phòng (tuỳ chọn)</span>
        <SearchableSelect
          options={fallbackOptions}
          value={route?.fallbackPositionId ?? ''}
          placeholder="Chọn chức danh dự phòng"
          clearable
          disabled={disabled || !route}
          onChange={(value) => route && onChange({ positionId: route.positionId, ...(value ? { fallbackPositionId: value } : {}) })}
        />
      </div>
      {positionsError ? (
        <p role="alert" className="col-span-full m-0 text-xs text-red-600">
          Không lấy được danh sách chức danh từ sơ đồ tổ chức. Vui lòng thử lại sau.
        </p>
      ) : null}
    </div>
  );
}

function describe(policy: InventoryDocumentApprovalSettings): string {
  const parts = [`Mặc định: ${MODE_LABEL[policy.mode]}`];
  if (policy.allowSelfApproval) parts.push('cho tự duyệt');
  for (const group of INVENTORY_APPROVAL_GROUPS) {
    const mode = policy.overrides?.[group];
    if (mode) parts.push(`${INVENTORY_APPROVAL_GROUP_LABEL[group]}: ${MODE_LABEL[mode]}`);
  }
  return parts.join('; ');
}

function Note({ tone, children }: { tone: 'amber' | 'red'; children: ReactNode }) {
  return (
    <p
      role={tone === 'red' ? 'alert' : 'note'}
      className={
        tone === 'red'
          ? 'm-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700'
          : 'm-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] leading-normal text-amber-800'
      }
    >
      {children}
    </p>
  );
}

/**
 * Lý do thay đổi, nút lưu có xác nhận và thông báo lỗi: phần chung của hai thẻ chính sách. Mỗi thẻ lưu phần của mình,
 * giữ nguyên phần còn lại đã lưu; mỗi lần đổi đều cần lý do và vào nhật ký.
 */
function SaveBar({
  canManage,
  changed,
  risky,
  confirmTitle,
  confirmDescription,
  buttonLabel,
  build,
  version,
  onSaved,
}: {
  canManage: boolean;
  changed: boolean;
  risky: boolean;
  confirmTitle: string;
  confirmDescription: string;
  buttonLabel: string;
  build: () => InventoryDocumentApprovalSettings;
  version: number | undefined;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reasonId = useId();
  const reasonError = reason ? validateReason(reason) : '';
  const blocked = !canManage || busy || !changed || validateReason(reason) !== '';

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await saveInventorySetting('documents.approval', build(), version as number, reason.trim());
      setReason('');
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được chính sách duyệt chứng từ.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-[0.4rem]">
          <Label htmlFor={reasonId}>Lý do thay đổi</Label>
          <Input
            id={reasonId}
            aria-label="Lý do thay đổi chính sách duyệt chứng từ"
            placeholder="Lý do thay đổi (tối thiểu 10 ký tự)"
            maxLength={MAX_REASON}
            value={reason}
            disabled={!canManage || busy}
            onChange={(event) => setReason(event.target.value)}
            className="h-9"
          />
          <span className={reasonError ? 'text-[13px] text-red-600' : 'text-[13px] text-slate-500'}>
            {reasonError || 'Tối thiểu 10 ký tự.'}
          </span>
        </div>
        <div className="pt-[1.55rem]">
          <Popconfirm
            title={confirmTitle}
            description={confirmDescription}
            okText="Xác nhận"
            cancelText="Quay lại"
            okType={risky ? 'danger' : 'primary'}
            disabled={blocked}
            loading={busy}
            onConfirm={save}
          >
            <Button type="button" variant="outline" disabled={blocked} className="h-9 px-3 text-xs">
              {buttonLabel}
            </Button>
          </Popconfirm>
        </div>
      </div>
      {error ? <Note tone="red">{error}</Note> : null}
    </>
  );
}

/**
 * Chính sách duyệt chứng từ kho, tách ba thẻ như cấu hình duyệt của HRM: cách duyệt theo từng nhóm chứng từ,
 * chính sách tự duyệt, lịch sử thay đổi. Tự lưu ngay (không dùng nút Lưu chung của màn Cài đặt).
 */
export function ApprovalPolicySection({
  settings,
  canManage,
  onSaved,
}: {
  settings: InventorySettingsSnapshot | undefined;
  canManage: boolean;
  onSaved: (message: string) => void;
}) {
  const entry = settings?.['documents.approval'];
  const saved = entry?.value ?? DEFAULT_POLICY;
  const savedOverrides = saved.overrides ?? {};

  const [mode, setMode] = useState<InventoryApprovalMode>(saved.mode);
  const [overrides, setOverrides] = useState<Partial<Record<InventoryApprovalGroup, InventoryApprovalMode>>>(savedOverrides);
  const [self, setSelf] = useState(saved.allowSelfApproval);
  const [approvers, setApprovers] = useState<ApproverDraft>(saved.approvers ?? {});
  const [positions, setPositions] = useState<ApprovalPositionOption[]>([]);
  const [positionsError, setPositionsError] = useState(false);
  const [log, setLog] = useState<ApprovalPolicyChange[]>([]);

  const reloadLog = useCallback(() => {
    if (!canManage) return;
    void loadApprovalPolicyLog().then(setLog).catch(() => undefined);
  }, [canManage]);
  useEffect(reloadLog, [reloadLog]);
  useEffect(() => {
    if (!canManage) return;
    void loadApprovalPositions().then(setPositions).catch(() => setPositionsError(true));
  }, [canManage]);

  const draftApprovers = prunedApprovers(mode, overrides, approvers);
  const routingChanged =
    mode !== saved.mode ||
    JSON.stringify(overrides) !== JSON.stringify(savedOverrides) ||
    JSON.stringify(draftApprovers) !== JSON.stringify(saved.approvers ?? {});
  const routingDraft: InventoryDocumentApprovalSettings = { ...saved, mode, overrides, approvers: draftApprovers };
  const setRoute = (key: InventoryApproverKey) => (next: InventoryApproverRoute | undefined) =>
    setApprovers((current) => {
      const copy = { ...current };
      if (next) copy[key] = next;
      else delete copy[key];
      return copy;
    });
  const waivedGroups = INVENTORY_APPROVAL_GROUPS.filter((group) => (overrides[group] ?? mode) === 'NOT_APPLICABLE');
  const done = (message: string) => () => {
    onSaved(message);
    reloadLog();
  };

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Workflow size={16} className="text-blue-600" aria-hidden />
            Cách duyệt chứng từ kho
          </h3>
          <span
            className={
              saved.mode === 'NOT_APPLICABLE' || INVENTORY_APPROVAL_GROUPS.some((g) => savedOverrides[g] === 'NOT_APPLICABLE')
                ? 'rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700'
                : 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700'
            }
          >
            {saved.mode === 'NOT_APPLICABLE' || INVENTORY_APPROVAL_GROUPS.some((g) => savedOverrides[g] === 'NOT_APPLICABLE')
              ? 'Có nhóm không áp dụng duyệt'
              : 'Đang bắt buộc duyệt'}
          </span>
        </header>
        <p className="m-0 text-[13px] leading-normal text-slate-500">
          Chọn cách duyệt cho từng nhóm chứng từ. Nhóm chọn "Theo mặc định" dùng cách ở dòng đầu. Chuyển kho tính chung cả
          hai vế; kiểm kê và chứng từ đảo có luật duyệt riêng, chưa theo bảng này.
        </p>

        <div className="overflow-hidden rounded-md border border-slate-200">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,18rem)] items-center gap-3 border-b border-slate-100 bg-slate-50 px-3 py-2 max-sm:grid-cols-1">
            <span className="text-[13px] font-semibold text-slate-800">Mặc định cho mọi chứng từ</span>
            <SearchableSelect
              options={MODE_OPTIONS}
              value={mode}
              onChange={(value) => setMode((value as InventoryApprovalMode) || 'FIXED_APPROVER')}
              clearable={false}
              disabled={!canManage}
            />
            {mode === 'FIXED_APPROVER' ? (
              <ApproverPickers
                label="mặc định"
                route={approvers.DEFAULT}
                positions={positions}
                positionsError={positionsError}
                disabled={!canManage}
                onChange={setRoute('DEFAULT')}
              />
            ) : null}
          </div>
          {INVENTORY_APPROVAL_GROUPS.map((group) => (
            <div
              key={group}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,18rem)] items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0 max-sm:grid-cols-1"
            >
              <span className="text-[13px] text-slate-700">{INVENTORY_APPROVAL_GROUP_LABEL[group]}</span>
              <SearchableSelect
                options={GROUP_OPTIONS}
                value={overrides[group] ?? INHERIT}
                onChange={(value) =>
                  setOverrides((current) => {
                    const next = { ...current };
                    if (value && value !== INHERIT) next[group] = value as InventoryApprovalMode;
                    else delete next[group];
                    return next;
                  })
                }
                clearable={false}
                disabled={!canManage}
              />
              {overrides[group] === 'FIXED_APPROVER' ? (
                <ApproverPickers
                  label={INVENTORY_APPROVAL_GROUP_LABEL[group]}
                  route={approvers[group]}
                  positions={positions}
                  positionsError={positionsError}
                  disabled={!canManage}
                  onChange={setRoute(group)}
                />
              ) : null}
            </div>
          ))}
        </div>

        {waivedGroups.length > 0 ? (
          <Note tone="amber">
            Rủi ro kiểm soát nội bộ: chứng từ thuộc nhóm không áp dụng duyệt ({waivedGroups.map((g) => INVENTORY_APPROVAL_GROUP_LABEL[g]).join(', ')})
            được ghi sổ ngay, tồn kho đổi tức thì. Sai sót chỉ sửa được bằng chứng từ đảo.
          </Note>
        ) : null}

        <SaveBar
          key={`routing-${entry?.version ?? 0}`}
          canManage={canManage}
          changed={routingChanged}
          risky={waivedGroups.length > 0}
          confirmTitle={waivedGroups.length > 0 ? 'Áp dụng cách duyệt nới kiểm soát?' : 'Lưu cách duyệt chứng từ?'}
          confirmDescription={
            waivedGroups.length > 0
              ? 'Từ lúc này phiếu thuộc nhóm không áp dụng duyệt được ghi sổ ngay, không qua người duyệt.'
              : 'Chứng từ phải duyệt chỉ người giữ chức danh được chỉ định (hoặc dự phòng) duyệt được; dòng không chỉ định chức danh thì ai có quyền duyệt kho cũng duyệt được.'
          }
          buttonLabel="Lưu cách duyệt"
          build={() => routingDraft}
          version={entry?.version}
          onSaved={done('Đã lưu cách duyệt chứng từ.')}
        />
      </section>

      <section className={CARD}>
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <ShieldAlert size={16} className="text-amber-600" aria-hidden />
            Chính sách tự duyệt chứng từ
          </h3>
          <span
            className={
              saved.allowSelfApproval
                ? 'rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700'
                : 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700'
            }
          >
            {saved.allowSelfApproval ? 'Đang cho phép tự duyệt' : 'Đang chặn tự duyệt'}
          </span>
        </header>
        <p className="m-0 text-[13px] leading-normal text-slate-500">
          Mặc định người lập không được tự duyệt chứng từ của chính mình. Chỉ bật ngoại lệ khi tổ chức không có người duyệt
          thay thế.
        </p>
        <div className="flex max-w-md flex-col gap-[0.4rem]">
          <Label>Tự duyệt chứng từ của chính mình</Label>
          <SearchableSelect
            options={SELF_OPTIONS}
            value={self ? 'yes' : 'no'}
            onChange={(value) => setSelf(value === 'yes')}
            clearable={false}
            disabled={!canManage}
          />
        </div>
        {self ? (
          <Note tone="amber">
            Rủi ro kiểm soát nội bộ: người lập có thể tự duyệt phiếu của mình, mất nguyên tắc phân tách nhiệm vụ.
          </Note>
        ) : null}
        <SaveBar
          key={`self-${entry?.version ?? 0}`}
          canManage={canManage}
          changed={self !== saved.allowSelfApproval}
          risky={self}
          confirmTitle={self ? 'Bật ngoại lệ tự duyệt?' : 'Tắt ngoại lệ tự duyệt?'}
          confirmDescription={
            self ? 'Từ lúc này người lập có thể tự duyệt phiếu của mình.' : 'Từ lúc này người lập không tự duyệt được phiếu của mình.'
          }
          buttonLabel={self ? 'Bật cho phép tự duyệt' : 'Tắt cho phép tự duyệt'}
          build={() => ({ ...saved, allowSelfApproval: self })}
          version={entry?.version}
          onSaved={done('Đã lưu chính sách tự duyệt.')}
        />
      </section>

      {canManage ? (
        <section className={CARD}>
          <h3 className="m-0 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <History size={16} className="text-slate-500" aria-hidden />
            Lịch sử thay đổi
          </h3>
          {log.length === 0 ? (
            <p className="m-0 text-[13px] text-slate-500">Chưa có thay đổi nào.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {log.map((change) => (
                <li key={change.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-[13px]">
                  <div className="text-slate-800">
                    {describe(change.previous)}
                    <br />→ <strong>{describe(change.current)}</strong>
                  </div>
                  <div className="text-slate-600">Lý do: {change.reason}</div>
                  <div className="text-xs text-slate-400">{formatDate(change.changedAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
