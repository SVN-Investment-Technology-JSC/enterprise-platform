import {
  CATALOG_CODE_PATTERN,
  CATALOG_KINDS,
  DISPATCH_MODES,
  LETTER_DIRECTIONS,
  conditionSet,
  numberFormatError,
  type CatalogItem,
  type CorrespondenceSettings,
  type LetterCondition,
  type LetterDirection,
  type QuickCatalogItemRequest,
  type Register,
  type SaveCatalogItemRequest,
  type SaveRegisterRequest,
  type SaveWorkflowRequest,
  type Workflow,
} from '@enterprise-platform/contracts-correspondence';
import { normalizeCondition, normalizeSteps } from '../../domain/approvers.js';
import { CorrespondenceForbiddenError, CorrespondenceValidationError } from '../../domain/correspondence.error.js';
import { type CorrespondenceActor } from '../ports.js';
import {
  MAX_UNITS_PER_LETTER,
  unitCodeList,
  optionalNumberFormat,
  foldName,
  catalogCode,
  requireText,
  optionalText,
  requireEnum,
  parseOptional,
} from '../core/letter-helpers.js';
import { CorrespondenceCore } from '../core/correspondence-core.js';

/** Cấu hình: cài đặt, danh mục, quy trình, sổ đăng ký. */
export class CorrespondenceConfiguration extends CorrespondenceCore {
  async saveSettings(actor: CorrespondenceActor, input: CorrespondenceSettings): Promise<CorrespondenceSettings> {
    this.requireConfigure(actor);
    const days = Number(input?.defaultDueDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      throw new CorrespondenceValidationError('Hạn xử lý mặc định là số ngày từ 0 đến 365.');
    }
    const settings: CorrespondenceSettings = {
      incomingSuffix: requireText(input?.incomingSuffix, 'Ký hiệu số đến', 30),
      outgoingSuffix: requireText(input?.outgoingSuffix, 'Ký hiệu số đi', 30),
      archivePrefix: requireText(input?.archivePrefix, 'Tiền tố số hồ sơ', 20),
      defaultDueDays: days,
      dispatchMode: parseOptional(input?.dispatchMode, DISPATCH_MODES, 'Cách giao phòng ban') ?? 'all',
      clerkUserIds: await this.clerkList(actor.tenantId, input?.clerkUserIds),
      delegations: await this.delegationList(actor.tenantId, input?.delegations),
      orgCode: optionalText(input?.orgCode, 'Ký hiệu cơ quan', 20) ?? '',
      unitCodes: unitCodeList(input?.unitCodes),
    };
    await this.store.saveSettings(actor.tenantId, actor.userId, settings);
    return settings;
  }

