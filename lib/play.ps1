param(
  [Parameter(Mandatory = $true)][string]$Path
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path -LiteralPath $Path)) { Write-Error "找不到音频：$Path"; exit 1 }

$mciCode = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class SovitsPlayer {
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
  static extern int mciSendString(string cmd, StringBuilder ret, int len, IntPtr hwnd);
  static string Run(string cmd) {
    var sb = new StringBuilder(256);
    mciSendString(cmd, sb, 256, IntPtr.Zero);
    return sb.ToString();
  }
  public static void PlayWait(string path, string type) {
    Run("close sovitsplay");
    string openCommand = "open \"" + path + "\" type " + type + " alias sovitsplay";
    var sb = new StringBuilder(256);
    mciSendString(openCommand, sb, 256, IntPtr.Zero);
    mciSendString("play sovitsplay wait", sb, 256, IntPtr.Zero);
    mciSendString("close sovitsplay", sb, 256, IntPtr.Zero);
  }
}
'@
if (-not ('SovitsPlayer' -as [type])) { Add-Type -TypeDefinition $mciCode -Language CSharp }

$bytes = [IO.File]::ReadAllBytes($Path)
$type = if ($bytes.Length -gt 12 -and $bytes[0] -eq 0x52 -and $bytes[1] -eq 0x49 -and $bytes[2] -eq 0x46 -and $bytes[3] -eq 0x46) { 'waveaudio' } else { 'mpegvideo' }
[SovitsPlayer]::PlayWait($Path, $type)
exit 0
