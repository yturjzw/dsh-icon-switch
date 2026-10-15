#requires -Version 5.1
<#
.SYNOPSIS
  DSH 图标切换工具（命令行内核）— 同时支持两种安装：
    harness  DeepSeek Harness（正式版/打包版，D:\Software\DeepSeek Harness\resources）
             可替换：tray.ico（托盘）、icon.png（关于面板）；任务栏图标需配合 dsh-taskbar-icon.ps1
    desktop  DSH Desktop（开发版/解包版，...\resources\app\build）
             可替换：app-icon.png（窗口/任务栏）、tray-icon-*.png（托盘）、app-icon.ico 等全套

  图标集存于 <ToolDir>\icons\<名称>\，原始备份存于 <ToolDir>\originals\<安装>\。
  切换后需重启 DSH 生效（-RestartApp 自动重启）。

.PARAMETER Action
  list | status | apply | restore | backup | new | reicon
.PARAMETER Name
  apply/restore 时的图标集名称。
.PARAMETER SourceImage
  new 时传入的源 PNG（将生成 source.png 母版、app-icon.png、托盘多尺寸 PNG、多尺寸 app-icon.ico）。
.PARAMETER Install
  auto（默认） | harness | desktop
.PARAMETER ResourcesDir
  覆盖资源目录（默认取安装配置）。
.PARAMETER Round / Radius
  把方角图裁成圆角（与 DeepSeek Harness 默认图标的圆角一致）。-Radius 为边长百分比，默认 26。
  new/apply 都会按当前开关重建图标文件：带 -Round 生成圆角，不带则从 source.png 还原直角（可反复切换）。
.PARAMETER RestartApp / Strict / NoShortcut / DryRun
  可选开关。
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('list', 'status', 'apply', 'restore', 'backup', 'new', 'reicon')]
  [string]$Action = 'status',
  [Parameter(Position = 1)]
  [string]$Name,
  [string]$SourceImage,
  [ValidateSet('auto', 'harness', 'desktop')]
  [string]$Install = 'auto',
  [Alias('BuildDir')]
  [string]$ResourcesDir = '',
  # 注意：param 默认值里取不到 $PSScriptRoot（[CmdletBinding()] 下参数绑定阶段尚未设置），
  # 因此留空，在下面 Set-StrictMode 之后补默认值
  [string]$ToolDir = '',
  # 圆角：生成/应用时把方角图裁成圆角（与 DeepSeek Harness 默认图标一致）
  [switch]$Round,
  [ValidateRange(0, 50)]
  [double]$Radius = 26,
  [switch]$RestartApp,
  [switch]$Strict,
  [switch]$NoShortcut,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

if (-not $ToolDir) { $ToolDir = $PSScriptRoot }
if (-not $ToolDir) { $ToolDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ToolDir) { throw '无法确定工具目录，请用 -ToolDir 指定' }

# ---------- 安装配置 ----------
$Script:Installs = @(
  @{
    id = 'harness'; title = 'DeepSeek Harness（正式版/打包版）'
    exeName = 'DeepSeek Harness.exe'; processName = 'DeepSeek Harness'
    resourceDir = 'D:\Software\DeepSeek Harness\resources'
    targets = @('tray.ico', 'icon.png')
  },
  @{
    id = 'desktop'; title = 'DSH Desktop（开发版/解包版）'
    exeName = 'DSH Desktop.exe'; processName = 'DSH Desktop'
    resourceDir = 'D:\Software\DSH Desktop\resources\app\build'
    targets = @('app-icon-mac.png', 'app-icon.ico', 'app-icon.png', 'tray-icon-blue.png', 'tray-icon-blue@1.25x.png', 'tray-icon-blue@1.5x.png', 'tray-icon-blue@2x.png', 'tray-icon.svg', 'tray-iconTemplate.png', 'tray-iconTemplate@2x.png')
  }
)

function Write-Line([string]$Text, [ConsoleColor]$Color = [ConsoleColor]::Gray) {
  if ($Color -eq [ConsoleColor]::Gray) { Write-Host $Text } else { Write-Host $Text -ForegroundColor $Color }
}

