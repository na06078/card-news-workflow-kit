"""검증된 자연 종료 경합의 낡은 실행 잠금만 이전 OS 소유자 종료 후 복구합니다."""
import hashlib,json,os,sqlite3,subprocess,sys,time,uuid
from pathlib import Path
from contextlib import closing
ROOT=Path(__file__).resolve().parent.parent
DATA=ROOT/'실행데이터/앱'
OUT=ROOT/'실행데이터/실사용검수복구/종료실측'
RUN=sys.argv[1]
if str(uuid.UUID(RUN))!=RUN:raise RuntimeError('INVALID_RUN_ID')
PS=str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe')
def ps(script):
 p=subprocess.run([PS,'-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';"+script],capture_output=True,encoding='utf-8',timeout=20)
 if p.returncode:raise RuntimeError('PROCESS_PROOF_FAILED')
 return json.loads(p.stdout) if p.stdout.strip() else []
with closing(sqlite3.connect((DATA/'카드뉴스.sqlite').as_uri()+'?mode=ro',uri=True)) as db:
 row=db.execute('SELECT payload FROM runs WHERE id=?',(RUN,)).fetchone()
 r=json.loads(row[0]) if row else None
 if not r or r['projectId']!='43daccac-2d26-4db1-bdd7-3b0e6416cd55' or r['status']!='failed' or r['error']['code']!='CANCEL_CLEANUP_FAILED':raise RuntimeError('KNOWN_FAILED_RUN_REQUIRED')
 if db.execute("SELECT count(*) FROM runs WHERE status IN ('queued','running','waiting_for_user','cancel_requested')").fetchone()[0]:raise RuntimeError('RUN_ACTIVE')
diag=json.loads((DATA/f"projects/{r['projectId']}/attempts/{RUN}/1/semantic-review/검수진단.json").read_text(encoding='utf-8'))
if not(diag['terminalReceived'] and diag['nativeExitObserved'] and diag['exitCode']==0 and not diag['protocolFailed']):raise RuntimeError('NATIVE_SUCCESS_PROOF_REQUIRED')
green=json.loads((OUT/'자연종료경합_GREEN.json').read_text(encoding='utf-8'))
if not(green['actual_os_test'] and green['jobEmpty'] and green['report']['status']=='confirmed'):raise RuntimeError('FIX_REAL_OS_PROOF_REQUIRED')
runtime=json.loads((ROOT/'실행데이터/연결준비/사용자앱런타임.json').read_text(encoding='utf-8-sig'))
worker=runtime['worker']['pid']
query=f"$all=Get-CimInstance Win32_Process;$ids=@({worker});do{{$new=@($all|Where-Object {{$_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids}}|ForEach-Object {{$_.ProcessId}});$ids+=$new}}while($new.Count);@($all|Where-Object {{$_.ProcessId -in $ids}}|ForEach-Object {{[pscustomobject]@{{id=$_.ProcessId;parent=$_.ParentProcessId;exe=$_.ExecutablePath;created=$_.CreationDate.ToUniversalTime().ToString('o');scopeHelper=($_.CommandLine -like '*CardNewsOwnedJob*')}}}})|ConvertTo-Json -Compress"
old=ps(query)
if not any(p['id']==worker for p in old) or not any(p['scopeHelper'] and p['parent']==worker for p in old):raise RuntimeError('OWNED_JOB_HELPER_PROOF_REQUIRED')
health=DATA/'작업자상태.json'
raw=health.read_bytes();before=json.loads(raw)
if before['reason']!='CANCEL_CLEANUP_FAILED' or before['state']!='unavailable':raise RuntimeError('EXPECTED_RUNTIME_LOCK_REQUIRED')
# 기존 helper는 실행 파일·진입점·생성시각을 다시 확인해 이 앱의 정확한 PID만 종료합니다.
p=subprocess.run([sys.executable,str(ROOT/'scripts/사용자앱반영.py'),'--apply'],cwd=ROOT,timeout=60)
if p.returncode:raise RuntimeError('APP_APPLY_FAILED')
ids=','.join(str(p['id']) for p in old)
for _ in range(30):
 live=ps("@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in @("+ids+")}|ForEach-Object {[pscustomobject]@{id=$_.ProcessId;created=$_.CreationDate.ToUniversalTime().ToString('o')}})|ConvertTo-Json -Compress")
 if not isinstance(live,list):live=[live]
 if not any(a['id']==b.get('id') and a['created']==b.get('created') for a in old for b in live):break
 time.sleep(.2)
else:raise RuntimeError('OLD_EXECUTION_STILL_ALIVE')
if health.read_bytes()!=raw:raise RuntimeError('RUNTIME_OWNER_CHANGED')
# 원래 실패 원장/진단은 바꾸지 않습니다. 죽은 소유자의 readiness 이유만 회복하여 새 소유자가 재획득하게 합니다.
after={**before,'reason':'WORKER_UNAVAILABLE'}
temp=health.with_name(health.name+'.복구.'+str(uuid.uuid4())+'.tmp')
temp.write_text(json.dumps(after),encoding='utf-8');os.replace(temp,health)
for _ in range(50):
 current=json.loads(health.read_text(encoding='utf-8'))
 if current['state']=='ready' and current['token']!=before['token']:break
 time.sleep(.1)
else:raise RuntimeError('NEW_WORKER_NOT_READY')
proof={'runId':RUN,'oldWorker':worker,'oldExecutionTerminated':True,'oldProcessIds':[p['id'] for p in old],'healthBeforeSha256':hashlib.sha256(raw).hexdigest(),'nativeSuccessObserved':True,'realOsRegression':'confirmed','newOwnerAcquired':True,'state':current['state'],'originalFailurePreserved':True}
(OUT/'실행잠금복구.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
