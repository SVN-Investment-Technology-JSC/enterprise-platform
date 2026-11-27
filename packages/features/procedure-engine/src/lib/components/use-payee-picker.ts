'use client';

import type { ProcedureAttributeValue, ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  loadPayeeProfile,
  payeeBankChanges,
  payeeNameUntouched,
  payeeSlots,
  type PayeeSlots,
} from '../payee-prefill';

type Draft = Record<string, ProcedureAttributeValue | null>;

interface Member {
  readonly userId: string;
  readonly displayName: string;
}

/**
 * Người nhận là nhân viên (chọn trong thành viên tổ chức, STK / ngân hàng tự điền từ hồ sơ nhân sự) hay khách hàng / bên
 * ngoài (tên, STK, ngân hàng gõ tay; không tra hồ sơ nhân sự). Không lưu riêng: suy ra từ tên đang lưu mỗi lần mở.
 */
export type PayeeMode = 'employee' | 'external';

/**
 * Suy ra loại người nhận từ tên ĐÃ LƯU: trống hoặc trùng tên một thành viên là nhân viên; có tên mà không khớp thành viên
 * nào là bên ngoài. Chưa có danh sách thành viên thì coi là nhân viên (như trước).
 */
export function inferPayeeMode(
  stored: ProcedureAttributeValue | null | undefined,
  members: readonly Member[],
): PayeeMode {
  const text = stored?.type === 'text' ? stored.value.trim() : '';
  if (!text || !members.length) return 'employee';
  return members.some((member) => member.displayName.trim() === text) ? 'employee' : 'external';
}

/** Trạng thái ô chọn người nhận của hồ sơ thanh toán, truyền cho `AttributeForm`. */
export interface PayeePicker {
  readonly slots: PayeeSlots;
  /** Loại người nhận đang dùng (người dùng đã đổi trong phiên này, không thì suy từ tên đang lưu). */
  readonly mode: PayeeMode;
  /** Người dùng vừa tự đổi loại người nhận ở bước này (để đưa con trỏ vào ô tên khi sang "bên ngoài"). */
  readonly modeChosen: boolean;
  /**
   * Đổi loại người nhận. Sang bên ngoài: xoá tên, xoá STK / ngân hàng nếu còn là giá trị tự điền (giữ ô gõ tay), thôi tra
   * hồ sơ nhân sự. Về nhân viên: đặt lại người tạo hồ sơ và tự điền như cũ (không đè ô gõ tay).
   */
  readonly setMode: (next: PayeeMode) => void;
  /** Người vừa chọn trên ô (chưa chọn trong phiên này thì `null`, ô tự nhận ra người theo tên đang lưu). */
  readonly selectedUserId: string | null;
  /** Đã tra hồ sơ nhân sự của người vừa chọn mà không có (hoặc không được xem) STK, ngân hàng. */
  readonly missingBankInfo: boolean;
  /** Chọn người nhận (`null` là bỏ chọn). */
  readonly choose: (userId: string | null) => void;
}

/**
 * Chọn người nhận ở hồ sơ thanh toán: đặt tên vào ô "Người nhận", tra STK, ngân hàng của người đó ở HRM và điền vào hai
 * ô ngân hàng. Mặc định chọn người tạo hồ sơ khi ô còn trống. Không phải hồ sơ thanh toán thì trả `null`.
 *
 * Gọi sau effect xoá nháp của khung xử lý (cùng khoá hồ sơ + bước), để giá trị mặc định không bị xoá ngay sau khi điền.
 */
