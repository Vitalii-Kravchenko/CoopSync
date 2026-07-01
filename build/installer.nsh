; Вмикаємо вбудований у NSIS механізм "запам'ятати мову інсталятора в реєстрі".
; Без цього MUI_LANGDLL_DISPLAY завжди показує діалог — навіть у "внутрішньому"
; процесі після перезапуску через UAC (для "встановити для всіх"), тому
; користувач бачив питання про мову ДВІЧІ. З цим define'ом і SAVELANGUAGE
; (у customInit нижче) другий запуск MUI_LANGDLL_DISPLAY бачить збережене
; значення й діалог просто не показує.
!macro customHeader
  !define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
  !define MUI_LANGDLL_REGISTRY_KEY "Software\CoopSyncInstaller"
  !define MUI_LANGDLL_REGISTRY_VALUENAME "InstallerLanguage"
!macroend

; Реєстровий запис із SAVELANGUAGE (нижче) переживає й НАСТУПНІ, зовсім окремі
; запуски інсталятора — а нам треба, щоб він діяв ЛИШЕ в межах одного запуску
; (для UAC-перезапуску). Тож стираємо його на самому старті кожного НОВОГО
; (не-внутрішнього) запуску, перед тим як MUI_LANGDLL_DISPLAY встигне його
; побачити — так діалог вибору мови знову показується щоразу, коли користувач
; реально запускає інсталятор заново.
!macro preInit
  ${IfNot} ${UAC_IsInnerInstance}
    DeleteRegValue HKCU "Software\CoopSyncInstaller" "InstallerLanguage"
  ${EndIf}
!macroend

; Коли користувач обирає "встановити для всіх користувачів", NSIS перезапускає
; інсталятор заново з правами адміністратора (UAC) — і цей "внутрішній" процес
; НЕ успадковує $LANGUAGE з першого діалогу вибору мови автоматично. Тому мову
; фіксуємо одразу після діалогу у два місця: (1) реєстр — щоб другий запуск
; MUI_LANGDLL_DISPLAY не показував діалог знову; (2) тимчасовий файл — його
; читає customInstall (простіше, ніж парсити реєстр там же).
!macro customInit
  !insertmacro MUI_LANGDLL_SAVELANGUAGE
  ${IfNot} ${UAC_IsInnerInstance}
    FileOpen $9 "$TEMP\coopsync-installer-lang.txt" w
    FileWrite $9 "$LANGUAGE"
    FileClose $9
  ${EndIf}
!macroend

!macro customInstall
  ; Читаємо мову з тимчасового файлу (переживає UAC-перезапуск). Якщо його
  ; нема (наприклад, дуже старий інсталятор без customInit) — фолбек на $LANGUAGE.
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

  ; Пишемо в $INSTDIR (папку встановлення), а НЕ в $APPDATA — при "для всіх
  ; користувачів" деінсталятор-адмінська сесія й пізніший запуск застосунку
  ; звичайним користувачем можуть бачити РІЗНІ $APPDATA. $INSTDIR один і той
  ; самий незалежно від того, хто саме встановлював.
  FileOpen $1 "$INSTDIR\installer-language.txt" w
  FileWrite $1 "$0"
  FileClose $1
!macroend
