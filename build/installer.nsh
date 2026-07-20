; oneClick installers show no wizard pages at all, so the LangDLL-based
; language dialog and its registry/UAC-relaunch plumbing that used to live
; here are gone -- NSIS just falls back to its first compiled language
; (English), same default the app itself uses (settingsStore.ts's DEFAULTS).
; installerLanguages in electron-builder.yml still compiles the other 9 in,
; so LangString below CAN resolve to them if $LANGUAGE is ever set some other
; way -- but nothing currently changes it away from the default.
!macro customHeader
  LangString smartAppTitle ${LANG_ENGLISH} "Important: Windows Security Notice"
  LangString smartAppTitle ${LANG_UKRAINIAN} "Важливо: попередження безпеки Windows"
  LangString smartAppTitle ${LANG_GERMAN} "Wichtig: Windows-Sicherheitshinweis"
  LangString smartAppTitle ${LANG_FRENCH} "Important : avertissement de sécurité Windows"
  LangString smartAppTitle ${LANG_POLISH} "Ważne: ostrzeżenie zabezpieczeń Windows"
  LangString smartAppTitle ${LANG_RUSSIAN} "Важно: предупреждение безопасности Windows"
  LangString smartAppTitle ${LANG_SPANISHINTERNATIONAL} "Importante: aviso de seguridad de Windows"
  LangString smartAppTitle ${LANG_PORTUGUESEBR} "Importante: aviso de segurança do Windows"
  LangString smartAppTitle ${LANG_TURKISH} "Önemli: Windows güvenlik uyarısı"
  LangString smartAppTitle ${LANG_SIMPCHINESE} "重要：Windows 安全提示"

  LangString smartAppText ${LANG_ENGLISH} "CoopSync isn't digitally signed yet, and Windows 11's Smart App Control feature is currently ON on this PC -- it will block this installer or the app itself.$\r$\n$\r$\nTurn it off first: Settings -> Privacy & security -> Windows Security -> App & browser control -> Smart App Control -> Off.$\r$\n$\r$\nThis is safe and can be switched back on later. Then run this installer again.$\r$\n$\r$\nSetup will now close."
  LangString smartAppText ${LANG_UKRAINIAN} "CoopSync ще не має цифрового підпису, а функція Smart App Control у Windows 11 зараз УВІМКНЕНА на цьому ПК — вона заблокує цей інсталятор або саму програму.$\r$\n$\r$\nСпершу вимкни її: Параметри -> Конфіденційність і безпека -> Безпека Windows -> Керування додатками та браузером -> Smart App Control -> Вимкнено.$\r$\n$\r$\nЦе безпечно, і потім можна ввімкнути назад. Після цього запусти інсталятор ще раз.$\r$\n$\r$\nВстановлення зараз закриється."
  LangString smartAppText ${LANG_GERMAN} "CoopSync ist noch nicht digital signiert, und die Funktion Smart App Control von Windows 11 ist auf diesem PC aktuell EINGESCHALTET -- sie wird diesen Installer oder die App selbst blockieren.$\r$\n$\r$\nSchalte sie zuerst aus: Einstellungen -> Datenschutz und Sicherheit -> Windows-Sicherheit -> App- und Browsersteuerung -> Smart App Control -> Aus.$\r$\n$\r$\nDas ist unbedenklich und kann später wieder aktiviert werden. Starte danach diesen Installer erneut.$\r$\n$\r$\nDas Setup wird jetzt beendet."
  LangString smartAppText ${LANG_FRENCH} "CoopSync n'est pas encore signé numériquement, et la fonctionnalité Smart App Control de Windows 11 est actuellement ACTIVÉE sur ce PC -- elle va bloquer cet installateur ou l'application elle-même.$\r$\n$\r$\nDésactive-la d'abord : Paramètres -> Confidentialité et sécurité -> Sécurité Windows -> Contrôle des applications et du navigateur -> Smart App Control -> Désactivé.$\r$\n$\r$\nC'est sans risque et tu pourras la réactiver plus tard. Relance ensuite cet installateur.$\r$\n$\r$\nL'installation va maintenant se fermer."
  LangString smartAppText ${LANG_POLISH} "CoopSync nie jest jeszcze podpisany cyfrowo, a funkcja Smart App Control w Windows 11 jest obecnie WŁĄCZONA na tym komputerze -- zablokuje ten instalator lub samą aplikację.$\r$\n$\r$\nNajpierw ją wyłącz: Ustawienia -> Prywatność i zabezpieczenia -> Zabezpieczenia Windows -> Kontrola aplikacji i przeglądarki -> Smart App Control -> Wyłączone.$\r$\n$\r$\nJest to bezpieczne i można ją później włączyć ponownie. Następnie uruchom ten instalator jeszcze raz.$\r$\n$\r$\nInstalator teraz się zamknie."
  LangString smartAppText ${LANG_RUSSIAN} "CoopSync пока не имеет цифровой подписи, а функция Smart App Control в Windows 11 сейчас ВКЛЮЧЕНА на этом ПК — она заблокирует этот установщик или саму программу.$\r$\n$\r$\nСначала отключи её: Параметры -> Конфиденциальность и защита -> Безопасность Windows -> Управление приложениями и браузером -> Smart App Control -> Выключено.$\r$\n$\r$\nЭто безопасно, потом можно включить обратно. После этого запусти установщик ещё раз.$\r$\n$\r$\nУстановка сейчас закроется."
  LangString smartAppText ${LANG_SPANISHINTERNATIONAL} "CoopSync todavía no está firmado digitalmente, y la función Smart App Control de Windows 11 está actualmente ACTIVADA en este PC -- bloqueará este instalador o la propia aplicación.$\r$\n$\r$\nDesactívala primero: Configuración -> Privacidad y seguridad -> Seguridad de Windows -> Control de aplicaciones y navegador -> Smart App Control -> Desactivado.$\r$\n$\r$\nEsto es seguro y podrás volver a activarla después. Luego vuelve a ejecutar este instalador.$\r$\n$\r$\nLa instalación se cerrará ahora."
  LangString smartAppText ${LANG_PORTUGUESEBR} "O CoopSync ainda não possui assinatura digital, e o recurso Smart App Control do Windows 11 está atualmente ATIVADO neste PC -- ele vai bloquear este instalador ou o próprio aplicativo.$\r$\n$\r$\nDesative-o primeiro: Configurações -> Privacidade e segurança -> Segurança do Windows -> Controle de aplicativos e navegador -> Smart App Control -> Desativado.$\r$\n$\r$\nIsso é seguro e pode ser reativado depois. Depois execute este instalador novamente.$\r$\n$\r$\nA instalação será fechada agora."
  LangString smartAppText ${LANG_TURKISH} "CoopSync henüz dijital olarak imzalanmadı ve Windows 11'in Smart App Control özelliği bu bilgisayarda şu anda AÇIK -- bu yükleyiciyi veya uygulamanın kendisini engelleyecek.$\r$\n$\r$\nÖnce kapat: Ayarlar -> Gizlilik ve güvenlik -> Windows Güvenliği -> Uygulama ve tarayıcı denetimi -> Smart App Control -> Kapalı.$\r$\n$\r$\nBu güvenlidir, sonra tekrar açabilirsin. Ardından bu yükleyiciyi tekrar çalıştır.$\r$\n$\r$\nKurulum şimdi kapanacak."
  LangString smartAppText ${LANG_SIMPCHINESE} "CoopSync 尚未进行数字签名，并且此电脑上的 Windows 11 Smart App Control 功能当前处于开启状态——它将阻止此安装程序或应用程序本身运行。$\r$\n$\r$\n请先将其关闭：设置 -> 隐私和安全性 -> Windows 安全中心 -> 应用和浏览器控制 -> Smart App Control -> 关闭。$\r$\n$\r$\n这样做是安全的，之后可以重新开启。然后再次运行此安装程序。$\r$\n$\r$\n安装程序即将关闭。"
!macroend

; Runs before the actual file install. Skipped entirely for a silent run
; (electron-updater's quitAndInstall passes /S for an in-app update) -- an
; update relaunching the already-running app is never the moment to first
; discover Smart App Control is on; that only matters for a fresh manual
; install, where it's safe to stop and tell the user before anything's copied.
;
; The registry key isn't officially documented by Microsoft, but is the one
; widely used (by various diagnostic tools) to read Smart App Control's
; state: 0 = Off, 1 = On, 2 = Evaluation (on, but Windows may auto-disable it
; if it looks likely to cause problems) -- treated as "on" here too, since it
; can still block things while active. Reading HKLM doesn't need admin rights.
!macro customInit
  IfSilent skip_sac_check
    ReadRegDWORD $0 HKLM "SYSTEM\CurrentControlSet\Control\CI\Policy" "VerifiedAndReputablePolicyState"
    ${If} $0 == 1
    ${OrIf} $0 == 2
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(smartAppText)"
      Quit
    ${EndIf}
  skip_sac_check:
!macroend

; Marks that the installer just ran (fresh install, or a reinstall over
; existing settings) -- main/index.ts reads this once to enable autostart +
; start-minimized-to-tray by default, the same way it always has. No longer
; carries a language payload (there's no language dialog to read it from
; anymore) -- see settingsStore.ts's consumeJustInstalledMarker.
!macro customInstall
  FileOpen $1 "$INSTDIR\just-installed.txt" w
  FileWrite $1 "1"
  FileClose $1
!macroend
