# criar-atalho.ps1 - cria (ou remove) os atalhos Liz.lnk na Area de Trabalho e Menu Iniciar.
# Compativel com Windows PowerShell 5.1. Mantido em ASCII puro para evitar problemas de encoding.
param(
  [switch]$Remover
)

$ErrorActionPreference = 'Stop'

$painelDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbsPath   = Join-Path $painelDir 'liz-painel.vbs'
$icoPath   = Join-Path $painelDir 'liz.ico'

$desktopDir = [Environment]::GetFolderPath('Desktop')
$startDir   = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'

$shortcuts = @(
  (Join-Path $desktopDir 'Liz.lnk'),
  (Join-Path $startDir 'Liz.lnk')
)

if ($Remover) {
  foreach ($lnk in $shortcuts) {
    if (Test-Path -LiteralPath $lnk) {
      Remove-Item -LiteralPath $lnk -Force
      Write-Host "Removido: $lnk"
    }
  }
  Write-Host "Atalhos do Liz removidos."
  exit 0
}

if (-not (Test-Path -LiteralPath $vbsPath)) {
  Write-Error "Arquivo nao encontrado: $vbsPath"
  exit 1
}

function New-LizIcon {
  param([string]$OutPath)
  Add-Type -AssemblyName System.Drawing
  $sizes = @(16, 32, 48, 256)
  $pngList = New-Object System.Collections.ArrayList
  $fox = [char]::ConvertFromUtf32(0x1F98A)

  foreach ($sz in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($sz, $sz, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $fontSize = [float]($sz * 0.72)
    $font = New-Object System.Drawing.Font('Segoe UI Emoji', $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, 0, $sz, $sz)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 217, 93, 30))

    $g.DrawString($fox, $font, $brush, $rect, $sf)

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    [void]$pngList.Add($ms.ToArray())

    $ms.Dispose()
    $brush.Dispose()
    $sf.Dispose()
    $font.Dispose()
    $g.Dispose()
    $bmp.Dispose()
  }

  $fs = New-Object System.IO.FileStream($OutPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $bw = New-Object System.IO.BinaryWriter($fs)
  try {
    # ICONDIR header
    $bw.Write([UInt16]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]$sizes.Count)

    $offset = 6 + (16 * $sizes.Count)
    for ($i = 0; $i -lt $sizes.Count; $i++) {
      $sz = $sizes[$i]
      $data = $pngList[$i]
      $dim = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }
      $bw.Write($dim)
      $bw.Write($dim)
      $bw.Write([byte]0)
      $bw.Write([byte]0)
      $bw.Write([UInt16]1)
      $bw.Write([UInt16]32)
      $bw.Write([UInt32]$data.Length)
      $bw.Write([UInt32]$offset)
      $offset += $data.Length
    }
    for ($i = 0; $i -lt $sizes.Count; $i++) {
      $bw.Write($pngList[$i])
    }
  } finally {
    $bw.Dispose()
    $fs.Dispose()
  }
}

$iconLocation = $icoPath
if (-not (Test-Path -LiteralPath $icoPath)) {
  try {
    New-LizIcon -OutPath $icoPath
  } catch {
    Write-Warning "Nao foi possivel gerar liz.ico ($($_.Exception.Message)). Usando icone reserva do Edge."
    $edgeCandidates = @(
      (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
      (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    )
    $edge = $edgeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if ($edge) { $iconLocation = "$edge,0" } else { $iconLocation = 'wscript.exe,0' }
  }
}

$wsh = New-Object -ComObject WScript.Shell
foreach ($lnk in $shortcuts) {
  $parent = Split-Path -Parent $lnk
  if (-not (Test-Path -LiteralPath $parent)) { continue }
  $sc = $wsh.CreateShortcut($lnk)
  $sc.TargetPath       = 'wscript.exe'
  $sc.Arguments        = "//B `"$vbsPath`""
  $sc.WorkingDirectory = $painelDir
  $sc.IconLocation     = $iconLocation
  $sc.Description      = 'Painel do Liz Framework'
  $sc.Save()
  Write-Host "Atalho criado: $lnk"
}

Write-Host "Pronto! De dois cliques no atalho Liz para abrir o painel."
