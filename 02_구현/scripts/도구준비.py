"""S0 전용: 공식 Node 메타데이터/체크섬 검증 후 프로젝트 안에만 압축 해제."""
from pathlib import Path
import urllib.request, json, hashlib, zipfile
ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / '.도구'
TOOLS.mkdir(exist_ok=True)
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'card-news-local-setup'}), timeout=120) as r:
        return r.read()
index = json.loads(get('https://nodejs.org/dist/index.json'))
release = next(r for r in index if r['version'].startswith('v24.') and r['lts'])
v = release['version']; name = f'node-{v}-win-x64.zip'
base = f'https://nodejs.org/dist/{v}/'
checks = get(base+'SHASUMS256.txt')
(TOOLS/'SHASUMS256.txt').write_bytes(checks)
expected = next(line.split()[0] for line in checks.decode().splitlines() if line.split()[-1] == name)
archive = get(base+name); actual = hashlib.sha256(archive).hexdigest()
if actual != expected: raise RuntimeError('공식 SHA256 불일치: 실행/추출 금지')
(TOOLS/name).write_bytes(archive)
with zipfile.ZipFile(TOOLS/name) as z:
    for n in z.namelist():
        if '..' in Path(n).parts or Path(n).is_absolute(): raise RuntimeError('비정상 ZIP 경로')
    z.extractall(TOOLS)
record = {'release':release,'archive':name,'sha256':actual,'officialUrl':base+name,'node':str(TOOLS/f'node-{v}-win-x64'/'node.exe')}
(TOOLS/'노드설치.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(record,ensure_ascii=False,indent=2))
