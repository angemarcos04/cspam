# CSPAMS Runtime Verification Checklist

Use this checklist when the browser still shows older monitor dashboard behavior, such as a row-level file Download button or a required Return note.

1. Confirm the working repo is the real checkout:
   ```powershell
   cd C:\Users\Angie\Desktop\cspam-git
   git status --short --branch
   git log -1 --oneline
   ```
   The latest commit should be the expected `main` commit or newer. If this command fails, you are not in the real Git checkout.

2. Confirm the app is not being served from the stale folder:
   ```powershell
   Get-CimInstance Win32_Process -Filter "name = 'node.exe' or name = 'php.exe'" |
     Select-Object ProcessId,Name,ExecutablePath,CommandLine
   ```
   Stop any server whose `CommandLine` or working command points to `C:\Users\Angie\Desktop\cspam-main`.

3. Rebuild the frontend from the real checkout:
   ```powershell
   cd C:\Users\Angie\Desktop\cspam-git\frontend
   npm.cmd run build
   ```
   Confirm the generated bundle timestamp is newer than the latest commit you expect to test:
   ```powershell
   Get-ChildItem .\dist\assets | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name,LastWriteTime
   ```

4. Restart the backend/frontend process that serves the app from `C:\Users\Angie\Desktop\cspam-git`, then hard-refresh the browser.
   - In Chrome/Edge DevTools, right-click refresh and choose `Empty Cache and Hard Reload`.
   - If Vite dev server is used, stop and restart it from `C:\Users\Angie\Desktop\cspam-git\frontend`.
   - If Laravel serves the built frontend, make sure the public/built assets were replaced by the new `frontend\dist` output.

5. Verify the monitor School Detail file row shows `View`, `Verify`, and `Return` only. The file `Download` action should appear inside the preview modal, not in the row.

6. Verify the Return modal starts with `Include a note to the School Head` unchecked. The Return action should be available without typing a note; checking the option should reveal and require the note field.
