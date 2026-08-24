import { expect, test } from '@playwright/test';

const now='2026-08-17T08:00:00.000Z';
const assets=[
  {id:'61000000-0000-4000-8000-000000000001',code:'MBA',name:'Máy biến áp',type:'equipment',status:'active',health:'good',location:'Nhà máy chính',manufacturer:'ABB',createdAt:now,updatedAt:now},
  {id:'61000000-0000-4000-8000-000000000002',code:'DAU-CD',name:'Dầu cách điện',type:'part',parentId:'61000000-0000-4000-8000-000000000001',status:'active',health:'good',createdAt:now,updatedAt:now},
  {id:'61000000-0000-4000-8000-000000000003',code:'LAM-MAT',name:'Hệ thống làm mát (quạt gió)',type:'part',parentId:'61000000-0000-4000-8000-000000000001',status:'active',health:'warning',createdAt:now,updatedAt:now},
  {id:'61000000-0000-4000-8000-000000000004',code:'TIEP-DIA',name:'Hệ thống tiếp địa',type:'part',parentId:'61000000-0000-4000-8000-000000000001',status:'active',health:'good',createdAt:now,updatedAt:now},
  {id:'61000000-0000-4000-8000-000000000005',code:'SU-CD',name:'Sứ cách điện',type:'part',parentId:'61000000-0000-4000-8000-000000000001',status:'active',health:'good',createdAt:now,updatedAt:now},
  {id:'61000000-0000-4000-8000-000000000006',code:'MNK-01',name:'Máy nén khí - 01',type:'equipment',status:'active',health:'good',location:'Phòng máy',createdAt:now,updatedAt:now},
];
const jobPlan={id:'62000000-0000-4000-8000-000000000001',code:'MNK-01',name:'Bảo trì máy nén khí định kỳ',status:'published',versionNumber:1,checklist:[{id:'check-oil',order:1,title:'Kiểm tra dầu bôi trơn',required:true}],createdAt:now,updatedAt:now,publishedAt:now};
const schedule={id:'63000000-0000-4000-8000-000000000001',code:'PEMX_MNK-01_Q',title:'Bảo trì quý - Máy nén khí - 01',assetId:assets[5].id,jobPlanId:jobPlan.id,procedureDefinitionId:'41000000-0000-4000-8000-000000000002',procedureDefinitionCode:'EXEC_QT_MSTB',procedureDefinitionName:'Luồng Mua sắm, Lắp đặt và Bàn giao Thiết bị Thí nghiệm',frequency:'quarter',status:'active',startDate:'2026-08-17',timezone:'Asia/Ho_Chi_Minh',nextDueAt:'2026-11-17T08:00:00.000Z',createdAt:now,updatedAt:now};
const occurrence={id:'64000000-0000-4000-8000-000000000001',scheduleId:schedule.id,scheduleTitle:schedule.title,assetId:assets[5].id,assetCode:assets[5].code,assetName:assets[5].name,dueAt:now,status:'generated',procedureInstanceId:'42000000-0000-4000-8000-000000000003',procedureInstanceCode:'PROC-MAINT-0001',createdAt:now};
const workspace={tenantId:'99999999-9999-4999-8999-999999999999',actor:{id:'b9999999-9999-4999-8999-999999999999',name:'Tenant Admin'},permissions:{canManageAssets:true,canManageJobPlans:true,canManageSchedules:true},assets,jobPlans:[jobPlan],schedules:[schedule],occurrences:[occurrence],procedureCatalog:[{definitionId:schedule.procedureDefinitionId,code:'EXEC_QT_MSTB',name:schedule.procedureDefinitionName,versionNumber:1,status:'published',synchronizedAt:now}],metrics:{activeSchedules:1,upcomingOccurrences:0,generatedOccurrences:1,completedOccurrences:0}};

test.beforeEach(async({page}, testInfo)=>{
  if(testInfo.project.name !== 'Mobile Chrome') await page.setViewportSize({width:1440,height:1000});
  await page.route('**/api/maintenance/v1/workspace',(route)=>route.fulfill({contentType:'application/json',body:JSON.stringify(workspace)}));
});

for(const screen of [
  {hash:'asset-tree',heading:'Sơ đồ thiết bị',image:'maintenance-assets.png'},
  {hash:'maintenance-matrix',heading:'Ma trận bảo trì',image:'maintenance-matrix.png'},
  {hash:'maintenance-dashboard',heading:'Dashboard bảo trì',image:'maintenance-dashboard.png'},
]){
  test(`visual baseline: ${screen.hash}`,async({page})=>{
    await page.goto(`/modules/maintenance#${screen.hash}`);
    await expect(page.getByRole('heading',{level:1})).toHaveText(screen.heading);
    await expect(page).toHaveScreenshot(screen.image,{fullPage:true,animations:'disabled'});
  });
}
