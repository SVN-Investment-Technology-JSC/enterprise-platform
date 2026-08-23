# Inventory API

NestJS API server for Inventory module. Port 3336.

## Start

```bash
pnpm nx serve inventory-api
```

## Endpoints

- `GET /api/inventory/v1/warehouses` - List warehouses
- `GET /api/inventory/v1/materials` - List materials
- `GET /api/inventory/v1/assets` - List assets
- `POST /api/inventory/v1/reservations` - Create stock reservation
- `POST /api/inventory/v1/receipts` - Receive stock
- `POST /api/inventory/v1/issues` - Issue stock
- `POST /api/inventory/v1/transfers` - Transfer stock
