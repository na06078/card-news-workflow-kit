from pathlib import Path
import urllib.request,json,hashlib
root=Path(__file__).resolve().parents[1]; dest=root/'.도구'/'글꼴'; dest.mkdir(parents=True,exist_ok=True)
sources={
'NotoSansKR.woff2':'https://fonts.gstatic.com/s/notosanskr/v40/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLE.woff2',
'OFL.txt':'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/OFL.txt'
}
record={}
for name,url in sources.items():
 with urllib.request.urlopen(url,timeout=120) as r: data=r.read()
 if name.endswith('woff2') and data[:4]!=b'wOF2': raise RuntimeError('WOFF2 아님')
 (dest/name).write_bytes(data)
 record[name]={'url':url,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
(dest/'출처.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(record,indent=2))
