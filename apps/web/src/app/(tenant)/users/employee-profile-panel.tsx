'use client';

import type {
  OrganizationManagerChain,
  TenantOrganizationSnapshot,
} from '@enterprise-platform/contracts-organization';
import { SearchableSelect, authFetch } from '@enterprise-platform/shared-ui';
import { Network } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SidePanel } from '../side-panel';
import type { TenantCoreUser } from './page';

function csrfToken() {
  const value = document.cookie
    .split('; ')
    .find((item) => item.startsWith('ep_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
  return value ? decodeURIComponent(value) : '';
}

type Snapshot = TenantOrganizationSnapshot & {
  members: (TenantOrganizationSnapshot['members'][number] & {
    assignmentId?: string;
    reportsToPositionOverrideId?: string;
  })[];
};

/**
 * Hồ sơ nhân sự: chức danh đang giữ và quản lý trực tiếp của người đó, hiện ở
 * khung bên phải trang Người dùng.
 *
 * Quản lý trực tiếp SUY RA từ quan hệ "Báo cáo cho" của chức danh (chỉ đọc ở
 * đây, sửa ở màn Quản lý chức danh). Ô ghi đè chọn CHỨC DANH chứ không chọn
 * người: người đổi thì chức danh ở lại, ghi đè không bị lỗi thời theo nhân sự.
 */
export function EmployeeProfilePanel({
  user,
  onClose,
}: {
  user: TenantCoreUser;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [chains, setChains] = useState<Record<string, OrganizationManagerChain>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState<string>();

  const load = useCallback(async (userId: string) => {
    setError(undefined);
    try {
      const response = await authFetch('/api/platform/v1/tenant-organization/snapshot', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Không tải được sơ đồ tổ chức (HTTP ${response.status}).`);
      const data = (await response.json()) as Snapshot;
      setSnapshot(data);
      const held = data.members.filter((member) => member.userId === userId && member.positionId);
      const entries = await Promise.all(
        held.map(async (member) => {
          const result = await authFetch(
            `/api/platform/v1/tenant-organization/users/${encodeURIComponent(userId)}/manager-chain?positionId=${encodeURIComponent(member.positionId ?? '')}`,
            { cache: 'no-store' },
          );
          const chain = result.ok
            ? ((await result.json()) as OrganizationManagerChain)
            : { initiatorPositionId: null, chain: [] };
          return [member.positionId ?? '', chain] as const;
        }),
      );
      setChains(Object.fromEntries(entries));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được hồ sơ nhân sự.');
    }
  }, []);

  useEffect(() => {
    void load(user.id);
  }, [user, load]);

  const positionById = useMemo(
    () => new Map((snapshot?.positions ?? []).map((position) => [position.id, position])),
    [snapshot],
  );
  const unitName = useMemo(
    () => new Map((snapshot?.units ?? []).map((unit) => [unit.id, unit.name])),
    [snapshot],
  );
  const positionLabel = (id?: string | null) => {
    if (!id) return '—';
    const position = positionById.get(id);
    return position ? `${position.name} · ${unitName.get(position.unitId) ?? ''}` : 'Chức danh đã xoá';
  };
  const held = (snapshot?.members ?? []).filter((member) => member.userId === user.id && member.positionId);

  const saveOverride = async (assignmentId: string, reportsToPositionId: string | null) => {
    setSaving(assignmentId);
    setError(undefined);
    try {
      const response = await authFetch(
        `/api/platform/v1/tenant-organization/assignments/${encodeURIComponent(assignmentId)}/reports-to-override`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
          body: JSON.stringify({ reportsToPositionId }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? 'Không lưu được ô ghi đè.');
      }
      await load(user.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được ô ghi đè.');
    } finally {
      setSaving(undefined);
    }
  };

  return (
    <SidePanel
      icon={<Network className="size-4" />}
      title="Hồ sơ nhân sự"
      subtitle={`${user.fullName} · ${user.email}`}
      revealKey={user.id}
      onClose={onClose}
    >
        <div className="grid gap-3">
          {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          {!snapshot && !error ? <p className="text-sm text-slate-500">Đang tải…</p> : null}
          {snapshot && held.length === 0 ? (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Người này chưa được bổ nhiệm vào chức danh nào trong Sơ đồ tổ chức.
            </p>
          ) : null}

          {held.map((member) => {
            const position = member.positionId ? positionById.get(member.positionId) : undefined;
            const chain = chains[member.positionId ?? ''];
            const direct = chain?.chain[0];
            const effective = chain?.chain.find((link) => link.holderUserIds.length > 0);
            const options = (snapshot?.positions ?? [])
              .filter((candidate) => candidate.id !== member.positionId)
              .map((candidate) => ({
                value: candidate.id,
                label: candidate.name,
                description: unitName.get(candidate.unitId),
              }));
            return (
              <section key={member.assignmentId ?? member.positionId} className="grid gap-2.5 rounded-[10px] border border-[#eef0f3] px-3.5 py-3">
                <header className="flex items-start justify-between gap-2">
                  <div>
                    <p className="m-0 text-[14px] font-bold text-slate-900">{position?.name ?? member.positionName}</p>
                    <p className="m-0 text-xs text-slate-500">{unitName.get(position?.unitId ?? '') ?? ''}</p>
                  </div>
                  {member.isHead ? (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">Chức danh chính</span>
                  ) : null}
                </header>

                <dl className="m-0 grid gap-1.5 text-[13px]">
                  <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2.5">
                    <dt className="text-slate-500">Báo cáo cho (theo chức danh)</dt>
                    <dd className="font-medium text-slate-800">{positionLabel(position?.reportsToPositionId)}</dd>
                  </div>
                  <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2.5">
                    <dt className="text-slate-500">Quản lý trực tiếp</dt>
                    <dd className="font-medium text-slate-800">
                      {direct ? positionLabel(direct.positionId) : 'Chưa có — sẽ dùng người dự phòng của quy trình'}
                      {direct && direct.holderUserIds.length === 0 && effective ? (
                        <span className="block text-xs font-normal text-amber-700">
                          Chức danh đang trống, quy trình sẽ leo lên: {positionLabel(effective.positionId)}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                </dl>

                <div className="grid gap-1.5">
                  <label className="text-xs font-semibold text-slate-600">Ghi đè quản lý trực tiếp (tuỳ chọn)</label>
                  <SearchableSelect
                    options={options}
                    value={member.reportsToPositionOverrideId ?? ''}
                    placeholder="Không ghi đè — dùng theo chức danh"
                    disabled={!member.assignmentId || saving === member.assignmentId}
                    onChange={(value) =>
                      member.assignmentId ? void saveOverride(member.assignmentId, value || null) : undefined
                    }
                  />
                  <p className="text-xs text-slate-500">
                    Chỉ áp cho người này ở chức danh này. Chọn chức danh chứ không chọn người, để không phải sửa lại khi đổi nhân sự.
                  </p>
                </div>
              </section>
            );
          })}
        </div>
    </SidePanel>
  );
}
