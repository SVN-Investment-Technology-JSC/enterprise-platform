'use client';
import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import type { HrmRequestReasonCategory } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from '../ui/button';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { LeaveTypeCatalog } from '../ui/leave-type-catalog';
import { RequestReasonCatalog } from '../ui/request-reason-catalog';

const LEAVE_TAB = 'LEAVE';

const yesNo = [
  { value: 'true', label: 'Có' },
  { value: 'false', label: 'Không' },
];

/**
 * Danh mục đơn từ: mỗi loại đơn là một tab. Tab "Nghỉ phép" quản lý loại nghỉ;
 * các tab còn lại lấy từ danh mục loại đơn của tenant nên có thể thêm loại đơn mới
 * (mỗi loại có danh sách lý do riêng).
 */
export default function RequestCatalogScreen() {
  const { can } = useHrmPermissions();
  const canManage = can('hrm.leave.manage');
  const [categories, setCategories] = useState<HrmRequestReasonCategory[]>([]);
  const [activeTab, setActiveTab] = useState(LEAVE_TAB);
  const [error, setError] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);

  const load = useCallback(async () => {
    const result = await hrmFetch<{ data: HrmRequestReasonCategory[] }>(
      '/request-reason-categories',
    );
    setCategories(result.data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  // Tab đang chọn bị xoá thì quay về tab Nghỉ phép.
  useEffect(() => {
    if (
      activeTab !== LEAVE_TAB &&
      categories.length > 0 &&
      !categories.some((c) => c.code === activeTab)
    )
      setActiveTab(LEAVE_TAB);
  }, [categories, activeTab]);

  const current = categories.find((c) => c.code === activeTab);

  function createCategory() {
    setAction({
      title: 'Thêm loại đơn',
      description:
        'Loại đơn mới xuất hiện thành một tab với danh sách lý do riêng. Mã loại đơn không đổi được sau khi tạo.',
      columns: 2,
      fields: [
        { key: 'code', label: 'Mã loại đơn (VD: TRAINING)', required: true },
        { key: 'name', label: 'Tên loại đơn', required: true },
        { key: 'description', label: 'Mô tả', colSpan: 2 },
      ],
      submit: async (v) => {
        await hrmFetch('/request-reason-categories', {
          method: 'POST',
          body: JSON.stringify({
            code: v.code,
            name: v.name,
            description: v.description || null,
          }),
        });
        await load();
        setActiveTab(v.code.trim().toUpperCase());
      },
    });
  }

  function editCategory(row: HrmRequestReasonCategory) {
    setAction({
      title: `Cập nhật loại đơn ${row.code}`,
      columns: 2,
      fields: [
        { key: 'name', label: 'Tên loại đơn', value: row.name, required: true },
        {
          key: 'active',
          label: 'Đang sử dụng',
          options: yesNo,
          value: String(row.active),
          required: true,
        },
        {
          key: 'description',
          label: 'Mô tả',
          value: row.description ?? '',
          colSpan: 2,
        },
      ],
      submit: async (v) => {
        await hrmFetch(`/request-reason-categories/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: v.name,
            description: v.description || null,
            active: v.active === 'true',
          }),
        });
        await load();
      },
    });
  }

  function removeCategory(row: HrmRequestReasonCategory) {
    setAction({
      title: `Xoá loại đơn "${row.name}"`,
      confirmTitle: 'Xoá loại đơn này và toàn bộ lý do bên trong?',
      description: 'Đơn đã gửi không bị ảnh hưởng.',
      columns: 1,
      fields: [],
      submit: async () => {
        await hrmFetch(`/request-reason-categories/${row.id}`, {
          method: 'DELETE',
        });
        setActiveTab(LEAVE_TAB);
        await load();
      },
    });
  }

  const tabs = [
    { code: LEAVE_TAB, name: 'Lý do xin nghỉ' },
    ...categories.map((c) => ({ code: c.code, name: c.name })),
  ];

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <ClipboardList className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Danh mục đơn từ
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Loại nghỉ và lý do của từng loại đơn. Mỗi loại đơn là một tab;
              có thể thêm loại đơn mới theo nhu cầu của tenant.
            </p>
          </div>
        </div>
        {canManage && (
          <Button
            onClick={createCategory}
            className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs text-xs"
          >
            <Plus className="size-4" />
            <span>Thêm loại đơn</span>
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700"
        >
          {error}
        </div>
      )}

      <div
        role="tablist"
        className="flex flex-wrap gap-5 border-b border-slate-200"
      >
        {tabs.map((tab) => (
          <button
            key={tab.code}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.code}
            onClick={() => setActiveTab(tab.code)}
            className={`border-b-2 px-3 py-3 text-sm font-medium ${
              activeTab === tab.code
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.name}
          </button>
        ))}
      </div>

      {activeTab === LEAVE_TAB ? (
        <section className="rounded-xl border border-slate-200 bg-white shadow-xs p-5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Lý do xin nghỉ (loại nghỉ)
            </span>
          </div>
          <LeaveTypeCatalog />
        </section>
      ) : current ? (
        <>
          {canManage && (
            <div className="flex items-center justify-end gap-2">
              <Button
                size="xs"
                variant="outline"
                onClick={() => editCategory(current)}
                className="h-7 text-xs px-2"
              >
                <Pencil className="size-3 mr-1" />
                Sửa loại đơn
              </Button>
              {!current.isSystem && (
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() => removeCategory(current)}
                  className="h-7 text-xs px-2"
                >
                  <Trash2 className="size-3 mr-1" />
                  Xoá loại đơn
                </Button>
              )}
            </div>
          )}
          {!current.active && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Loại đơn này đang ngừng sử dụng: lý do không hiện ở form tạo đơn.
            </div>
          )}
          <RequestReasonCatalog
            key={current.code}
            kind={current.code}
            title={current.name}
            fixedItems={current.fixedItems}
          />
        </>
      ) : null}

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
