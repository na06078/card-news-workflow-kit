import {test,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
const exec=promisify(execFile),script=resolve('scripts/계정콘솔제어.ps1'); // execFile + argument arrays, no shell interpolation.
const base=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script];
test('인증용 별도 콘솔은 화면 없는 PseudoConsoleWindow가 아닌 실제 Windows 콘솔이다',async()=>{
 const executable=process.execPath;
 const launched=await exec('powershell.exe',[...base,'-Action','launch','-Executable',executable,'-WorkDirectory',process.cwd()],{timeout:15000,windowsHide:true});
 const target=JSON.parse(launched.stdout.replace(/^\uFEFF/,''));
 const args=['-Executable',executable,'-OwnedPid',String(target.pid),'-CreatedAt',target.createdAt];
 try{
  const probe=String.raw`Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class ConsoleKind { [DllImport("kernel32.dll")] public static extern bool FreeConsole(); [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid); [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd,StringBuilder text,int count); }'; [ConsoleKind]::FreeConsole()|Out-Null; [ConsoleKind]::AttachConsole(${target.pid})|Out-Null; $text=New-Object Text.StringBuilder 256; [ConsoleKind]::GetClassName([ConsoleKind]::GetConsoleWindow(),$text,256)|Out-Null; [ConsoleKind]::FreeConsole()|Out-Null; $text.ToString()`;
  const result=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',probe],{timeout:15000,windowsHide:true});
  expect(result.stdout.trim()).toBe('ConsoleWindowClass');
 }finally{await exec('powershell.exe',[...base,'-Action','stop',...args],{timeout:15000,windowsHide:true});}
},60000);
test('실제 Win32 소유 콘솔 fixture는 exe·생성시각 불일치 종료를 거부하고 정확한 대상만 종료한다',async()=>{
 // Only a new node REPL fixture, never agy/Claude/Hermes or a model request.
 const executable=process.execPath;
 const result=await exec('powershell.exe',[...base,'-Action','launch','-Executable',executable,'-WorkDirectory',process.cwd()],{timeout:15000,windowsHide:true});
 const target=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
 expect(target.pid).toBeGreaterThan(0);expect(target.executable.toLowerCase()).toBe(executable.toLowerCase());
 const args=['-Executable',executable,'-OwnedPid',String(target.pid),'-CreatedAt',target.createdAt];
 try{
  await expect(exec('powershell.exe',[...base,'-Action','stop',...args.slice(0,-1),(BigInt(target.createdAt)-1n).toString()],{timeout:15000,windowsHide:true})).rejects.toThrow();
  await expect(exec('powershell.exe',[...base,'-Action','stop','-Executable',executable+'.wrong','-OwnedPid',String(target.pid),'-CreatedAt',target.createdAt],{timeout:15000,windowsHide:true})).rejects.toThrow();
  const alive=await exec('powershell.exe',[...base,'-Action','inspect',...args],{timeout:15000,windowsHide:true});expect(JSON.parse(alive.stdout).alive).toBe(true);
  // Fixed /logout input goes ONLY to this new Node REPL, not a provider.
  const input=await exec('powershell.exe',[...base,'-Action','logout',...args],{timeout:15000,windowsHide:true});expect(JSON.parse(input.stdout).sent).toBe(true);
 }finally{
  const stopped=await exec('powershell.exe',[...base,'-Action','stop',...args],{timeout:15000,windowsHide:true});expect(JSON.parse(stopped.stdout).alive).toBe(false);
 }
},60000);
