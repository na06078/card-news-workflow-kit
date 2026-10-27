"""재부팅 이전의 전부 0인 상태 파일만 확인된 이 앱 종료 후 제거합니다."""
import hashlib
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '실행데이터/가독성개선/재개'
HEALTH = ROOT / '실행데이터/앱/작업자상태.json'
PS = str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
EXPECTED_SHA = '97779f7cae716a4243ac78cdd8c051cfbefdd111d26740978dd0f4c962c2aa7d'


def query(script):
    prefix = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';"
    result = subprocess.run([PS, '-NoProfile', '-Command', prefix + script], capture_output=True, encoding='utf-8', timeout=25, check=True)
    return json.loads(result.stdout) if result.stdout.strip() else None


raw = HEALTH.read_bytes()
if len(raw) != 205 or any(raw) or hashlib.sha256(raw).hexdigest() != EXPECTED_SHA:
    raise RuntimeError('EXPECTED_ZERO_FILLED_STATE_REQUIRED')
boot = query("@{utc=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress")
if HEALTH.stat().st_mtime >= datetime.fromisoformat(boot['utc']).timestamp():
    raise RuntimeError('STATE_MUST_PREDATE_BOOT')
with sqlite3.connect((ROOT / '실행데이터/앱/카드뉴스.sqlite').as_uri() + '?mode=ro', uri=True) as db:
    active = db.execute("SELECT count(*) FROM runs WHERE status IN ('queued','running','waiting_for_user','cancel_requested')").fetchone()[0]
    if active or db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
        raise RuntimeError('IDLE_HEALTHY_DATABASE_REQUIRED')
db.close()
runtime_path = ROOT / '실행데이터/연결준비/사용자앱런타임.json'
runtime = json.loads(runtime_path.read_text(encoding='utf-8-sig'))
console = json.loads((ROOT / '실행데이터/연결준비/사용자콘솔.json').read_text(encoding='utf-8-sig'))
ids = [runtime['pid'], runtime['http']['pid'], runtime['worker']['pid'], console['consolePid']]
items = query("Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in @(" + ','.join(map(str, ids)) + ")}|ForEach-Object {[pscustomobject]@{id=$_.ProcessId;parent=$_.ParentProcessId;exe=$_.ExecutablePath;cmd=$_.CommandLine;created=$_.CreationDate.ToUniversalTime().ToString('o')}}|ConvertTo-Json -Compress")
if not isinstance(items, list) or {p['id'] for p in items} != set(ids):
    raise RuntimeError('EXACT_APP_PROCESS_SET_REQUIRED')
entries = dict(zip(ids, ['scripts/개발실행.mjs', 'dist/server/server-main.js', 'dist/server/worker-main.js', 'scripts/사용자앱.ps1']))
node = ROOT / '.도구/node-v24.22.1-win-x64/node.exe'
for p in items:
    if os.path.normcase(os.path.normpath(p['exe'])) != os.path.normcase(os.path.normpath(PS if p['id'] == ids[3] else str(node))):
        raise RuntimeError('APP_EXECUTABLE_IDENTITY_MISMATCH')
    if entries[p['id']] not in p['cmd'].replace(chr(92), '/'):
        raise RuntimeError('APP_ENTRYPOINT_MISMATCH')
    if p['id'] in ids[1:3] and p['parent'] != ids[0]:
        raise RuntimeError('APP_CHILD_OWNER_MISMATCH')
# 원시 명령행은 저장하지 않고 종료 직전 신원 대조에만 사용합니다.
for pid in [ids[0], ids[2], ids[1], ids[3]]:
    p = next(p for p in items if p['id'] == pid)
    encoded = json.dumps(p, ensure_ascii=True).replace("'", "''")
    query("$e='" + encoded + "'|ConvertFrom-Json;$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$e.id);if($p){if($p.ExecutablePath -ne $e.exe -or $p.CommandLine -ne $e.cmd -or $p.CreationDate.ToUniversalTime().ToString('o') -ne $e.created){throw 'APP_PID_REUSED'};Stop-Process -Id $e.id;Start-Sleep -Milliseconds 300}")
remaining = query("@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in @(" + ','.join(map(str, ids)) + ")}|Select-Object -ExpandProperty ProcessId)|ConvertTo-Json -Compress")
if remaining:
    raise RuntimeError('OLD_APP_STILL_RUNNING')
for port in [5173, 8765]:
    try:
        connection = socket.create_connection(('127.0.0.1', port), timeout=1)
    except OSError:
        continue
    connection.close()
    raise RuntimeError('APP_PORT_STILL_OPEN')
if HEALTH.read_bytes() != raw:
    raise RuntimeError('STATE_CHANGED_DURING_REPAIR')
HEALTH.unlink()
conhost = Path(os.environ['SystemRoot']) / 'System32/conhost.exe'
launched = subprocess.Popen([str(conhost), PS, '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / 'scripts/사용자앱.ps1')], cwd=ROOT, close_fds=True, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
for _ in range(60):
    time.sleep(.4)
    try:
        current = json.loads(HEALTH.read_text(encoding='utf-8'))
        new_runtime = json.loads(runtime_path.read_text(encoding='utf-8-sig'))
        if current['state'] == 'ready' and new_runtime['pid'] != runtime['pid']:
            break
    except (OSError, ValueError):
        continue
else:
    raise RuntimeError('NEW_WORKER_NOT_READY')
record = {'at': datetime.now(timezone.utc).isoformat(), 'oldAppPids': ids, 'originalStateBytes': len(raw), 'originalStateAllZero': True, 'originalStateSha256': EXPECTED_SHA, 'statePredatesBoot': True, 'activeBefore': active, 'exactAppStopped': True, 'newController': new_runtime['pid'], 'newHttp': new_runtime['http']['pid'], 'newWorker': new_runtime['worker']['pid'], 'conhostPid': launched.pid, 'workerState': current['state'], 'checkedAt': current['checkedAt'], 'databaseWrittenDirectly': False, 'backupCreated': False}
(OUT / '작업자복구.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(record, ensure_ascii=True))
