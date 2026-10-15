'use client';
import { useOrganizationPermissions } from './organization-permissions';

import type {
  OrganizationPosition,
  OrganizationUnit,
  TenantOrganizationSnapshot,
} from '@enterprise-platform/contracts-organization';
import { SearchableSelect, authFetch } from '@enterprise-platform/shared-ui';
import { Briefcase, Network, Search, Sparkles, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { CollapsibleGroup } from '../collapsible-group';

const csrf = () =>
  decodeURIComponent(
    document.cookie
      .split('; ')
      .find((x) => x.startsWith('ep_csrf='))
      ?.split('=')
      .slice(1)
      .join('=') ?? '',
  );

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();

/**
 * Gợi ý "Báo cáo cho" từ cây đơn vị.
 *
 * - Chức danh thường báo cáo cho chức danh trưởng của chính đơn vị mình.
 * - Chức danh trưởng báo cáo cho chức danh trưởng của đơn vị cha gần nhất có trưởng.
 *
 * Chỉ là gợi ý: admin xác nhận thì mới lưu, vì cơ cấu báo cáo thật thường lệch
 * khỏi cây (phó phòng báo cáo thẳng lên giám đốc khối...).
 */
export function suggestReportsTo(
  position: OrganizationPosition,
  unitById: ReadonlyMap<string, OrganizationUnit>,
): string | undefined {
  const own = unitById.get(position.unitId);
  if (own?.headPositionId && own.headPositionId !== position.id) return own.headPositionId;
  const seen = new Set<string>();
  let cursor = own?.parentId ? unitById.get(own.parentId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (cursor.typeCategory === 'unit' && cursor.headPositionId && cursor.headPositionId !== position.id) {
      return cursor.headPositionId;
    }
    cursor = cursor.parentId ? unitById.get(cursor.parentId) : undefined;
  }
  return undefined;
}

/**
 * Tab Chức danh: khai báo "Báo cáo cho" giữa các chức danh — gốc để suy ra
 * quản lý trực tiếp cho mọi module (Quy trình, HRM...).
 */
export function OrganizationPositionTable() {
  const { canUpdate } = useOrganizationPermissions();
  const [organization, setOrganization] = useState<TenantOrganizationSnapshot>();
  const [loadError, setLoadError] = useState<string>();
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string>();

  const load = useCallback(async () => {
    try {
      const response = await authFetch('/api/platform/v1/tenant-organization/snapshot', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Không tải được danh sách chức danh (HTTP ${response.status}).`);
      setOrganization((await response.json()) as TenantOrganizationSnapshot);
      setLoadError(undefined);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Không tải được danh sách chức danh.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const units = organization?.units;
  const positions = organization?.positions;
  const members = organization?.members;

  const unitById = useMemo(() => new Map((units ?? []).map((unit) => [unit.id, unit])), [units]);
  const positionById = useMemo(
    () => new Map((positions ?? []).map((position) => [position.id, position])),
    [positions],
  );
  const holdersOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const member of members ?? []) {
      if (!member.positionId) continue;
      map.set(member.positionId, [...(map.get(member.positionId) ?? []), member.displayName]);
    }
    return map;
  }, [members]);

  const label = (positionId: string) => {
    const position = positionById.get(positionId);
    if (!position) return 'Chức danh đã xoá';
    return `${position.name} · ${unitById.get(position.unitId)?.name ?? ''}`;
  };

  const allRows = useMemo(
    () =>
      [...(positions ?? [])]
        .map((position) => ({
          position,
          unit: unitById.get(position.unitId),
          holders: holdersOf.get(position.id) ?? [],
          suggestion: suggestReportsTo(position, unitById),
        }))
        .sort(
          (left, right) =>
            (left.unit?.name ?? '').localeCompare(right.unit?.name ?? '', 'vi') ||
            left.position.name.localeCompare(right.position.name, 'vi'),
        ),
    [positions, unitById, holdersOf],
  );

  const rows = useMemo(() => {
    const keyword = normalize(search);
    if (!keyword) return allRows;
    return allRows.filter(({ position, unit, holders }) =>
      normalize(`${position.name} ${unit?.name ?? ''} ${holders.join(' ')}`).includes(keyword),
    );
  }, [allRows, search]);

  const write = async (positionId: string, next: string | null) => {
    const response = await authFetch(
      `/api/platform/v1/tenant-organization/positions/${encodeURIComponent(positionId)}/reports-to`,
      {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() },
        body: JSON.stringify({ reportsToPositionId: next }),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      const message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
      throw new Error(message ?? 'Không lưu được "Báo cáo cho".');
    }
  };

  const save = async (positionId: string, next: string | null) => {
    setSaving(positionId);
    try {
      await write(positionId, next);
      await load();
      toast.success('Đã lưu "Báo cáo cho".');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Không lưu được "Báo cáo cho".');
    } finally {
      setSaving(undefined);
    }
  };

  const pendingSuggestions = allRows.filter(
    (row) => !row.position.reportsToPositionId && row.suggestion,
  );
  const applySuggestions = async () => {
    setSaving('*');
    let applied = 0;
    try {
      for (const row of pendingSuggestions) {
        // Tuần tự chứ không song song: mỗi lần ghi Core kiểm vòng lặp trên dữ liệu
        // đã ghi trước đó; ghi song song thì hai gợi ý có thể cùng lọt qua kiểm tra.
        await write(row.position.id, row.suggestion ?? null);
        applied += 1;
      }
      toast.success(`Đã áp dụng gợi ý cho ${applied} chức danh.`);
    } catch (cause) {
      toast.error(
        `${applied ? `Đã áp dụng ${applied} gợi ý. ` : ''}${cause instanceof Error ? cause.message : 'Không lưu được "Báo cáo cho".'}`,
      );
    } finally {
      await load();
      setSaving(undefined);
    }
  };

  // Danh sách đã xếp theo đơn vị: mỗi đơn vị thành một nhóm, thay cho cột "Đơn vị"
  // lặp lại ở mọi dòng.
  const unitGroups = useMemo(() => {
    const groups: { unitId: string; unitName: string; rows: typeof rows }[] = [];
    for (const row of rows) {
      const last = groups[groups.length - 1];
      if (last && last.unitId === row.position.unitId) last.rows.push(row);
      else
        groups.push({
          unitId: row.position.unitId,
          unitName: row.unit?.name ?? 'Chưa thuộc đơn vị',
          rows: [row],
        });
    }
    return groups;
  }, [rows]);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-[38px] min-w-[220px] flex-[0_1_340px] items-center gap-2 rounded-lg border border-[#eef0f3] bg-white px-3 text-slate-500 focus-within:border-[#ffc90a]">
          <Search className="size-4 shrink-0" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm chức danh, đơn vị, người giữ…"
            aria-label="Tìm chức danh"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-[#18181b] outline-none placeholder:text-slate-400"
          />
        </label>
        {!canUpdate ? (
          <span className="rounded-md border border-[#eef0f3] bg-white px-2 py-0.5 text-xs text-slate-500">
            Chỉ xem
          </span>
        ) : null}
        <span className="flex-1" />
        <Button
          disabled={!canUpdate || !pendingSuggestions.length || Boolean(saving)}
          onClick={() => void applySuggestions()}
          className="h-[38px] shrink-0 gap-1.5 bg-[#ffc90a] text-[14px] font-bold text-[#18181b] hover:bg-[#ffd84d]"
          title="Điền gợi ý từ cây cho các chức danh chưa khai báo Báo cáo cho"
        >
          <Sparkles className="size-4" />
          Áp dụng gợi ý cho {pendingSuggestions.length} ô trống
        </Button>
      </div>

      {!organization && !loadError ? (
        <p className="m-0 rounded-[14px] border border-[#eef0f3] bg-white py-12 text-center text-sm text-slate-500">
          Đang tải danh sách chức danh…
        </p>
      ) : null}
      {loadError ? (
        <p
          className="m-0 rounded-[14px] border border-red-200 bg-red-50 py-12 text-center text-sm text-red-700"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      {unitGroups.map((group) => (
        <CollapsibleGroup
          count={group.rows.length}
          icon={<Network className="size-[15px]" />}
          key={group.unitId}
          title={group.unitName}
          tone="bg-sky-50 text-sky-600"
        >
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <div className={`${ROW} py-2 text-[12px] font-semibold tracking-[0.4px] text-slate-500`}>
                <span>CHỨC DANH</span>
                <span>NGƯỜI GIỮ</span>
                <span>BÁO CÁO CHO</span>
                <span>GỢI Ý TỪ CÂY</span>
              </div>
              {group.rows.map(({ position, unit, holders, suggestion }) => {
                const options = (positions ?? [])
                  .filter(
                    (candidate) =>
                      candidate.id !== position.id &&
                      (!position.treeId || !candidate.treeId || candidate.treeId === position.treeId),
                  )
                  .map((candidate) => ({
                    value: candidate.id,
                    label: candidate.name,
                    description: unitById.get(candidate.unitId)?.name,
                  }));
                const current = position.reportsToPositionId ?? '';
                return (
                  <div className={`${ROW} py-[9px] text-[14px] hover:bg-[#f4f6f9]/60`} key={position.id}>
                    <span className="flex min-w-0 items-center gap-2">
                      <b className="truncate font-semibold">{position.name}</b>
                      {unit?.headPositionId === position.id ? (
                        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] border border-amber-200 bg-amber-50 px-1.5 text-[12px] font-semibold text-amber-700">
                          <Star className="size-3" />
                          Quản lý
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0 truncate text-slate-700" title={holders.join(', ') || undefined}>
                      {holders.length ? (
                        holders.join(', ')
                      ) : (
                        <span className="text-xs italic text-slate-400">Đang trống</span>
                      )}
                    </span>
                    <SearchableSelect
                      options={options}
                      value={current}
                      placeholder="Chưa khai báo"
                      disabled={!canUpdate || Boolean(saving)}
                      onChange={(value) => {
                        if (value === current) return;
                        void save(position.id, value || null);
                      }}
                    />
                    <span className="min-w-0">
                      {suggestion && suggestion !== current ? (
                        <button
                          type="button"
                          className="max-w-full cursor-pointer truncate rounded-[7px] border border-dashed border-amber-300 bg-[#fffbeb] px-2 py-1 text-left text-xs text-[#8a6400] hover:bg-amber-100/60 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={!canUpdate || Boolean(saving)}
                          title="Dùng gợi ý này"
                          onClick={() => void save(position.id, suggestion)}
                        >
                          {label(suggestion)}
                        </button>
                      ) : suggestion ? (
                        <span className="text-xs font-semibold text-emerald-700">Khớp gợi ý</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </CollapsibleGroup>
      ))}

      {organization && rows.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
          <Briefcase className="mx-auto size-8 text-slate-300" />
          <p className="mt-2 font-medium">
            Không có chức danh nào{search ? ' khớp từ khoá' : ''}.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-between gap-2 text-[13px] text-slate-500">
        <span>
          Hiển thị <b className="text-[#18181b]">{rows.length}</b> / {allRows.length} chức danh
        </span>
        <span>
          {allRows.filter((row) => row.position.reportsToPositionId).length} đã khai báo Báo cáo cho
        </span>
      </div>
    </div>
  );
}

const ROW =
  'grid grid-cols-[minmax(220px,1fr)_minmax(170px,0.8fr)_250px_250px] items-center gap-x-3 border-t border-[#f1f3f6] px-5';
