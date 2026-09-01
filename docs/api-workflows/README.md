# BALENISA API and workflow documentation

This index contains only module documentation and generated workflow artifacts that are present in this directory. Each module document is derived from the current implementation and its tests; use the source code as the final authority when the application changes.

## Modules

| Module | Verified documentation |
|---|---|
| Authentication | [auth/README.md](auth/README.md) |
| Bills | [bills/README.md](bills/README.md) |
| Budget | [budget/README.md](budget/README.md) |
| Charts | [charts/README.md](charts/README.md) |
| Expenses | [expense/README.md](expense/README.md) |
| Income | [income/README.md](income/README.md) |
| ML service | [ml-service/README.md](ml-service/README.md) |
| Reports | [report/README.md](report/README.md) |
| SIA | [sia/README.md](sia/README.md) |
| System | [system/README.md](system/README.md) |

## Shared workflow tooling

- [Diagram tokens](diagram-tokens.json)
- [Diagram renderer](workflow_diagram.py)
- [Workflow template](\_template_spec.py)

## Verification convention

For every documented route, keep the route, middleware, controller/service path, data stores, external calls, and response behavior aligned with the current source. Regenerate the module's SVG and PNG artifacts through its local generator after changing a documented flow.
