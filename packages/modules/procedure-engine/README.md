# module-procedure-engine

Backend bounded context cho Procedure Engine. Hướng phụ thuộc nội bộ:

```text
presentation -> application -> domain
                      ^
                      |
               infrastructure
```

Lát cắt đầu tiên hỗ trợ tạo definition, công bố phiên bản, khởi tạo instance,
thực thi tuần tự theo RCSI và idempotency. `InMemoryProcedureStore` chỉ là adapter
development/test; migration PostgreSQL tenant nằm trong
`src/lib/infrastructure/persistence/migrations`.
