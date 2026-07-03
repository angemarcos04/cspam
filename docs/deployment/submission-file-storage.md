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

After deploying the backend, run:

```bash
php artisan migrate --force
php artisan optimize:clear
php artisan cspams:audit-submission-storage
```

The readiness endpoint should report:

```text
checks.submissionStorage.databaseBlobTableExists: true
checks.submissionStorage.databaseBlobReadable: true
checks.submissionStorage.databaseBlobReady: true
```

## Storage Audit

Run the audit command after deploys and when diagnosing old uploads:

```bash
php artisan cspams:audit-submission-storage
php artisan cspams:audit-submission-storage --only-missing
php artisan cspams:audit-submission-storage --json
php artisan cspams:audit-submission-storage --fail-on-missing
```

The audit is read-only. It reports database blobs, legacy disk files, and missing storage without showing file contents, absolute server paths, or secrets.

Missing rows with `reupload_required` must be re-uploaded through the School Head workflow.

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

1. Deploy the backend.
2. Run migrations.
3. Run the storage audit.
4. Upload a test file.
5. Redeploy the backend.
6. Confirm the test file still previews and downloads.
