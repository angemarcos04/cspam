# FM-QAD Template Library Rollout

FM-QAD form identities remain fixed in `config/fm_qad.php`. Template revisions are stored in the database, including their DOCX bytes, so Render's ephemeral filesystem and Vercel's public assets are not runtime dependencies.

## Deployment order

1. Deploy the Laravel migration and backend API.
2. Run `php artisan migrate --force`.
3. Run `php artisan db:seed --class=FmQadFormSeeder --force`.
4. Preview the import with `php artisan cspams:import-fm-qad-templates --dry-run`.
5. Import the ten retained rollback assets with `php artisan cspams:import-fm-qad-templates`.
6. Repeat `php artisan cspams:import-fm-qad-templates --dry-run` to confirm the import is idempotent.
7. Verify integrity with `php artisan cspams:audit-fm-qad-templates`. Do not deploy the dynamic frontend until this exits successfully.
8. Deploy the frontend.
9. Verify a private School Head can list and download each effective template, and that a public School Head cannot see the downloader or use a direct download URL.

The importer is idempotent: it skips a form when its file hash is already present. `--form=fm_qad_003` limits a run to one stable scope. `--force` reactivates a matching imported revision that was archived. Static files under `frontend/public/templates/fm-qad/` are intentionally retained for rollback, but the frontend no longer uses them at runtime.

The active Render web startup script runs pending migrations and the idempotent `FmQadFormSeeder` on every backend deployment. This initializes or refreshes only the ten permanent form identities. With `set -euo pipefail`, a migration or catalog-seeding failure stops startup and preserves the non-zero status; the web server is not launched with a partially initialized catalog. The startup script does not run the template importer or FM-QAD audit.

The initial dry run must report no missing catalog entries, missing files, or invalid files. On an empty version library it should report ten would-import decisions. The real import should then import those revisions (or skip hashes already present), and the post-import dry run should report zero would-import and ten would-skip decisions. Any missing-catalog, missing-file, invalid-file, or audit issue makes the command fail and must stop the rollout.

Catalog initialization and template-version initialization are separate. Ten `fm_qad_forms` rows prove only that the permanent identities exist. On an empty version library, a successful import creates ten persistent version rows and ten database blobs, activates each as an Academic-Year-neutral baseline, and uses `Initial Version` unless a configured retained filename has an approved label such as `Rev. 02`. Do not force these counts when valid history already exists.

The retained files resolve from `base_path('frontend/public/templates/fm-qad')`, so importer behavior does not depend on the shell working directory. The root Docker build uses `COPY . .`; because the repository has no `.dockerignore` and the ten DOCX files are tracked, they are included in the Render image. Confirm their presence in the deployed image if a dry run reports missing files.

## Resolution and history

For the selected Academic Year, CSPAMS resolves the exact active revision first, then an active baseline revision whose `academic_year_id` is null. Archived revisions are never selected. Activation locks the competing rows and replaces the prior active revision in one transaction. Existing uploaded, submitted, returned, verified, and finalized files are not modified; their nullable version foreign key preserves history.

## Operational checks

`php artisan cspams:audit-fm-qad-templates` is read-only. It reports missing catalog entries, forms without versions or active revisions, relevant Academic Years without an exact or baseline effective revision, duplicate actives, missing blobs, hash mismatches, orphaned versions, invalid Academic Year references, broken submission references, and invalid download-grant relationships. Current years, years referenced by indicator submissions, and persisted years in the existing rolling indicator window are considered relevant.

Before activation, the Monitor UI warns that the existing active revision will be archived without changing submissions. Archiving preserves the blob and historical downloads. Upload, metadata update, activation, and archival are written to the Audit Trail and broadcast through the existing CSPAMS realtime channel after database commit.

## Failure handling and rollback

Do not run the importer automatically on every Render startup. Permanent catalog seeding is an automatic, idempotent deployment step; template import and audit remain controlled deployment operations. If migration or seeding fails, stop before importing and correct the database/configuration issue. If dry run reports a missing or invalid rollback DOCX, restore the retained static asset and rerun dry run. If audit reports an Academic Year without an effective revision, activate an exact revision for that year or an approved baseline revision, then rerun the audit.

The migration rollback command is `php artisan migrate:rollback --step=1 --force`, but use it only before download grants are relied on in production and only after taking a database backup. Do not delete imported versions, blobs, grants, or submission references as an operational rollback. The application may be rolled back to the prior release while leaving the additive FM-QAD tables and historical data in place.

After rollout, verify at least one private School Head and one public School Head. The private account must download the current-year effective template, receive a grant, and upload with that revision association. The public account must receive an empty list and HTTP 403 from a known direct version URL. Confirm the audit reports current Academic Year coverage before declaring the rollout ready.

Verify backend/frontend deployment parity and catalog initialization from the Render shell:

```bash
php artisan route:list --path=monitor/fm-qad
php artisan migrate:status
php artisan tinker --execute="dump(App\Models\FmQadForm::count());"
```

The route list must include `GET api/monitor/fm-qad/forms`, all FM-QAD migrations must be applied, and the form count must be exactly `10`. Confirm the Render deploy identifies the same Git revision selected for the Vercel production deployment. A healthy public `/api/health` response proves availability but does not prove catalog seeding or frontend/backend revision parity.

Before importing, classify the deployed template library with a read-only count:

```bash
php artisan tinker --execute="dump([
    'forms' => App\Models\FmQadForm::count(),
    'versions' => App\Models\FmQadTemplateVersion::count(),
    'blobs' => App\Models\FmQadTemplateVersionBlob::count(),
    'active' => App\Models\FmQadTemplateVersion::query()->active()->count(),
    'draft' => App\Models\FmQadTemplateVersion::query()->draft()->count(),
    'archived' => App\Models\FmQadTemplateVersion::query()->archived()->count(),
]);"
```

If forms are `10` and versions are `0`, the catalog seeder ran but the controlled importer did not. If versions exist without active rows or blobs, stop and investigate rather than rerunning with `--force`. After a clean initial import, expect forms `10`, versions `10`, blobs `10`, and active baseline versions `10`; then run the post-import dry run and integrity audit before enabling School Head use.

## Configuration

`CSPAMS_FM_QAD_TEMPLATE_MAX_KB` controls the DOCX limit and defaults to 10 MB. Uploads must have a `.docx` extension, an accepted DOCX/ZIP MIME signature, and valid `[Content_Types].xml` and `word/document.xml` ZIP entries. Hashes, sizes, and filenames are calculated or sanitized by the backend.

## Deferred enhancements

Scheduled activation, in-browser DOCX editing/preview, bulk activation, usage analytics, mass email, arbitrary form creation, and forced migration of open drafts are intentionally outside this release.