function Get-AutoInstallId {
  # 优先正式版（用户实际使用的安装）
  foreach ($p in $Script:Installs) { if (Test-Path $p.resourceDir) { return $p.id } }
  throw '未找到任何 DSH 安装目录，请用 -Install 或 -ResourcesDir 指定'
}

function Get-ProfileByInstall([string]$install) {
  $id = if ($install -eq 'auto') { Get-AutoInstallId } else { $install }
  $p = $Script:Installs | Where-Object { $_.id -eq $id } | Select-Object -First 1
  if (-not $p) { throw "未知安装类型: $install" }
  return $p
}

function Get-ResourcesDir($profile) {
  if ($ResourcesDir) { return $ResourcesDir }
  return $profile.resourceDir
}

function Get-OriginalsDir($profile) {
  return Join-Path (Join-Path $ToolDir 'originals') $profile.id
}

function Get-ExePath($profile) {
  $rd = Get-ResourcesDir $profile
  # 从资源目录向上逐级查找含 exeName 的安装根（不同安装层级不同）
  $dir = $rd
  for ($i = 0; $i -lt 6; $i++) {
    $candidate = Join-Path $dir $profile.exeName
    if (Test-Path $candidate) { return $candidate }
    $parent = Split-Path $dir -Parent
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  return Join-Path (Split-Path $rd) $profile.exeName
}

function Get-IconSets {
  $dir = Join-Path $ToolDir 'icons'
  if (-not (Test-Path $dir)) { return @() }
  Get-ChildItem $dir -Directory -Force | Where-Object { $_.Name -notlike '.*' } | ForEach-Object {
    $files = @(Get-ChildItem $_.FullName -File -Include '*.png', '*.ico', '*.svg' -Recurse -ErrorAction SilentlyContinue)
    [pscustomobject]@{ Name = $_.Name; Path = $_.FullName; Files = @($files).Count }
  }
}

function Test-ResourceWritable([string]$dir) {
  try {
    $probe = Join-Path $dir ('.dsh-icon-probe-' + [guid]::NewGuid().ToString('N'))
    [System.IO.File]::WriteAllText($probe, 'probe')
    Remove-Item $probe -Force
    return $true
  } catch { return $false }
}

function Test-AppRunning($profile) {
  return [bool](Get-Process -Name $profile.processName -ErrorAction SilentlyContinue)
}

# ---------- 备份 / 复制 ----------
function Invoke-Backup($profile) {
  $rd = Get-ResourcesDir $profile
  $dst = Get-OriginalsDir $profile
  Write-Line "正在快照 [$($profile.title)] 图标到 originals\$($profile.id) ..." Cyan
  New-Item -ItemType Directory -Path $dst -Force | Out-Null
  $copied = 0
  foreach ($t in $profile.targets) {
    $src = Join-Path $rd $t
    if (Test-Path $src) {
      if ($DryRun) { Write-Line "  [dry] 备份 $t"; continue }
      Copy-Item $src (Join-Path $dst $t) -Force
      $copied++
    }
  }
  if (-not $DryRun) { Write-Line "  已备份 $copied 个文件" Green }
}

function Get-SetIcoPath($setDir) {
  # 图标集若缺 app-icon.ico，则从 app-icon.png 合成多尺寸 ico
  $ico = Join-Path $setDir 'app-icon.ico'
  if (Test-Path $ico) { return $ico }
  $png = Join-Path $setDir 'app-icon.png'
  if (-not (Test-Path $png)) { return $null }
  if ($DryRun) { return $ico }
  New-MultiSizeIco $png $ico
  return $ico
}

function Invoke-Apply($profile, [string]$SetName) {
  $rd = Get-ResourcesDir $profile
  $set = Join-Path (Join-Path $ToolDir 'icons') $SetName
  if (-not (Test-Path $set)) { throw "图标集不存在: $SetName" }
  if (-not (Test-Path $rd)) { throw "资源目录不存在: $rd" }
  if (-not (Test-ResourceWritable $rd)) {
    if ($DryRun) { Write-Line '  [警告] 当前权限下资源目录不可写（仅预览，不实际执行）' Yellow }
    else { throw "资源目录不可写: $rd （需要管理员权限）" }
  }

  # 应用前按 -Round/-Radius 重建图标文件（幂等；未开启圆角且无 source.png 时不动任何文件）
  if (-not $DryRun) { Update-SetImages $set }

  $originals = Get-OriginalsDir $profile
  if (-not (Test-Path (Join-Path $originals $profile.targets[0]))) {
    Write-Line '首次应用：先备份当前官方图标 ...' Yellow
    Invoke-Backup $profile
  }

  Write-Line "应用图标集 [$SetName] -> [$($profile.title)] $rd" Cyan
  if ($profile.id -eq 'harness') {
    # 正式版：icon.png（关于）+ tray.ico（托盘，来自 app-icon.ico / 合成）
    $srcPng = Join-Path $set 'app-icon.png'
    if (-not (Test-Path $srcPng)) { throw "图标集 $SetName 缺少 app-icon.png（正式版必需）" }
    if ($DryRun) {
      Write-Line '  [dry] app-icon.png -> icon.png'
      Write-Line '  [dry] app-icon.ico(或合成) -> tray.ico'
    } else {
      Copy-Item $srcPng (Join-Path $rd 'icon.png') -Force
      Write-Line '  ✔ icon.png' Green
      $ico = Get-SetIcoPath $set
      if ($ico) { Copy-Item $ico (Join-Path $rd 'tray.ico') -Force; Write-Line "  ✔ tray.ico（来自 $((Split-Path $ico -Leaf))）" Green }
    }
  } else {
    foreach ($t in $profile.targets) {
      $src = Join-Path $set $t
      if (-not (Test-Path $src)) { continue }
      if ($DryRun) { Write-Line "  [dry] 复制 $t"; continue }
      Copy-Item $src (Join-Path $rd $t) -Force
      Write-Line "  ✔ $t" Green
    }
    if ($Strict -and -not $DryRun) {
      foreach ($t in $profile.targets) {
        $dst = Join-Path $rd $t
        if ((Test-Path $dst) -and -not (Test-Path (Join-Path $set $t))) {
          Remove-Item $dst -Force
          Write-Line "  ✘ 删除（-Strict）: $t" Yellow
        }
      }
    }
  }

  # 快捷方式指向安装目录内的稳定副本：工具目录被移动/清理后图标不会变白
  $ico = Get-SetIcoPath $set
  $stableIco = $null
  if ($ico) {
    $stableIco = Join-Path $rd 'app-icon.ico'
    if ($DryRun) { Write-Line "  [dry] app-icon.ico -> $stableIco（快捷方式图标源）" }
    elseif (-not (Test-Path $stableIco) -or (Get-FileHash $ico).Hash -ne (Get-FileHash $stableIco).Hash) {
      Copy-Item $ico $stableIco -Force
      Write-Line '  ✔ app-icon.ico（安装目录内，供快捷方式使用）' Green
    }
  }
  if (-not $NoShortcut) {
    $shortcutIco = if ($DryRun) { $ico } elseif ($stableIco -and (Test-Path $stableIco)) { $stableIco } else { $ico }
    Update-Shortcuts $profile $shortcutIco
  }

  if (Test-AppRunning $profile) {
    Write-Line "检测到 $($profile.processName) 正在运行：托盘/窗口图标需重启后生效（任务栏图标可配合 dsh-taskbar-icon.ps1 即时设置）。" Yellow
    if ($RestartApp) {
      if ($DryRun) { Write-Line "  [dry] 关闭并重启 $($profile.exeName)" }
      else {
        Write-Line '  正在重启 ...' Yellow
        Get-Process -Name $profile.processName -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2
        Start-Process -FilePath (Get-ExePath $profile)
        Write-Line '  已重新启动' Green
      }
    }
  }
}

function Invoke-Restore($profile) {
  $rd = Get-ResourcesDir $profile
  $originals = Get-OriginalsDir $profile
  if (-not (Test-Path (Join-Path $originals $profile.targets[0]))) {
    throw "缺少 [$($profile.title)] 官方原版备份（originals\$($profile.id)）。如当前资源目录即是原版，请先执行 backup。"
  }
  Write-Line "恢复 [$($profile.title)] 官方默认图标 <- originals\$($profile.id)" Cyan
  foreach ($t in $profile.targets) {
    $src = Join-Path $originals $t
    $dst = Join-Path $rd $t
    if (-not (Test-Path $src)) { continue }
    if ($DryRun) { Write-Line "  [dry] 恢复 $t"; continue }
    Copy-Item $src $dst -Force
    Write-Line "  ✔ $t" Green
  }
  # 清理仅供快捷方式使用的临时副本（不属于该安装的官方目标文件时才删）
  $stableIco = Join-Path $rd 'app-icon.ico'
  if (($profile.targets -notcontains 'app-icon.ico') -and (Test-Path $stableIco)) {
    if ($DryRun) { Write-Line '  [dry] 删除 app-icon.ico（快捷方式图标源）' }
    else { Remove-Item $stableIco -Force; Write-Line '  ✔ 已删除安装目录内的 app-icon.ico' Green }
  }
  if (-not $NoShortcut) { Update-Shortcuts $profile $null }
  if (Test-AppRunning $profile) {
    Write-Line "$($profile.processName) 正在运行：恢复后的图标需重启生效。" Yellow
    if ($RestartApp) {
      if ($DryRun) { Write-Line "  [dry] 关闭并重启 $($profile.exeName)" }
      else {
        Get-Process -Name $profile.processName -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2
        Start-Process -FilePath (Get-ExePath $profile)
        Write-Line '  已重新启动' Green
      }
    }
  }
}

# ---------- 快捷方式 ----------
function Update-ShellIconCache {
  # 快捷方式/文件图标改动后通知外壳立即重取图标（否则资源管理器可能一直显示缓存里的空白图标）
  if (-not ('DshShellNotify' -as [type])) {
    try {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshShellNotify {
  [DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
'@ -ErrorAction Stop
    } catch { }
  }
  try {
    # SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0x0000
    [DshShellNotify]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Line '  已通知 Windows 刷新图标缓存' Green
  } catch { Write-Line "  刷新图标缓存失败（不影响图标文件本身）: $($_.Exception.Message)" Yellow }
  # 兜底：部分系统上 SHChangeNotify 不足以清掉已缓存的空白图标，让资源管理器重建图标缓存
  try {
    $ie4u = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
    if (Test-Path $ie4u) {
      Start-Process -FilePath $ie4u -ArgumentList '-ClearIconCache' -WindowStyle Hidden -ErrorAction Stop
      Start-Process -FilePath $ie4u -ArgumentList '-show' -WindowStyle Hidden -ErrorAction Stop
      Write-Line '  已请求资源管理器重建图标缓存' Green
    }
  } catch { }
}

function Update-Shortcuts($profile, [string]$CustomIcoPath) {
  $exe = Get-ExePath $profile
  if (-not $exe -or -not (Test-Path $exe)) { return }
  $iconLocation = if ($CustomIcoPath -and (Test-Path $CustomIcoPath)) { "$CustomIcoPath,0" } else { "$exe,0" }
  $pattern = '*' + $profile.exeName
  $targetParts = @()
  foreach ($d in @(
      [Environment]::GetFolderPath('Desktop'),
      [Environment]::GetFolderPath('CommonDesktopDirectory'),
      (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
      'C:\ProgramData\Microsoft\Windows\Start Menu\Programs'
    )) {
    if ($d -and (Test-Path $d)) { $targetParts += (Get-ChildItem $d -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue) }
  }
  $hits = @($targetParts | Where-Object {
    try { (New-Object -ComObject WScript.Shell -ErrorAction Stop).CreateShortcut($_.FullName).TargetPath -like $pattern } catch { $false }
  })
  if ($DryRun) { Write-Line "  [dry] 快捷方式图标 -> $iconLocation （命中 $($hits.Count) 个 .lnk）"; return }
  $shell = New-Object -ComObject WScript.Shell
  $updated = 0
  foreach ($lnk in $hits) {
    try {
      $sc = $shell.CreateShortcut($lnk.FullName)
      $sc.IconLocation = $iconLocation
      $sc.Save()
      $updated++
    } catch { Write-Line "  无法更新快捷方式: $($lnk.FullName)" Yellow }
  }
  Write-Line "  快捷方式已更新: $updated 个 -> $iconLocation" Green
  if ($updated -gt 0) { Update-ShellIconCache }
}

# ---------- 多尺寸 ICO 合成（DIB 帧，全部尺寸通用有效） ----------
# 注意：不要用 PNG 压缩帧。ICO 里除 256 尺寸外的 PNG 帧在 Windows 外壳/快捷方式图标
# 提取路径（ExtractIconEx 等）下会被拒绝，表现为图标变成空白/白色方块。
# 这里为每个尺寸写标准 BITMAPINFOHEADER + 32bpp BGRA（自下而上）+ AND 掩码。
function New-IcoDibFrame([System.Drawing.Bitmap]$Bmp) {
  $s = $Bmp.Width
  $rect = New-Object System.Drawing.Rectangle 0, 0, $s, $s
  $locked = $Bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $stride = $locked.Stride
    $buffer = New-Object byte[] ($stride * $s)
    [System.Runtime.InteropServices.Marshal]::Copy($locked.Scan0, $buffer, 0, $buffer.Length)
  } finally { $Bmp.UnlockBits($locked) }

  $maskRow = [int]([Math]::Floor(($s + 31) / 32) * 4)
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  # BITMAPINFOHEADER（高度写 2 倍：XOR 位图 + AND 掩码）
  $bw.Write([UInt32]40); $bw.Write([Int32]$s); $bw.Write([Int32]($s * 2))
  $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]0)
  $bw.Write([UInt32]($s * $s * 4)); $bw.Write([Int32]0); $bw.Write([Int32]0)
  $bw.Write([UInt32]0); $bw.Write([UInt32]0)
  # XOR：BGRA 自下而上
  for ($y = $s - 1; $y -ge 0; $y--) { $bw.Write($buffer, $y * $stride, $s * 4) }
  # AND 掩码按 alpha 生成（1 = 透出背景）：老式外壳只看掩码时圆角/透明也正确
  $mask = New-Object byte[] ($maskRow * $s)
  for ($y = 0; $y -lt $s; $y++) {
    $srcRow = $y * $stride
    $dstRow = ($s - 1 - $y) * $maskRow      # 掩码同样自下而上
    for ($x = 0; $x -lt $s; $x++) {
      if ($buffer[$srcRow + $x * 4 + 3] -lt 128) {
        $i = $dstRow + [int][Math]::Floor($x / 8)
        $mask[$i] = $mask[$i] -bor (0x80 -shr ($x % 8))
      }
    }
  }
  $bw.Write($mask, 0, $mask.Length)
  $bw.Flush()
  $bytes = $ms.ToArray()
  $bw.Dispose(); $ms.Dispose()
  return , $bytes
}

function New-MultiSizeIco([string]$PngPath, [string]$IcoPath) {
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Bitmap]::new($PngPath)
  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $frames = @()
  foreach ($s in $sizes) {
    $bmp = [System.Drawing.Bitmap]::new($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($src, 0, 0, $s, $s)
    $g.Dispose()
    $frames += , (New-IcoDibFrame $bmp)
    $bmp.Dispose()
  }
  $src.Dispose()
  $out = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($out)
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$frames.Count)
  $offset = 6 + 16 * $frames.Count
  for ($i = 0; $i -lt $frames.Count; $i++) {
    $s = $sizes[$i]
    $dim = if ($s -ge 256) { 0 } else { $s }
    $bw.Write([Byte]$dim); $bw.Write([Byte]$dim)      # 宽/高（0 表示 256）
    $bw.Write([Byte]0); $bw.Write([Byte]0)            # 颜色数 / 保留
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)       # 平面 / 位深
    $bw.Write([UInt32]$frames[$i].Length); $bw.Write([UInt32]$offset)
    $offset += $frames[$i].Length
  }
  for ($i = 0; $i -lt $frames.Count; $i++) { $bw.Write($frames[$i]) }
  $bw.Flush()
  [System.IO.File]::WriteAllBytes($IcoPath, $out.ToArray())
  $bw.Dispose(); $out.Dispose()
}

