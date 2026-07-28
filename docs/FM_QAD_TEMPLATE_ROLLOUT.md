# FM-QAD Template Library Rollout

FM-QAD form identities remain fixed in `config/fm_qad.php`. Template revisions are stored in the database, including their DOCX bytes, so Render's ephemeral filesystem and Vercel's public assets are not runtime dependencies.

## Deployment order

1. Deploy the Laravel migration and backend API.
2. Run `php artisan migrate --force`.
3. Run `php artisan db:seed --class=FmQadFormSeeder --force`.
4. Preview the import with `php artisan cspams:import-fm-qad-templates --dry-run`.
5. Import the ten retained rollback assets with `php artisan cspams:import-fm-qad-templates`.
6. Verify integrity with `php artisan cspams:audit-fm-qad-templates`. Do not deploy the dynamic frontend until this exits successfully.
7. Deploy the frontend.
8. Verify a private School Head can list and download each effective template, and that a public School Head cannot see the downloader.

The importer is idempotent: it skips a form when its file hash is already present. `--form=fm_qad_003` limits a run to one stable scope. `--force` reactivates a matching imported revision that was archived. Static files under `frontend/public/templates/fm-qad/` are intentionally retained for rollback, but the frontend no longer uses them at runtime.

## Resolution and history

For the selected Academic Year, CSPAMS resolves the exact active revision first, then an active baseline revision whose `academic_year_id` is null. Archived revisions are never selected. Activation locks the competing rows and replaces the prior active revision in one transaction. Existing uploaded, submitted, returned, verified, and finalized files are not modified; their nullable version foreign key preserves history.

## Operational checks

`php artisan cspams:audit-fm-qad-templates` is read-only. It reports missing catalog entries, forms without versions or active revisions, duplicate actives, missing blobs, hash mismatches, orphaned versions, invalid Academic Year references, and broken submission references.

Before activation, the Monitor UI warns that the existing active revision will be archived without changing submissions. Archiving preserves the blob and historical downloads. Upload, metadata update, activation, and archival are written to the Audit Trail and broadcast through the existing CSPAMS realtime channel after database commit.

## Configuration

`CSPAMS_FM_QAD_TEMPLATE_MAX_KB` controls the DOCX limit and defaults to 10 MB. Uploads must have a `.docx` extension, an accepted DOCX/ZIP MIME signature, and valid `[Content_Types].xml` and `word/document.xml` ZIP entries. Hashes, sizes, and filenames are calculated or sanitized by the backend.

## Deferred enhancements

Scheduled activation, in-browser DOCX editing/preview, bulk activation, usage analytics, mass email, arbitrary form creation, and forced migration of open drafts are intentionally outside this release.
