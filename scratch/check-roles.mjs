import pg from '../node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/index.js';
const { Client } = pg;

async function check() {
  const tenant = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/savina' });
  await tenant.connect();

  console.log('=== CHECKING USER BÙI CÔNG QUYỀN ===');
  const uRes = await tenant.query(`SELECT id, email, full_name, status FROM core_schema.users WHERE email = 'bui.cong.quyen@savina.local'`);
  console.log('User:', uRes.rows);

  if (uRes.rows.length > 0) {
    const userId = uRes.rows[0].id;

    const rolesRes = await tenant.query(`
      SELECT r.id, r.key, r.name 
      FROM core_schema.roles r
      JOIN core_schema.user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = $1
    `, [userId]);
    console.log('Roles:', rolesRes.rows);

    const permRes = await tenant.query(`
      SELECT DISTINCT pa.action_key
      FROM core_schema.user_roles ur
      JOIN core_schema.role_permissions rp ON rp.role_id = ur.role_id
      JOIN core_schema.permission_actions pa ON pa.permission_id = rp.permission_id
      WHERE ur.user_id = $1
    `, [userId]);
    console.log('Permissions:', permRes.rows.map(r => r.action_key));

    const hrmProfileRes = await tenant.query(`
      SELECT * FROM hrm_schema.employee_profiles WHERE employee_id = $1
    `, [userId]);
    console.log('hrm_schema.employee_profiles:', hrmProfileRes.rows);
  }

  console.log('\n=== CHECKING ADMIN SAVINA ===');
  const adminRes = await tenant.query(`SELECT id, email, full_name FROM core_schema.users WHERE email = 'admin@savina.local'`);
  if (adminRes.rows.length > 0) {
    const adminId = adminRes.rows[0].id;
    const adminRoles = await tenant.query(`
      SELECT r.key, r.name FROM core_schema.roles r
      JOIN core_schema.user_roles ur ON ur.role_id = r.id WHERE ur.user_id = $1
    `, [adminId]);
    console.log('Admin Roles:', adminRoles.rows);

    const adminPerms = await tenant.query(`
      SELECT DISTINCT pa.action_key FROM core_schema.user_roles ur
      JOIN core_schema.role_permissions rp ON rp.role_id = ur.role_id
      JOIN core_schema.permission_actions pa ON pa.permission_id = rp.permission_id
      WHERE ur.user_id = $1
    `, [adminId]);
    console.log('Admin Permissions count:', adminPerms.rows.length);
  }

  console.log('\n=== ALL ROLES IN SAVINA ===');
  const allRoles = await tenant.query(`SELECT id, key, name FROM core_schema.roles`);
  console.log('All Roles:', allRoles.rows);

  console.log('\n=== ALL ROLE MODULES IN SAVINA ===');
  const allRoleMods = await tenant.query(`SELECT r.key as role_key, rm.module_key FROM core_schema.role_modules rm JOIN core_schema.roles r ON r.id = rm.role_id`);
  console.log('Role modules:', allRoleMods.rows);

  await tenant.end();
}

check().catch(console.error);
