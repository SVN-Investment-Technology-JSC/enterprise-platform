'use client';

import {
  SOCIAL_GROUP_COVER_PRESETS,
  SOCIAL_GROUP_COVER_PRESET_LABELS,
  SOCIAL_GROUP_NAME_MAX,
  SOCIAL_GROUP_POST_PERMISSIONS,
  SOCIAL_GROUP_POST_PERMISSION_LABELS,
  type SocialGroupDetail,
  type SocialGroupMembershipMode,
  type SocialGroupPostPermission,
} from '@enterprise-platform/contracts-social';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Lock, Globe } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../social-api';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group';
import { RichEditor } from '../rich-editor';
import { Dialog, Field, SelectField } from '../ui';
import { MemberPicker, OrgSourcePicker } from './group-visuals';
import {
  buildCreateGroupRequest,
  buildUpdateGroupRequest,
  emptyGroupForm,
  groupFormFrom,
  memberSourcesChange,
  presetGradient,
  validateGroupForm,
  type GroupFormState,
} from './groups.model';
import { createGroup, setGroupMemberSources, updateGroup } from './social-groups-api';

const POST_PERMISSION_OPTIONS = SOCIAL_GROUP_POST_PERMISSIONS.map((value) => ({
  value,
  label: SOCIAL_GROUP_POST_PERMISSION_LABELS[value],
}));

const MODES: ReadonlyArray<{ readonly value: SocialGroupMembershipMode; readonly label: string }> = [
  { value: 'manual', label: 'Nhóm theo danh sách người dùng' },
  { value: 'org', label: 'Nhóm theo phòng ban, vị trí, chức vụ' },
];

/**
 * Hộp thoại tạo nhóm (không có `group`) hoặc sửa nhóm (có `group`), bố cục theo 1Office.
 * Khi sửa: quản lý và thành viên đổi ở màn Thành viên (API đổi vai trò/gỡ người riêng), không nằm ở đây.
 */
