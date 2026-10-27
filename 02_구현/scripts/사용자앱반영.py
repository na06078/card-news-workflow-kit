"""이 프로젝트의 확인된 서버만 교체하고 데이터/자산 무변경을 검사합니다."""
import ctypes
import hashlib
import json
import os
import socket
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import urllib.request
from contextlib import closing
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
OUT = (ROOT / os.environ.get("CARDNEWS_APP_APPLY_EVIDENCE_DIR", "실행데이터/실사용검수복구")).resolve()
if not OUT.is_relative_to((ROOT / "실행데이터").resolve()):
    raise RuntimeError("EVIDENCE_OUTSIDE_PROJECT_DATA")
DATA = ROOT / "실행데이터/앱"
PS = str(Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe")
sys.stdout.reconfigure(encoding="utf-8")
OUT.mkdir(parents=True, exist_ok=True)

def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")

def ps(script):
    prefix = "$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';"
    result = subprocess.run([PS, "-NoProfile", "-Command", prefix + script], capture_output=True, encoding="utf-8", timeout=30)
    if result.returncode:
        raise RuntimeError("APP_PROCESS_CHECK_FAILED:" + str(result.returncode))
    return json.loads(result.stdout) if result.stdout.strip() else None

def snapshot():
    with closing(sqlite3.connect((DATA / "카드뉴스.sqlite").as_uri() + "?mode=ro", uri=True)) as db:
        db.execute("BEGIN")
        tables = {}
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
            rows = db.execute('SELECT * FROM "' + name.replace('"', '""') + '"').fetchall()
            encoded = sorted(json.dumps(row, ensure_ascii=True, default=lambda x: x.hex()) for row in rows)
            tables[name] = {"rows": len(rows), "sha256": hashlib.sha256("\n".join(encoded).encode()).hexdigest()}
        assets = {}
        for aid, stored in db.execute("SELECT id,path FROM assets"):
            file = Path(stored)
            file = (file if file.is_absolute() else DATA / file).resolve()
            if not file.is_relative_to(DATA.resolve()):
                raise RuntimeError("ASSET_PATH_OUTSIDE_APP")
            assets[aid] = hashlib.sha256(file.read_bytes()).hexdigest()
        active = db.execute("SELECT count(*) FROM runs WHERE status IN (?,?,?,?)", ("queued", "running", "waiting_for_user", "cancel_requested")).fetchone()[0]
        return {"at": datetime.now(timezone.utc).isoformat(), "quickCheck": db.execute("PRAGMA quick_check").fetchone()[0], "tables": tables, "assets": assets, "active": active}

before = snapshot()
if before["active"] or before["quickCheck"] != "ok":
    raise RuntimeError("APP_NOT_IDLE_OR_INTEGRITY_FAILED")
save("적용전_무결성.json", before)
runtime_path = ROOT / "실행데이터/연결준비/사용자앱런타임.json"
runtime = json.loads(runtime_path.read_text(encoding="utf-8-sig"))
console = json.loads((ROOT / "실행데이터/연결준비/사용자콘솔.json").read_text(encoding="utf-8-sig"))
ids = [runtime["pid"], runtime["http"]["pid"], runtime["worker"]["pid"], console["consolePid"]]
query = "Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -in @(" + ",".join(map(str, ids)) + ")} | ForEach-Object { [pscustomobject]@{id=$_.ProcessId;parent=$_.ParentProcessId;exe=$_.ExecutablePath;cmd=$_.CommandLine;created=$_.CreationDate.ToUniversalTime().ToString('o')} } | ConvertTo-Json -Compress"
processes = ps(query)
if not isinstance(processes, list) or {p["id"] for p in processes} != set(ids):
    raise RuntimeError("APP_PROCESS_SET_CHANGED")
node = str(ROOT / ".도구/node-v24.22.1-win-x64/node.exe")
entrypoints = {ids[0]: "scripts/개발실행.mjs", ids[1]: "dist/server/server-main.js", ids[2]: "dist/server/worker-main.js", ids[3]: "scripts/사용자앱.ps1"}
for p in processes:
    cmd = p["cmd"].replace("\\", "/")
    expected_exe = PS if p["id"] == ids[3] else node
    if os.path.normcase(p["exe"]) != os.path.normcase(expected_exe) or entrypoints[p["id"]] not in cmd:
        raise RuntimeError("APP_PROCESS_IDENTITY_MISMATCH")
    if p["id"] in ids[1:3] and p["parent"] != ids[0]:
        raise RuntimeError("APP_CHILD_OWNER_MISMATCH")
if next(p for p in processes if p["id"] == ids[0])["parent"] != ids[3]:
    raise RuntimeError("APP_CONTROLLER_OWNER_MISMATCH")
save("적용_소유프로세스.json", processes)
stop_only = "--stop-only" in sys.argv
print(json.dumps({"mode": "stop" if stop_only else "apply" if "--apply" in sys.argv else "check", "verifiedAppPids": ids, "active": before["active"], "tables": len(before["tables"]), "assets": len(before["assets"])}), flush=True)
if "--apply" not in sys.argv and not stop_only:
    sys.exit(0)
if snapshot()["active"]:
    raise RuntimeError("APP_BECAME_BUSY")
# 모든 PID를 실제 실행 파일·진입점·생성시각에 다시 결합합니다. 이름/와일드카드 종료는 없습니다.
script = "$items=Get-Content -LiteralPath '" + str(OUT / "적용_소유프로세스.json").replace("'", "''") + "' -Raw -Encoding UTF8|ConvertFrom-Json;"
script += "$order=@(" + ",".join(map(str, [ids[0], ids[2], ids[1], ids[3]])) + ");foreach($id in $order){$e=$items|Where-Object {$_.id -eq $id};$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$id);if($p){if($p.ExecutablePath -ne $e.exe -or $p.CommandLine -ne $e.cmd -or $p.CreationDate.ToUniversalTime().ToString('o') -ne $e.created){throw 'APP_PID_REUSED'};Stop-Process -Id $id -ErrorAction Stop;Start-Sleep -Milliseconds 400}};@{stopped=$order}|ConvertTo-Json -Compress"
save("적용_종료결과.json", ps(script))
for port in (5173, 8765):
    try:
        connection = socket.create_connection(("127.0.0.1", port), timeout=1)
    except OSError:
        continue
    connection.close()
    raise RuntimeError("APP_PORT_STILL_LISTENING")
if stop_only:
    after = snapshot()
    result = {"stoppedAppPids": ids, "tablesUnchanged": before["tables"] == after["tables"], "assetsUnchanged": before["assets"] == after["assets"], "quickCheck": after["quickCheck"], "active": after["active"]}
    save("앱중단결과.json", result)
    print(json.dumps(result), flush=True)
    if not result["tablesUnchanged"] or not result["assetsUnchanged"] or result["active"]:
        raise RuntimeError("APP_DATA_CHANGED_DURING_STOP")
    sys.exit(0)
conhost = Path(os.environ["SystemRoot"]) / "System32/conhost.exe"
launched = subprocess.Popen([str(conhost), PS, "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts/사용자앱.ps1")], cwd=ROOT, close_fds=True, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
for _ in range(40):
    time.sleep(0.5)
    try:
        current = json.loads(runtime_path.read_text(encoding="utf-8-sig"))
        if current["pid"] == runtime["pid"]:
            continue
        with urllib.request.urlopen("http://127.0.0.1:5173/", timeout=1) as response:
            if response.status == 200:
                break
    except (OSError, ValueError):
        pass
else:
    raise RuntimeError("APP_RESTART_NOT_READY")
after = snapshot()
result = {"beforePids": ids, "newRuntimePid": current["pid"], "newHttpPid": current["http"]["pid"], "newWorkerPid": current["worker"]["pid"], "conhostPid": launched.pid, "http": 200, "quickCheck": after["quickCheck"], "tablesUnchanged": before["tables"] == after["tables"], "assetsUnchanged": before["assets"] == after["assets"], "active": after["active"]}
save("적용후_무결성.json", after)
save("앱반영결과.json", result)
print(json.dumps(result), flush=True)
if not result["tablesUnchanged"] or not result["assetsUnchanged"] or result["active"]:
    raise RuntimeError("APP_DATA_CHANGED_DURING_APPLY")