  async saveCatalogItem(actor: CorrespondenceActor, id: string | undefined, input: SaveCatalogItemRequest): Promise<CatalogItem> {
    this.requireConfigure(actor);
    const kind = requireEnum(input?.kind, CATALOG_KINDS, 'Loại danh mục');
    const code = String(input?.code ?? '').trim().toLowerCase();
    if (!CATALOG_CODE_PATTERN.test(code)) {
      throw new CorrespondenceValidationError('Mã chỉ gồm chữ thường không dấu, số, gạch ngang, gạch dưới (tối đa 40 ký tự).');
    }
    const existing = id ? (await this.store.catalog(actor.tenantId)).find((item) => item.id === id) : undefined;
    if (id && !existing) throw new CorrespondenceValidationError('Mục danh mục không còn, tải lại trang.');
    if (existing && (existing.kind !== kind || (existing.inUse && existing.code !== code))) {
      throw new CorrespondenceValidationError('Mục đã có công văn dùng nên không đổi được mã hay loại.');
    }
    const due = input?.defaultDueDays as unknown;
    const defaultDueDays = due === undefined || due === null || due === '' ? null : Number(due);
    if (defaultDueDays !== null && (!Number.isInteger(defaultDueDays) || defaultDueDays < 0 || defaultDueDays > 365)) {
      throw new CorrespondenceValidationError('Hạn xử lý mặc định là số ngày từ 0 đến 365.');
    }
    const workflows = await this.store.workflows(actor.tenantId);
    const workflowFor = (value: unknown, direction: LetterDirection) => {
      const wanted = optionalText(value, 'Quy trình', 64);
      if (!wanted) return null;
      if (!workflows.some((item) => item.id === wanted && item.direction === direction)) {
        throw new CorrespondenceValidationError(`Quy trình ${direction === 'incoming' ? 'công văn đến' : 'công văn đi'} được chọn không còn.`);
      }
      return wanted;
    };
    const defaultUnitIds = [...new Set((Array.isArray(input?.defaultUnitIds) ? input.defaultUnitIds : []).map(String).filter(Boolean))];
    if (defaultUnitIds.length > MAX_UNITS_PER_LETTER) throw new CorrespondenceValidationError(`Tối đa ${MAX_UNITS_PER_LETTER} phòng ban gợi ý.`);
    const sortOrder = Number(input?.sortOrder ?? 0);
    const letterType = kind === 'letter_type';
    return this.store.saveCatalogItem(actor.tenantId, actor.userId, id, {
      kind,
      code,
      name: requireText(input?.name, 'Tên', 120),
      sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
      isActive: input?.isActive !== false,
      defaultDueDays: letterType ? defaultDueDays : null,
      workflowId: letterType ? workflowFor(input?.workflowId, 'incoming') : null,
      outgoingWorkflowId: letterType ? workflowFor(input?.outgoingWorkflowId, 'outgoing') : null,
      defaultUnitIds: letterType ? defaultUnitIds : [],
      highlight: kind === 'urgency' && input?.highlight === true,
      restricted: kind === 'confidentiality' && input?.restricted === true,
      abbreviation: letterType ? (optionalText(input?.abbreviation, 'Ký hiệu viết tắt', 20) ?? null) : null,
      numberFormat: letterType ? optionalNumberFormat(input?.numberFormat) : null,
    });
  }

  /**
   * Thêm nhanh mục danh mục lúc nhập công văn (nút "+" cạnh ô chọn): người cấu hình và văn thư
   * làm được. Chỉ cần tên; mã tự sinh từ tên, xếp cuối danh mục, các tuỳ chọn khác để mặc định
   * (sửa thêm trong Cấu hình). Tên đã có thì trả mục đó, không tạo trùng.
   */
  async quickAddCatalogItem(original: CorrespondenceActor, input: QuickCatalogItemRequest): Promise<CatalogItem> {
    const actor = await this.effective(original);
    if (!actor.canConfigure && !actor.isTenantAdmin && !actor.canRegister) {
      throw new CorrespondenceForbiddenError('Bạn không có quyền thêm danh mục văn thư.');
    }
    const kind = requireEnum(input?.kind, CATALOG_KINDS, 'Loại danh mục');
    const name = requireText(input?.name, 'Tên', 120).replace(/\s+/g, ' ');
    const items = (await this.store.catalog(actor.tenantId)).filter((item) => item.kind === kind);
    const same = items.find((item) => foldName(item.name) === foldName(name));
    if (same) {
      if (!same.isActive) throw new CorrespondenceValidationError(`"${same.name}" đã có nhưng đang ngừng dùng. Vào Cấu hình để dùng lại.`);
      return same;
    }
    const base = catalogCode(name);
    const taken = new Set(items.map((item) => item.code));
    let code = base;
    for (let index = 2; taken.has(code); index += 1) code = `${base.slice(0, 36)}-${index}`;
    return this.store.saveCatalogItem(actor.tenantId, actor.userId, undefined, {
      kind,
      code,
      name,
      sortOrder: items.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 10,
      isActive: true,
      defaultDueDays: null,
      workflowId: null,
      outgoingWorkflowId: null,
      defaultUnitIds: [],
      highlight: false,
      restricted: false,
      abbreviation: null,
      numberFormat: null,
    });
  }

