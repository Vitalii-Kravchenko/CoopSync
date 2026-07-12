; Enables NSIS's built-in "remember installer language in the registry" mechanism.
; Without this, MUI_LANGDLL_DISPLAY always shows the dialog — even in the "inner"
; process after a UAC relaunch (for "install for all users"), so the user would
; see the language prompt TWICE. With this define and SAVELANGUAGE (in customInit
; below), the second MUI_LANGDLL_DISPLAY run sees the saved value and just skips
; the dialog.
!macro customHeader
  !define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
  !define MUI_LANGDLL_REGISTRY_KEY "Software\CoopSyncInstaller"
  !define MUI_LANGDLL_REGISTRY_VALUENAME "InstallerLanguage"

  ; Smart App Control warning text (Windows 11 22H2+) for the Welcome page below
  ; (customWelcomePage). LangString can only be declared AFTER the corresponding
  ; ${LANG_X} is already defined — which happens via !insertmacro addLangs, run
  ; BEFORE customHeader (installer.nsi: addLangs first, then customHeader).
  ; MUI_WELCOMEPAGE_TEXT/TITLE in customWelcomePage use $(...) — a reference into
  ; the LangString table that resolves at runtime, so it doesn't matter that
  ; customWelcomePage itself is inserted BEFORE these declarations (before
  ; assistedInstaller.nsh, before addLangs).
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

  LangString smartAppText ${LANG_ENGLISH} "CoopSync isn't digitally signed yet. Windows 11's Smart App Control feature may block this installer or the app itself.$\r$\n$\r$\nBefore continuing, check: Settings -> Privacy & security -> Windows Security -> App & browser control -> Smart App Control, and turn it Off if it's On or in Evaluation mode.$\r$\n$\r$\nThis is safe and can be switched back on later.$\r$\n$\r$\nClick Next to continue."
  LangString smartAppText ${LANG_UKRAINIAN} "CoopSync ще не має цифрового підпису. Функція Smart App Control у Windows 11 може заблокувати цей інсталятор або саму програму.$\r$\n$\r$\nПерш ніж продовжити, перевір: Параметри -> Конфіденційність і безпека -> Безпека Windows -> Керування додатками та браузером -> Smart App Control, і вимкни її, якщо вона увімкнена або в режимі оцінювання.$\r$\n$\r$\nЦе безпечно, і потім можна ввімкнути назад.$\r$\n$\r$\nНатисни «Далі», щоб продовжити."
  LangString smartAppText ${LANG_GERMAN} "CoopSync ist noch nicht digital signiert. Die Funktion Smart App Control von Windows 11 kann diesen Installer oder die App selbst blockieren.$\r$\n$\r$\nBitte prüfe vor dem Fortfahren: Einstellungen -> Datenschutz und Sicherheit -> Windows-Sicherheit -> App- und Browsersteuerung -> Smart App Control, und schalte sie aus, falls sie aktiviert oder im Auswertungsmodus ist.$\r$\n$\r$\nDas ist unbedenklich und kann später wieder aktiviert werden.$\r$\n$\r$\nKlicke auf Weiter, um fortzufahren."
  LangString smartAppText ${LANG_FRENCH} "CoopSync n'est pas encore signé numériquement. La fonctionnalité Smart App Control de Windows 11 peut bloquer cet installateur ou l'application elle-même.$\r$\n$\r$\nAvant de continuer, vérifie : Paramètres -> Confidentialité et sécurité -> Sécurité Windows -> Contrôle des applications et du navigateur -> Smart App Control, et désactive-la si elle est active ou en mode évaluation.$\r$\n$\r$\nC'est sans risque et tu pourras la réactiver plus tard.$\r$\n$\r$\nClique sur Suivant pour continuer."
  LangString smartAppText ${LANG_POLISH} "CoopSync nie jest jeszcze podpisany cyfrowo. Funkcja Smart App Control w Windows 11 może zablokować ten instalator lub samą aplikację.$\r$\n$\r$\nZanim przejdziesz dalej, sprawdź: Ustawienia -> Prywatność i zabezpieczenia -> Zabezpieczenia Windows -> Kontrola aplikacji i przeglądarki -> Smart App Control, i wyłącz ją, jeśli jest włączona lub w trybie oceny.$\r$\n$\r$\nJest to bezpieczne i można ją później włączyć ponownie.$\r$\n$\r$\nKliknij Dalej, aby kontynuować."
  LangString smartAppText ${LANG_RUSSIAN} "CoopSync пока не имеет цифровой подписи. Функция Smart App Control в Windows 11 может заблокировать этот установщик или саму программу.$\r$\n$\r$\nПрежде чем продолжить, проверь: Параметры -> Конфиденциальность и защита -> Безопасность Windows -> Управление приложениями и браузером -> Smart App Control, и отключи её, если она включена или в режиме оценки.$\r$\n$\r$\nЭто безопасно, потом можно включить обратно.$\r$\n$\r$\nНажми «Далее», чтобы продолжить."
  LangString smartAppText ${LANG_SPANISHINTERNATIONAL} "CoopSync todavía no está firmado digitalmente. La función Smart App Control de Windows 11 puede bloquear este instalador o la propia aplicación.$\r$\n$\r$\nAntes de continuar, comprueba: Configuración -> Privacidad y seguridad -> Seguridad de Windows -> Control de aplicaciones y navegador -> Smart App Control, y desactívala si está activada o en modo de evaluación.$\r$\n$\r$\nEsto es seguro y podrás volver a activarla después.$\r$\n$\r$\nHaz clic en Siguiente para continuar."
  LangString smartAppText ${LANG_PORTUGUESEBR} "O CoopSync ainda não possui assinatura digital. O recurso Smart App Control do Windows 11 pode bloquear este instalador ou o próprio aplicativo.$\r$\n$\r$\nAntes de continuar, verifique: Configurações -> Privacidade e segurança -> Segurança do Windows -> Controle de aplicativos e navegador -> Smart App Control, e desative-o se estiver ativado ou em modo de avaliação.$\r$\n$\r$\nIsso é seguro e pode ser reativado depois.$\r$\n$\r$\nClique em Avançar para continuar."
  LangString smartAppText ${LANG_TURKISH} "CoopSync henüz dijital olarak imzalanmadı. Windows 11'in Smart App Control özelliği bu yükleyiciyi veya uygulamanın kendisini engelleyebilir.$\r$\n$\r$\nDevam etmeden önce şunu kontrol et: Ayarlar -> Gizlilik ve güvenlik -> Windows Güvenliği -> Uygulama ve tarayıcı denetimi -> Smart App Control, ve açıksa veya değerlendirme modundaysa kapat.$\r$\n$\r$\nBu güvenlidir, sonra tekrar açabilirsin.$\r$\n$\r$\nDevam etmek için İleri'ye tıkla."
  LangString smartAppText ${LANG_SIMPCHINESE} "CoopSync 尚未进行数字签名。Windows 11 的 Smart App Control 功能可能会阻止此安装程序或应用程序本身运行。$\r$\n$\r$\n继续之前，请检查：设置 -> 隐私和安全性 -> Windows 安全中心 -> 应用和浏览器控制 -> Smart App Control，如果它处于开启或评估模式，请将其关闭。$\r$\n$\r$\n这样做是安全的，之后可以重新开启。$\r$\n$\r$\n点击“下一步”继续。"
