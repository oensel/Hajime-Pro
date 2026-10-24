; Zusätze zum NSIS-Installer des Server-Pakets (electron-builder: nsis.include).
; Firewall: eingehende Verbindungen für das private Netzwerk erlauben, damit Clients (Matte, Waage) und Browser im
; Hallennetz den Server erreichen. Öffentliche Netzwerke bleiben gesperrt.
!macro customInstall
  ; Dateiname des Installers ablegen: Downloads aus der Cloud tragen einen Einlösecode im Namen (Hajime-Pro-Server-<Version>-win-x64.<Code>.exe),
  ; den der Server beim ersten Start gegen seinen Geräteschlüssel für Updates tauscht (desktop/server/main.js, src/utils/releaseQuelle.js).
  CreateDirectory "$APPDATA\HajimeProInstall"
  Push $R9
  FileOpen $R9 "$APPDATA\HajimeProInstall\installer-name.txt" w
  FileWrite $R9 "$EXEFILE"
  FileClose $R9
  Pop $R9
  ExecWait 'netsh advfirewall firewall delete rule name="Hajime Pro Server"'
  ExecWait 'netsh advfirewall firewall add rule name="Hajime Pro Server" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=private'
!macroend

!macro customUnInstall
  ExecWait 'netsh advfirewall firewall delete rule name="Hajime Pro Server"'
!macroend
