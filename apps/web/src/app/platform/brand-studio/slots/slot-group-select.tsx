'use client';

import type { BrandSlotGroup } from '@enterprise-platform/shared-brand-icon';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Plus } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { errorMessage, createSlotGroup } from '../store/brand-api';

/** Chân danh sách: mục "Thêm nhóm mới" mở ô nhập tên ngay trong danh sách. */
function AddGroupFooter({
  name,
  onCreated,
  close,
}: {
  name: string;
  onCreated: (group: BrandSlotGroup) => void;
  close: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Tên nhóm không được để trống.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const group = await createSlotGroup(trimmed);
      onCreated(group);
      toast.success(`Đã thêm nhóm "${group.label}".`);
      setLabel('');
      setOpen(false);
      close();
    } catch (cause) {
      setError(errorMessage(cause, 'Không thể thêm nhóm.'));
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!submitting) void submit();
    }
  };

  if (!open) {
    return (
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50"
        data-testid={`${name}-add-group`}
        onClick={() => setOpen(true)}
        type="button"
      >
        <Plus aria-hidden className="size-4" />
        Thêm nhóm mới
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 p-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Tên nhóm"
          autoFocus
          className="h-8 min-w-0 flex-1 bg-white"
          maxLength={60}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Tên nhóm"
          value={label}
        />
        <Button
          className="bg-blue-600 text-white hover:bg-blue-700"
          disabled={submitting}
          onClick={() => void submit()}
          type="button"
        >
          {submitting ? 'Đang thêm...' : 'Thêm'}
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Ô chọn nhóm vị trí: liệt kê mọi nhóm và cho thêm nhóm mới ngay trong danh sách. */
export function SlotGroupSelect({
  name,
  groups,
  value,
  onChange,
  onGroupCreated,
}: {
  name: string;
  groups: readonly BrandSlotGroup[];
  value: string;
  onChange: (key: string) => void;
  onGroupCreated: (group: BrandSlotGroup) => void;
}) {
  const options = useMemo(() => groups.map((group) => ({ value: group.key, label: group.label })), [groups]);

  return (
    <SearchableSelect
      clearable={false}
      dropdownFooter={({ close }) => (
        <AddGroupFooter
          close={close}
          name={name}
          onCreated={(group) => {
            onGroupCreated(group);
            onChange(group.key);
          }}
        />
      )}
      height={32}
      hideDropdownSearch
      name={name}
      nativeTitle={false}
      onChange={(val) => onChange(val || 'custom')}
      options={options}
      searchInDropdown
      value={value}
    />
  );
}
