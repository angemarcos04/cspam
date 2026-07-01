# Submission File Storage

CSPAMS stores uploaded report-file metadata in the database, but the physical
PDF/DOCX/XLSX files must live on persistent storage. In production, especially
on Render-style deployments, writing to an ephemeral local filesystem can leave
the database row intact while the file disappears after a restart or redeploy.

## Environment

Use the dedicated submission-file disk:

```env
CSPAMS_SUBMISSION_FILE_DISK=submissions
CSPAMS_SUBMISSION_STORAGE_PATH=/var/data/cspams-submissions
```

`CSPAMS_SUBMISSION_FILE_DISK` must match the Laravel filesystem disk CSPAMS uses
for submission files. `CSPAMS_SUBMISSION_STORAGE_PATH` must point to the mounted
persistent disk in production. For Render, attach a persistent disk to the
backend service and make sure the mount path is exactly
`/var/data/cspams-submissions` if you use the value above. Do not hardcode the
mount path in application code.

After changing storage environment values, clear cached Laravel configuration:

```bash
php artisan optimize:clear
php artisan config:clear
php artisan cache:clear
```

With `CSPAMS_DIAGNOSTICS_TOKEN` configured, verify the protected readiness probe
before users upload files:

```bash
curl -i "https://cspams.onrender.com/api/ops/readiness?token=$CSPAMS_DIAGNOSTICS_TOKEN"
```

The response should include `checks.submissionStorage.status: ok`,
`diskName: submissions`, and `canWriteReadDelete: true`. The readiness endpoint
does not expose the absolute storage path, uploaded filenames, or file contents.

## Smoke Test

1. Deploy with the persistent disk mounted.
2. Set `CSPAMS_SUBMISSION_FILE_DISK=submissions`.
3. Set `CSPAMS_SUBMISSION_STORAGE_PATH=/var/data/cspams-submissions`.
4. Confirm the path matches the actual Render persistent disk mount.
5. Redeploy the backend.
6. Clear cached config with `php artisan optimize:clear`, `php artisan config:clear`, and `php artisan cache:clear`.
7. Check protected readiness and confirm submission storage is writable.
8. Log in as School Head.
9. Upload a report file.
10. Preview/download the file.
11. Restart or redeploy the backend.
12. Preview/download the same file again.
13. Confirm it still works.
14. If DB metadata remains but preview/download fails, the storage path is still wrong or the old file was already lost.

## Missing Existing Files

If CSPAMS shows a submitted file record but preview/download is disabled with a
storage-missing warning, the database metadata exists but the physical file is
not present on the configured disk. CSPAMS intentionally reports that honestly:
the file is not reviewable, monitor verification is blocked, and preview or
download returns `404`.

Files already lost from ephemeral storage cannot be reconstructed from database
metadata alone. Re-upload the file through the School Head workflow or restore
the physical file from an external backup after persistent storage is fixed.