  async deleteCatalogItem(actor: CorrespondenceActor, id: string): Promise<void> {
    this.requireConfigure(actor);
    if (!(await this.store.deleteCatalogItem(actor.tenantId, id))) {
      throw new CorrespondenceValidationError('Mục đã có công văn dùng nên không xoá được; hãy ngừng dùng.');
    }
  }

  async saveWorkflow(actor: CorrespondenceActor, id: string | undefined, input: SaveWorkflowRequest): Promise<Workflow> {
    this.requireConfigure(actor);
    const direction = requireEnum(input?.direction, LETTER_DIRECTIONS, 'Luồng công văn');
    const steps = normalizeSteps(input?.steps);
    const conditions = normalizeCondition(input?.conditions);
    // Mã trong điều kiện, phòng ban cố định phải còn trong danh mục / sơ đồ tổ chức.
    const [catalog, snapshot] = await Promise.all([this.catalogMap(actor.tenantId), this.organization.snapshot(actor.tenantId)]);
    const checkCodes = (condition: LetterCondition | undefined, where: string) => {
      for (const [field, kind] of [['kinds', 'letter_type'], ['urgency', 'urgency'], ['confidentiality', 'confidentiality']] as const) {
        if ((condition?.[field] ?? []).some((code) => !catalog.get(kind)?.has(code))) {
          throw new CorrespondenceValidationError(`${where}: điều kiện có mục không còn trong danh mục.`);
        }
      }
    };
    checkCodes(conditions, 'Quy trình');
    for (const step of steps) {
      checkCodes(step.condition, `Bước "${step.name}"`);
      if ((step.units ?? []).some((unit) => !snapshot.nodes.some((node) => node.id === unit.unitId && node.kind === 'unit'))) {
        throw new CorrespondenceValidationError(`Bước "${step.name}": phòng ban cố định không còn trong sơ đồ tổ chức.`);
      }
    }
    const isDefault = input?.isDefault === true;
    const isActive = input?.isActive !== false;
    if (isDefault && !isActive) throw new CorrespondenceValidationError('Quy trình mặc định phải đang dùng.');
    const existing = id ? (await this.store.workflows(actor.tenantId)).find((item) => item.id === id) : undefined;
    if (id && !existing) throw new CorrespondenceValidationError('Quy trình không còn, tải lại trang.');
    if (existing && existing.direction !== direction) {
      throw new CorrespondenceValidationError('Không đổi được luồng của quy trình đã có; tạo quy trình mới cho luồng kia.');
    }
    if (existing?.isDefault && !isDefault) {
      throw new CorrespondenceValidationError('Đặt một quy trình khác làm mặc định trước khi bỏ cờ mặc định của quy trình này.');
    }
    return this.store.saveWorkflow(actor.tenantId, actor.userId, id, {
      name: requireText(input?.name, 'Tên quy trình', 160),
      description: optionalText(input?.description, 'Mô tả', 2000) ?? null,
      direction,
      isActive,
      isDefault,
      startName: optionalText(input?.startName, 'Tên ô đầu', 160) ?? null,
      endName: optionalText(input?.endName, 'Tên ô cuối', 160) ?? null,
      autoStart: direction === 'incoming' && input?.autoStart === true,
      endActor: input?.autoEnd === true || !input?.endActor ? null : this.endActorRule(input.endActor),
      autoEnd: input?.autoEnd === true,
      archive: input?.archive !== false,
      steps,
      conditions: conditionSet(conditions) ? conditions : null,
    });
  }

