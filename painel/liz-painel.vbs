' liz-painel.vbs - inicia o painel do Liz Framework sem janela de console.
' Arquivo mantido apenas em ASCII (VBScript interpreta arquivos como ANSI).
Option Explicit

Dim fso, shell, scriptDir, serverJs, rc, cmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverJs = fso.BuildPath(scriptDir, "server.js")

If Not fso.FileExists(serverJs) Then
  MsgBox "Arquivo server.js n" & ChrW(227) & "o encontrado em: " & scriptDir, vbCritical, "Liz Framework"
  WScript.Quit 1
End If

rc = shell.Run("cmd /c where node >nul 2>&1", 0, True)
If rc <> 0 Then
  MsgBox "O painel precisa do Node.js. Instale com: winget install OpenJS.NodeJS.LTS (ou baixe em nodejs.org) e abra o Liz de novo.", vbExclamation, "Liz Framework"
  WScript.Quit 1
End If

cmd = "node """ & serverJs & """"
shell.Run cmd, 0, False
