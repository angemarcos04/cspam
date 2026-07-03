# Submission File Storage

CSPAMS stores School Head requirement upload bytes in PostgreSQL so files survive Render Free restarts and redeploys. New uploads use metadata paths like:

```text
database://indicator-submissions/{submission_id}/{file_type}
```

The existing metadata columns remain in place for frontend compatibility:

- `indicator_submissions` stores BMEF and SMEA metadata.
- `indicator_submission_files` stores FM-QAD and other non-core file metadata.
- `indicator_submission_file_blobs` stores the actual PDF/DOCX/XLSX bytes.

Legacy disk paths are still readable when the old disk file still exists. Files already lost from Render ephemeral storage cannot be reconstructed from metadata and must be re-uploaded by the School Head.

## Production Settings

Render Free does not persist local uploaded files. Do not use GitHub, frontend localStorage, public storage, or the Render local filesystem for uploads.

Recommended production upload limit:

```env
CSPAMS_SUBMISSION_FILE_MAX_KB=2048
```

Use `5120` only if the team accepts the extra PostgreSQL storage cost. Database-backed storage is intended for small capstone requirement files.

## Deployment Steps

Render Shell is not required for normal deploy migrations or storage checks. The active Docker startup path is `scripts/render-start.sh` because the root `Dockerfile` ends with:

```text
CMD ["bash", "scripts/render-start.sh"]
```

On every backend deploy/start, `scripts/render-start.sh` runs startup maintenance before launching the app:

```bash
CACHE_STORE=file php artisan config:clear
CACHE_STORE=file php artisan route:clear
CACHE_STORE=file php artisan view:clear
CACHE_STORE=file php artisan event:clear
CACHE_STORE=file php artisan cache:clear
CACHE_STORE=file php artisan optimize:clear
php artisan migrate --force
php artisan db:seed --class=Database\\Seeders\\RolesAndPermissionsSeeder --force
php artisan cspams:diagnose-submission-storage
php artisan cspams:audit-submission-storage --only-missing --limit="${CSPAMS_STORAGE_AUDIT_LIMIT:-50}"
```

Migration failure remains fatal. Submission-storage diagnostics and the missing-file audit are printed to Render logs but do not stop startup. Old missing uploaded files require School Head re-upload; they should not prevent the backend from booting.

After pushing storage fixes, use Render:

```text
Manual Deploy -> Clear build cache & deploy
```

The Render logs should show the blob table and schema are ready:

```text
databaseBlobTableExists: yes
databaseBlobReadable: yes
databaseBlobColumnsReady: yes
databaseBlobSchemaReady: yes
databaseBlobReady: yes
```

The protected readiness endpoint should report matching `true` values under `checks.submissionStorage`. Diagnostics verify blob table existence, readability, required columns, and the PostgreSQL `content` column type. The expected production type is `bytea`.

## Storage Audit

Run the audit command after deploys and when diagnosing old uploads:

```bash
php artisan cspams:audit-submission-storage
php artisan cspams:audit-submission-storage --only-missing
php artisan cspams:audit-submission-storage --json
php artisan cspams:audit-submission-storage --fail-on-missing
```

The audit is read-only. It reports database blobs, legacy disk files, and missing storage without showing file contents, absolute server paths, or secrets. Startup intentionally runs the audit without `--fail-on-missing`, so old missing files do not stop the app.

Missing rows with `reupload_required` must be re-uploaded through the School Head workflow.

## Upload Failure Logs

If a new upload still returns `The uploaded file could not be persisted. Please try again or contact the administrator.`, search Render logs for:

```text
submission_file_upload_persist_failed
SQLSTATE
indicator_submission_file_blobs
invalid byte sequence
content
bytea
```

The structured upload-failure log is safe to search. It includes submission ID, school ID, file type, exception class, and a bounded exception message. It does not include uploaded file contents, temporary upload paths, absolute storage paths, or secrets.

## Manual QA Checklist

School Head:

1. Login as School Head.
2. Create or bootstrap an indicator submission.
3. Upload BMEF.
4. Upload SMEA.
5. For a private school, upload FM-QAD-001.
6. Refresh the page.
7. Logout and login again.
8. Confirm files remain uploaded and available.
9. Send a scope or submit the package.

Monitor:

1. Login as Monitor.
2. Confirm unsent draft files are not reviewable.
3. After School Head sends or submits, confirm files are visible.
4. Preview the file.
5. Download the file.
6. Verify or return the scope.
7. Confirm a returned replaced file must be resent.

Deployment:

1. Push the fix to `main`.
2. In Render, run `Manual Deploy -> Clear build cache & deploy`.
3. Check logs for `databaseBlobSchemaReady: yes` and `databaseBlobReady: yes`.
4. Upload a small PDF under 500 KB.
5. Refresh, then logout and login again.
6. Send the scope or full package.
7. Confirm Monitor preview and download work.
8. Redeploy the backend.
9. Confirm the same file still previews and downloads.
