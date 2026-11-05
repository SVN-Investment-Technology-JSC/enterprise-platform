import {
  ACTIVITY_REMINDER_MINUTES_MAX,
  type CrmPerson,
  type CrmSettings,
  type CustomerGroup,
  type SaveCustomerGroupRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { normalizeCustomerCodeRule } from '../domain/customer-code.js';
import { isUuid, optionalText, requiredText } from '../domain/fields.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CustomerGroupRecord, CustomerGroupStore, PeopleDirectory, SettingsStore } from './sales-store.port.js';

const GROUP_CODE_PATTERN = /^[A-Z0-9._-]+$/;

/**
 * Nhóm khách hàng do tenant cấu hình. Ai có `crm.read` cũng đọc được (để lọc,
 * chọn nhóm); tạo, sửa, xoá cần `crm.manage`. Nhóm đang có khách không xoá được.
 */
export class CustomerGroupService {
  constructor(private readonly groups: CustomerGroupStore) {}

  async list(actor: CrmActor): Promise<CustomerGroup[]> {
    return this.groups.listGroups(actor.tenantId);
  }

  async create(actor: CrmActor, request: SaveCustomerGroupRequest): Promise<CustomerGroup> {
    requireSalesManager(actor);
    return this.groups.createGroup(actor.tenantId, groupRecord(request), actor.userId);
  }

  async update(actor: CrmActor, id: string, request: SaveCustomerGroupRequest): Promise<CustomerGroup> {
    requireSalesManager(actor);
    const record = groupRecord(request);
    const updated = isUuid(id) ? await this.groups.updateGroup(actor.tenantId, id, record, actor.userId) : undefined;
    if (!updated) throw new CrmNotFoundError('Không tìm thấy nhóm khách hàng.');
    return updated;
  }

  async remove(actor: CrmActor, id: string): Promise<void> {
    requireSalesManager(actor);
    const deleted = isUuid(id) && (await this.groups.deleteGroup(actor.tenantId, id));
    if (!deleted) throw new CrmNotFoundError('Không tìm thấy nhóm khách hàng.');
  }
}

export function groupRecord(request: SaveCustomerGroupRequest): CustomerGroupRecord {
  const code = requiredText(request.code, 50, 'mã nhóm').toUpperCase();
  if (!GROUP_CODE_PATTERN.test(code)) {
    throw new CrmValidationError(
      'INVALID_GROUP_CODE',
      'Mã nhóm chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang, gạch dưới.',
    );
  }
  return {
    code,
    name: requiredText(request.name, 200, 'tên nhóm'),
    description: optionalText(request.description, 1000, 'mô tả'),
  };
}

/** Cấu hình của phân hệ: ai cũng đọc được, chỉ `crm.manage` sửa. */
export class CrmSettingsService {
  constructor(private readonly settings: SettingsStore) {}

  async get(actor: CrmActor): Promise<CrmSettings> {
    const [customerCode, activityReminderMinutes] = await Promise.all([
      this.settings.customerCodeRule(actor.tenantId),
      this.settings.activityReminderMinutes(actor.tenantId),
    ]);
    return { customerCode, activityReminderMinutes };
  }

  async save(actor: CrmActor, request: Partial<CrmSettings>): Promise<CrmSettings> {
    requireSalesManager(actor);
    if (request.customerCode !== undefined) {
      const rule = normalizeCustomerCodeRule(request.customerCode ?? {});
      await this.settings.saveCustomerCodeRule(actor.tenantId, rule, actor.userId);
    }
    if (request.activityReminderMinutes !== undefined) {
      const minutes = Number(request.activityReminderMinutes);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > ACTIVITY_REMINDER_MINUTES_MAX) {
        throw new CrmValidationError(
          'INVALID_REMINDER',
          `Thời gian nhắc trước hạn phải là số phút từ 0 đến ${ACTIVITY_REMINDER_MINUTES_MAX}.`,
        );
      }
      await this.settings.saveActivityReminderMinutes(actor.tenantId, minutes, actor.userId);
    }
    return this.get(actor);
  }
}

/**
 * Danh bạ để chọn người phụ trách, người được giao: tên và id, thứ đã công khai
 * trên sơ đồ tổ chức. Không kèm quyền hay vai trò.
 */
export class CrmPeopleService {
  constructor(private readonly directory: PeopleDirectory) {}

  list(actor: CrmActor): Promise<CrmPerson[]> {
    return this.directory.people(actor.tenantId);
  }
}
