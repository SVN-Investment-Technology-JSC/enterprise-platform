import {
  abbreviate,
  formatLetterNumber,
  suggestRegister,
  type CatalogItem,
  type CorrespondenceSettings,
  type LetterDirection,
  type Register,
} from '@enterprise-platform/contracts-correspondence';
import { CorrespondenceValidationError } from './correspondence.error.js';

/**
 * Sổ đăng ký của một văn bản: sổ được chọn nếu có; không thì sổ đang dùng cùng luồng hợp độ mật (văn bản
 * có độ mật vào sổ mật, văn bản thường không vào sổ mật) và loại văn bản, sổ ghi đúng loại văn bản trước,
 * rồi sổ mặc định. Không sổ nào hợp thì sổ mặc định của luồng.
 */
export function pickRegister(
  registers: readonly Register[],
  direction: LetterDirection,
  letter: { readonly kind: string; readonly restricted: boolean },
  requestedId?: string,
): Register {
  const usable = registers.filter((item) => item.isActive && item.direction === direction);
  if (requestedId) {
    const requested = usable.find((item) => item.id === requestedId);
    if (!requested) throw new CorrespondenceValidationError('Sổ đăng ký được chọn không còn dùng, chọn sổ khác.');
    return requested;
  }
  const picked = suggestRegister(registers, direction, letter);
  if (!picked) {
    throw new CorrespondenceValidationError(
      `Chưa có sổ đăng ký ${direction === 'incoming' ? 'công văn đến' : 'công văn đi'} đang dùng. Vào Cấu hình, mục Sổ đăng ký.`,
    );
  }
  return picked;
}

/**
 * Số văn bản theo mẫu: văn bản đi dùng mẫu riêng của loại văn bản nếu có, không thì mẫu của sổ. Ký hiệu
 * loại văn bản, đơn vị lấy theo cấu hình; chưa đặt thì chữ cái đầu của tên.
 */
export function letterNumber(
  register: Pick<Register, 'direction' | 'numberFormat'>,
  type: Pick<CatalogItem, 'name' | 'abbreviation' | 'numberFormat'> | undefined,
  settings: Pick<CorrespondenceSettings, 'orgCode' | 'unitCodes'>,
  parts: { readonly seq: number; readonly year: number; readonly unitId?: string; readonly unitName?: string },
): string {
  const format = (register.direction === 'outgoing' && type?.numberFormat) || register.numberFormat;
  const unitCode = parts.unitId ? settings.unitCodes?.find((item) => item.unitId === parts.unitId)?.code : undefined;
  return formatLetterNumber(format, {
    seq: parts.seq,
    year: parts.year,
    type: type?.abbreviation || (type ? abbreviate(type.name) : undefined),
    org: settings.orgCode || undefined,
    unit: unitCode || (parts.unitName ? abbreviate(parts.unitName, true) : undefined),
  });
}