export function GroupFormDialog({
  open,
  group,
  creatorId,
  creatorName,
  onClose,
  onSaved,
}: {
  readonly open: boolean;
  readonly group?: SocialGroupDetail;
  /** Id người tạo, dùng để loại khỏi danh sách quản lý thêm. */
  readonly creatorId?: string;
  /** Tên người tạo, hiện làm quản lý mặc định. */
  readonly creatorName?: string;
  readonly onClose: () => void;
  readonly onSaved: (group: SocialGroupDetail) => void;
}) {
  const editing = Boolean(group);
  const [state, setState] = useState<GroupFormState>(emptyGroupForm);
  /** Đổi mỗi lần mở để trình soạn dựng lại với nội dung mới. */
  const [session, setSession] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setState(group ? groupFormFrom(group) : emptyGroupForm());
    setSession((value) => value + 1);
    setError(undefined);
    setSubmitting(false);
  }, [open, group]);

  const patch = (next: Partial<GroupFormState>) => setState((current) => ({ ...current, ...next }));

  const submit = async () => {
    const problem = validateGroupForm(state, editing);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      let saved: SocialGroupDetail;
      if (group) {
        saved = await updateGroup(group.id, buildUpdateGroupRequest(state));
        const sources = memberSourcesChange(state, group.memberSources, group.membershipMode);
        if (sources) saved = await setGroupMemberSources(group.id, { sources });
      } else {
        saved = await createGroup(buildCreateGroupRequest(state));
      }
      onSaved(saved);
    } catch (cause) {
      setError(errorMessage(cause, editing ? 'Không lưu được nhóm.' : 'Không tạo được nhóm.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      wide
      fixedHeight
      title={editing ? 'Chỉnh sửa nhóm' : 'Tạo nhóm'}
      submitLabel={editing ? 'Cập nhật' : 'Tạo nhóm'}
      submittingLabel={editing ? 'Đang lưu…' : 'Đang tạo…'}
      submitting={submitting}
      submitDisabled={!state.name.trim()}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <div className="flex flex-col gap-2.5">
        <Field label="Tên nhóm" required>
          <Input
            className="h-[38px] rounded-md px-3 text-[13.5px]!"
            value={state.name}
            maxLength={SOCIAL_GROUP_NAME_MAX}
            placeholder="Ví dụ: Câu lạc bộ sáng tạo"
            autoFocus
            onChange={(event) => patch({ name: event.target.value })}
          />
        </Field>

        <RadioGroup
          className="flex flex-wrap gap-x-5 gap-y-1"
          aria-label="Cách chọn thành viên"
          value={state.mode}
          onValueChange={(value) => patch({ mode: value as SocialGroupMembershipMode })}
        >
          {MODES.map((mode) => (
            <Label key={mode.value} className="cursor-pointer text-[13px] font-normal text-slate-800">
              <RadioGroupItem value={mode.value} />
              {mode.label}
            </Label>
          ))}
        </RadioGroup>

        {editing ? null : (
          <SelectField label="Quản lý nhóm">
            <div className="flex flex-col gap-1.5">
              <span className="self-start rounded-full bg-blue-50 px-3 py-0.5 text-[12.5px] font-semibold text-blue-800">
                {creatorName ? `${creatorName} (bạn)` : 'Bạn'}
              </span>
              <MemberPicker
                selected={state.admins}
                onChange={(admins) => patch({ admins })}
                exclude={creatorId ? [creatorId] : []}
                placeholder="Thêm quản lý khác…"
              />
            </div>
          </SelectField>
        )}

        {state.mode === 'org' ? (
          <SelectField
            label="Phòng ban, vị trí"
            hint={
              editing && group?.lastSyncedAt
                ? 'Thành viên tự đồng bộ khi bấm "Đồng bộ lại" ở màn Thành viên.'
                : 'Thành viên được nở từ các nguồn này tại thời điểm lưu; đồng bộ lại sau bằng nút ở màn Thành viên.'
            }
          >
            <OrgSourcePicker sources={state.sources} onChange={(sources) => patch({ sources })} />
          </SelectField>
        ) : editing ? null : (
          <SelectField label="Thành viên">
            <MemberPicker
              variant="list"
              selected={state.members}
              onChange={(members) => patch({ members })}
              placeholder="Tìm người theo tên hoặc chức vụ…"
            />
          </SelectField>
        )}

        <SelectField label="Người được phép đăng bài">
          <SearchableSelect
            options={POST_PERMISSION_OPTIONS}
            value={state.postPermission}
            height={36}
            onChange={(value) => patch({ postPermission: value as SocialGroupPostPermission })}
          />
          {state.postPermission === 'selected' ? (
            <MemberPicker
              selected={state.permitted}
              onChange={(permitted) => patch({ permitted })}
              placeholder="Chọn người được phép đăng bài…"
            />
          ) : null}
        </SelectField>

        <SelectField label="Mô tả">
          <RichEditor
            key={`${session}`}
            initialHtml={state.descriptionHtml}
            placeholder="Nhóm này dành cho ai và để làm gì?"
            onChange={(descriptionHtml) => setState((current) => ({ ...current, descriptionHtml }))}
          />
        </SelectField>

        <div className="flex flex-wrap items-center gap-2.5" role="group" aria-label="Ảnh bìa">
          <span className="text-[13px] font-semibold text-slate-700">Ảnh bìa</span>
          <div className="flex flex-wrap gap-1.5">
            {SOCIAL_GROUP_COVER_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="h-[22px] w-[34px] cursor-pointer rounded-md border-2 border-transparent p-0 outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-blue-500/30 data-[active=true]:border-slate-900 data-[active=true]:ring-2 data-[active=true]:ring-blue-500/30"
                data-active={preset === state.coverPreset}
                style={{ background: presetGradient(preset) }}
                aria-label={SOCIAL_GROUP_COVER_PRESET_LABELS[preset]}
                aria-pressed={preset === state.coverPreset}
                title={SOCIAL_GROUP_COVER_PRESET_LABELS[preset]}
                onClick={() => patch({ coverPreset: preset })}
              />
            ))}
          </div>
        </div>

        <Label className="cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-normal text-slate-800">
          <Checkbox checked={state.isPublic} onCheckedChange={(checked) => patch({ isPublic: checked })} />
          <span className="inline-flex items-center gap-1.5 font-semibold">
            {state.isPublic ? <Globe size={13} aria-hidden="true" /> : <Lock size={13} aria-hidden="true" />}
            Nhóm công khai
          </span>
          <small className="basis-full pl-6 text-xs text-slate-500">
            {state.isPublic
              ? 'Mọi người trong công ty thấy nhóm và tham gia được ngay.'
              : 'Chỉ thành viên thấy nội dung; người khác phải gửi yêu cầu.'}
          </small>
        </Label>
      </div>
    </Dialog>
  );
}
