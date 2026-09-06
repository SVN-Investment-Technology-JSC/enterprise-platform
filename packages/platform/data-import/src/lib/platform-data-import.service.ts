import {
  dataImportRowCounts,
  requiredDataImportModules,
  type DataImportCheck,
  type DataImportDataset,
  type DataImportExecutionResponse,
  type DataImportIssue,
  type DataImportModuleKey,
  type DataImportPreviewResponse,
  type DataImportTenantTarget,
  type InternalDataImportValidationResponse,
} from '@enterprise-platform/contracts-data-import';
import { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  parseDataImportFiles,
  type UploadedDataImportFile,
} from './data-import-file.parser.js';
import {
  validateImportDataset,
  type ExistingCoreImportState,
} from './data-import-validation.js';

@Injectable()
export class PlatformDataImportService {
  constructor(private readonly identity: PlatformIdentityService) {}

  async preview(
    tenantId: string,
    files: readonly UploadedDataImportFile[],
  ): Promise<DataImportPreviewResponse> {
    const parsed = await parseDataImportFiles(files);
    return this.buildPreview(
      tenantId,
      parsed.dataset,
      parsed.sourceFiles,
      parsed.issues,
    );
  }

  async execute(
    tenantId: string,
    expectedPreviewId: string,
    actorId: string,
    files: readonly UploadedDataImportFile[],
  ): Promise<DataImportExecutionResponse> {
    const parsed = await parseDataImportFiles(files);
    const preview = await this.buildPreview(
      tenantId,
      parsed.dataset,
      parsed.sourceFiles,
      parsed.issues,
    );
    if (!expectedPreviewId || preview.previewId !== expectedPreviewId) {
      throw new BadRequestException(
        'File hoặc tenant đã thay đổi sau khi kiểm tra. Hãy kiểm tra lại trước khi import.',
      );
    }
    if (!preview.valid || !preview.target) {
      throw new BadRequestException({
        code: 'DATA_IMPORT_VALIDATION_FAILED',
        message: 'Dữ liệu chưa hợp lệ; import đã bị chặn.',
        preview,
      });
    }

    const importId = randomUUID();
    try {
      const organizationNodeIds = await this.importCoreData(
        tenantId,
        parsed.dataset,
      );
      if (preview.requiredModules.includes('inventory')) {
        await this.executeModule('inventory', tenantId, {
          dataset: parsed.dataset,
          organizationNodeIds,
        });
      }
      let procedureDefinitionIds: Record<string, string> = {};
      if (preview.requiredModules.includes('procedure-engine')) {
        const result = await this.executeModule('procedure-engine', tenantId, {
          dataset: parsed.dataset,
          organizationNodeIds,
        });
        procedureDefinitionIds = stringRecord(result.definitionIds);
      }
      if (preview.requiredModules.includes('maintenance')) {
        await this.executeModule('maintenance', tenantId, {
          dataset: parsed.dataset,
          procedureDefinitionIds,
        });
      }
      await this.identity.recordDataImport({
        actorId,
        tenantId,
        importId,
        status: 'completed',
        sourceFiles: parsed.sourceFiles,
        rowCounts: preview.rowCounts,
      });
    } catch (error) {
      await this.identity.recordDataImport({
        actorId,
        tenantId,
        importId,
        status: 'failed',
        sourceFiles: parsed.sourceFiles,
        rowCounts: preview.rowCounts,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return {
      status: 'completed',
      importId,
      target: preview.target,
      importedRows: preview.rowCounts,
      completedAt: new Date().toISOString(),
    };
  }

  private async buildPreview(
    tenantIdInput: string,
    dataset: DataImportDataset,
    sourceFiles: readonly string[],
    parseIssues: readonly DataImportIssue[],
  ): Promise<DataImportPreviewResponse> {
    const tenantId = tenantIdInput?.trim();
    if (!tenantId) throw new BadRequestException('tenantId là bắt buộc.');
    const previewId = this.fingerprint(tenantId, dataset);
    const requiredModules = requiredDataImportModules(dataset);
    const checks: DataImportCheck[] = [];
    const issues: DataImportIssue[] = [...parseIssues];
    const tenant = (await this.identity.listTenants()).find(
      (candidate) => candidate.id === tenantId,
    );
    if (!tenant) {
      checks.push({
        key: 'tenant',
        label: 'Tenant tồn tại',
        status: 'failed',
        detail: 'Không tìm thấy tenant đã chọn.',
      });
      issues.push(systemError('TENANT_NOT_FOUND', 'Không tìm thấy tenant đã chọn.'));
      return {
        previewId,
        valid: false,
        sourceFiles,
        requiredModules,
        rowCounts: dataImportRowCounts(dataset),
        checks,
        issues,
      };
    }

    const target: DataImportTenantTarget = {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      adminEmail: tenant.admin?.email,
    };
    const activeTenant = tenant.status === 'active';
    checks.push({
      key: 'tenant',
      label: 'Tenant tồn tại và đang hoạt động',
      status: activeTenant ? 'passed' : 'failed',
      detail: activeTenant
        ? `${tenant.name} (${tenant.slug})`
        : 'Tenant đang bị khóa.',
    });
    if (!activeTenant) issues.push(systemError('TENANT_DISABLED', 'Tenant đang bị khóa.'));

    let existing: ExistingCoreImportState = {
      userEmails: new Set(),
      nodeTypeCodes: new Set(),
      treeCodes: new Set(),
      nodeCodes: new Set(),
      assignmentKeys: new Set(),
    };
    let coreReady = false;
    let adminReady = false;
    if (tenant.database) {
      try {
        const [usersRaw, organizationRaw] = await Promise.all([
          this.identity.coreUsers(tenantId),
          this.identity.coreOrganizationSnapshot(tenantId),
        ]);
        const users = usersRaw as CoreUser[];
        const organization = organizationRaw as CoreOrganizationSnapshot;
        const nodeCodeById = new Map(
          organization.nodes.map((item) => [item.id, item.code]),
        );
        const userEmailById = new Map(
          organization.users.map((item) => [item.id, item.email.toLowerCase()]),
        );
        existing = {
          userEmails: new Set(users.map((user) => user.email.toLowerCase())),
          nodeTypeCodes: new Set(organization.nodeTypes.map((item) => item.code)),
          treeCodes: new Set(organization.trees.map((item) => item.code)),
          nodeCodes: new Set(organization.nodes.map((item) => item.code)),
          assignmentKeys: new Set(
            organization.assignments.flatMap((assignment) => {
              const nodeCode = nodeCodeById.get(assignment.nodeId);
              const email = userEmailById.get(assignment.userId);
              return nodeCode && email ? [`${nodeCode}:${email}`] : [];
            }),
          ),
        };
        coreReady = true;
        adminReady = Boolean(
          tenant.admin &&
            users.some(
              (user) =>
                user.email.toLowerCase() === tenant.admin?.email.toLowerCase() &&
                user.systemRole === 'tenant-admin' &&
                user.isActive !== false,
            ),
        );
      } catch (error) {
        issues.push(
          systemError(
            'TENANT_DATABASE_UNAVAILABLE',
            `Không thể đọc Tenant Core: ${messageOf(error)}`,
          ),
        );
      }
    }
    checks.push({
      key: 'tenant-database',
      label: 'Tenant Database và Core schema sẵn sàng',
      status: coreReady ? 'passed' : 'failed',
      detail: coreReady
        ? tenant.database?.databaseName ?? 'Đã kết nối'
        : 'Chưa có cấu hình hoặc không thể kết nối database.',
    });
    checks.push({
      key: 'tenant-admin',
      label: 'Tenant Admin đã tồn tại',
      status: adminReady ? 'passed' : 'failed',
      detail: adminReady
        ? tenant.admin?.email ?? 'Đã xác nhận'
        : 'Thiếu Tenant Admin hoạt động trong Tenant Core.',
    });
    if (!adminReady) {
      issues.push(
        systemError(
          'TENANT_ADMIN_MISSING',
          'Tenant chưa có Tenant Admin hoạt động đồng nhất giữa Platform và Tenant Core.',
        ),
      );
    }

    issues.push(...validateImportDataset(dataset, existing));

    const overview = await this.identity.tenantEntitlementOverview(tenantId);
    for (const moduleKey of ['inventory', 'procedure-engine', 'maintenance'] as const) {
      const required = requiredModules.includes(moduleKey);
      const registered = overview.modules.find((item) => item.key === moduleKey);
      const entitled = registered?.entitlementStatus === 'active';
      checks.push({
        key: `module:${moduleKey}`,
        label: `Module ${moduleKey}`,
        status: required ? (entitled ? 'passed' : 'failed') : 'not-required',
        detail: required
          ? registered
            ? `Entitlement: ${registered.entitlementStatus}`
            : 'Module chưa được đăng ký.'
          : 'File không có dữ liệu cho module này.',
      });
      if (!required) {
        checks.push({
          key: `schema:${moduleKey}`,
          label: `Schema ${moduleKey}`,
          status: 'not-required',
          detail: 'Không cần kiểm tra.',
        });
        continue;
      }
      if (!entitled) {
        issues.push(
          systemError(
            registered ? 'MODULE_NOT_ENTITLED' : 'MODULE_NOT_REGISTERED',
            registered
              ? `Tenant chưa được cấp module ${moduleKey} ở trạng thái active.`
              : `Module ${moduleKey} chưa tồn tại trong registry.`,
          ),
        );
        checks.push({
          key: `schema:${moduleKey}`,
          label: `Schema ${moduleKey}`,
          status: 'failed',
          detail: 'Không kiểm tra vì entitlement chưa active.',
        });
        continue;
      }
      const validation = await this.validateModule(moduleKey, tenantId, dataset);
      issues.push(...validation.issues);
      const moduleValid = validation.schemaReady && validation.valid;
      checks.push({
        key: `schema:${moduleKey}`,
        label: `Schema và dữ liệu ${moduleKey}`,
        status: moduleValid ? 'passed' : 'failed',
        detail: !validation.schemaReady
          ? 'Service không đọc được schema của module.'
          : validation.valid
            ? 'Service đã kết nối được schema và kiểm tra dữ liệu.'
            : 'Schema sẵn sàng nhưng dữ liệu module chưa hợp lệ.',
      });
    }

    checks.unshift({
      key: 'file',
      label: 'Cấu trúc file',
      status: issues.some(
        (issue) =>
          issue.level === 'error' &&
          issue.code !== 'TENANT_NOT_FOUND' &&
          !issue.code.startsWith('MODULE_') &&
          !issue.code.startsWith('TENANT_'),
      )
        ? 'failed'
        : 'passed',
      detail: `${Object.values(dataImportRowCounts(dataset)).reduce((sum, count) => sum + count, 0)} dòng dữ liệu được nhận diện.`,
    });

    return {
      previewId,
      valid:
        !issues.some((issue) => issue.level === 'error') &&
        !checks.some((check) => check.status === 'failed'),
      sourceFiles,
      target,
      requiredModules,
      rowCounts: dataImportRowCounts(dataset),
      checks,
      issues,
    };
  }

  private async validateModule(
    moduleKey: DataImportModuleKey,
    tenantId: string,
    dataset: DataImportDataset,
  ): Promise<InternalDataImportValidationResponse> {
    try {
      return (await this.callModule(moduleKey, 'validate', tenantId, {
        dataset,
      })) as unknown as InternalDataImportValidationResponse;
    } catch (error) {
      return {
        valid: false,
        schemaReady: false,
        issues: [
          systemError(
            'MODULE_SCHEMA_UNAVAILABLE',
            `Không thể kiểm tra ${moduleKey}: ${messageOf(error)}`,
          ),
        ],
      };
    }
  }

  private async executeModule(
    moduleKey: DataImportModuleKey,
    tenantId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.callModule(moduleKey, 'execute', tenantId, body);
  }

  private async callModule(
    moduleKey: DataImportModuleKey,
    action: 'validate' | 'execute',
    tenantId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const token = process.env.INTERNAL_SERVICE_TOKEN;
    if (!token) {
      throw new ServiceUnavailableException(
        'INTERNAL_SERVICE_TOKEN chưa được cấu hình.',
      );
    }
    const response = await fetch(
      `${moduleRoot(moduleKey)}/v1/internal/data-import/${action}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': token,
          'x-tenant-id': tenantId,
        },
        body: JSON.stringify(body),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        typeof payload.message === 'string'
          ? payload.message
          : `${moduleKey} trả về HTTP ${response.status}.`,
      );
    }
    return payload;
  }

  private async importCoreData(
    tenantId: string,
    dataset: DataImportDataset,
  ): Promise<Record<string, string>> {
    for (const user of dataset.users) {
      await this.identity.createCoreUser(tenantId, {
        fullName: user.fullName,
        email: user.email,
        password: user.temporaryPassword,
        systemRole: user.systemRole,
      });
    }

    const initial = (await this.identity.coreOrganizationSnapshot(
      tenantId,
    )) as CoreOrganizationSnapshot;
    const typeIds = new Map(initial.nodeTypes.map((item) => [item.code, item.id]));
    for (const item of dataset.organizationNodeTypes) {
      const created = entity(
        await this.identity.createCoreOrganizationResource(
          tenantId,
          'node-types',
          item as unknown as Record<string, unknown>,
        ),
      );
      typeIds.set(item.code, created.id);
      if (item.description || item.sortOrder !== undefined) {
        await this.identity.updateCoreOrganizationResource(
          tenantId,
          'node-types',
          created.id,
          item as unknown as Record<string, unknown>,
        );
      }
    }

    const treeIds = new Map(initial.trees.map((item) => [item.code, item.id]));
    for (const item of dataset.organizationTrees) {
      const created = entity(
        await this.identity.createCoreOrganizationResource(
          tenantId,
          'trees',
          item as unknown as Record<string, unknown>,
        ),
      );
      treeIds.set(item.code, created.id);
    }

    const nodeIds = new Map(initial.nodes.map((item) => [item.code, item.id]));
    let pending = [...dataset.organizationNodes];
    while (pending.length) {
      const ready = pending.filter(
        (item) => !item.parentCode || nodeIds.has(item.parentCode),
      );
      if (!ready.length) {
        throw new BadRequestException(
          `Không thể xác định thứ tự node: ${pending.map((item) => item.code).join(', ')}.`,
        );
      }
      for (const item of ready) {
        const treeId = treeIds.get(item.treeCode);
        const nodeTypeId = typeIds.get(item.nodeTypeCode);
        if (!treeId || !nodeTypeId) {
          throw new NotFoundException(
            `Thiếu tham chiếu tree/type cho node ${item.code}.`,
          );
        }
        const created = entity(
          await this.identity.createCoreOrganizationResource(
            tenantId,
            'nodes',
            {
              code: item.code,
              name: item.name,
              description: item.description,
              sortOrder: item.sortOrder,
              treeId,
              nodeTypeId,
              parentId: item.parentCode
                ? nodeIds.get(item.parentCode)
                : undefined,
            },
          ),
        );
        nodeIds.set(item.code, created.id);
        if (item.description || item.sortOrder !== undefined) {
          await this.identity.updateCoreOrganizationResource(
            tenantId,
            'nodes',
            created.id,
            {
              description: item.description,
              sortOrder: item.sortOrder,
            },
          );
        }
      }
      pending = pending.filter((item) => !ready.includes(item));
    }

    const users = (await this.identity.coreUsers(tenantId)) as CoreUser[];
    const userIds = new Map(
      users.map((item) => [item.email.toLowerCase(), item.id]),
    );
    for (const item of dataset.organizationAssignments) {
      const nodeId = nodeIds.get(item.nodeCode);
      const userId = userIds.get(item.userEmail.toLowerCase());
      if (!nodeId || !userId) {
        throw new NotFoundException(
          `Thiếu node hoặc người dùng cho bổ nhiệm ${item.nodeCode}/${item.userEmail}.`,
        );
      }
      await this.identity.createCoreOrganizationResource(
        tenantId,
        'assignments',
        {
          nodeId,
          userId,
          isPrimary: item.isPrimary,
          startDate: item.startDate,
          note: item.note,
        },
      );
    }
    return Object.fromEntries(nodeIds);
  }

  private fingerprint(tenantId: string, dataset: DataImportDataset): string {
    return createHash('sha256')
      .update(JSON.stringify({ tenantId, dataset }))
      .digest('hex');
  }
}

interface CoreUser {
  readonly id: string;
  readonly email: string;
  readonly systemRole: string;
  readonly isActive?: boolean;
}

interface CoreEntity {
  readonly id: string;
  readonly code: string;
}

interface CoreOrganizationSnapshot {
  readonly trees: readonly CoreEntity[];
  readonly nodeTypes: readonly CoreEntity[];
  readonly nodes: readonly CoreEntity[];
  readonly assignments: readonly {
    readonly nodeId: string;
    readonly userId: string;
  }[];
  readonly users: readonly {
    readonly id: string;
    readonly email: string;
  }[];
}

function entity(value: unknown): CoreEntity {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as CoreEntity).id !== 'string' ||
    typeof (value as CoreEntity).code !== 'string'
  ) {
    throw new ServiceUnavailableException(
      'Tenant Core trả về thực thể không hợp lệ.',
    );
  }
  return value as CoreEntity;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function moduleRoot(moduleKey: DataImportModuleKey): string {
  const roots: Record<DataImportModuleKey, string> = {
    inventory:
      process.env.INVENTORY_INTERNAL_API_URL ??
      'http://localhost:3336/api/inventory',
    'procedure-engine':
      process.env.PROCEDURE_INTERNAL_API_URL ??
      'http://localhost:3334/api/procedure',
    maintenance:
      process.env.MAINTENANCE_INTERNAL_API_URL ??
      'http://localhost:3335/api/maintenance',
  };
  return roots[moduleKey].replace(/\/$/, '');
}

function systemError(code: string, message: string): DataImportIssue {
  return { level: 'error', code, message, sheet: 'SYSTEM' };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
