'use client';
import { useOrganizationPermissions } from './organization-permissions';

import type {
  OrganizationPosition,
  OrganizationUnit,
  TenantOrganizationSnapshot,
} from '@enterprise-platform/contracts-organization';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Briefcase, Search, Sparkles, Star } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';

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
      const response = await fetch('/api/platform/v1/tenant-organization/snapshot', {
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
    const response = await fetch(
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

  const unitSizes = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.position.unitId, (map.get(row.position.unitId) ?? 0) + 1);
    return map;
  }, [rows]);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 flex flex-col justify-between gap-3 border-b border-slate-200 bg-white p-3 sm:p-4 md:flex-row md:items-center">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative w-full max-w-xs sm:w-80">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm chức danh, đơn vị, người giữ…"
              aria-label="Tìm chức danh"
              className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {!canUpdate ? (
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500">
              Chỉ xem
            </span>
          ) : null}
        </div>

        <Button
          disabled={!canUpdate || !pendingSuggestions.length || Boolean(saving)}
          onClick={() => void applySuggestions()}
          size="default"
          className="bg-blue-600 hover:bg-blue-700 text-white shrink-0 gap-1.5"
          title="Điền gợi ý từ cây cho các chức danh chưa khai báo Báo cáo cho"
        >
          <Sparkles className="size-4" />
          Áp dụng gợi ý cho {pendingSuggestions.length} ô trống
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 text-xs font-semibold uppercase text-slate-700 shadow-sm">
            <tr>
              <th className="px-5 py-3">Chức danh</th>
              <th className="px-5 py-3">Người giữ</th>
              <th className="px-5 py-3 w-[34%]">Báo cáo cho</th>
              <th className="px-5 py-3">Gợi ý từ cây</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {!organization && !loadError ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-sm text-slate-500">
                  Đang tải danh sách chức danh…
                </td>
              </tr>
            ) : null}
            {loadError ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-sm text-red-600" role="alert">
                  {loadError}
                </td>
              </tr>
            ) : null}
            {rows.map(({ position, unit, holders, suggestion }, index) => {
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
              // Danh sách đã xếp theo đơn vị: đổi đơn vị thì chèn một dòng tiêu đề nhóm,
              // thay cho cột "Đơn vị" lặp lại ở mọi dòng.
              const firstOfUnit = index === 0 || rows[index - 1].position.unitId !== position.unitId;
              return (
                <Fragment key={position.id}>
                  {firstOfUnit ? (
                    <tr className="bg-slate-50">
                      <th
                        colSpan={4}
                        scope="colgroup"
                        className="px-5 py-2 text-left text-xs font-semibold text-slate-600"
                      >
                        {unit?.name ?? 'Chưa thuộc đơn vị'}
                        <span className="ml-2 rounded-full border border-slate-200 bg-white px-1.5 py-px text-[11px] font-medium text-slate-500">
                          {unitSizes.get(position.unitId) ?? 0}
                        </span>
                      </th>
                    </tr>
                  ) : null}
                  <tr className="transition-colors hover:bg-slate-50/80">
                    <td className="px-5 py-2.5 pl-8">
                      <span className="font-semibold text-slate-900">{position.name}</span>
                      {unit?.headPositionId === position.id ? (
                        <span className="ml-2 inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-700">
                          <Star className="size-3" />
                          Quản lý
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-2.5">
                      {holders.length ? (
                        holders.join(', ')
                      ) : (
                        <span className="text-xs italic text-slate-400">Đang trống</span>
                      )}
                    </td>
                    <td className="px-5 py-2">
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
                    </td>
                    <td className="px-5 py-2.5">
                      {suggestion && suggestion !== current ? (
                        <button
                          type="button"
                          className="rounded-md border border-dashed border-blue-300 px-2 py-1 text-left text-xs text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={!canUpdate || Boolean(saving)}
                          title="Dùng gợi ý này"
                          onClick={() => void save(position.id, suggestion)}
                        >
                          {label(suggestion)}
                        </button>
                      ) : suggestion ? (
                        <span className="text-xs font-medium text-emerald-600">Khớp gợi ý</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {organization && rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-sm text-slate-500">
                  <Briefcase className="mx-auto size-8 text-slate-300" />
                  <p className="mt-2 font-medium">
                    Không có chức danh nào{search ? ' khớp từ khoá' : ''}.
                  </p>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-500">
        <span>
          Hiển thị <strong>{rows.length}</strong> / {allRows.length} chức danh
        </span>
        <span>
          {allRows.filter((row) => row.position.reportsToPositionId).length} đã khai báo Báo cáo cho
        </span>
      </div>
    </div>
  );
}
