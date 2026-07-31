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

The initial dry run must report no missing catalog entries, missing files, or invalid files. On an empty version library it should report ten would-import decisions. The real import should then import those revisions (or skip hashes already present), and the post-import dry run should report zero would-import and ten would-skip decisions. Any missing-catalog, missing-file, invalid-file, or audit issue makes the command fail and must stop the rollout.

## Resolution and history

For the selected Academic Year, CSPAMS resolves the exact active revision first, then an active baseline revision whose `academic_year_id` is null. Archived revisions are never selected. Activation locks the competing rows and replaces the prior active revision in one transaction. Existing uploaded, submitted, returned, verified, and finalized files are not modified; their nullable version foreign key preserves history.

## Operational checks

`php artisan cspams:audit-fm-qad-templates` is read-only. It reports missing catalog entries, forms without versions or active revisions, relevant Academic Years without an exact or baseline effective revision, duplicate actives, missing blobs, hash mismatches, orphaned versions, invalid Academic Year references, broken submission references, and invalid download-grant relationships. Current years, years referenced by indicator submissions, and persisted years in the existing rolling indicator window are considered relevant.

Before activation, the Monitor UI warns that the existing active revision will be archived without changing submissions. Archiving preserves the blob and historical downloads. Upload, metadata update, activation, and archival are written to the Audit Trail and broadcast through the existing CSPAMS realtime channel after database commit.

## Failure handling and rollback

Do not run the importer automatically on every Render startup. Catalog seeding, import, and audit are controlled deployment operations. If migration or seeding fails, stop before importing and correct the database/configuration issue. If dry run reports a missing or invalid rollback DOCX, restore the retained static asset and rerun dry run. If audit reports an Academic Year without an effective revision, activate an exact revision for that year or an approved baseline revision, then rerun the audit.

The migration rollback command is `php artisan migrate:rollback --step=1 --force`, but use it only before download grants are relied on in production and only after taking a database backup. Do not delete imported versions, blobs, grants, or submission references as an operational rollback. The application may be rolled back to the prior release while leaving the additive FM-QAD tables and historical data in place.

After rollout, verify at least one private School Head and one public School Head. The private account must download the current-year effective template, receive a grant, and upload with that revision association. The public account must receive an empty list and HTTP 403 from a known direct version URL. Confirm the audit reports current Academic Year coverage before declaring the rollout ready.

## Configuration

`CSPAMS_FM_QAD_TEMPLATE_MAX_KB` controls the DOCX limit and defaults to 10 MB. Uploads must have a `.docx` extension, an accepted DOCX/ZIP MIME signature, and valid `[Content_Types].xml` and `word/document.xml` ZIP entries. Hashes, sizes, and filenames are calculated or sanitized by the backend.

## Deferred enhancements

Scheduled activation, in-browser DOCX editing/preview, bulk activation, usage analytics, mass email, arbitrary form creation, and forced migration of open drafts are intentionally outside this release.