export function usePayeePicker({
  instance,
  draft,
  setDraft,
  members,
  actorId,
}: {
  instance: ProcedureInstance;
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  members: readonly Member[];
  actorId?: string;
}): PayeePicker | null {
  const slots = payeeSlots(instance);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [missingBankInfo, setMissingBankInfo] = useState(false);
  // Loại người nhận người dùng tự chọn ở bước này; `null` là theo tên đang lưu.
  const [chosenMode, setChosenMode] = useState<PayeeMode | null>(null);
  const mode = chosenMode ?? inferPayeeMode(slots ? instance.attributeValues?.[slots.name]?.value : undefined, members);
  // Giá trị đã tự điền vào từng ô ngân hàng: chỉ những ô còn giữ đúng giá trị này (hoặc trống) mới được thay hay xoá.
  const autoFilled = useRef<Record<string, string>>({});
  // Mỗi lần chọn một số mới; kết quả tra của lần chọn cũ về muộn thì bỏ.
  const run = useRef(0);
  const latest = useRef({ instance, draft, setDraft, members, actorId, slots, mode });
  latest.current = { instance, draft, setDraft, members, actorId, slots, mode };

  const stepKey = `${instance.id}:${instance.currentStepId ?? ''}`;
  const defaulted = useRef<string | null>(null);
  useEffect(() => {
    setSelectedUserId(null);
    setMissingBankInfo(false);
    setChosenMode(null);
    autoFilled.current = {};
    run.current += 1;
    defaulted.current = null;
    // Khung xử lý vừa xoá nháp trong cùng lượt này; giá trị mặc định tính trên nháp rỗng.
    latest.current = { ...latest.current, draft: {} };
  }, [stepKey]);

  const choose = useCallback((userId: string | null) => {
    const current = latest.current.slots;
    if (!current) return;
    const ticket = ++run.current;
    const valueOf = (key: string) => {
      const { draft: draftNow, instance: instanceNow } = latest.current;
      return key in draftNow ? draftNow[key] : instanceNow.attributeValues?.[key]?.value;
    };
    // Đổi hay bỏ người: STK, ngân hàng tự điền của người trước đi theo, không đứng cạnh tên mới.
    const cleared = payeeBankChanges(current, valueOf, autoFilled.current, null);
    autoFilled.current = cleared.autoFilled;
    const label = userId ? latest.current.members.find((member) => member.userId === userId)?.displayName : undefined;
    const name: Draft = userId ? (label ? { [current.name]: { type: 'text', value: label } } : {}) : { [current.name]: null };
    setSelectedUserId(userId);
    setMissingBankInfo(false);
    latest.current.setDraft((draftNow) => ({ ...draftNow, ...cleared.changes, ...name }));
    if (!userId || (label && !current.accountNo && !current.bank)) return;

    void loadPayeeProfile(userId, latest.current.actorId).then((profile) => {
      if (ticket !== run.current) return;
      const filled = payeeBankChanges(current, valueOf, autoFilled.current, profile ?? {});
      autoFilled.current = filled.autoFilled;
      const changes: Draft = { ...filled.changes };
      // Người không có trong danh sách thành viên (chưa nạp xong): lấy tên theo hồ sơ nhân sự.
      const fullName = profile?.fullName?.trim();
      const nameNow = valueOf(current.name);
      if (!label && fullName && !(nameNow?.type === 'text' && nameNow.value.trim())) {
        changes[current.name] = { type: 'text', value: fullName };
      }
      setMissingBankInfo(
        Boolean(
          (current.accountNo && !profile?.bankAccountNumber?.trim()) || (current.bank && !profile?.bankName?.trim()),
        ),
      );
      if (Object.keys(changes).length) latest.current.setDraft((draftNow) => ({ ...draftNow, ...changes }));
    });
  }, []);

  // Mặc định là người tạo hồ sơ, một lần mỗi hồ sơ + bước, khi ô còn trống và người dùng chưa đụng tới. Đợi danh sách
  // thành viên có người tạo; người đang nhập chính là người tạo thì không cần đợi (tên lấy theo hồ sơ nhân sự).
  const nameKey = slots?.name;
  const initiatorLabel = members.find((member) => member.userId === instance.initiatedBy)?.displayName;
  useEffect(() => {
    if (!nameKey || defaulted.current === stepKey) return;
    const { instance: instanceNow, draft: draftNow, mode: modeNow } = latest.current;
    // Người nhận bên ngoài: không chọn sẵn ai, không tra hồ sơ nhân sự.
    if (modeNow === 'external') return;
    const isInitiator = Boolean(actorId) && actorId === instanceNow.initiatedBy;
    if (!initiatorLabel && !isInitiator) return;
    defaulted.current = stepKey;
    if (!payeeNameUntouched(instanceNow, draftNow, nameKey)) return;
    choose(instanceNow.initiatedBy);
  }, [stepKey, nameKey, initiatorLabel, actorId, choose]);

  const setMode = useCallback(
    (next: PayeeMode) => {
      const { slots: current, mode: modeNow, instance: instanceNow } = latest.current;
      if (!current || next === modeNow) return;
      // Kết quả tra của lần chọn trước về muộn thì bỏ; đã tự đổi loại thì thôi chọn sẵn người tạo hồ sơ.
      run.current += 1;
      defaulted.current = `${instanceNow.id}:${instanceNow.currentStepId ?? ''}`;
      setChosenMode(next);
      setSelectedUserId(null);
      setMissingBankInfo(false);
      if (next === 'external') {
        const valueOf = (key: string) => {
          const { draft: draftNow, instance: latestInstance } = latest.current;
          return key in draftNow ? draftNow[key] : latestInstance.attributeValues?.[key]?.value;
        };
        // STK, ngân hàng còn là giá trị tự điền thì xoá; ô gõ tay thì giữ.
        const cleared = payeeBankChanges(current, valueOf, autoFilled.current, null);
        autoFilled.current = cleared.autoFilled;
        latest.current.setDraft((draftNow) => ({ ...draftNow, ...cleared.changes, [current.name]: null }));
        return;
      }
      // Về nhân viên: tên đang là chữ gõ tay (hay trống) nên đặt lại người tạo hồ sơ, tự điền như lúc mở.
      latest.current.setDraft((draftNow) => ({ ...draftNow, [current.name]: null }));
      choose(instanceNow.initiatedBy || null);
    },
    [choose],
  );

  return slots
    ? { slots, selectedUserId, missingBankInfo, choose, mode, modeChosen: chosenMode !== null, setMode }
    : null;
}
