# CSPAMS Runtime Verification Checklist

Use this checklist when the browser still shows older monitor dashboard behavior, such as a row-level file Download button or a required Return note.

1. Run the runtime verifier from the real checkout:
   ```powershell
   cd C:\Users\Angie\Desktop\cspam-git
   .\scripts\verify-cspams-runtime.ps1
   ```
   The script prints the current Git commit, newest frontend build assets, `frontend\dist\cspams-build-info.json`, and running `node.exe` / `php.exe` command lines. Stop any process that references `C:\Users\Angie\Desktop\cspam-main`, and rebuild if the built commit does not match the current checkout.

2. Confirm the working repo is the real checkout:
   ```powershell
   cd C:\Users\Angie\Desktop\cspam-git
   git status --short --branch
   git log -1 --oneline
   ```
   The latest commit should be the expected `main` commit or newer. If this command fails, you are not in the real Git checkout.

3. Confirm the app is not being served from the stale folder:
   ```powershell
   Get-CimInstance Win32_Process -Filter "name = 'node.exe' or name = 'php.exe'" |
     Select-Object ProcessId,Name,ExecutablePath,CommandLine
   ```
   Stop any server whose `CommandLine` or working command points to `C:\Users\Angie\Desktop\cspam-main`.

4. Rebuild the frontend from the real checkout:
   ```powershell
   cd C:\Users\Angie\Desktop\cspam-git\frontend
   npm.cmd run build
   ```
   Confirm the generated bundle timestamp is newer than the latest commit you expect to test:
   ```powershell
   Get-ChildItem .\dist\assets | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name,LastWriteTime
   Get-Content .\dist\cspams-build-info.json
   ```

5. Restart the backend/frontend process that serves the app from `C:\Users\Angie\Desktop\cspam-git`, then hard-refresh the browser.
   - In Chrome/Edge DevTools, right-click refresh and choose `Empty Cache and Hard Reload`.
   - If Vite dev server is used, stop and restart it from `C:\Users\Angie\Desktop\cspam-git\frontend`.
   - If Laravel serves the built frontend, make sure the public/built assets were replaced by the new `frontend\dist` output.

6. Verify the monitor School Detail file row shows `View`, `Verify`, and `Return` only. The file `Download` action should appear inside the preview modal, not in the row.

7. Verify the Return modal starts with `Include a note to the School Head` unchecked. The Return action should be available without typing a note; checking the option should reveal and require the note field.

8. Optional browser smoke check:
   ```powershell
   cd C:\Users\Angie\Desktop\cspam-git\frontend
   npm.cmd run e2e
   ```
   This runs a mocked Playwright monitor review flow that confirms file rows do not have a row-level Download, the preview modal still has Download, Verify refreshes the visible queue/school state, and Return keeps notes optional.

9. Optional live browser/API smoke check:
   ```powershell
   cd C:\Users\Angie\Desktop\cspam-git\frontend
   npm.cmd run e2e:live
   ```
   This starts Laravel in `APP_ENV=testing` with an isolated SQLite database, starts Vite against that local backend, and verifies the real monitor review flow through the browser, API, database, and file endpoint.

10. Backend workflow test timing:
   ```powershell
   cd C:\Users\Angie\Desktop\cspam-git
   php artisan test --filter=IndicatorSubmissionWorkflowTest
   ```
   This test suite can take several minutes locally. Treat short command timeouts as an operational timeout, not a workflow failure.

## Realtime Operations

Immediate School Head, Monitor, and Audit Trail updates require both the database queue worker and Reverb. A connected browser alone is not enough: `CspamsUpdateBroadcast` uses the `broadcasts` queue.

1. Validate the runtime services from the real checkout:
   ```powershell
   cd C:\Users\Angie\Desktop\cspam-git
   .\scripts\verify-cspams-runtime.ps1 -RequireRealtimeServices -ReverbPort 8080
   ```
   The command checks for a PHP worker serving `broadcasts`, a `reverb:start` process, and a listener on the configured Reverb port. It does not print secrets or application payloads.

2. Run these processes under the host's process supervisor. Do not rely on an interactive terminal:
   ```powershell
   php artisan queue:work database --queue=broadcasts,default --sleep=1 --tries=3 --timeout=90
   php artisan reverb:start --host=0.0.0.0 --port=8080
   ```
   Use your deployment platform's restart policy, log retention, and alerting to restart either process after failure. Configure Reverb app keys and database credentials through the deployment environment, never this document.

3. Local proof of realtime audit delivery uses a separate test-only stack:
   ```powershell
   cd C:\Users\Angie\Desktop\cspam-git\frontend
   npm.cmd run e2e:realtime
   ```
   It creates an isolated SQLite database, starts Reverb and a `broadcasts` queue worker, performs a real Monitor scope review, and verifies that a second Monitor Audit Trail refreshes without pressing Refresh.
