import {
  FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES,
  type FinanceVoucherSourceField,
  type ProcedureAttributeValue,
  type ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { authFetch } from '@enterprise-platform/shared-ui';

/**
 * Tự điền người nhận tiền ở hồ sơ thanh toán.
 *
 * Hồ sơ có bước Tài chính lập phiếu chi thì các ô "Người nhận", "STK người nhận", "Ngân hàng người nhận" (nhận ra theo
 * cùng bộ mã mà bước Tài chính dùng để lấy dữ liệu phiếu, hoặc theo ánh xạ đã khai ở bước) được điền sẵn thông tin của
 * người tạo hồ sơ: tên, và số tài khoản, ngân hàng trong hồ sơ nhân sự. Chỉ điền ô đang mở cho người này nhập và còn
 * trống; thiếu dữ liệu thì để trống. Người dùng xoá hay sửa thoải mái; giá trị chỉ được lưu khi họ lưu nháp hay hoàn tất.
 *
 * "Người nhận" là ô chọn nhân sự (giá trị lưu vẫn là chữ: tên hiển thị, nên ánh xạ sang phiếu chi không đổi). Chọn người
 * khác thì STK, ngân hàng lấy theo hồ sơ nhân sự của người đó; bỏ chọn thì xoá hai ô nếu chúng còn là giá trị tự điền.
 */

export type PayeeField = Extract<FinanceVoucherSourceField, 'counterpartyName' | 'counterpartyAccountNo' | 'counterpartyBank'>;

const PAYEE_FIELDS: readonly PayeeField[] = ['counterpartyName', 'counterpartyAccountNo', 'counterpartyBank'];

/** Hồ sơ có bước Tài chính lập phiếu chi (hồ sơ thanh toán). */
export function isPaymentProcedure(instance: Pick<ProcedureInstance, 'steps'>): boolean {
  return instance.steps.some(
    (step) => step.integration?.module === 'finance' && step.integration.voucherKind === 'PAYMENT',
  );
}

/** Khoá các ô người nhận đang mở cho người này nhập, theo từng trường của phiếu. */
export function payeeSlotKeys(instance: ProcedureInstance): Map<string, PayeeField> {
  const result = new Map<string, PayeeField>();
  if (!isPaymentProcedure(instance)) return result;
  const editable = new Set(instance.authorization?.editableAttributeKeys ?? []);
  if (!editable.size) return result;

  const textSlots: { key: string; code: string }[] = [];
  for (const attribute of instance.flow?.attributes ?? []) {
    if (attribute.type === 'text') textSlots.push({ key: `process:${attribute.code}`, code: attribute.code.toLowerCase() });
  }
  for (const step of instance.steps) {
    for (const attribute of step.attributes ?? []) {
      if (attribute.type === 'text') {
        textSlots.push({ key: `step:${step.definitionStepId}:${attribute.code}`, code: attribute.code.toLowerCase() });
      }
    }
  }
  const textKeys = new Set(textSlots.map((slot) => slot.key));

  // Ánh xạ khai ở bước Tài chính thắng mã chuẩn, cùng luật với lúc gửi phiếu.
  const mapping = instance.steps.find((step) => step.integration?.voucherKind === 'PAYMENT')?.integration?.mapping ?? {};
  for (const field of PAYEE_FIELDS) {
    const mapped = mapping[field];
    if (mapped) {
      if (editable.has(mapped) && textKeys.has(mapped)) result.set(mapped, field);
      continue;
    }
    for (const code of FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES[field]) {
      const slot = textSlots.find((candidate) => candidate.code === code && editable.has(candidate.key));
      if (slot && !result.has(slot.key)) {
        result.set(slot.key, field);
        break;
      }
    }
  }
  return result;
}

const isBlank = (value: ProcedureAttributeValue | null | undefined) =>
  value === null || value === undefined || (value.type === 'text' && !value.value.trim());

/** Ô "Người nhận" và hai ô ngân hàng của hồ sơ thanh toán (chỉ ô đang mở cho người này nhập). */
export interface PayeeSlots {
  readonly name: string;
  readonly accountNo?: string;
  readonly bank?: string;
}

/** Không phải hồ sơ thanh toán, hay ô "Người nhận" không mở cho người này nhập, thì `null`. */
export function payeeSlots(instance: ProcedureInstance): PayeeSlots | null {
  const byField = new Map([...payeeSlotKeys(instance)].map(([key, field]) => [field, key]));
  const name = byField.get('counterpartyName');
  if (!name) return null;
  return { name, accountNo: byField.get('counterpartyAccountNo'), bank: byField.get('counterpartyBank') };
}

/** Ô "Người nhận" đang trống và người dùng chưa đụng tới: được điền mặc định người tạo hồ sơ. */
export function payeeNameUntouched(
  instance: ProcedureInstance,
  draft: Readonly<Record<string, ProcedureAttributeValue | null>>,
  nameKey: string,
): boolean {
  return !(nameKey in draft) && isBlank(instance.attributeValues?.[nameKey]?.value);
}

/**
 * Thay STK, ngân hàng theo người nhận vừa chọn; `profile` null là bỏ chọn (xoá). Chỉ đụng ô còn trống hoặc còn giữ
 * đúng giá trị đã tự điền lần trước (`autoFilled`); ô người dùng tự gõ thì giữ nguyên và thôi coi là ô tự điền.
 * Hồ sơ không có hay không được xem STK, ngân hàng thì ô tự điền cũ bị xoá, không để STK người trước đứng cạnh tên mới.
 */
export function payeeBankChanges(
  slots: PayeeSlots,
  valueOf: (key: string) => ProcedureAttributeValue | null | undefined,
  autoFilled: Readonly<Record<string, string>>,
  profile: Pick<PayeeProfile, 'bankAccountNumber' | 'bankName'> | null,
): { changes: Record<string, ProcedureAttributeValue | null>; autoFilled: Record<string, string> } {
  const changes: Record<string, ProcedureAttributeValue | null> = {};
  const nextAutoFilled = { ...autoFilled };
  const targets: [string | undefined, string | null | undefined][] = [
    [slots.accountNo, profile?.bankAccountNumber],
    [slots.bank, profile?.bankName],
  ];
  for (const [key, wanted] of targets) {
    if (!key) continue;
    const current = valueOf(key);
    const text = current?.type === 'text' ? current.value : '';
    delete nextAutoFilled[key];
    if (text.trim() && text !== autoFilled[key]) continue;
    const value = wanted?.trim();
    if (value) {
      nextAutoFilled[key] = value;
      if (text !== value) changes[key] = { type: 'text', value };
    } else if (text) {
      changes[key] = null;
    }
  }
  return { changes, autoFilled: nextAutoFilled };
}

export interface PayeeProfile {
  readonly fullName?: string | null;
  readonly bankAccountNumber?: string | null;
  readonly bankName?: string | null;
}

let myProfile: Promise<PayeeProfile | null> | null = null;

/**
 * Hồ sơ nhân sự của chính người đang đăng nhập (chỉ đọc). Không có hồ sơ hay không có quyền thì `null`, không báo lỗi:
 * tự điền chỉ là tiện ích. Nạp một lần mỗi phiên trang; lỗi thì lần sau thử lại.
 */
export function loadMyPayeeProfile(): Promise<PayeeProfile | null> {
  if (!myProfile) {
    myProfile = authFetch('/api/hrm/v1/my-profile')
      .then(async (response) => {
        if (!response.ok) return null;
        const body = (await response.json().catch(() => null)) as { data?: PayeeProfile } | null;
        return body?.data ?? null;
      })
      .catch(() => null)
      .then((profile) => {
        if (!profile) myProfile = null;
        return profile;
      });
  }
  return myProfile;
}

const otherProfiles = new Map<string, Promise<PayeeProfile | null>>();

/**
 * Tên, STK, ngân hàng của người được chọn làm người nhận. Chính mình thì đọc hồ sơ của mình; người khác thì HRM trả
 * theo luật dữ liệu nhạy cảm: không phải chính chủ, không có quyền xem dữ liệu nhạy cảm thì STK, ngân hàng là null.
 * Lỗi hay chưa có hồ sơ thì `null`, không báo lỗi; lần sau thử lại.
 */
export function loadPayeeProfile(userId: string, actorId?: string): Promise<PayeeProfile | null> {
  if (actorId && userId === actorId) return loadMyPayeeProfile();
  let pending = otherProfiles.get(userId);
  if (!pending) {
    pending = authFetch(`/api/hrm/v1/employees/by-user/${encodeURIComponent(userId)}/payee`)
      .then(async (response) => {
        if (!response.ok) return null;
        const body = (await response.json().catch(() => null)) as { data?: PayeeProfile } | null;
        return body?.data ?? null;
      })
      .catch(() => null)
      .then((profile) => {
        if (!profile) otherProfiles.delete(userId);
        return profile;
      });
    otherProfiles.set(userId, pending);
  }
  return pending;
}

/** Chỉ cho test: quên hồ sơ đã nạp. */
export function resetMyPayeeProfileCache(): void {
  myProfile = null;
  otherProfiles.clear();
}