!macroend

; Custom Welcome page (not present by default — only enabled via this hook)
; with a Smart App Control warning (Windows 11 22H2+): it blocks unsigned apps
; BEFORE the app even opens, so warning inside the app itself would already be
; too late — it has to be here, on the very first installer screen.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(smartAppTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(smartAppText)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

; The registry entry from SAVELANGUAGE (below) survives into SUBSEQUENT, entirely
; separate installer runs too — but we need it to apply ONLY within a single run
; (for the UAC relaunch). So we clear it right at the start of every NEW
; (non-inner) run, before MUI_LANGDLL_DISPLAY gets a chance to see it — this way
; the language dialog shows up again every time the user actually launches the
; installer fresh.
!macro preInit
  ${IfNot} ${UAC_IsInnerInstance}
    DeleteRegValue HKCU "Software\CoopSyncInstaller" "InstallerLanguage"
  ${EndIf}
!macroend

; When the user picks "install for all users", NSIS relaunches the installer
; with admin rights (UAC) — and this "inner" process does NOT automatically
; inherit $LANGUAGE from the first language-selection dialog. So we record the
; language right after the dialog in two places: (1) the registry — so the
; second MUI_LANGDLL_DISPLAY run doesn't show the dialog again; (2) a temp file —
; read by customInstall (simpler than parsing the registry there too).
!macro customInit
  !insertmacro MUI_LANGDLL_SAVELANGUAGE
  ${IfNot} ${UAC_IsInnerInstance}
    FileOpen $9 "$TEMP\coopsync-installer-lang.txt" w
    FileWrite $9 "$LANGUAGE"
    FileClose $9
  ${EndIf}
!macroend

!macro customInstall
  ; Read the language from the temp file (survives the UAC relaunch). If it's
  ; missing (e.g. a very old installer without customInit) — fall back to $LANGUAGE.
  ClearErrors
  FileOpen $8 "$TEMP\coopsync-installer-lang.txt" r
  ${IfNot} ${Errors}
    FileRead $8 $7
    FileClose $8
    Delete "$TEMP\coopsync-installer-lang.txt"
  ${Else}
    StrCpy $7 "$LANGUAGE"
  ${EndIf}

  ${If} $7 == 1058
    StrCpy $0 "uk"
  ${ElseIf} $7 == 1031
    StrCpy $0 "de"
  ${ElseIf} $7 == 1036
    StrCpy $0 "fr"
  ${ElseIf} $7 == 1045
    StrCpy $0 "pl"
  ${ElseIf} $7 == 1049
    StrCpy $0 "ru"
  ${ElseIf} $7 == 3082
    StrCpy $0 "es"
  ${ElseIf} $7 == 1046
    StrCpy $0 "pt-BR"
  ${ElseIf} $7 == 1055
    StrCpy $0 "tr"
  ${ElseIf} $7 == 2052
    StrCpy $0 "zh-CN"
  ${Else}
    StrCpy $0 "en"
  ${EndIf}

  ; Written to $INSTDIR (the install folder), NOT $APPDATA — with "for all
  ; users", the admin installer session and a later launch by a regular user
  ; can see DIFFERENT $APPDATA. $INSTDIR is the same no matter who installed it.
  FileOpen $1 "$INSTDIR\installer-language.txt" w
  FileWrite $1 "$0"
  FileClose $1
!macroend
