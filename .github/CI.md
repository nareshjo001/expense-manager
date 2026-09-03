# Continuous integration

The workflow at `.github/workflows/ci.yml` runs on every push, pull request, and manual dispatch.

| Job | Purpose |
|---|---|
| Frontend validation | Clean install, React tests, production build, and build artifact retention. |
| Backend unit validation | Clean install and the default Jest suite. |
| Backend integration validation | Isolated MongoDB and Redis services with the protected integration suite. |
| ML validation | Clean Python dependency install, dependency consistency check, isolated MongoDB, and the full pytest suite. |
| Dependency audit | Fails on critical production dependency advisories in either Node application. |

The MongoDB and Redis services are disposable CI-only containers. Their credentials and test secrets are non-production values defined in the workflow; production values must remain in the hosting platforms' secret stores.

Enable the `Continuous Integration` workflow as a required pull-request status check after its first successful run. Do not add deployment steps to this workflow until OPS-004 defines verified rollout and rollback controls.
