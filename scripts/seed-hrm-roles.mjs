import { createHash } from 'crypto';
import pg from 'file:///d:/CRM/enterprise-platform/packages/adapters/database/node_modules/pg/lib/index.js';
const { Client } = pg;

const hrmTemplateId = (type, key) => {
  const hex = createHash('sha256').update(`hrm:template:${type}:${key}`).digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16), 'a' + hex.slice(17, 20), hex.slice(20, 32)].join('-');
};

const HRM_ROLE_TEMPLATES = [
  {
    key: 'employee',
    name: 'HRM - Nhân viên',
    description: 'Xem và gửi đơn của bản thân, xem phiếu lương cá nhân.',
    actions: ['hrm.self.read','hrm.self.profile.write','hrm.self.attendance','hrm.self.request','hrm.self.payslip']
  },
  {
    key: 'department-head',
    name: 'HRM - Trưởng bộ phận',
    description: 'Duyệt đơn phép, tăng ca, công tác, đổi ca và xem chấm công.',
    actions: ['hrm.self.read','hrm.self.request','hrm.request.read','hrm.attendance.read','hrm.leave.approve','hrm.ot.approve','hrm.trip.approve','hrm.shift.approve']
  },
  {
    key: 'hr-profile',
    name: 'HRM - Nhân sự (hồ sơ)',
    description: 'Quản lý hồ sơ nhân viên, liên kết tài khoản, người phụ thuộc.',
    actions: ['hrm.employee.read','hrm.employee.manage','hrm.employee.link-account','hrm.profile.approve','hrm.profile.approve.all','hrm.dependent.read','hrm.dependent.manage']
  },
  {
    key: 'timekeeper',
    name: 'HRM - Chấm công viên',
    description: 'Điều phối ca, thiết bị, chấm công, phép và bảng công.',
    actions: ['hrm.shift.read','hrm.shift.manage','hrm.time.configure','hrm.device.manage','hrm.attendance.read','hrm.attendance.import','hrm.attendance.approve','hrm.attendance.approve.all','hrm.leave.read','hrm.leave.manage','hrm.timesheet.read','hrm.timesheet.calculate','hrm.timesheet.adjust','hrm.timesheet.export']
  },
  {
    key: 'comp-ben',
    name: 'HRM - C&B',
    description: 'Cấu hình lương, hồ sơ lương, tính lương và điều chỉnh.',
    actions: ['hrm.payroll.configure','hrm.salary.read','hrm.salary.manage','hrm.employee.read','hrm.dependent.read','hrm.payroll.read','hrm.payroll.calculate','hrm.payroll.adjust']
  },
  {
    key: 'payroll-approver',
    name: 'HRM - Người chốt lương',
    description: 'Chốt và phát hành bảng lương; khóa công.',
    actions: ['hrm.timesheet.read','hrm.timesheet.lock','hrm.payroll.read','hrm.payroll.approve','hrm.payroll.publish','hrm.salary.advance.approve','hrm.salary.advance.approve.all']
  },
  {
    key: 'hr-manager',
    name: 'HRM - Trưởng phòng nhân sự',
    description: 'Toàn quyền cấu hình chính sách, duyệt mọi loại đơn toàn tenant.',
    actions: ['hrm.policy.configure','hrm.leave.approve.all','hrm.ot.approve.all','hrm.trip.approve.all','hrm.shift.approve.all','hrm.attendance.approve.all','hrm.profile.approve.all','hrm.salary.advance.approve.all','hrm.integration.manage','hrm.manage']
  }
];

async function run() {
  for (const tenantDb of ['savina', 'qa03']) {
    const client = new Client({ connectionString: `postgresql://tenant:tenant@localhost:55436/${tenantDb}` });
    await client.connect();
    console.log(`Seeding templates for ${tenantDb}...`);
    for (const template of HRM_ROLE_TEMPLATES) {
      const roleId = hrmTemplateId('role', template.key);
      const permissionId = hrmTemplateId('permission', template.key);
      await client.query(
        'INSERT INTO core_schema.roles(id,key,name,description) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=$3, description=$4',
        [roleId, `custom-${roleId}`, template.name, template.description]
      );
      await client.query(
        'INSERT INTO core_schema.permissions(id,name,description) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=$2, description=$3',
        [permissionId, template.name, template.description]
      );
      for (const act of template.actions) {
        await client.query(
          'INSERT INTO core_schema.permission_actions VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [permissionId, act]
        );
      }
      await client.query(
        'INSERT INTO core_schema.role_permissions VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [roleId, permissionId]
      );
      await client.query(
        'INSERT INTO core_schema.role_modules VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [roleId, 'hrm']
      );
    }
    const r = await client.query(`
      SELECT r.name, count(pa.action_key) as actions 
      FROM core_schema.roles r 
      JOIN core_schema.role_permissions rp ON rp.role_id = r.id 
      JOIN core_schema.permission_actions pa ON pa.permission_id = rp.permission_id 
      GROUP BY r.name
    `);
    console.log(`${tenantDb} roles:`, r.rows);
    await client.end();
  }
}

run().catch(console.error);
