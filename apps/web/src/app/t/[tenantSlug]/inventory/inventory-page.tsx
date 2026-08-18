import type { InventoryWorkspaceDto } from '@enterprise-platform/contract-inventory';
import { InventoryScreen,type InventoryView } from '@enterprise-platform/feature-inventory';
import { cookies } from 'next/headers';import { redirect } from 'next/navigation';
export async function InventoryPage({tenantSlug,view}:{tenantSlug:string;view:InventoryView}){const cookie=(await cookies()).toString();const api=process.env.API_BASE_URL??'http://localhost:3333';const response=await fetch(`${api}/api/inventory/v1/workspace`,{headers:{cookie},cache:'no-store'});if(response.status===401)redirect('/tenant/login');if(!response.ok)redirect(`/t/${tenantSlug}`);return <InventoryScreen data={await response.json() as InventoryWorkspaceDto} tenantSlug={tenantSlug} view={view}/>;}
