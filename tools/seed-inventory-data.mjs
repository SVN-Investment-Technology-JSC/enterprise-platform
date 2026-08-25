import pg from '../apps/migrator/node_modules/pg/lib/index.js';

const TENANT_DB_URL = process.env.TENANT_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55436/test';

async function seed() {
  const client = new pg.Client({ connectionString: TENANT_DB_URL });
  await client.connect();
  console.log('Connected to tenant database:', TENANT_DB_URL);

  try {
    await client.query('BEGIN');

    // Fetch a valid user ID to use as creator/manager
    const userRes = await client.query('SELECT id FROM core_schema.users ORDER BY created_at ASC LIMIT 1');
    const adminUserId = userRes.rows[0]?.id ?? 'ed4d54be-21c9-43dc-b442-c08c7ddbd12b';
    console.log('Using admin user id:', adminUserId);

    // =========================================================================
    // 1. CLEAN EXISTING INVENTORY DATA
    // =========================================================================
    console.log('Cleaning existing inventory records...');
    await client.query('DELETE FROM inventory_schema.inventory_adjustments');
    await client.query('DELETE FROM inventory_schema.inventory_transactions');
    await client.query('DELETE FROM inventory_schema.reservation_items');
    await client.query('DELETE FROM inventory_schema.reservations');
    await client.query('DELETE FROM inventory_schema.material_inventory');
    await client.query('DELETE FROM inventory_schema.serial_tracking');
    await client.query('DELETE FROM inventory_schema.asset_installations');
    await client.query('DELETE FROM inventory_schema.asset_status_logs');
    await client.query('DELETE FROM inventory_schema.asset_boms');
    await client.query('DELETE FROM inventory_schema.assets');
    await client.query('DELETE FROM inventory_schema.materials');
    await client.query('DELETE FROM inventory_schema.warehouse_locations');
    await client.query('DELETE FROM inventory_schema.warehouses');

    // =========================================================================
    // 2. WAREHOUSES & LOCATIONS
    // =========================================================================
    console.log('Creating Warehouses & Locations...');
    const warehouseDefs = [
      {
        code: 'WH-HP-01',
        name: 'Kho Tổng Trung Tâm Hải Phòng',
        type: 'PHYSICAL',
        location: 'Khu công nghiệp Đình Vũ, Hải Phòng',
        locations: [
          { code: 'HP-RACK-A1', name: 'Kệ A1 - Thiết bị truyền động' },
          { code: 'HP-RACK-A2', name: 'Kệ A2 - Vòng bi & Phớt cơ khí' },
          { code: 'HP-RACK-B1', name: 'Kệ B1 - Van công nghiệp & Phụ kiện đường ống' },
          { code: 'HP-RACK-B2', name: 'Kệ B2 - Vật tư điện & Cảm biến' },
          { code: 'HP-ZONE-OIL', name: 'Khu vực Dầu mỡ & Hóa chất bôi trơn' },
        ],
      },
      {
        code: 'WH-DQ-02',
        name: 'Kho Phụ Tùng Nhà Máy Dung Quất',
        type: 'PHYSICAL',
        location: 'Khu kinh tế Dung Quất, Quảng Ngãi',
        locations: [
          { code: 'DQ-BAY-01', name: 'Gian số 1 - Phụ tùng máy nén & Turbine' },
          { code: 'DQ-BAY-02', name: 'Gian số 2 - Thiết bị phân tích & Đo lường' },
          { code: 'DQ-RACK-C1', name: 'Kệ C1 - Đệm kín & Gioăng kim loại' },
        ],
      },
      {
        code: 'WH-MECH-03',
        name: 'Kho Cơ Khí & Gia Công Chế Tạo',
        type: 'PHYSICAL',
        location: 'Xưởng cơ điện trung tâm',
        locations: [
          { code: 'MC-RACK-01', name: 'Giá vật liệu que hàn & kim loại màu' },
          { code: 'MC-ZONE-HEAVY', name: 'Bãi chứa kết cấu & Trục máy lớn' },
        ],
      },
      {
        code: 'WH-ELEC-04',
        name: 'Kho Thiết Bị Điện & Tự Động Hóa',
        type: 'PHYSICAL',
        location: 'Phòng sạch kỹ thuật điện E-House',
        locations: [
          { code: 'EL-CAB-01', name: 'Tủ chống tĩnh điện Module PLC & Card I/O' },
          { code: 'EL-RACK-02', name: 'Kệ Biến tần, Khởi động từ & Rơ le' },
        ],
      },
      {
        code: 'WH-SITE-05',
        name: 'Kho Hiện Trường & Trung Chuyển Bảo Trì',
        type: 'VIRTUAL_IN_TRANSIT',
        location: 'Container kho dã chiến tổ bảo trì',
        locations: [
          { code: 'ST-MOB-01', name: 'Tủ dụng cụ & Thiết bị đo di động' },
        ],
      },
    ];

    const warehouseMap = new Map(); // code -> { id, locations: Map(code -> id) }

    for (const wh of warehouseDefs) {
      const whRes = await client.query(
        `INSERT INTO inventory_schema.warehouses (code, name, type, manager_user_id, location, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id, code, name`,
        [wh.code, wh.name, wh.type, adminUserId, wh.location]
      );
      const whId = whRes.rows[0].id;
      const locMap = new Map();

      for (const loc of wh.locations) {
        const locRes = await client.query(
          `INSERT INTO inventory_schema.warehouse_locations (warehouse_id, code, name, qr_code)
           VALUES ($1, $2, $3, $4)
           RETURNING id, code`,
          [whId, loc.code, loc.name, `QR-LOC-${loc.code}`]
        );
        locMap.set(loc.code, locRes.rows[0].id);
      }

      warehouseMap.set(wh.code, { id: whId, locations: locMap });
    }
    console.log(`Created ${warehouseMap.size} warehouses with locations.`);

    // =========================================================================
    // 3. MATERIALS (65+ materials across SPARE_PART, CONSUMABLE, TOOL, ROTABLE)
    // =========================================================================
    console.log('Creating 65 Materials...');
    const materialsData = [
      // SPARE_PART (40 items)
      { code: 'MAT-BRG-6208', name: 'Vòng bi cầu SKF 6208-2Z/C3', category: 'SPARE_PART', unit: 'Bộ', min: 10, max: 50, serial: false, bar: '8935001001' },
      { code: 'MAT-BRG-22216', name: 'Vòng bi tang trống SKF 22216 EK', category: 'SPARE_PART', unit: 'Bộ', min: 5, max: 20, serial: false, bar: '8935001002' },
      { code: 'MAT-BRG-NU315', name: 'Vòng bi đũa trụ NSK NU 315 ECM', category: 'SPARE_PART', unit: 'Bộ', min: 4, max: 15, serial: false, bar: '8935001003' },
      { code: 'MAT-SEAL-120', name: 'Phớt chắn dầu chịu nhiệt Viton TC 120x150x12', category: 'SPARE_PART', unit: 'Cái', min: 15, max: 60, serial: false, bar: '8935001004' },
      { code: 'MAT-SEAL-80', name: 'Phớt cơ khí trục bơm Grundfos Φ80mm', category: 'SPARE_PART', unit: 'Bộ', min: 6, max: 24, serial: true, bar: '8935001005' },
      { code: 'MAT-IMP-250', name: 'Cánh bơm hợp kim gang chống mòn Φ250mm', category: 'SPARE_PART', unit: 'Cái', min: 2, max: 8, serial: true, bar: '8935001006' },
      { code: 'MAT-VLV-100', name: 'Van cầu hơi chịu áp lực cao DN100 PN40', category: 'SPARE_PART', unit: 'Cái', min: 3, max: 12, serial: true, bar: '8935001007' },
      { code: 'MAT-VLV-50', name: 'Van bi điều khiển khí nén DN50 PN25', category: 'SPARE_PART', unit: 'Cái', min: 5, max: 20, serial: true, bar: '8935001008' },
      { code: 'MAT-FLG-150', name: 'Mặt bích thép rèn ANSI Class 300 DN150', category: 'SPARE_PART', unit: 'Cái', min: 10, max: 40, serial: false, bar: '8935001009' },
      { code: 'MAT-GSK-300', name: 'Đệm kim loại xoắn ốc Spiral Wound DN300', category: 'SPARE_PART', unit: 'Cái', min: 20, max: 80, serial: false, bar: '8935001010' },
      { code: 'MAT-FLT-05', name: 'Lõi lọc dầu thủy lực Hydac 05 micron', category: 'SPARE_PART', unit: 'Cái', min: 12, max: 50, serial: false, bar: '8935001011' },
      { code: 'MAT-FLT-AIR', name: 'Bộ lõi lọc khí nén Donaldson P-SRF', category: 'SPARE_PART', unit: 'Bộ', min: 8, max: 30, serial: false, bar: '8935001012' },
      { code: 'MAT-COUP-180', name: 'Khớp nối mềm cao su chịu lực Flender 180', category: 'SPARE_PART', unit: 'Bộ', min: 4, max: 16, serial: false, bar: '8935001013' },
      { code: 'MAT-BELT-SPC', name: 'Dây curoa chịu nhiệt công nghiệp Optibelt SPC 3550', category: 'SPARE_PART', unit: 'Sợi', min: 15, max: 60, serial: false, bar: '8935001014' },
      { code: 'MAT-NOZ-01', name: 'Cụm vòi phun nhiên liệu khí đốt áp cao', category: 'SPARE_PART', unit: 'Bộ', min: 6, max: 24, serial: true, bar: '8935001015' },
      { code: 'MAT-IGN-02', name: 'Bộ bugi đánh lửa mồi tự động lò hơi áp cao', category: 'SPARE_PART', unit: 'Bộ', min: 4, max: 16, serial: false, bar: '8935001016' },
      { code: 'MAT-BLD-T1', name: 'Cánh tuabin khí tầng 1 hợp kim Inconel 718', category: 'SPARE_PART', unit: 'Chiếc', min: 8, max: 32, serial: true, bar: '8935001017' },
      { code: 'MAT-BLD-T2', name: 'Cánh tĩnh định hướng tuabin tầng 2', category: 'SPARE_PART', unit: 'Chiếc', min: 8, max: 32, serial: true, bar: '8935001018' },
      { code: 'MAT-SHF-90', name: 'Trục truyền động thứ cấp hộp giảm tốc thép 40CrMo', category: 'SPARE_PART', unit: 'Cái', min: 2, max: 6, serial: true, bar: '8935001019' },
      { code: 'MAT-GEAR-32', name: 'Bộ bánh răng côn xoắn hợp kim m=8 Z=32', category: 'SPARE_PART', unit: 'Bộ', min: 2, max: 8, serial: true, bar: '8935001020' },
      { code: 'MAT-THRM-PT', name: 'Cảm biến nhiệt độ công nghiệp RTD Pt100 Φ8x300mm', category: 'SPARE_PART', unit: 'Chiếc', min: 10, max: 40, serial: false, bar: '8935001021' },
      { code: 'MAT-PRS-TX', name: 'Cảm biến áp suất vi sai Rosemount 3051CD', category: 'SPARE_PART', unit: 'Chiếc', min: 4, max: 15, serial: true, bar: '8935001022' },
      { code: 'MAT-VIB-AC', name: 'Cảm biến độ rung gia tốc 3 trục Wilcoxon 793', category: 'SPARE_PART', unit: 'Chiếc', min: 6, max: 20, serial: true, bar: '8935001023' },
      { code: 'MAT-LEV-RAD', name: 'Cảm biến báo mức Radar Endress+Hauser Micropilot', category: 'SPARE_PART', unit: 'Chiếc', min: 3, max: 10, serial: true, bar: '8935001024' },
      { code: 'MAT-MCB-63A', name: 'Aptomat khối MCCB Schneider 3P 63A 36kA', category: 'SPARE_PART', unit: 'Cái', min: 8, max: 30, serial: false, bar: '8935001025' },
      { code: 'MAT-MCB-250', name: 'Aptomat khối MCCB ABB Tmax 3P 250A 50kA', category: 'SPARE_PART', unit: 'Cái', min: 4, max: 15, serial: true, bar: '8935001026' },
      { code: 'MAT-CNT-40A', name: 'Khởi động từ Contactor Siemens Sirius 3P 40A 220V', category: 'SPARE_PART', unit: 'Cái', min: 10, max: 40, serial: false, bar: '8935001027' },
      { code: 'MAT-RLY-OMR', name: 'Rơ le kiếng trung gian Omron 8 chân MY2N kèm đế', category: 'SPARE_PART', unit: 'Bộ', min: 25, max: 100, serial: false, bar: '8935001028' },
      { code: 'MAT-SSR-40', name: 'Rơ le bán dẫn SSR Fotek 40A 480VAC', category: 'SPARE_PART', unit: 'Cái', min: 8, max: 30, serial: false, bar: '8935001029' },
      { code: 'MAT-FUS-100', name: 'Cầu chì ống cắt nhanh Bussmann 100A 690V', category: 'SPARE_PART', unit: 'Cái', min: 20, max: 80, serial: false, bar: '8935001030' },
      { code: 'MAT-PLC-DI', name: 'Module ngõ vào số 16 DI Siemens Simatic S7-1500', category: 'SPARE_PART', unit: 'Module', min: 3, max: 12, serial: true, bar: '8935001031' },
      { code: 'MAT-PLC-AI', name: 'Module ngõ vào tương tự 8 AI Siemens S7-1500', category: 'SPARE_PART', unit: 'Module', min: 3, max: 10, serial: true, bar: '8935001032' },
      { code: 'MAT-PSU-24V', name: 'Bộ nguồn công nghiệp DIN-rail Meanwell 24VDC 20A', category: 'SPARE_PART', unit: 'Cái', min: 5, max: 20, serial: false, bar: '8935001033' },
      { code: 'MAT-FAN-230', name: 'Quạt tản nhiệt tủ điện EBM-Papst 230VAC 120x120', category: 'SPARE_PART', unit: 'Cái', min: 10, max: 40, serial: false, bar: '8935001034' },
      { code: 'MAT-DIOD-300', name: 'Module Diode chỉnh lưu công suất Semikron 300A 1600V', category: 'SPARE_PART', unit: 'Cái', min: 4, max: 16, serial: false, bar: '8935001035' },
      { code: 'MAT-THYR-400', name: 'Module Thyristor công suất SanRex 400A 1600V', category: 'SPARE_PART', unit: 'Cái', min: 4, max: 16, serial: false, bar: '8935001036' },
      { code: 'MAT-SOL-24V', name: 'Cuộn coil hút van điện từ Festo 24VDC 4.5W', category: 'SPARE_PART', unit: 'Cái', min: 12, max: 45, serial: false, bar: '8935001037' },
      { code: 'MAT-GAU-100', name: 'Đồng hồ đo áp suất chân đồng Wika 0-25 bar Φ100', category: 'SPARE_PART', unit: 'Cái', min: 8, max: 30, serial: false, bar: '8935001038' },
      { code: 'MAT-GAU-OIL', name: 'Kính thăm mức dầu bồn chứa inox 304 chịu nhiệt L=300mm', category: 'SPARE_PART', unit: 'Bộ', min: 5, max: 20, serial: false, bar: '8935001039' },
      { code: 'MAT-CHK-80', name: 'Van một chiều lá lật inox 316 DN80 PN16', category: 'SPARE_PART', unit: 'Cái', min: 4, max: 15, serial: true, bar: '8935001040' },

      // CONSUMABLE (15 items)
      { code: 'MAT-OIL-46', name: 'Dầu thủy lực công nghiệp Shell Tellus S2 MX 46 (Phuy 209L)', category: 'CONSUMABLE', unit: 'Phuy', min: 6, max: 25, serial: false, bar: '8935002001' },
      { code: 'MAT-OIL-220', name: 'Dầu nhớt bánh răng hộp số Mobilgear 600 XP 220 (Phuy 208L)', category: 'CONSUMABLE', unit: 'Phuy', min: 4, max: 18, serial: false, bar: '8935002002' },
      { code: 'MAT-OIL-TURB', name: 'Dầu bôi trơn turbine Mobil DTE 732 Premium (Phuy 208L)', category: 'CONSUMABLE', unit: 'Phuy', min: 5, max: 20, serial: false, bar: '8935002003' },
      { code: 'MAT-GRS-EP2', name: 'Mỡ bôi trơn chịu cực áp Mobilux EP 2 (Xô 18kg)', category: 'CONSUMABLE', unit: 'Xô', min: 8, max: 30, serial: false, bar: '8935002004' },
      { code: 'MAT-GRS-HT', name: 'Mỡ bôi trơn chịu nhiệt độ cao SKF LGHP 2/1 (Hộp 1kg)', category: 'CONSUMABLE', unit: 'Hộp', min: 10, max: 40, serial: false, bar: '8935002005' },
      { code: 'MAT-CLNR-500', name: 'Bình xịt vệ sinh bo mạch điện tử 3M Novec 500ml', category: 'CONSUMABLE', unit: 'Chai', min: 20, max: 80, serial: false, bar: '8935002006' },
      { code: 'MAT-RUST-WD', name: 'Bình xịt tẩy rỉ sét & bôi trơn đa năng WD-40 412ml', category: 'CONSUMABLE', unit: 'Chai', min: 25, max: 100, serial: false, bar: '8935002007' },
      { code: 'MAT-SLT-577', name: 'Keo khóa ren đường ống chịu áp lực Loctite 577 (50ml)', category: 'CONSUMABLE', unit: 'Tuýp', min: 15, max: 50, serial: false, bar: '8935002008' },
      { code: 'MAT-SLT-243', name: 'Keo khóa bu-lông chống tự tháo Loctite 243 (50ml)', category: 'CONSUMABLE', unit: 'Tuýp', min: 20, max: 60, serial: false, bar: '8935002009' },
      { code: 'MAT-WELD-E70', name: 'Que hàn chịu lực chất lượng cao Hyundai E7018 Φ3.2mm', category: 'CONSUMABLE', unit: 'Gói', min: 30, max: 120, serial: false, bar: '8935002010' },
      { code: 'MAT-WELD-308', name: 'Dây hàn Inox Kiswel T-308L Φ2.4mm (Hộp 5kg)', category: 'CONSUMABLE', unit: 'Hộp', min: 10, max: 40, serial: false, bar: '8935002011' },
      { code: 'MAT-GAS-ARG', name: 'Bình khí Argon tinh khiết hàn công nghiệp 99.999% (40L)', category: 'CONSUMABLE', unit: 'Bình', min: 8, max: 30, serial: false, bar: '8935002012' },
      { code: 'MAT-GAS-N2', name: 'Bình khí Nitơ áp suất cao nạp bình tích năng (40L)', category: 'CONSUMABLE', unit: 'Bình', min: 6, max: 20, serial: false, bar: '8935002013' },
      { code: 'MAT-RAG-CL', name: 'Giẻ lau kỹ thuật không sinh bụi phòng máy (Bao 10kg)', category: 'CONSUMABLE', unit: 'Bao', min: 15, max: 50, serial: false, bar: '8935002014' },
      { code: 'MAT-TAPE-3M', name: 'Băng keo cách điện hạ thế chống cháy 3M Super 33+ (Cuộn)', category: 'CONSUMABLE', unit: 'Cuộn', min: 40, max: 150, serial: false, bar: '8935002015' },

      // TOOL (6 items)
      { code: 'MAT-TORQ-200', name: 'Cờ lê lực đo mô-men xiết Tohnichi 40-200 Nm', category: 'TOOL', unit: 'Cái', min: 2, max: 6, serial: true, bar: '8935003001' },
      { code: 'MAT-TOOL-SKF', name: 'Bộ vam tháo lắp vòng bi thủy lực chuyên dụng SKF TMMA 120', category: 'TOOL', unit: 'Bộ', min: 1, max: 4, serial: true, bar: '8935003002' },
      { code: 'MAT-TOOL-ALGN', name: 'Thiết bị cân chỉnh đồng tâm trục Laser Easy-Laser XT440', category: 'TOOL', unit: 'Bộ', min: 1, max: 3, serial: true, bar: '8935003003' },
      { code: 'MAT-MTR-FLUKE', name: 'Đồng hồ vạn năng True-RMS công nghiệp Fluke 87V', category: 'TOOL', unit: 'Cái', min: 3, max: 10, serial: true, bar: '8935003004' },
      { code: 'MAT-MTR-IR', name: 'Súng đo nhiệt độ hồng ngoại không tiếp xúc Fluke 62 Max+', category: 'TOOL', unit: 'Cái', min: 4, max: 12, serial: true, bar: '8935003005' },
      { code: 'MAT-MTR-MEG', name: 'Đồng hồ đo điện trở cách điện cao thế Megger MIT410', category: 'TOOL', unit: 'Cái', min: 2, max: 6, serial: true, bar: '8935003006' },

      // ROTABLE (5 items)
      { code: 'MAT-ROT-MTR75', name: 'Động cơ điện rotor lồng sóc 75kW 380V (Rotable tân trang)', category: 'ROTABLE', unit: 'Cụm', min: 1, max: 4, serial: true, bar: '8935004001' },
      { code: 'MAT-ROT-PUMP45', name: 'Cụm đầu bơm ly tâm đa tầng cánh 45kW (Rotable thay nhanh)', category: 'ROTABLE', unit: 'Cụm', min: 1, max: 3, serial: true, bar: '8935004002' },
      { code: 'MAT-ROT-INV132', name: 'Cụm module biến tần công suất lớn ABB ACS880-01-132kW', category: 'ROTABLE', unit: 'Cụm', min: 1, max: 3, serial: true, bar: '8935004003' },
      { code: 'MAT-ROT-RTR100', name: 'Trục rotor máy nén khí trục vít dự phòng xoay vòng', category: 'ROTABLE', unit: 'Bộ', min: 1, max: 3, serial: true, bar: '8935004004' },
      { code: 'MAT-ROT-FAN55', name: 'Cụm quạt hút khói công nghiệp chịu nhiệt 55kW (Đã cân bằng động)', category: 'ROTABLE', unit: 'Cụm', min: 1, max: 3, serial: true, bar: '8935004005' },
    ];

    const materialMap = new Map(); // code -> { id, ...data }

    for (const m of materialsData) {
      const matRes = await client.query(
        `INSERT INTO inventory_schema.materials
           (code, name, category, unit, min_stock, max_stock, is_serialized, barcode, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
         RETURNING id, code, name, category, unit, min_stock, max_stock, is_serialized`,
        [m.code, m.name, m.category, m.unit, m.min, m.max, m.serial, m.bar]
      );
      materialMap.set(m.code, matRes.rows[0]);
    }
    console.log(`Created ${materialMap.size} materials in master catalog.`);

    // =========================================================================
    // 4. MATERIAL INVENTORY (Stock rows across warehouses > 65 items)
    // =========================================================================
    console.log('Populating Inventory Balance across warehouses...');
    let stockRowCount = 0;

    // Distribute stock across WH-HP-01, WH-DQ-02, WH-MECH-03, WH-ELEC-04
    for (const [code, mat] of materialMap.entries()) {
      let whCode = 'WH-HP-01';
      let locCode = 'HP-RACK-A1';
      let qty = 15;
      let reserved = 0;

      if (mat.category === 'CONSUMABLE') {
        if (code.includes('OIL') || code.includes('GRS')) {
          whCode = 'WH-HP-01';
          locCode = 'HP-ZONE-OIL';
          qty = 12;
        } else if (code.includes('WELD') || code.includes('GAS')) {
          whCode = 'WH-MECH-03';
          locCode = 'MC-RACK-01';
          qty = 25;
        } else {
          whCode = 'WH-HP-01';
          locCode = 'HP-RACK-A1';
          qty = 35;
        }
      } else if (mat.category === 'TOOL') {
        whCode = 'WH-SITE-05';
        locCode = 'ST-MOB-01';
        qty = 3;
        reserved = 1;
      } else if (mat.category === 'ROTABLE') {
        whCode = 'WH-MECH-03';
        locCode = 'MC-ZONE-HEAVY';
        qty = 2;
      } else if (code.includes('PLC') || code.includes('MCB') || code.includes('CNT') || code.includes('RLY') || code.includes('PSU') || code.includes('THYR') || code.includes('DIOD')) {
        whCode = 'WH-ELEC-04';
        locCode = 'EL-CAB-01';
        qty = 18;
      } else if (code.includes('VLV') || code.includes('FLG') || code.includes('GSK')) {
        whCode = 'WH-DQ-02';
        locCode = 'DQ-RACK-C1';
        qty = 14;
      } else if (code.includes('BLD') || code.includes('NOZ') || code.includes('IGN')) {
        whCode = 'WH-DQ-02';
        locCode = 'DQ-BAY-01';
        qty = 10;
        reserved = 2;
      } else {
        whCode = 'WH-HP-01';
        locCode = 'HP-RACK-A2';
        qty = 20;
      }

      const wh = warehouseMap.get(whCode);
      const locId = wh.locations.get(locCode) ?? null;

      await client.query(
        `INSERT INTO inventory_schema.material_inventory
           (warehouse_id, location_id, material_id, quantity, quantity_reserved, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [wh.id, locId, mat.id, qty, reserved]
      );
      stockRowCount++;

      // For select critical spare parts, also place backup stock in WH-DQ-02
      if (code === 'MAT-BRG-6208' || code === 'MAT-SEAL-120' || code === 'MAT-OIL-46' || code === 'MAT-MCB-63A' || code === 'MAT-THRM-PT') {
        const dqWh = warehouseMap.get('WH-DQ-02');
        const dqLocId = dqWh.locations.get('DQ-BAY-02') ?? null;
        await client.query(
          `INSERT INTO inventory_schema.material_inventory
             (warehouse_id, location_id, material_id, quantity, quantity_reserved, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())`,
          [dqWh.id, dqLocId, mat.id, 8, 0]
        );
        stockRowCount++;
      }
    }
    console.log(`Created ${stockRowCount} stock inventory balance rows (> 60 materials).`);

    // =========================================================================
    // 5. ASSET TREE WITH 4-LEVEL DEPTH (PLANT -> SYSTEM -> EQUIPMENT -> COMPONENT)
    // =========================================================================
    console.log('Creating 4-Level Deep Asset Hierarchy Tree...');
    const assetMap = new Map(); // code -> id

    // LEVEL 1: PLANT (Depth 1)
    const plants = [
      { code: 'PLANT-HP-01', name: 'Nhà máy Nhiệt điện & Luyện kim Hải Phòng', type: 'PLANT', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'PLANT-DQ-02', name: 'Nhà máy Liên hợp Hóa dầu & Năng lượng Dung Quất', type: 'PLANT', criticality: 'CRITICAL', status: 'OPERATING' },
    ];

    for (const p of plants) {
      const res = await client.query(
        `INSERT INTO inventory_schema.assets
           (code, internal_code, name, parent_id, type, serial_number, status, criticality, qr_code)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8)
         RETURNING id, code`,
        [p.code, `INT-${p.code}`, p.name, p.type, `SN-${p.code}`, p.status, p.criticality, `QR-${p.code}`]
      );
      assetMap.set(p.code, res.rows[0].id);
    }

    // LEVEL 2: SYSTEM (Depth 2)
    const systems = [
      // Under PLANT-HP-01
      { code: 'SYS-HP-TURB', parent: 'PLANT-HP-01', name: 'Hệ thống Tổ hợp Turbine Khí & Máy phát STG-01', type: 'SYSTEM', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'SYS-HP-BOIL', parent: 'PLANT-HP-01', name: 'Hệ thống Lò hơi Sinh hơi Tầng sôi Tuần hoàn CFB-01', type: 'SYSTEM', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'SYS-HP-WTR', parent: 'PLANT-HP-01', name: 'Hệ thống Xử lý Nước cấp & Bơm cao áp Lò hơi', type: 'SYSTEM', criticality: 'HIGH', status: 'OPERATING' },
      { code: 'SYS-HP-ELEC', parent: 'PLANT-HP-01', name: 'Hệ thống Trạm phân phối Điện & Biến áp 110kV', type: 'SYSTEM', criticality: 'CRITICAL', status: 'OPERATING' },

      // Under PLANT-DQ-02
      { code: 'SYS-DQ-REF', parent: 'PLANT-DQ-02', name: 'Hệ thống Phân xưởng Chưng cất & Tách khí Gas Naphtha', type: 'SYSTEM', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'SYS-DQ-COMP', parent: 'PLANT-DQ-02', name: 'Hệ thống Máy nén Khí công nghiệp & Khí công nghệ', type: 'SYSTEM', criticality: 'HIGH', status: 'OPERATING' },
    ];

    for (const s of systems) {
      const parentId = assetMap.get(s.parent);
      const res = await client.query(
        `INSERT INTO inventory_schema.assets
           (code, internal_code, name, parent_id, type, serial_number, status, criticality, qr_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, code`,
        [s.code, `INT-${s.code}`, s.name, parentId, s.type, `SN-${s.code}`, s.status, s.criticality, `QR-${s.code}`]
      );
      assetMap.set(s.code, res.rows[0].id);
    }

    // LEVEL 3: EQUIPMENT (Depth 3)
    const equipments = [
      // Under SYS-HP-TURB
      { code: 'EQ-HP-GT101', parent: 'SYS-HP-TURB', name: 'Turbine Khí Cao Áp Công Suất 150MW (GE 9E)', type: 'EQUIPMENT', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'EQ-HP-GEN201', parent: 'SYS-HP-TURB', name: 'Máy Phát Điện Đồng Bộ Ba Pha 175MVA (Siemens SGen5)', type: 'EQUIPMENT', criticality: 'CRITICAL', status: 'OPERATING' },

      // Under SYS-HP-BOIL
      { code: 'EQ-HP-BLR301', parent: 'SYS-HP-BOIL', name: 'Lò Hơi Áp Lực Cao 450 Tấn/Giờ (Foster Wheeler)', type: 'EQUIPMENT', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'EQ-HP-FDF401', parent: 'SYS-HP-BOIL', name: 'Quạt Thổi Gió Cấp 1 Lưu Lượng Lớn (Fläkt Woods)', type: 'EQUIPMENT', criticality: 'HIGH', status: 'MAINTENANCE' },

      // Under SYS-HP-WTR
      { code: 'EQ-HP-PMP501', parent: 'SYS-HP-WTR', name: 'Cụm Bơm Cấp Nước Đa Tầng Cánh Áp Cao (KSB HGC)', type: 'EQUIPMENT', criticality: 'HIGH', status: 'OPERATING' },
      { code: 'EQ-HP-RO601', parent: 'SYS-HP-WTR', name: 'Hệ Thống Thẩm Thấu Ngược Khử Khoáng RO 120m3/h', type: 'EQUIPMENT', criticality: 'MEDIUM', status: 'OPERATING' },

      // Under SYS-HP-ELEC
      { code: 'EQ-HP-TRF701', parent: 'SYS-HP-ELEC', name: 'Máy Biến Áp Lực 110kV/22kV 63MVA (ABB Trafo)', type: 'EQUIPMENT', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'EQ-HP-SWG801', parent: 'SYS-HP-ELEC', name: 'Tủ Đóng Cắt Hợp Bộ Trung Thế 24kV (Schneider UniGear)', type: 'EQUIPMENT', criticality: 'HIGH', status: 'OPERATING' },

      // Under SYS-DQ-REF
      { code: 'EQ-DQ-COL101', parent: 'SYS-DQ-REF', name: 'Tháp Chưng Cất Tách Phân Đoạn Naphtha Column C-101', type: 'EQUIPMENT', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'EQ-DQ-HEX201', parent: 'SYS-DQ-REF', name: 'Bộ Trao Đổi Nhiệt Dạng Ống Chùm Áp Lực Cao E-201', type: 'EQUIPMENT', criticality: 'HIGH', status: 'OPERATING' },

      // Under SYS-DQ-COMP
      { code: 'EQ-DQ-CMP301', parent: 'SYS-DQ-COMP', name: 'Máy Nén Khí Ly Tâm Cao Áp 4 Cấp (Atlas Copco GT050)', type: 'EQUIPMENT', criticality: 'HIGH', status: 'OPERATING' },
      { code: 'EQ-DQ-DRY401', parent: 'SYS-DQ-COMP', name: 'Máy Sấy Khí Hấp Phụ Điểm Sương -40°C (Donaldson Ultrapac)', type: 'EQUIPMENT', criticality: 'MEDIUM', status: 'STOPPED' },
    ];

    for (const eq of equipments) {
      const parentId = assetMap.get(eq.parent);
      const res = await client.query(
        `INSERT INTO inventory_schema.assets
           (code, internal_code, name, parent_id, type, serial_number, status, criticality, qr_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, code`,
        [eq.code, `INT-${eq.code}`, eq.name, parentId, eq.type, `SN-${eq.code}`, eq.status, eq.criticality, `QR-${eq.code}`]
      );
      assetMap.set(eq.code, res.rows[0].id);
    }

    // LEVEL 4: COMPONENT (Depth 4)
    const components = [
      // Under EQ-HP-GT101
      { code: 'COMP-HP-RTR1', parent: 'EQ-HP-GT101', name: 'Cụm Trục & Đĩa Cánh Turbine Tầng 1 (Rotor Assembly #1)', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'COMP-HP-BRG1', parent: 'EQ-HP-GT101', name: 'Cụm Ổ Đỡ Chặn & Ổ Bạc Lót Trục Chính #1', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'COMP-HP-NOZ1', parent: 'EQ-HP-GT101', name: 'Vành Dẫn Hướng & Cụm Kim Phun Khí Đốt Buồng Đốt', criticality: 'HIGH', status: 'OPERATING' },

      // Under EQ-HP-GEN201
      { code: 'COMP-HP-EXC1', parent: 'EQ-HP-GEN201', name: 'Cụm Kích Từ Không Chổi Than & Cầu Diode Xoay', criticality: 'HIGH', status: 'OPERATING' },
      { code: 'COMP-HP-CLR1', parent: 'EQ-HP-GEN201', name: 'Cụm Giàn Làm Mát Khí Hydro & Nước Máy Phát', criticality: 'MEDIUM', status: 'OPERATING' },

      // Under EQ-HP-BLR301
      { code: 'COMP-HP-TUB1', parent: 'EQ-HP-BLR301', name: 'Giàn Ống Nước Vách Sinh Hơi Buồng Lửa (Waterwall Tubes)', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'COMP-HP-VLV1', parent: 'EQ-HP-BLR301', name: 'Cụm Van Xả Áp An Toàn Chính Lò Hơi (Safety Valve SV-101)', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'COMP-HP-BRN1', parent: 'EQ-HP-BLR301', name: 'Đầu Đốt Phun Than Mịn & Dầu Mồi Buồng Đốt', criticality: 'HIGH', status: 'OPERATING' },

      // Under EQ-HP-FDF401
      { code: 'COMP-HP-IMP1', parent: 'EQ-HP-FDF401', name: 'Cánh Quạt Hút Hợp Kim Chịu Mài Mòn Φ2800mm', criticality: 'HIGH', status: 'MAINTENANCE' },
      { code: 'COMP-HP-MTR1', parent: 'EQ-HP-FDF401', name: 'Động Cơ Kéo Điện Áp Cao 6kV 1250kW', criticality: 'HIGH', status: 'MAINTENANCE' },

      // Under EQ-HP-PMP501
      { code: 'COMP-HP-PIMP1', parent: 'EQ-HP-PMP501', name: 'Cánh Bơm Thép Không Gỉ Duplex & Buồng Xoắn', criticality: 'HIGH', status: 'OPERATING' },
      { code: 'COMP-HP-MSEAL', parent: 'EQ-HP-PMP501', name: 'Bộ Phớt Cơ Khí Làm Mát Tuần Hoàn Burgmann Cartex', criticality: 'HIGH', status: 'OPERATING' },

      // Under EQ-HP-TRF701
      { code: 'COMP-HP-OLTC', parent: 'EQ-HP-TRF701', name: 'Bộ Điều Chỉnh Điện Áp Dưới Tải (OLTC MR Reinhausen)', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'COMP-HP-BUSH', parent: 'EQ-HP-TRF701', name: 'Bộ Sứ Cách Điện Đầu Cực Cao Thế 110kV RIP', criticality: 'HIGH', status: 'OPERATING' },

      // Under EQ-DQ-COL101
      { code: 'COMP-DQ-TRY1', parent: 'EQ-DQ-COL101', name: 'Cụm Đĩa Khay Chóp Chưng Cất Inox 316L (Bubble Cap Trays)', criticality: 'CRITICAL', status: 'OPERATING' },
      { code: 'COMP-DQ-DRM1', parent: 'EQ-DQ-COL101', name: 'Bình Tách Lỏng Đỉnh Tháp Áp Suất Chân Không', criticality: 'HIGH', status: 'OPERATING' },

      // Under EQ-DQ-HEX201
      { code: 'COMP-DQ-BNDL', parent: 'EQ-DQ-HEX201', name: 'Bó Ống Trao Đổi Nhiệt Titan Gr.2 (Tube Bundle B-201)', criticality: 'HIGH', status: 'OPERATING' },
      { code: 'COMP-DQ-CHHD', parent: 'EQ-DQ-HEX201', name: 'Nắp Hộp Kênh Phân Phối Dòng Chảy Áp Cao Chống Ăn Mòn', criticality: 'MEDIUM', status: 'OPERATING' },

      // Under EQ-DQ-CMP301
      { code: 'COMP-DQ-IGV1', parent: 'EQ-DQ-CMP301', name: 'Cụm Cánh Hướng Dòng Đầu Vào Điều Khiển Góc Mở (IGV)', criticality: 'HIGH', status: 'OPERATING' },
      { code: 'COMP-DQ-GBX1', parent: 'EQ-DQ-CMP301', name: 'Hộp Bánh Răng Tăng Tốc Tỷ Số Cao 14.500 RPM', criticality: 'CRITICAL', status: 'OPERATING' },

      // Under EQ-DQ-DRY401
      { code: 'COMP-DQ-VLV2', parent: 'EQ-DQ-DRY401', name: 'Cụm Van Chuyển Đổi Chiều Hấp Phụ 4 Cổng Khí Nén', criticality: 'MEDIUM', status: 'STOPPED' },
      { code: 'COMP-DQ-FIL1', parent: 'EQ-DQ-DRY401', name: 'Lõi Lọc Bụi Hạt Hút Ẩm Tinh Cấp Đầu Ra 0.01 Micron', criticality: 'LOW', status: 'STOPPED' },
    ];

    for (const c of components) {
      const parentId = assetMap.get(c.parent);
      const res = await client.query(
        `INSERT INTO inventory_schema.assets
           (code, internal_code, name, parent_id, type, serial_number, status, criticality, qr_code)
         VALUES ($1, $2, $3, $4, 'COMPONENT', $5, $6, $7, $8)
         RETURNING id, code`,
        [c.code, `INT-${c.code}`, c.name, parentId, `SN-${c.code}`, c.status, c.criticality, `QR-${c.code}`]
      );
      assetMap.set(c.code, res.rows[0].id);
    }
    console.log(`Created 4-Level Asset Tree: 2 Plants -> 6 Systems -> 12 Equipments -> 22 Components (Total: ${assetMap.size} assets).`);

    // =========================================================================
    // 6. ASSET BOMs (Standard spare parts per component)
    // =========================================================================
    console.log('Attaching BOM to components...');
    const bomLinks = [
      { asset: 'COMP-HP-BRG1', mat: 'MAT-BRG-22216', qty: 2, critical: true, note: 'Vòng bi chính đỡ trục' },
      { asset: 'COMP-HP-BRG1', mat: 'MAT-SEAL-120', qty: 4, critical: true, note: 'Phớt chắn dầu chịu nhiệt' },
      { asset: 'COMP-HP-NOZ1', mat: 'MAT-NOZ-01', qty: 6, critical: true, note: 'Vòi phun nhiên liệu' },
      { asset: 'COMP-HP-TUB1', mat: 'MAT-GSK-300', qty: 12, critical: true, note: 'Đệm kín kim loại chịu áp' },
      { asset: 'COMP-HP-VLV1', mat: 'MAT-VLV-100', qty: 2, critical: true, note: 'Van cầu áp cao thay thế' },
      { asset: 'COMP-HP-PIMP1', mat: 'MAT-IMP-250', qty: 1, critical: true, note: 'Cánh bơm dự phòng' },
      { asset: 'COMP-HP-MSEAL', mat: 'MAT-SEAL-80', qty: 2, critical: true, note: 'Bộ phớt cơ khí trục bơm' },
      { asset: 'COMP-DQ-GBX1', mat: 'MAT-BRG-NU315', qty: 2, critical: true, note: 'Vòng bi đũa hộp số tốc độ cao' },
      { asset: 'COMP-DQ-GBX1', mat: 'MAT-OIL-220', qty: 1, critical: false, note: 'Dầu bôi trơn bánh răng' },
    ];

    for (const bom of bomLinks) {
      const assetId = assetMap.get(bom.asset);
      const mat = materialMap.get(bom.mat);
      if (assetId && mat) {
        await client.query(
          `INSERT INTO inventory_schema.asset_boms (asset_id, material_id, standard_quantity, is_critical_spare, note)
           VALUES ($1, $2, $3, $4, $5)`,
          [assetId, mat.id, bom.qty, bom.critical, bom.note]
        );
      }
    }

    // =========================================================================
    // 7. 30 TRANSACTIONS (Phiếu nhập - xuất - chuyển - mượn - trả kho)
    // =========================================================================
    console.log('Generating 30 Inventory Transactions...');
    const now = Date.now();
    const dayMs = 86400000;

    const txDefs = [
      // 1. Nhập kho theo PO từ SKF
      {
        code: 'TX-REC-2026-0001',
        type: 'IMPORT',
        wh: 'WH-HP-01',
        loc: 'HP-RACK-A2',
        mat: 'MAT-BRG-6208',
        qty: 30,
        cost: 450000,
        refType: 'PURCHASE_ORDER',
        note: 'Nhập kho lô vòng bi SKF 6208 theo đơn hàng PO-2026-081',
        daysAgo: 28,
      },
      // 2. Nhập dầu turbine Shell Tellus
      {
        code: 'TX-REC-2026-0002',
        type: 'IMPORT',
        wh: 'WH-HP-01',
        loc: 'HP-ZONE-OIL',
        mat: 'MAT-OIL-46',
        qty: 15,
        cost: 12500000,
        refType: 'PURCHASE_ORDER',
        note: 'Nhập 15 phuy dầu thủy lực Shell Tellus S2 MX 46',
        daysAgo: 26,
      },
      // 3. Nhập que hàn và dây hàn
      {
        code: 'TX-REC-2026-0003',
        type: 'IMPORT',
        wh: 'WH-MECH-03',
        loc: 'MC-RACK-01',
        mat: 'MAT-WELD-E70',
        qty: 50,
        cost: 180000,
        refType: 'PURCHASE_ORDER',
        note: 'Nhập que hàn E7018 phục vụ sửa chữa lò hơi',
        daysAgo: 25,
      },
      // 4. Nhập module PLC Siemens
      {
        code: 'TX-REC-2026-0004',
        type: 'IMPORT',
        wh: 'WH-ELEC-04',
        loc: 'EL-CAB-01',
        mat: 'MAT-PLC-DI',
        qty: 6,
        cost: 8500000,
        refType: 'PURCHASE_ORDER',
        note: 'Nhập bổ sung module DI S7-1500 cho tủ điều khiển',
        daysAgo: 24,
      },
      // 5. Xuất kho thay thế vòng bi quạt gió FDF-401
      {
        code: 'TX-ISS-2026-0005',
        type: 'EXPORT',
        wh: 'WH-HP-01',
        loc: 'HP-RACK-A2',
        mat: 'MAT-BRG-22216',
        qty: 2,
        cost: 3200000,
        refType: 'WORK_ORDER',
        note: 'Xuất theo Lệnh sửa chữa WO-HP-2026-092 thay vòng bi quạt gió',
        daysAgo: 22,
      },
      // 6. Xuất dầu bôi trơn turbine bảo dưỡng định kỳ
      {
        code: 'TX-ISS-2026-0006',
        type: 'EXPORT',
        wh: 'WH-HP-01',
        loc: 'HP-ZONE-OIL',
        mat: 'MAT-OIL-TURB',
        qty: 3,
        cost: 18000000,
        refType: 'WORK_ORDER',
        note: 'Châm bổ sung dầu bôi trơn turbine khí GT-101',
        daysAgo: 21,
      },
      // 7. Nhập đệm kim loại Spiral Wound
      {
        code: 'TX-REC-2026-0007',
        type: 'IMPORT',
        wh: 'WH-DQ-02',
        loc: 'DQ-RACK-C1',
        mat: 'MAT-GSK-300',
        qty: 40,
        cost: 850000,
        refType: 'PURCHASE_ORDER',
        note: 'Nhập đệm làm kín ống tháp chưng cất Dung Quất',
        daysAgo: 20,
      },
      // 8. Chuyển kho vật tư từ Hải Phòng sang Dung Quất
      {
        code: 'TX-TRA-2026-0008',
        type: 'TRANSFER_OUT',
        wh: 'WH-HP-01',
        loc: 'HP-RACK-A2',
        mat: 'MAT-SEAL-120',
        qty: 10,
        cost: 350000,
        refType: 'INTERNAL_TRANSFER',
        note: 'Điều chuyển phớt Viton cấp cho nhà máy Dung Quất',
        daysAgo: 19,
      },
      // 9. Tiếp nhận chuyển kho tại Dung Quất
      {
        code: 'TX-TRA-2026-0009',
        type: 'TRANSFER_IN',
        wh: 'WH-DQ-02',
        loc: 'DQ-RACK-C1',
        mat: 'MAT-SEAL-120',
        qty: 10,
        cost: 350000,
        refType: 'INTERNAL_TRANSFER',
        note: 'Nhập kho nhận điều chuyển từ Hải Phòng',
        daysAgo: 18,
      },
      // 10. Phiếu mượn thiết bị đo Fluke 87V
      {
        code: 'TX-BOR-2026-0010',
        type: 'BORROW',
        wh: 'WH-SITE-05',
        loc: 'ST-MOB-01',
        mat: 'MAT-MTR-FLUKE',
        qty: 1,
        cost: 14000000,
        refType: 'PROJECT_BORROW',
        note: 'Tổ điện mượn đồng hồ đo kiểm tra trạm 110kV',
        daysAgo: 17,
      },
      // 11. Phiếu mượn thiết bị cân tâm trục Laser
      {
        code: 'TX-BOR-2026-0011',
        type: 'BORROW',
        wh: 'WH-SITE-05',
        loc: 'ST-MOB-01',
        mat: 'MAT-TOOL-ALGN',
        qty: 1,
        cost: 185000000,
        refType: 'PROJECT_BORROW',
        note: 'Tổ cơ khí mượn cân chỉnh đồng tâm trục bơm KSB',
        daysAgo: 16,
      },
      // 12. Trả thiết bị cân tâm trục Laser về kho
      {
        code: 'TX-RET-2026-0012',
        type: 'RETURN',
        wh: 'WH-SITE-05',
        loc: 'ST-MOB-01',
        mat: 'MAT-TOOL-ALGN',
        qty: 1,
        cost: 185000000,
        refType: 'PROJECT_BORROW',
        note: 'Hoàn trả thiết bị cân tâm sau khi hoàn thành cân chỉnh',
        daysAgo: 15,
      },
      // 13. Nhập van bi điều khiển khí nén
      {
        code: 'TX-REC-2026-0013',
        type: 'IMPORT',
        wh: 'WH-DQ-02',
        loc: 'DQ-RACK-C1',
        mat: 'MAT-VLV-50',
        qty: 8,
        cost: 6200000,
        refType: 'PURCHASE_ORDER',
        note: 'Nhập van điều khiển cấp cho hệ thống khí nén',
        daysAgo: 14,
      },
      // 14. Xuất van xả áp an toàn cho lò hơi
      {
        code: 'TX-ISS-2026-0014',
        type: 'EXPORT',
        wh: 'WH-DQ-02',
        loc: 'DQ-RACK-C1',
        mat: 'MAT-VLV-100',
        qty: 1,
        cost: 32000000,
        refType: 'WORK_ORDER',
        note: 'Xuất thay thế van an toàn hơi lò BLR-301',
        daysAgo: 13,
      },
      // 15. Nhập cảm biến áp suất Rosemount
      {
        code: 'TX-REC-2026-0015',
        type: 'IMPORT',
        wh: 'WH-ELEC-04',
        loc: 'EL-CAB-01',
        mat: 'MAT-PRS-TX',
        qty: 5,
        cost: 24500000,
        refType: 'PURCHASE_ORDER',
        note: 'Nhập cảm biến áp suất vi sai Rosemount 3051CD',
        daysAgo: 12,
      },
      // 16. Xuất cảm biến áp suất cho tháp chưng cất
      {
        code: 'TX-ISS-2026-0016',
        type: 'EXPORT',
        wh: 'WH-ELEC-04',
        loc: 'EL-CAB-01',
        mat: 'MAT-PRS-TX',
        qty: 2,
        cost: 24500000,
        refType: 'WORK_ORDER',
        note: 'Lắp đặt giám sát áp suất đỉnh tháp Naphtha C-101',
        daysAgo: 11,
      },
      // 17. Nhập keo khóa ren Loctite 577 & 243
      {
        code: 'TX-REC-2026-0017',
        type: 'IMPORT',
        wh: 'WH-HP-01',
        loc: 'HP-RACK-A1',
        mat: 'MAT-SLT-577',
        qty: 25,
        cost: 380000,
        refType: 'PURCHASE_ORDER',
        note: 'Nhập keo khóa ren đường ống chịu áp lực',
        daysAgo: 10,
      },
      // 18. Xuất mỡ bôi trơn SKF chịu nhiệt
      {
        code: 'TX-ISS-2026-0018',
        type: 'EXPORT',
        wh: 'WH-HP-01',
        loc: 'HP-ZONE-OIL',
        mat: 'MAT-GRS-HT',
        qty: 4,
        cost: 950000,
        refType: 'WORK_ORDER',
        note: 'Bôi trơn ổ bạc đỡ máy biến áp và turbine',
        daysAgo: 9,
      },
      // 19. Nhập bình khí Argon tinh khiết
      {
        code: 'TX-REC-2026-0019',
        type: 'IMPORT',
        wh: 'WH-MECH-03',
        loc: 'MC-RACK-01',
        mat: 'MAT-GAS-ARG',
        qty: 12,
        cost: 750000,
        refType: 'PURCHASE_ORDER',
        note: 'Nhập khí Argon phục vụ hàn ống titan',
        daysAgo: 8,
      },
      // 20. Xuất cánh bơm hợp kim cho bơm KSB
      {
        code: 'TX-ISS-2026-0020',
        type: 'EXPORT',
        wh: 'WH-HP-01',
        loc: 'HP-RACK-A2',
        mat: 'MAT-IMP-250',
        qty: 1,
        cost: 16500000,
        refType: 'WORK_ORDER',
        note: 'Xuất thay cánh bơm nước cấp số 2 lò hơi',
        daysAgo: 7,
      },
      // 21. Phiếu mượn bộ vam thủy lực SKF
      {
        code: 'TX-BOR-2026-0021',
        type: 'BORROW',
        wh: 'WH-SITE-05',
        loc: 'ST-MOB-01',
        mat: 'MAT-TOOL-SKF',
        qty: 1,
        cost: 48000000,
        refType: 'PROJECT_BORROW',
        note: 'Mượn vam tháo vòng bi động cơ 75kW tại xưởng',
        daysAgo: 6,
      },
      // 22. Xuất aptomat khối Schneider 63A
      {
        code: 'TX-ISS-2026-0022',
        type: 'EXPORT',
        wh: 'WH-ELEC-04',
        loc: 'EL-CAB-01',
        mat: 'MAT-MCB-63A',
        qty: 3,
        cost: 1450000,
        refType: 'WORK_ORDER',
        note: 'Thay thế MCCB cấp nguồn bơm dầu làm mát',
        daysAgo: 5,
      },
      // 23. Nhập rơ le trung gian Omron
      {
        code: 'TX-REC-2026-0023',
        type: 'IMPORT',
        wh: 'WH-ELEC-04',
        loc: 'EL-CAB-01',
        mat: 'MAT-RLY-OMR',
        qty: 50,
        cost: 120000,
        refType: 'PURCHASE_ORDER',
        note: 'Nhập lô 50 bộ rơ le Omron dự phòng tủ liên động',
        daysAgo: 4,
      },
      // 24. Xuất keo Loctite 243 và giẻ lau kỹ thuật
      {
        code: 'TX-ISS-2026-0024',
        type: 'EXPORT',
        wh: 'WH-HP-01',
        loc: 'HP-RACK-A1',
        mat: 'MAT-SLT-243',
        qty: 5,
        cost: 320000,
        refType: 'MAINTENANCE_JOB',
        note: 'Cấp vật tư phụ cho đội đại tu máy phát',
        daysAgo: 3,
      },
      // 25. Trả bộ vam thủy lực SKF về kho
      {
        code: 'TX-RET-2026-0025',
        type: 'RETURN',
        wh: 'WH-SITE-05',
        loc: 'ST-MOB-01',
        mat: 'MAT-TOOL-SKF',
        qty: 1,
        cost: 48000000,
        refType: 'PROJECT_BORROW',
        note: 'Hoàn trả vam sau khi tháo xong vòng bi',
        daysAgo: 3,
      },
      // 26. Điều chỉnh kiểm kê định kỳ
      {
        code: 'TX-ADJ-2026-0026',
        type: 'ADJUST',
        wh: 'WH-HP-01',
        loc: 'HP-RACK-A1',
        mat: 'MAT-TAPE-3M',
        qty: 5,
        cost: 65000,
        refType: 'STOCK_TAKE',
        note: 'Điều chỉnh thừa 5 cuộn băng keo sau kiểm kê quý 3',
        daysAgo: 2,
      },
      // 27. Nhập bổ sung lõi lọc dầu thủy lực Hydac
      {
        code: 'TX-REC-2026-0027',
        type: 'IMPORT',
        wh: 'WH-HP-01',
        loc: 'HP-RACK-A2',
        mat: 'MAT-FLT-05',
        qty: 20,
        cost: 1450000,
        refType: 'PURCHASE_ORDER',
        note: 'Nhập lõi lọc dầu định kỳ cho hệ thống thủy lực',
        daysAgo: 2,
      },
      // 28. Xuất lõi lọc dầu Hydac thay định kỳ
      {
        code: 'TX-ISS-2026-0028',
        type: 'EXPORT',
        wh: 'WH-HP-01',
        loc: 'HP-RACK-A2',
        mat: 'MAT-FLT-05',
        qty: 4,
        cost: 1450000,
        refType: 'WORK_ORDER',
        note: 'Thay lõi lọc dầu trạm nguồn nâng hạ van hơi',
        daysAgo: 1,
      },
      // 29. Xuất dây curoa chịu nhiệt Optibelt
      {
        code: 'TX-ISS-2026-0029',
        type: 'EXPORT',
        wh: 'WH-HP-01',
        loc: 'HP-RACK-A1',
        mat: 'MAT-BELT-SPC',
        qty: 4,
        cost: 820000,
        refType: 'WORK_ORDER',
        note: 'Thay bộ dây đai truyền động máy nén khí phụ trợ',
        daysAgo: 1,
      },
      // 30. Nhập mới cánh tuabin khí tầng 1 Inconel
      {
        code: 'TX-REC-2026-0030',
        type: 'IMPORT',
        wh: 'WH-DQ-02',
        loc: 'DQ-BAY-01',
        mat: 'MAT-BLD-T1',
        qty: 12,
        cost: 145000000,
        refType: 'PURCHASE_ORDER',
        note: 'Nhập lô cánh động tuabin Inconel dự phòng đại tu năm 2027',
        daysAgo: 0,
      },
    ];

    for (const tx of txDefs) {
      const wh = warehouseMap.get(tx.wh);
      const locId = wh.locations.get(tx.loc) ?? null;
      const mat = materialMap.get(tx.mat);
      const createdAt = new Date(now - tx.daysAgo * dayMs);

      await client.query(
        `INSERT INTO inventory_schema.inventory_transactions
           (transaction_code, warehouse_id, location_id, material_id, type, quantity, unit_cost, reference_type, workflow_status, note, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'APPROVED', $9, $10, $11)`,
        [
          tx.code,
          wh.id,
          locId,
          mat.id,
          tx.type,
          tx.qty,
          tx.cost,
          tx.refType,
          tx.note,
          adminUserId,
          createdAt,
        ]
      );
    }
    console.log(`Created ${txDefs.length} transactions in inventory ledger.`);

    // =========================================================================
    // 8. SERIAL TRACKING FOR ROTABLES AND CRITICAL ITEMS
    // =========================================================================
    console.log('Registering serial tracking for rotable items...');
    const serialDefs = [
      { mat: 'MAT-ROT-MTR75', sn: 'SN-MTR-75KW-001', code: 'ROT-MTR-01', status: 'IN_STOCK', wh: 'WH-MECH-03' },
      { mat: 'MAT-ROT-MTR75', sn: 'SN-MTR-75KW-002', code: 'ROT-MTR-02', status: 'IN_USE', asset: 'COMP-HP-MTR1' },
      { mat: 'MAT-ROT-PUMP45', sn: 'SN-PMP-45KW-001', code: 'ROT-PMP-01', status: 'IN_STOCK', wh: 'WH-MECH-03' },
      { mat: 'MAT-ROT-INV132', sn: 'SN-INV-132KW-001', code: 'ROT-INV-01', status: 'IN_STOCK', wh: 'WH-ELEC-04' },
      { mat: 'MAT-ROT-RTR100', sn: 'SN-RTR-100-001', code: 'ROT-RTR-01', status: 'UNDER_REPAIR', wh: 'WH-MECH-03' },
      { mat: 'MAT-TOOL-ALGN', sn: 'SN-EASY-XT440-99', code: 'TOOL-ALGN-01', status: 'IN_STOCK', wh: 'WH-SITE-05' },
      { mat: 'MAT-MTR-FLUKE', sn: 'SN-FLUKE-87V-882', code: 'TOOL-FLK-01', status: 'IN_USE', wh: 'WH-SITE-05' },
    ];

    for (const s of serialDefs) {
      const mat = materialMap.get(s.mat);
      const whId = s.wh ? warehouseMap.get(s.wh)?.id : null;
      const assetId = s.asset ? assetMap.get(s.asset) : null;
      const locType = assetId ? 'ASSET' : 'WAREHOUSE';

      await client.query(
        `INSERT INTO inventory_schema.serial_tracking
           (material_id, serial_number, internal_code, current_status, location_type, current_warehouse_id, current_asset_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [mat.id, s.sn, s.code, s.status, locType, whId, assetId]
      );
    }
    console.log(`Created ${serialDefs.length} serial tracking units.`);

    await client.query('COMMIT');
    console.log('✅ SEEDING INVENTORY DATA COMPLETED SUCCESSFULLY!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ SEEDING FAILED:', error);
    throw error;
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