# 为已存在的图标集重新合成 app-icon.ico（修复旧版 PNG 帧导致的空白图标）
function Invoke-Reicon([string]$SetName) {
  $all = @()
  if ($SetName -eq 'all') {
    $all = @(Get-ChildItem (Join-Path $ToolDir 'icons') -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName 'app-icon.png') } | ForEach-Object { $_.Name })
    if ($all.Count -eq 0) { throw '没有可重新合成的图标集' }
  } else { $all = @($SetName) }
  Add-Type -AssemblyName System.Drawing
  foreach ($n in $all) {
    $set = Join-Path (Join-Path $ToolDir 'icons') $n
    if (-not (Test-Path $set)) { throw "图标集不存在: $n" }
    $png = Join-Path $set 'app-icon.png'
    if (-not (Test-Path $png)) { Write-Line "  跳过 $n（缺少 app-icon.png）" Yellow; continue }
    $ico = Join-Path $set 'app-icon.ico'
    if ($DryRun) { Write-Line "  [dry] 由 app-icon.png 重新合成 $n\app-icon.ico"; continue }
    New-MultiSizeIco $png $ico
    Write-Line ("  ✔ {0,-22} app-icon.ico  {1,7} bytes（DIB 帧）" -f $n, (Get-Item $ico).Length) Green
  }
}

