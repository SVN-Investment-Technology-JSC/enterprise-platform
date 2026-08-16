import { randomUUID } from 'node:crypto';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type {
  AssignOrganizationMemberRequest,
  CreateOrganizationPositionRequest,
  CreateOrganizationUnitRequest,
  CreateOrganizationUnitTypeRequest,
  OrganizationMember,
  OrganizationPosition,
  OrganizationUnit,
  OrganizationUnitType,
  TenantOrganizationSnapshot,
  UpdateOrganizationUnitRequest,
  UpdateOrganizationUnitTypeRequest,
} from '@enterprise-platform/contracts-organization';

type PlatformPool = ReturnType<typeof createPostgresPool>;

export class PlatformOrganizationStore {
  private readonly pool: PlatformPool;

  constructor(
    connectionString =
      process.env.PLATFORM_DATABASE_URL ??
      'postgresql://platform:platform@localhost:55432/platform',
  ) {
    this.pool = createPostgresPool(connectionString, {
      max: 6,
      application_name: 'enterprise-platform:organization',
    });
  }

  async snapshot(tenantId: string): Promise<TenantOrganizationSnapshot> {
    const [unitTypes, units, positions, members] = await Promise.all([
      this.pool.query<OrganizationUnitType>(
        `SELECT type.id, type.key, type.name, type.created_at AS "createdAt",
                count(unit.id)::integer AS "usageCount"
           FROM organization_schema.unit_types type
           LEFT JOIN organization_schema.units unit ON unit.type_id = type.id
          WHERE type.tenant_id = $1
          GROUP BY type.id
          ORDER BY type.name`,
        [tenantId],
      ),
      this.pool.query<OrganizationUnit>(
        `SELECT unit.id, unit.code, unit.name, unit.type_id AS "typeId",
                type.name AS "typeName", unit.parent_id AS "parentId",
                unit.head_membership_id AS "headMembershipId",
                head.display_name AS "headName",
                count(member.membership_id)::integer AS "memberCount",
                unit.created_at AS "createdAt", unit.updated_at AS "updatedAt"
           FROM organization_schema.units unit
           JOIN organization_schema.unit_types type ON type.id = unit.type_id
           LEFT JOIN organization_schema.unit_members member ON member.unit_id = unit.id
           LEFT JOIN tenancy_schema.tenant_memberships head_membership
             ON head_membership.id = unit.head_membership_id
           LEFT JOIN identity_schema.users head ON head.id = head_membership.user_id
          WHERE unit.tenant_id = $1
          GROUP BY unit.id, type.name, head.display_name
          ORDER BY unit.name`,
        [tenantId],
      ),
      this.pool.query<OrganizationPosition>(
        `SELECT position.id, position.key, position.name,
                position.unit_id AS "unitId", position.created_at AS "createdAt"
           FROM organization_schema.positions position
           JOIN organization_schema.units unit ON unit.id = position.unit_id
          WHERE unit.tenant_id = $1
          ORDER BY position.name`,
        [tenantId],
      ),
      this.pool.query<OrganizationMember>(
        `SELECT member.membership_id AS "membershipId", membership.user_id AS "userId",
                user_account.display_name AS "displayName", user_account.email,
                member.unit_id AS "unitId", member.position_id AS "positionId",
                position.name AS "positionName",
                (unit.head_membership_id = member.membership_id) AS "isHead"
           FROM organization_schema.unit_members member
           JOIN organization_schema.units unit ON unit.id = member.unit_id
           JOIN tenancy_schema.tenant_memberships membership
             ON membership.id = member.membership_id
           JOIN identity_schema.users user_account ON user_account.id = membership.user_id
           LEFT JOIN organization_schema.positions position ON position.id = member.position_id
          WHERE unit.tenant_id = $1
          ORDER BY user_account.display_name`,
        [tenantId],
      ),
    ]);
    const membershipSubjects: Record<
      string,
      { organizationUnitIds: string[]; positionIds: string[] }
    > = {};
    for (const member of members.rows) {
      const subjects = (membershipSubjects[member.membershipId] ??= {
        organizationUnitIds: [],
        positionIds: [],
      });
      if (member.unitId && !subjects.organizationUnitIds.includes(member.unitId)) {
        subjects.organizationUnitIds.push(member.unitId);
      }
      if (member.positionId && !subjects.positionIds.includes(member.positionId)) {
        subjects.positionIds.push(member.positionId);
      }
    }
    return {
      tenantId,
      generatedAt: new Date().toISOString(),
      unitTypes: unitTypes.rows,
      units: units.rows,
      positions: positions.rows,
      members: members.rows,
      membershipSubjects,
    };
  }

