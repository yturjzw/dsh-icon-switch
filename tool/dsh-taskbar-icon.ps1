#requires -Version 5.1
<#
.SYNOPSIS
  任务栏图标运行时助手：用 Windows API（WM_SETICON）把已运行窗口的任务栏图标改成自定义 .ico。
  适用场景：DeepSeek Harness 正式版等打包安装（任务栏图标来自 exe 内嵌，无法直接替换文件）。

.DESCRIPTION
  - 默认 Watch 模式：循环检测目标进程的主窗口，出现即设置任务栏图标（可注册为开机自启，覆盖每次启动）。
  - -Once：只在当前设置一次（进程窗口存在则立即生效，不存在则提示后退出）。
  - 恢复原状：把 -Icon 传 exe 路径即可（LoadImage 会加载 exe 内嵌的原始图标）。

.EXAMPLE
  .\dsh-taskbar-icon.ps1 -Icon "C:\...\icons\sample-blue\app-icon.ico" -Once
  .\dsh-taskbar-icon.ps1 -Icon "C:\...\icons\sample-blue\app-icon.ico" -ProcessName "DeepSeek Harness" -Seconds 10
  .\dsh-taskbar-icon.ps1 -Icon "D:\Software\DeepSeek Harness\DeepSeek Harness.exe" -Once   # 恢复 exe 原图标
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Icon,
  [string]$ProcessName = 'DeepSeek Harness',
  [switch]$Once,
  [int]$Seconds = 8
)

$ErrorActionPreference = 'Stop'

try {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class DshTaskbarIconApi
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    private static readonly Dictionary<string, IntPtr> IconCache = new Dictionary<string, IntPtr>();

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadImage(IntPtr hinst, string lpszName, uint type, int cx, int cy, uint fuLoad);

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    private const uint IMAGE_ICON = 1;
    private const uint LR_LOADFROMFILE = 0x10;
    private const uint WM_SETICON = 0x80;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    /// 在指定进程的顶层窗口中找可见、有标题且面积最大的主窗口。
    public static IntPtr FindMainWindow(uint pid)
    {
        IntPtr best = IntPtr.Zero;
        long bestArea = 0;
        EnumWindows((hWnd, lParam) =>
        {
            uint wp;
            GetWindowThreadProcessId(hWnd, out wp);
            if (wp == pid && IsWindowVisible(hWnd) && GetWindowTextLength(hWnd) > 0)
            {
                RECT r;
                if (GetWindowRect(hWnd, out r))
                {
                    long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
                    if (area >= bestArea) { bestArea = area; best = hWnd; }
                }
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    /// 把窗口大小图标改为指定文件（.ico 或 .exe，供恢复原 exe 图标）里的图标。
    public static bool SetWindowIcon(IntPtr hWnd, string iconPath)
    {
        IntPtr hIcon;
        if (!IconCache.TryGetValue(iconPath, out hIcon))
        {
            hIcon = LoadImage(IntPtr.Zero, iconPath, IMAGE_ICON, 0, 0, LR_LOADFROMFILE);
            if (hIcon == IntPtr.Zero) return false;
            IconCache[iconPath] = hIcon;   // 缓存句柄，避免重复加载/泄漏；进程退出时由系统回收
        }
        if (hWnd == IntPtr.Zero) return false;
        SendMessage(hWnd, WM_SETICON, (IntPtr)1, hIcon);
        SendMessage(hWnd, WM_SETICON, (IntPtr)0, hIcon);
        return true;
    }
}
'@
} catch {
  # 同一会话重复运行时类型已存在，忽略
  if ($_.Exception.Message -notmatch 'already exists|已存在') { throw }
}

$targetPids = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | ForEach-Object { [uint32]$_ })

function Get-MainWindowHandle {
  foreach ($procId in $targetPids) {
    $h = [DshTaskbarIconApi]::FindMainWindow($procId)
    if ($h -ne [IntPtr]::Zero) { return $h }
  }
  return [IntPtr]::Zero
}

if (-not (Test-Path $Icon)) { Write-Error "图标文件不存在: $Icon"; exit 1 }

if ($Once) {
  if ($targetPids.Count -eq 0) { Write-Host "[$ProcessName] 未在运行，跳过。"; exit 0 }
  $hwnd = Get-MainWindowHandle
  if ($hwnd -eq [IntPtr]::Zero) { Write-Host "[$ProcessName] 未找到主窗口，跳过。"; exit 0 }
  if ([DshTaskbarIconApi]::SetWindowIcon($hwnd, $Icon)) { Write-Host "已设置任务栏图标: $Icon" } else { Write-Error "图标加载失败: $Icon"; exit 1 }
} else {
  Write-Host "Watch 模式：监听 [$ProcessName]（图标 $Icon），每 $Seconds 秒检查一次。Ctrl+C 退出。"
  while ($true) {
    try {
      $pids = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | ForEach-Object { [uint32]$_ })
      if ($pids.Count -gt 0) {
        $hwnd = $null
        foreach ($procId in $pids) {
          $h = [DshTaskbarIconApi]::FindMainWindow($procId)
          if ($h -ne [IntPtr]::Zero) { $hwnd = $h; break }
        }
        if ($hwnd -ne $null -and $hwnd -ne [IntPtr]::Zero) { [void][DshTaskbarIconApi]::SetWindowIcon($hwnd, $Icon) }
      }
    } catch { }
    Start-Sleep -Seconds $Seconds
  }
}