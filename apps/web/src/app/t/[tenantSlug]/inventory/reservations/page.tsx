import { InventoryPage } from '../inventory-page';
export default async function Page({params}:{params:Promise<{tenantSlug:string}>}){return <InventoryPage tenantSlug={(await params).tenantSlug} view="reservations"/>;}
