# Submission File Storage

CSPAMS stores uploaded report-file metadata in the database, but the physical
PDF/DOCX/XLSX files must live on persistent storage. In production, especially
on Render-style deployments, writing to an ephemeral local filesystem can leave
the database row intact while the file disappears after a restart or redeploy.

## Environment

Use the dedicated submission-file disk:

```env
CSPAMS_SUBMISSION_FILE_DISK=submissions
CSPAMS_SUBMISSION_STORAGE_PATH=/persistent/path/for/submissions
```

`CSPAMS_SUBMISSION_FILE_DISK` must match the Laravel filesystem disk CSPAMS uses
for submission files. `CSPAMS_SUBMISSION_STORAGE_PATH` must point to a mounted
persistent disk in production. For Render, configure a persistent disk mount and
set the path to that mount. Do not hardcode the mount path in application code.

After changing storage environment values, clear cached Laravel configuration:

```bash
php artisan config:clear
php artisan cache:clear
php artisan route:clear
```

## Smoke Test

1. Deploy with the persistent disk mounted.
2. Set `CSPAMS_SUBMISSION_FILE_DISK=submissions`.
3. Set `CSPAMS_SUBMISSION_STORAGE_PATH` to the persistent disk mount path.
4. Clear Laravel config cache or redeploy.
5. Log in as School Head.
6. Upload a report file.
7. Preview/download the file.
8. Restart or redeploy the backend.
9. Preview/download the same file again.
10. Confirm it still works.
11. If DB metadata remains but preview/download fails, the storage path is still wrong or the old file was already lost.

Files already lost from ephemeral storage cannot be recovered from database
metadata alone. Re-upload the file or restore it from an external backup.
