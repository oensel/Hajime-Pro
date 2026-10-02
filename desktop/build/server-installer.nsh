; Zusätze zum NSIS-Installer des Server-Pakets (electron-builder: nsis.include).
; Firewall: eingehende Verbindungen für das private Netzwerk erlauben, damit Clients (Matte, Waage) und Browser im
; Hallennetz den Server erreichen. Öffentliche Netzwerke bleiben gesperrt.
!macro customInstall
  ExecWait 'netsh advfirewall firewall delete rule name="Hajime Pro Server"'
  ExecWait 'netsh advfirewall firewall add rule name="Hajime Pro Server" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=private'
!macroend

!macro customUnInstall
  ExecWait 'netsh advfirewall firewall delete rule name="Hajime Pro Server"'
!macroend
