# platform-data-import

Platform-owned orchestration for Super Admin bulk data import.

The package validates Platform/Tenant Core prerequisites, delegates module
validation and writes through internal HTTP APIs, and records the final audit
result. It must not read or write a module-owned schema directly.

Execution order is Tenant Core, Inventory, Procedure Engine, then Maintenance.

Run `pnpm nx test platform-data-import` for unit tests.
