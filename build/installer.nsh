; Included automatically by electron-builder (build/installer.nsh).

!macro customUnInstall
  ; "Start when Windows starts" (app.setLoginItemSettings) writes these; remove them on uninstall
  ; so Windows isn't left with a startup entry pointing at a deleted app.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "local.reminders.app"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "local.reminders.app"
!macroend