  async deleteWorkflow(actor: CorrespondenceActor, id: string): Promise<void> {
    this.requireConfigure(actor);
    const workflow = (await this.store.workflows(actor.tenantId)).find((item) => item.id === id);
    if (workflow?.isDefault) throw new CorrespondenceValidationError('Không xoá được quy trình mặc định; chọn quy trình mặc định khác trước.');
    if (!workflow) throw new CorrespondenceValidationError('Quy trình không còn, tải lại trang.');
    const result = await this.store.deleteWorkflow(actor.tenantId, id);
    if (!result.deleted) {
      // Nói rõ cái gì đang dùng quy trình: loại văn bản phải gỡ trước; công văn đã chạy thì giữ lịch sử, ngừng dùng.
      const reasons = [
        result.types.length > 0 ? `đang gắn với loại văn bản ${result.types.join(', ')} (gỡ ở Cấu hình, Danh mục)` : '',
        result.letterCount > 0
          ? `có ${result.letterCount} công văn đã chạy hay đang chọn quy trình này (${result.letters.join(', ')}${result.letterCount > result.letters.length ? ', …' : ''})`
          : '',
      ].filter(Boolean);
      throw new CorrespondenceValidationError(
        `Không xoá được "${workflow.name}": ${reasons.join('; ')}.${result.letterCount > 0 ? ' Công văn đã chạy cần giữ lịch sử, hãy ngừng dùng quy trình.' : ''}`,
      );
    }
  }

  /** Sổ đăng ký: tên, luồng, mẫu số, sổ mật, loại văn bản; sổ mặc định luôn đang dùng và không là sổ mật. */
  async saveRegister(actor: CorrespondenceActor, id: string | undefined, input: SaveRegisterRequest): Promise<Register> {
    this.requireConfigure(actor);
    const direction = requireEnum(input?.direction, LETTER_DIRECTIONS, 'Luồng');
    const numberFormat = String(input?.numberFormat ?? '').trim();
    const formatError = numberFormatError(numberFormat);
    if (formatError) throw new CorrespondenceValidationError(formatError);
    const [registers, catalog] = await Promise.all([this.store.registers(actor.tenantId), this.store.catalog(actor.tenantId)]);
    const existing = id ? registers.find((item) => item.id === id) : undefined;
    if (id && !existing) throw new CorrespondenceValidationError('Sổ đăng ký không còn, tải lại trang.');
    if (existing?.inUse && existing.direction !== direction) {
      throw new CorrespondenceValidationError('Sổ đã có công văn nên không đổi được luồng.');
    }
    const types = new Set(catalog.filter((item) => item.kind === 'letter_type').map((item) => item.code));
    const letterTypes = [...new Set((Array.isArray(input?.letterTypes) ? input.letterTypes : []).map(String).filter(Boolean))];
    if (letterTypes.some((code) => !types.has(code))) throw new CorrespondenceValidationError('Loại văn bản được chọn không còn trong danh mục.');
    const isDefault = input?.isDefault === true || Boolean(existing?.isDefault);
    const isActive = input?.isActive !== false;
    const confidential = input?.confidential === true;
    if (isDefault && !isActive) throw new CorrespondenceValidationError('Sổ mặc định phải đang dùng; chọn sổ mặc định khác trước.');
    if (isDefault && confidential) throw new CorrespondenceValidationError('Sổ mặc định không là sổ mật.');
    const sortOrder = Number(input?.sortOrder ?? existing?.sortOrder ?? 0);
    return this.store.saveRegister(actor.tenantId, actor.userId, id, {
      direction,
      name: requireText(input?.name, 'Tên sổ', 160),
      numberFormat,
      confidential,
      letterTypes,
      isDefault,
      isActive,
      sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
    });
  }

  async deleteRegister(actor: CorrespondenceActor, id: string): Promise<void> {
    this.requireConfigure(actor);
    const register = (await this.store.registers(actor.tenantId)).find((item) => item.id === id);
    if (register?.isDefault) throw new CorrespondenceValidationError('Không xoá được sổ mặc định; chọn sổ mặc định khác trước.');
    if (!(await this.store.deleteRegister(actor.tenantId, id))) {
      throw new CorrespondenceValidationError('Sổ đã có công văn nên không xoá được; hãy ngừng dùng.');
    }
  }
}
