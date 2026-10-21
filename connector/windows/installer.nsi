Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
Name "SRTB Graphics Connecteur — validation"
OutFile "${OUTPUT}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\SRTB Graphics Connector"
SetCompressor /SOLID lzma
VIProductVersion "0.3.0.0"
VIAddVersionKey /LANG=1036 "ProductName" "SRTB Graphics Connector"
VIAddVersionKey /LANG=1036 "FileDescription" "Connecteur local — version de validation non signée"
VIAddVersionKey /LANG=1036 "FileVersion" "0.3.0"
!define MUI_WELCOMEPAGE_TEXT "Version de validation, non destinée au déploiement équipe.$\r$\n$\r$\nAccès en lecture seule aux emplacements que vous choisirez. Aucun disque n’est parcouru à l’installation.$\r$\n$\r$\nPas de démarrage automatique, de service système ou de règle de pare-feu."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

; No editable destination or /D override; refuse reparse points and existing
; installations rather than overwrite unknown files or a running helper.
!macro CheckParents PREFIX
Function ${PREFIX}CheckParents
 Pop $0
 loop_${PREFIX}:
 System::Call 'kernel32::GetFileAttributesW(w r0) i.r1'
 ${If} $1 != -1
  IntOp $2 $1 & 0x400
  ${If} $2 != 0
   MessageBox MB_OK|MB_ICONSTOP "L’emplacement d’installation traverse un lien ou une jonction. Installation interrompue." /SD IDOK
   Abort
  ${EndIf}
 ${EndIf}
 ${GetParent} "$0" $1
 StrCmp $1 $0 done_${PREFIX}
 StrCmp $1 "" done_${PREFIX}
 StrCpy $0 $1
 Goto loop_${PREFIX}
 done_${PREFIX}:
FunctionEnd
!macroend
!include "FileFunc.nsh"
!insertmacro CheckParents ""
!insertmacro CheckParents "un."
Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_OK|MB_ICONSTOP "Cette version de validation demande Windows x64." /SD IDOK
  Abort
 ${EndIf}
 StrCpy $INSTDIR "$LOCALAPPDATA\Programs\SRTB Graphics Connector"
 SetShellVarContext current
 Push "$INSTDIR\connector\ui"
 Call CheckParents
 Push "$SMPROGRAMS\SRTB Graphics Connector"
 Call CheckParents
 IfFileExists "$INSTDIR\*.*" 0 empty
 MessageBox MB_OK|MB_ICONSTOP "Un dossier d’installation existe déjà. Arrêtez puis désinstallez l’ancienne version avant de réessayer. Vos médias et index seront conservés." /SD IDOK
 Abort
 empty:
 IfFileExists "$SMPROGRAMS\SRTB Graphics Connector\*.*" 0 clean_shortcuts
 MessageBox MB_OK|MB_ICONSTOP "Un dossier de raccourcis Graphics existe déjà. Aucune installation n’a été effectuée. Contactez votre support." /SD IDOK
 Abort
 clean_shortcuts:
FunctionEnd
Section "Connecteur"
 SetOutPath "$INSTDIR"
 ClearErrors
 File /r "${PAYLOAD}\*"
 ${If} ${Errors}
  MessageBox MB_OK|MB_ICONSTOP "La copie est incomplète. Le connecteur n’est pas installé. Aucun média n’a été modifié. Contactez votre support." /SD IDOK
  Abort
 ${EndIf}
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\SRTB Graphics Connector"
 CreateShortcut "$SMPROGRAMS\SRTB Graphics Connector\Ouvrir le connecteur.lnk" "$INSTDIR\GraphicsConnector.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SRTBGraphicsConnector" "DisplayName" "SRTB Graphics Connecteur (validation)"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SRTBGraphicsConnector" "DisplayVersion" "0.3.0"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SRTBGraphicsConnector" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SRTBGraphicsConnector" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SRTBGraphicsConnector" "NoRepair" 1
SectionEnd
Function un.onInit
 StrCmp $INSTDIR "$LOCALAPPDATA\Programs\SRTB Graphics Connector" valid
 MessageBox MB_OK|MB_ICONSTOP "Emplacement inattendu. Aucune suppression." /SD IDOK
 Abort
 valid:
 SetShellVarContext current
 Push "$INSTDIR\connector\ui"
 Call un.CheckParents
 Push "$SMPROGRAMS\SRTB Graphics Connector"
 Call un.CheckParents
 MessageBox MB_OKCANCEL "Arrêtez d’abord le connecteur depuis sa console ou son icône près de l’horloge.$\r$\nVos médias et vos index ne seront pas supprimés." /SD IDOK IDOK proceed
 Abort
 proceed:
 ; Exclusive write-open checks only: no content is written. Windows refuses
 ; this while an executable image is in use. Never kill another process.
 Push "$INSTDIR\node.exe"
 Call un.CheckNotInUse
 Push "$INSTDIR\GraphicsConnector.exe"
 Call un.CheckNotInUse
FunctionEnd
Function un.CheckNotInUse
 Pop $0
 IfFileExists "$0" 0 unused
 System::Call 'kernel32::CreateFileW(w r0, i 0x40000000, i 0, p 0, i 3, i 0, p 0) p.r1'
 ${If} $1 == -1
  MessageBox MB_OK|MB_ICONSTOP "Le connecteur est encore ouvert, ou ses fichiers sont verrouillés. Arrêtez-le puis réessayez. Aucune suppression n’a commencé." /SD IDOK
  Abort
 ${EndIf}
 System::Call 'kernel32::CloseHandle(p r1)'
 unused:
FunctionEnd
Section "Uninstall"
 ; Generated explicit file list; never RMDir /r, never a media or data folder.
 ClearErrors
 !include "${DELETE_LIST}"
 ${If} ${Errors}
  MessageBox MB_OK|MB_ICONSTOP "Certains fichiers n’ont pas pu être retirés. Le désinstalleur reste disponible pour réessayer. Vos médias et index sont conservés." /SD IDOK
  Abort
 ${EndIf}
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR\connector\ui"
 RMDir "$INSTDIR\connector"
 RMDir "$INSTDIR"
 Delete "$SMPROGRAMS\SRTB Graphics Connector\Ouvrir le connecteur.lnk"
 RMDir "$SMPROGRAMS\SRTB Graphics Connector"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SRTBGraphicsConnector"
SectionEnd