  async createUnitType(
    tenantId: string,
    input: CreateOrganizationUnitTypeRequest,
  ): Promise<OrganizationUnitType> {
    const key = required(input.key, 'Mã loại đơn vị').toUpperCase();
    const name = required(input.name, 'Tên loại đơn vị');
    await this.pool.query(
      `INSERT INTO organization_schema.unit_types (id, tenant_id, key, name)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), tenantId, key, name],
    );
    return this.requireUnitType(tenantId, key);
  }

  async updateUnitType(
    tenantId: string,
    typeId: string,
    input: UpdateOrganizationUnitTypeRequest,
  ): Promise<OrganizationUnitType> {
    const name = required(input.name, 'Tên loại đơn vị');
    const result = await this.pool.query<{ key: string }>(
      `UPDATE organization_schema.unit_types SET name = $3
        WHERE id = $1 AND tenant_id = $2 RETURNING key`,
      [typeId, tenantId, name],
    );
    const key = result.rows[0]?.key;
    if (!key) throw new Error('Không tìm thấy loại đơn vị.');
    return this.requireUnitType(tenantId, key);
  }

  async deleteUnitType(tenantId: string, typeId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM organization_schema.unit_types type
        WHERE type.id = $1 AND type.tenant_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM organization_schema.units unit WHERE unit.type_id = type.id
          )`,
      [typeId, tenantId],
    );
    if (!result.rowCount) {
      throw new Error('Loại đơn vị không tồn tại hoặc đang được sử dụng.');
    }
  }

