import { SocialError } from './social.error.js';

/** Người không có trong danh bạ (đã nghỉ việc) hoặc id sai. */
export class SocialPersonNotFoundError extends SocialError {
  constructor() {
    super('PERSON_NOT_FOUND', 'Không tìm thấy người này.', 404);
    Object.setPrototypeOf(this, SocialPersonNotFoundError.prototype);
  }
}