# ---------- 圆角处理与图标集图像生成 ----------
# Save-Resized：把源图铺满为 Size×Size 的方形 PNG（透明底）
function Save-Resized([System.Drawing.Image]$Source, [int]$Size, [string]$OutPath) {
  $bmp = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($Source, 0, 0, $Size, $Size)
  $g.Dispose()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# Add-RoundedCorners：就地给 PNG 裁圆角（RadiusPercent 为边长的百分比，与 DSH 默认图标的 26% 一致）
function Add-RoundedCorners([string]$PngPath, [double]$RadiusPercent) {
  if ($RadiusPercent -le 0) { return }
  Add-Type -AssemblyName System.Drawing
  # 先读进内存，避免 Bitmap 长期占用文件句柄导致原路径无法覆盖
  $bytes = [System.IO.File]::ReadAllBytes($PngPath)
  $ms = New-Object System.IO.MemoryStream(, $bytes)
  $src = [System.Drawing.Bitmap]::new($ms)
  $out = $null
  $g = $null
  $path = $null
  try {
    $s = $src.Width
    $r = [single]([Math]::Max(1.0, [Math]::Min($s / 2.0, $s * $RadiusPercent / 100.0)))
    $d = $r * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc([single]0, [single]0, $d, $d, 180, 90)
    $path.AddArc([single]($s - $d), [single]0, $d, $d, 270, 90)
    $path.AddArc([single]($s - $d), [single]($s - $d), $d, $d, 0, 90)
    $path.AddArc([single]0, [single]($s - $d), $d, $d, 90, 90)
    $path.CloseFigure()
    $out = [System.Drawing.Bitmap]::new($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.SetClip($path)
    $rect = New-Object System.Drawing.Rectangle 0, 0, $s, $s
    $g.DrawImage($src, $rect, 0, 0, $s, $s, [System.Drawing.GraphicsUnit]::Pixel)
    $g.ResetClip()
    $g.Dispose(); $g = $null
    $out.Save($PngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    if ($g) { $g.Dispose() }
    if ($out) { $out.Dispose() }
    if ($path) { $path.Dispose() }
    $src.Dispose(); $ms.Dispose()
  }
}

# New-SetImages：由方形原图生成图标集的标准文件（app-icon.png / 托盘图 / app-icon.ico）
# 原图分辨率 ≥256 时保留（上限 1024），避免把已有的高清 app-icon.png 降级成 256
function New-SetImages([string]$SourcePng, [string]$SetDir) {
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Bitmap]::new($SourcePng)
  try {
    $size = [int][Math]::Min(1024, [Math]::Max(256, [Math]::Max($src.Width, $src.Height)))
    $png = Join-Path $SetDir 'app-icon.png'
    Save-Resized $src $size $png
    if ($Round) { Add-RoundedCorners $png $Radius }
    foreach ($t in @(
        @{ N = 'tray-icon-blue.png'; S = 16 }, @{ N = 'tray-icon-blue@1.25x.png'; S = 20 },
        @{ N = 'tray-icon-blue@1.5x.png'; S = 24 }, @{ N = 'tray-icon-blue@2x.png'; S = 32 },
        @{ N = 'tray-iconTemplate.png'; S = 16 }, @{ N = 'tray-iconTemplate@2x.png'; S = 32 }
      )) {
      $p = Join-Path $SetDir $t.N
      Save-Resized $src $t.S $p
      if ($Round) { Add-RoundedCorners $p $Radius }
    }
    New-MultiSizeIco $png (Join-Path $SetDir 'app-icon.ico')
  } finally { $src.Dispose() }
}

# Update-SetImages：让图标集与当前 -Round/-Radius 设置保持一致（幂等）
# 有 source.png 就从它重建（可反复切换圆角/直角）；没有则只在要求圆角时以当前 app-icon.png 作为原图
function Update-SetImages([string]$SetDir) {
  $png = Join-Path $SetDir 'app-icon.png'
  $src = Join-Path $SetDir 'source.png'
  if (-not (Test-Path $png)) { return }
  if (-not (Test-Path $src)) {
    if (-not $Round) { return }
    Copy-Item $png $src -Force
    Write-Line '  已保留直角原图: source.png' Gray
  }
  $mode = if ($Round) { "圆角 $Radius%" } else { '直角' }
  Write-Line "  按当前设置重建图标文件（$mode）" Cyan
  New-SetImages $src $SetDir
}

# ---------- list / status / new ----------
function Show-List($profile) {
  $sets = Get-IconSets
  if ($sets.Count -eq 0) { Write-Line 'icons\ 目录下没有图标集。' Yellow; return }
  Write-Line "可用图标集（当前安装 [$($profile.id)]，可替换: $($profile.targets -join ', ')）：" Cyan
  foreach ($s in ($sets | Sort-Object Name)) {
    $covers = '-'
    if ($profile.id -eq 'harness') {
      if (Test-Path (Join-Path $s.Path 'app-icon.png')) { $covers = '✓' }
    } else {
      $has = @($profile.targets | Where-Object { Test-Path (Join-Path $s.Path $_) })
      if ($has.Count -gt 0) { $covers = '✓' }
    }
    $tag = if ($s.Name -eq 'default') { ' [官方原版备份]' } else { '' }
    Write-Line ('  {0,-22} 覆盖:{1}  {2,3} 文件{3}' -f $s.Name, $covers, $s.Files, $tag)
  }
}

function Show-Status($profile) {
  Write-Line '========== DSH 图标状态 ==========' Cyan
  $rd = Get-ResourcesDir $profile
  $exe = Get-ExePath $profile
  Write-Line "  安装        : [$($profile.id)] $($profile.title)"
  Write-Line "  资源目录    : $rd"
  Write-Line "  可执行文件  : $exe"
  Write-Line "  应用运行中  : $(Test-AppRunning $profile)"
  Write-Line "  目录可写    : $(Test-ResourceWritable $rd)"
  $originals = Get-OriginalsDir $profile
  Write-Line "  官方备份    : $(if (Test-Path (Join-Path $originals $profile.targets[0])) { $originals } else { '未建立（执行 backup）' })"
  $primary = $profile.targets | Where-Object { $_ -match '^app-icon\.png$|^icon\.png$' } | Select-Object -First 1
  if (-not $primary) { $primary = $profile.targets[0] }
  $file = Join-Path $rd $primary
  if (Test-Path $file) {
    $h = (Get-FileHash $file -Algorithm SHA256).Hash
    $match = $null
    foreach ($s in (Get-IconSets)) {
      $p = Join-Path $s.Path $primary
      $alt = if ($primary -eq 'icon.png') { Join-Path $s.Path 'app-icon.png' } else { $null }
      if ((Test-Path $p) -and (Get-FileHash $p -Algorithm SHA256).Hash -eq $h) { $match = $s.Name; break }
      if ($alt -and (Test-Path $alt) -and (Get-FileHash $alt -Algorithm SHA256).Hash -eq $h) { $match = "$($s.Name) (经 app-icon.png)"; break }
    }
    if ($match) { Write-Line "  当前生效    : $match" Green } else {
      # 与原版备份比对
      $orig = Join-Path $originals $primary
      if ((Test-Path $orig) -and (Get-FileHash $orig -Algorithm SHA256).Hash -eq $h) {
        Write-Line '  当前生效    : [官方原版]（与原版备份一致）' Green
      } else {
        Write-Line '  当前生效    : 未知/被外部修改' Yellow
      }
    }
  } else { Write-Line "  当前生效    : 缺少 $primary" Red }
  Write-Line '=====================================' Cyan
}

function Invoke-NewSet([string]$SetName) {
  if (-not $SourceImage) { throw '需要 -SourceImage <源 PNG 路径>' }
  if (-not (Test-Path $SourceImage)) { throw "源图片不存在: $SourceImage" }
  if ($SetName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw '名称只能包含字母、数字、点、下划线、连字符' }
  $set = Join-Path (Join-Path $ToolDir 'icons') $SetName
  if (Test-Path $set) { throw "图标集已存在: $SetName" }
  Add-Type -AssemblyName System.Drawing
  Write-Line "生成图标集 [$SetName]（源: $SourceImage）" Cyan
  New-Item -ItemType Directory -Path $set -Force | Out-Null
  $srcBmp = [System.Drawing.Bitmap]::new($SourceImage)
  if ($DryRun) { $srcBmp.Dispose(); Write-Line '  [dry] 生成图标文件'; return }

  # 先留一份直角母版 source.png：之后可在圆角/直角之间自由切换而不损失质量
  $master = [int][Math]::Min(1024, [Math]::Max(256, [Math]::Max($srcBmp.Width, $srcBmp.Height)))
  Save-Resized $srcBmp $master (Join-Path $set 'source.png')
  $srcBmp.Dispose()
  New-SetImages (Join-Path $set 'source.png') $set
  Write-Line '  已生成：' Green
  Get-ChildItem $set -File | ForEach-Object { Write-Line "    $($_.Name)  ($($_.Length) bytes)" }
}

# ---------- 主流程 ----------
try {
  if ($Action -eq 'new') {
    if (-not $Name) { throw 'new 需要 -Name <图标集名>' }
    Invoke-NewSet $Name
  } elseif ($Action -eq 'reicon') {
    if (-not $Name) { throw 'reicon 需要 -Name <图标集名>（或 all）' }
    Invoke-Reicon $Name
  } else {
    $profile = Get-ProfileByInstall $Install
    switch ($Action) {
      'list' { Show-List $profile }
      'status' { Show-Status $profile }
      'apply' {
        if (-not $Name) { throw 'apply 需要 -Name <图标集名>' }
        Invoke-Apply $profile $Name
      }
      'restore' { Invoke-Restore $profile }
      'backup' { Invoke-Backup $profile }
    }
  }
} catch {
  Write-Line "发生错误：$($_.Exception.Message)" Red
  if ($_.ScriptStackTrace) { Write-Line $_.ScriptStackTrace DarkGray }
  exit 1
}