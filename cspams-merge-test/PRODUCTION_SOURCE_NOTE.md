# Production Source Note

This folder is a merge-test snapshot, not the production CSPAMS frontend source.

Production builds must use the root `frontend/` directory. Vercel's Root Directory must be set to `frontend`.

If `window.__CSPAMS_BUILD_INFO__` reports `source: "cspams-merge-test/frontend"`, the deployment is using this snapshot by mistake.
