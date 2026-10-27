"""새 결과의 실제 파일을 중단 전 기준과 독립적으로 읽어 대조합니다."""
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from contextlib import closing

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '실행데이터/가독성개선/재개'
DATA = ROOT / '실행데이터/앱'


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(value):
    return hashlib.sha256(value).hexdigest()


def canonical_hash(value):
    return sha(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode())


def protected_view(project):
    return {
        'topic': project['topic'], 'period': project['period'],
        'candidates': project['candidates'], 'claims': project['claims'],
        'sources': project['sources'], 'selectedCandidateIds': project['selectedCandidateIds'],
        'storyboard': project['storyboard'],
        'semanticReview': project['result'].get('semanticReview') if project.get('result') else None,
        'cards': [{key: card.get(key) for key in ['cardId', 'order', 'role', 'title', 'body', 'sourceIds', 'imagePlan', 'imageAssetId']}
                  for card in (project.get('result') or {}).get('cards', [])],
    }


baseline = load(ROOT / '실행데이터/가독성개선/변경전_보존기준.json')
ledger = load(OUT / '반영/접수원장.json')
applied = load(OUT / '반영/반영결과.json')
isolated = load(OUT / '실물/d0fe58ef-7ed6-4347-ab5d-d752f93b9702/실물검증.json')
with closing(sqlite3.connect((DATA / '카드뉴스.sqlite').as_uri() + '?mode=ro', uri=True)) as db:
    db.execute('BEGIN')
    projects = {pid: json.loads(raw) for pid, raw in db.execute('SELECT id,payload FROM projects')}
    target = projects[baseline['projectId']]
    assets = {}
    for asset_id, stored in db.execute('SELECT id,path FROM assets'):
        path = Path(stored)
        path = (path if path.is_absolute() else DATA / path).resolve()
        if not path.is_relative_to(DATA.resolve()):
            raise RuntimeError('ASSET_OUTSIDE_DATA_ROOT')
        assets[asset_id] = sha(path.read_bytes())
    protected = {pid: canonical_hash(protected_view(project)) == baseline['protectedHashes'][pid]
                 for pid, project in projects.items()}
    model_rows = [dict(zip(['project_id', 'model', 'version'], row))
                  for row in db.execute('SELECT project_id,model,version FROM project_model_settings ORDER BY project_id')]
    phases = [json.loads(raw)['phase'] for raw, in db.execute('SELECT payload FROM invocations WHERE run_id=?', (applied['runId'],))]
    new_types = [json.loads(raw)['kind'] for aid, raw in db.execute('SELECT id,payload FROM assets') if aid not in baseline['assets']]
    inspected = {row['order']: row['sha256'] for row in isolated['results']}
    same_png = {card['order']: assets[card['previewAssetId']] == inspected[card['order']]
                for card in target['result']['cards']}
    record = {
        'at': datetime.now(timezone.utc).isoformat(),
        'projectVersion': target['projectVersion'], 'resultVersion': target['result']['version'],
        'cards': len(target['result']['cards']),
        'readyCards': sum(card['state'] == 'ready' for card in target['result']['cards']),
        'finalApprovedVersion': target['result']['finalApprovedVersion'],
        'factsCheck': target['result']['factsCheck'], 'protectedContent': protected,
        'allOriginalAssets': all(assets.get(aid) == value for aid, value in baseline['assets'].items()),
        'oldAssetCount': len(baseline['assets']), 'assetCount': len(assets), 'newAssetKinds': new_types,
        'sameAsVisuallyInspectedPng': same_png,
        'modelValuesUnchanged': model_rows == ledger['beforeDb']['modelValues'],
        'active': db.execute("SELECT count(*) FROM runs WHERE status IN ('queued','running','waiting_for_user','cancel_requested')").fetchone()[0],
        'quickCheck': db.execute('PRAGMA quick_check').fetchone()[0],
        'runPhases': sorted(set(phases)),
    }
runtime = load(ROOT / '실행데이터/연결준비/사용자앱런타임.json')
record['backendBuildMatches'] = all(sha((ROOT / path).read_bytes()) == value for path, value in runtime['build'].items())
record['currentAppPids'] = {'controller': runtime['pid'], 'http': runtime['http']['pid'], 'worker': runtime['worker']['pid']}
console = load(ROOT / '실행데이터/연결준비/사용자콘솔.json')
repair = load(OUT / '작업자복구.json')
owned = {console['consolePid'], repair['conhostPid']}
user32 = ctypes.WinDLL('user32', use_last_error=True)
windows = []
callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


@callback
def visit(hwnd, param):
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if pid.value in owned and user32.IsWindowVisible(hwnd):
        window_class = ctypes.create_unicode_buffer(256)
        title = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, window_class, 256)
        user32.GetWindowTextW(hwnd, title, 256)
        windows.append({'pid': pid.value, 'class': window_class.value, 'title': title.value})
    return True


user32.EnumWindows(visit, 0)
record['ownedVisibleWindows'] = windows
record['passed'] = (
    all(protected.values()) and record['allOriginalAssets'] and all(same_png.values())
    and record['modelValuesUnchanged'] and record['active'] == 0 and record['quickCheck'] == 'ok'
    and record['resultVersion'] == 3 and record['readyCards'] == 7
    and record['finalApprovedVersion'] is None and new_types == ['preview'] * 7
    and all(phase in {'render', 'planning', 'terminal_commit'} for phase in phases)
    and record['backendBuildMatches']
)
(OUT / '최종감사.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(record, ensure_ascii=True))
if not record['passed']:
    raise RuntimeError('FINAL_READBACK_FAILED')