  async createUnit(
    tenantId: string,
    input: CreateOrganizationUnitRequest,
  ): Promise<OrganizationUnit> {
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO organization_schema.units
         (id, tenant_id, code, name, type_id, parent_id, head_membership_id)
       SELECT $1, $2, $3, $4, type.id, parent.id, head.id
         FROM organization_schema.unit_types type
         LEFT JOIN organization_schema.units parent
           ON parent.id = $6 AND parent.tenant_id = $2
         LEFT JOIN tenancy_schema.tenant_memberships head
           ON head.id = $7 AND head.tenant_id = $2 AND head.status = 'active'
        WHERE type.id = $5 AND type.tenant_id = $2`,
      [
        id,
        tenantId,
        required(input.code, 'Mã đơn vị').toUpperCase(),
        required(input.name, 'Tên đơn vị'),
        input.typeId,
        input.parentId ?? null,
        input.headMembershipId ?? null,
      ],
    );
    if (!result.rowCount) throw new Error('Loại, cấp trên hoặc trưởng đơn vị không hợp lệ.');
    return this.requireUnit(tenantId, id);
  }

  async updateUnit(
    tenantId: string,
    unitId: string,
    input: UpdateOrganizationUnitRequest,
  ): Promise<OrganizationUnit> {
    if (input.parentId === unitId) throw new Error('Đơn vị không thể là cấp trên của chính nó.');
    await this.pool.query(
      `UPDATE organization_schema.units
          SET name = coalesce($3, name),
              type_id = coalesce($4, type_id),
              parent_id = CASE WHEN $5::boolean THEN $6::uuid ELSE parent_id END,
              head_membership_id = CASE WHEN $7::boolean THEN $8::uuid ELSE head_membership_id END,
              updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [
        unitId,
        tenantId,
        input.name?.trim() || null,
        input.typeId ?? null,
        input.parentId !== undefined,
        input.parentId ?? null,
        input.headMembershipId !== undefined,
        input.headMembershipId ?? null,
      ],
    );
    return this.requireUnit(tenantId, unitId);
  }

  async deleteUnit(tenantId: string, unitId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM organization_schema.units unit
        WHERE unit.id = $1 AND unit.tenant_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM organization_schema.units child WHERE child.parent_id = unit.id
          )`,
      [unitId, tenantId],
    );
    if (!result.rowCount) throw new Error('Đơn vị không tồn tại hoặc còn đơn vị trực thuộc.');
  }

  async createPosition(
    tenantId: string,
    input: CreateOrganizationPositionRequest,
  ): Promise<OrganizationPosition> {
    const id = randomUUID();
    const result = await this.pool.query<OrganizationPosition>(
      `INSERT INTO organization_schema.positions (id, unit_id, key, name)
       SELECT $1, unit.id, $4, $5
         FROM organization_schema.units unit
        WHERE unit.id = $3 AND unit.tenant_id = $2
       RETURNING id, key, name, unit_id AS "unitId", created_at AS "createdAt"`,
      [
        id,
        tenantId,
        input.unitId,
        required(input.key, 'Mã chức danh').toUpperCase(),
        required(input.name, 'Tên chức danh'),
      ],
    );
    const position = result.rows[0];
    if (!position) throw new Error('Không tìm thấy đơn vị của chức danh.');
    return position;
  }

  async assignMember(
    tenantId: string,
    unitId: string,
    input: AssignOrganizationMemberRequest,
  ): Promise<void> {
    const assigned = await this.pool.query(
      `INSERT INTO organization_schema.unit_members
         (unit_id, membership_id, position_id)
       SELECT unit.id, membership.id, position.id
         FROM organization_schema.units unit
         JOIN tenancy_schema.tenant_memberships membership
           ON membership.id = $3 AND membership.tenant_id = $1 AND membership.status = 'active'
         LEFT JOIN organization_schema.positions position
           ON position.id = $4 AND position.unit_id = unit.id
        WHERE unit.id = $2 AND unit.tenant_id = $1
       ON CONFLICT (unit_id, membership_id)
       DO UPDATE SET position_id = EXCLUDED.position_id`,
      [tenantId, unitId, input.membershipId, input.positionId ?? null],
    );
    if (!assigned.rowCount) throw new Error('Không thể gán nhân sự vào đơn vị.');
    if (input.isHead) {
      await this.pool.query(
        `UPDATE organization_schema.units SET head_membership_id = $3, updated_at = now()
          WHERE id = $2 AND tenant_id = $1`,
        [tenantId, unitId, input.membershipId],
      );
    }
  }

  async removeMember(
    tenantId: string,
    unitId: string,
    membershipId: string,
  ): Promise<void> {
    await this.pool.query(
      `DELETE FROM organization_schema.unit_members member
        USING organization_schema.units unit
        WHERE member.unit_id = unit.id AND unit.tenant_id = $1
          AND member.unit_id = $2 AND member.membership_id = $3`,
      [tenantId, unitId, membershipId],
    );
    await this.pool.query(
      `UPDATE organization_schema.units SET head_membership_id = NULL, updated_at = now()
        WHERE id = $2 AND tenant_id = $1 AND head_membership_id = $3`,
      [tenantId, unitId, membershipId],
    );
  }

  close(): Promise<void> {
    return this.pool.end();
  }

  private async requireUnitType(
    tenantId: string,
    key: string,
  ): Promise<OrganizationUnitType> {
    const snapshot = await this.snapshot(tenantId);
    const type = snapshot.unitTypes.find((candidate) => candidate.key === key);
    if (!type) throw new Error('Không tìm thấy loại đơn vị.');
    return type;
  }

  private async requireUnit(
    tenantId: string,
    unitId: string,
  ): Promise<OrganizationUnit> {
    const snapshot = await this.snapshot(tenantId);
    const unit = snapshot.units.find((candidate) => candidate.id === unitId);
    if (!unit) throw new Error('Không tìm thấy đơn vị tổ chức.');
    return unit;
  }
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} là bắt buộc.`);
  return normalized;
}

