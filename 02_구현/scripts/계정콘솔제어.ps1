param(
 [Parameter(Mandatory=$true)][ValidateSet('launch','inspect','stop','logout')][string]$Action,
 [Parameter(Mandatory=$true)][string]$Executable,
 [string]$WorkDirectory,
 [int]$OwnedPid=0,
 [string]$CreatedAt
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
if($Action -eq 'launch') {
 # A hidden/ConPTY parent can otherwise create only a PseudoConsoleWindow.
 # The Windows-provided host guarantees a separate, actually visible console.
 $consoleHost=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\conhost.exe') -ArgumentList @('"'+$Executable+'"') -WorkingDirectory $WorkDirectory -WindowStyle Normal -PassThru
 $p=$null
 try {
  $deadline=[DateTime]::UtcNow.AddSeconds(5)
  do {
   $candidate=Get-CimInstance Win32_Process -Filter "ParentProcessId = $($consoleHost.Id)" | Where-Object { $_.ExecutablePath -and [string]::Equals([IO.Path]::GetFullPath($_.ExecutablePath),[IO.Path]::GetFullPath($Executable),[StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
   if($candidate){$p=[Diagnostics.Process]::GetProcessById([int]$candidate.ProcessId);break}
   if($consoleHost.HasExited){throw 'OWNED_CONSOLE_EXITED'}
   Start-Sleep -Milliseconds 50
  }while([DateTime]::UtcNow -lt $deadline)
  if($null -eq $p){throw 'OWNED_CONSOLE_START_TIMEOUT'}
  $null=$p.Handle
  if($p.HasExited){throw 'OWNED_CONSOLE_EXITED'}
  $path=$p.MainModule.FileName
  if(-not [string]::Equals([IO.Path]::GetFullPath($path),[IO.Path]::GetFullPath($Executable),[StringComparison]::OrdinalIgnoreCase)){throw 'OWNED_CONSOLE_IDENTITY_MISMATCH'}
  @{pid=$p.Id;executable=$path;createdAt=$p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()} | ConvertTo-Json -Compress
 } catch {
  # This is the exact newly created host object, not a process-name lookup.
  if(-not $consoleHost.HasExited){$consoleHost.Kill();$null=$consoleHost.WaitForExit(3000)}
  throw
 } finally {if($null -ne $p){$p.Dispose()};$consoleHost.Dispose()}
 exit 0
}
if($OwnedPid -le 0 -or $CreatedAt -notmatch '^\d{16,20}$'){throw 'OWNED_CONSOLE_IDENTITY_REQUIRED'}
try {$p=[Diagnostics.Process]::GetProcessById($OwnedPid)}catch [ArgumentException] {
 @{alive=$false} | ConvertTo-Json -Compress
 exit 0
}
try {
 # Retain the exact process handle across validation and action; PID reuse is not authority.
 $handle=$p.Handle
 if($p.HasExited){@{alive=$false}|ConvertTo-Json -Compress;exit 0}
 if(-not [string]::Equals([IO.Path]::GetFullPath($p.MainModule.FileName),[IO.Path]::GetFullPath($Executable),[StringComparison]::OrdinalIgnoreCase) -or $p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -ne $CreatedAt){throw 'OWNED_CONSOLE_IDENTITY_MISMATCH'}
 if($Action -eq 'inspect'){@{alive=$true}|ConvertTo-Json -Compress;exit 0}
 if($Action -eq 'stop'){
  $p.Kill()
  if(-not $p.WaitForExit(3000)){throw 'OWNED_CONSOLE_CLEANUP_UNCONFIRMED'}
  @{alive=$false}|ConvertTo-Json -Compress
  exit 0
 }
 Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class CardNewsOwnedConsole {
 [StructLayout(LayoutKind.Explicit, Size=20, CharSet=CharSet.Unicode)]
 public struct InputRecord {
  [FieldOffset(0)] public ushort EventType;
  [FieldOffset(4)] public int KeyDown;
  [FieldOffset(8)] public ushort Repeat;
  [FieldOffset(10)] public ushort VirtualKey;
  [FieldOffset(12)] public ushort ScanCode;
  [FieldOffset(14)] public char Character;
  [FieldOffset(16)] public uint ControlState;
 }
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool FreeConsole();
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool AttachConsole(uint pid);
 [DllImport("kernel32.dll", SetLastError=true)] static extern uint GetConsoleProcessList([Out] uint[] list,uint length);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll", EntryPoint="WriteConsoleInputW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool WriteConsoleInput(IntPtr input,InputRecord[] records,uint length,out uint written);
 public static void FixedLogout(uint pid,IntPtr ownedHandle) {
  FreeConsole();
  if(!AttachConsole(pid))throw new Win32Exception(Marshal.GetLastWin32Error());
  IntPtr input=new IntPtr(-1);
  try {
   uint[] processes=new uint[16];uint count=GetConsoleProcessList(processes,(uint)processes.Length);
   if(count==0 || count>2)throw new InvalidOperationException("OWNED_CONSOLE_SHARED");
   uint self=(uint)System.Diagnostics.Process.GetCurrentProcess().Id;
   bool found=false;
   for(int i=0;i<count;i++){if(processes[i]==pid)found=true;else if(processes[i]!=self)throw new InvalidOperationException("OWNED_CONSOLE_SHARED");}
   if(!found || WaitForSingleObject(ownedHandle,0)!=258)throw new InvalidOperationException("OWNED_CONSOLE_EXITED");
   input=CreateFile("CONIN$",0xC0000000,3,IntPtr.Zero,3,0,IntPtr.Zero);
   if(input==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());
   // No text argument exists: this bridge can send only the official TUI logout.
   const string command="/logout\r";
   InputRecord[] records=new InputRecord[command.Length*2];
   for(int i=0;i<command.Length;i++){
    InputRecord key=new InputRecord();key.EventType=1;key.KeyDown=1;key.Repeat=1;key.Character=command[i];key.VirtualKey=command[i]=='\r'?(ushort)13:(ushort)0;
    records[i*2]=key;key.KeyDown=0;records[i*2+1]=key;
   }
   uint written;
   if(!WriteConsoleInput(input,records,(uint)records.Length,out written) || written!=records.Length)throw new Win32Exception(Marshal.GetLastWin32Error());
  }finally{if(input!=new IntPtr(-1))CloseHandle(input);FreeConsole();}
 }
}
'@
 [CardNewsOwnedConsole]::FixedLogout([uint32]$OwnedPid,$handle)
 @{sent=$true}|ConvertTo-Json -Compress
} finally {$p.Dispose()}
