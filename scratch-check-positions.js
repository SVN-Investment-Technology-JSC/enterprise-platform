const { Client } = require('pg');

async function check() {
  const client = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/tenant_savina' });
  try {
    await client.connect();

    const epCount = await client.query('SELECT count(*) FROM hrm_schema.employee_profiles WHERE deleted_at IS NULL');
    console.log('Total hrm_schema.employee_profiles:', epCount.rows[0].count);

    const userCount = await client.query('SELECT count(*) FROM core_schema.users WHERE deleted_at IS NULL');
    console.log('Total core_schema.users:', userCount.rows[0].count);

    const nodes = await client.query('SELECT category, count(*) FROM core_schema.organization_nodes WHERE deleted_at IS NULL GROUP BY category');
    console.log('Nodes by category:', nodes.rows);

    const allPositions = await client.query("SELECT id, code, name, parent_id FROM core_schema.organization_nodes WHERE category = 'position' AND deleted_at IS NULL ORDER BY code");
    console.log(`Available positions in Core (${allPositions.rows.length}):`);
    console.table(allPositions.rows);

    const allUnits = await client.query("SELECT id, code, name, head_position_id FROM core_schema.organization_nodes WHERE category = 'unit' AND deleted_at IS NULL ORDER BY code");
    console.log(`Available units/departments in Core (${allUnits.rows.length}):`);
    console.table(allUnits.rows);

    const totalAssign = await client.query("SELECT count(*) FROM core_schema.organization_node_assignments WHERE deleted_at IS NULL AND status = 'active'");
    console.log('Total active node assignments:', totalAssign.rows[0].count);

    const assignQuery = `
      SELECT 
        ep.employee_id,
        ep.employee_code,
        u.full_name,
        u.email,
        a.node_id,
        pos.name as position_name,
        unit.name as department_name
      FROM hrm_schema.employee_profiles ep
      LEFT JOIN core_schema.users u ON u.id = ep.employee_id
      LEFT JOIN core_schema.organization_node_assignments a 
        ON a.user_id = ep.employee_id AND a.status = 'active' AND a.deleted_at IS NULL
      LEFT JOIN core_schema.organization_nodes pos ON pos.id = a.node_id
      LEFT JOIN core_schema.organization_nodes unit ON unit.id = pos.parent_id
      WHERE ep.deleted_at IS NULL
      ORDER BY ep.employee_code ASC;
    `;
    const rows = await client.query(assignQuery);
    console.log('Total employees queried:', rows.rows.length);

    const assigned = rows.rows.filter(r => r.node_id !== null);
    const unassigned = rows.rows.filter(r => r.node_id === null);

    console.log(`Assigned: ${assigned.length}, Unassigned: ${unassigned.length}`);
    if (unassigned.length > 0) {
      console.log('First 10 unassigned:');
      console.table(unassigned.slice(0, 10));
    }
    if (assigned.length > 0) {
      console.log('Assigned list:');
      console.table(assigned);
    }

  } catch(err) {
    console.error('Check error:', err);
  } finally {
    await client.end();
  }
}

check();
