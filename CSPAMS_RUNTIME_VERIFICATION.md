# CSPAMS Runtime Verification Checklist

Use this checklist when the browser still shows older monitor dashboard behavior, such as a row-level file Download button or a required Return note.

1. Confirm the working repo is the real checkout:
   ```powershell
   cd C:\Users\Angie\Desktop\cspam-git
   git status --short --branch
   git log -1 --oneline
   ```

2. Confirm the app is not being served from the stale folder:
   ```powershell
   Get-Process node,php -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path
   ```
   Stop any server started from `C:\Users\Angie\Desktop\cspam-main`.

3. Rebuild the frontend from the real checkout:
   ```powershell
   cd C:\Users\Angie\Desktop\cspam-git\frontend
   npm.cmd run build
   ```

4. Restart the backend/frontend process that serves the app, then hard-refresh the browser.

5. Verify the monitor School Detail file row shows `View`, `Verify`, and `Return` only. The file `Download` action should appear inside the preview modal, not in the row.
