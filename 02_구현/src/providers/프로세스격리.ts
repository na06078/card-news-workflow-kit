import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
/** Windows Job은 명시적으로 시작한 전용 앱 worker 자신에게만 할당합니다.
 * 이 모듈 import/factory에는 부작용 없음. 이후 자식/후손은 OS가 동일 Job에 상속.
 * 별도 소유 helper의 핸들이 사라지면 해당 Job만 정리. Hermes/부모/기존 서비스는 미포함. */
let scope:{process:ChildProcessWithoutNullStreams;request:(command:string)=>Promise<number[]>}|undefined;
const script=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
try {
 $parent=[int]$env:CARDNEWS_JOB_OWNER_PID
 $self=Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
 $owner=Get-CimInstance Win32_Process -Filter "ProcessId = $parent"
 if($self.ParentProcessId -ne $parent -or $owner.ExecutablePath -ne $env:CARDNEWS_JOB_OWNER_EXE){throw 'OWNER_MISMATCH'}
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CardNewsOwnedJob {
 [StructLayout(LayoutKind.Sequential)] struct Basic {public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
 [StructLayout(LayoutKind.Sequential)] struct Io {public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount;}
 [StructLayout(LayoutKind.Sequential)] struct Extended {public Basic BasicLimitInformation;public Io IoInfo;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,IntPtr info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,IntPtr info,uint length,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint rights,bool inherit,int pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static IntPtr job;
 static void Limits(uint flags){var value=new Extended();value.BasicLimitInformation.LimitFlags=flags;int size=Marshal.SizeOf(value);var p=Marshal.AllocHGlobal(size);try{Marshal.StructureToPtr(value,p,false);if(!SetInformationJobObject(job,9,p,(uint)size))throw new Exception("JOB_LIMIT_"+Marshal.GetLastWin32Error());}finally{Marshal.FreeHGlobal(p);}}
 public static void Start(int pid){job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Exception("JOB_CREATE");Limits(0x2000);var p=OpenProcess(0x101,true,pid);try{if(p==IntPtr.Zero||!AssignProcessToJobObject(job,p))throw new Exception("JOB_ASSIGN_"+Marshal.GetLastWin32Error());}finally{if(p!=IntPtr.Zero)CloseHandle(p);}}
 public static int[] Members(){int bytes=8+IntPtr.Size*4096;var p=Marshal.AllocHGlobal(bytes);try{if(!QueryInformationJobObject(job,3,p,(uint)bytes,IntPtr.Zero))throw new Exception("JOB_QUERY");int count=Marshal.ReadInt32(p,4);if(count<0||count>4096)throw new Exception("JOB_COUNT");int[] ids=new int[count];for(int i=0;i<count;i++)ids[i]=(int)Marshal.ReadIntPtr(p,8+i*IntPtr.Size);return ids;}finally{Marshal.FreeHGlobal(p);}}
 public static void CloseEmpty(int owner){var ids=Members();if(ids.Length!=1||ids[0]!=owner)throw new Exception("JOB_NOT_EMPTY");Limits(0);CloseHandle(job);job=IntPtr.Zero;}
}
'@
 [CardNewsOwnedJob]::Start($parent)
 [Console]::WriteLine('{"type":"ready"}')
 while($null -ne ($line=[Console]::ReadLine())) {
  if($line -eq 'inspect') { $ids=@([CardNewsOwnedJob]::Members());[Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{type='members';pids=$ids})) }
  elseif($line -eq 'close') { [CardNewsOwnedJob]::CloseEmpty($parent);[Console]::WriteLine('{"type":"closed","pids":[]}');break }
  else {throw 'UNKNOWN_COMMAND'}
 }
} catch { [Console]::Error.WriteLine('OWNED_JOB_UNAVAILABLE');exit 1 }
`;
export async function initializeOwnedScope():Promise<void>{
 if(scope)return;
 if(process.platform!=='win32')throw Error('OWNED_JOB_WINDOWS_REQUIRED');
 const env:NodeJS.ProcessEnv={};for(const [key,value]of Object.entries(process.env))if(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','HOME','APPDATA','LOCALAPPDATA'].includes(key.toUpperCase()))env[key]=value;
 env.CARDNEWS_JOB_OWNER_PID=String(process.pid);env.CARDNEWS_JOB_OWNER_EXE=process.execPath;
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
 let stopped=false;let pending:{resolve:(pids:number[])=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
 let readyResolve!:()=>void,readyReject!:(e:Error)=>void;
 const ready=new Promise<void>((r,j)=>{readyResolve=r;readyReject=j;});
 const fail=()=>{stopped=true;readyReject(Error('OWNED_JOB_UNAVAILABLE'));if(pending){clearTimeout(pending.timer);pending.reject(Error('OWNED_JOB_UNAVAILABLE'));pending=undefined;}};
 const lines=createInterface({input:child.stdout});
 lines.on('line',line=>{try{const data=JSON.parse(line);if(data.type==='ready')readyResolve();else if(['members','closed'].includes(data.type)&&Array.isArray(data.pids)&&data.pids.every((p:unknown)=>Number.isSafeInteger(p))){const p=pending;pending=undefined;if(p){clearTimeout(p.timer);p.resolve(data.pids);}}else fail();}catch{fail();}});
 child.once('error',fail);child.once('close',fail);child.stderr.resume();
 const timer=setTimeout(()=>{readyReject(Error('OWNED_JOB_TIMEOUT'));child.stdin.end();},15000);
 try{await ready;}finally{clearTimeout(timer);}
 scope={process:child,request:command=>new Promise<number[]>((resolve,reject)=>{
  if(stopped||pending){reject(Error('OWNED_JOB_UNAVAILABLE'));return;}
  const timer=setTimeout(()=>{pending=undefined;reject(Error('OWNED_JOB_TIMEOUT'));},5000);
  pending={resolve,reject,timer};child.stdin.write(command+'\n',error=>{if(error)fail();});
 })};
}
/** true는 OS Job의 유일한 생존 멤버가 이 전용 worker임을 확인한 경우뿐. */
export async function ownedDescendantsExited():Promise<boolean|null>{
 if(!scope)return null;
 try{const pids=await scope.request('inspect');return pids.length===1&&pids[0]===process.pid;}catch{return null;}
}
/** 자식 생성 시점부터 같은 Job인지 묶음. 사후 attach 증거로 대체 금지. */
export function captureDescendantCheck():()=>Promise<boolean|null>{const original=scope;return ()=>original&&scope===original?ownedDescendantsExited():Promise.resolve(null);}
export async function closeOwnedScope():Promise<void>{
 if(!scope)return;const current=scope;
 await current.request('close');current.process.stdin.end();scope=undefined;
 await new Promise<void>((resolve,reject)=>{if(current.process.exitCode!==null){current.process.exitCode===0?resolve():reject(Error('OWNED_JOB_CLOSE_FAILED'));return;}current.process.once('close',code=>code===0?resolve():reject(Error('OWNED_JOB_CLOSE_FAILED')));});
}
