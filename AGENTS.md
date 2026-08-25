<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# UI/UX Design & Component Guidelines (Mặc định cho toàn bộ dự án)

- **Thư viện Component chuẩn**:
  - Sử dụng hầu hết các component của **shadcn/ui** (https://ui.shadcn.com/docs/components) kết hợp style bằng **Tailwind CSS**.
  - Khi cần component mà dự án chưa có: Sử dụng lệnh cài đặt `pnpm dlx shadcn@latest add <component-name>` (ví dụ: `pnpm dlx shadcn@latest add button`, `dialog`, `select`, `table`, `sheet`, `tabs`, v.v.).
  - Đối với các component nghiệp vụ phức tạp như Bảng dữ liệu nâng cao (Table/Data Grid với đa cột sort/filter, tree data, virtual scroll), Tree phức tạp, Dynamic Form, Cascader...: Sử dụng thư viện **Ant Design (antd)** (https://ant.design/components/overview/).
- **Quy chuẩn bố cục**:
  - Thiết kế và căn chỉnh cân đối theo **tỉ lệ 16:9** (Widescreen 1920×1080, 1600×900, 1440×900).
  - Áp dụng cấu trúc Master-Detail Split Grid 2 cột với thanh cuộn nội bộ độc lập.
- **Skill tham chiếu**: Khi thiết kế hoặc điều chỉnh giao diện, tham khảo chi tiết tại skill `ui-design` (`.agents/skills/ui-design/SKILL.md`).

