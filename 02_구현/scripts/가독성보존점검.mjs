import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';

// 원문을 복사하거나 DB를 열어 갱신하지 않는 내용 없는 비교 기록입니다.
const root=process.cwd(),data=resolve(root,'실행데이터/앱');
const output=resolve(root,'실행데이터/가독성개선/재개');
const targetId='43daccac-2d26-4db1-bdd7-3b0e6416cd55';
const label=process.argv[2]??'시작';
if(!/^[가-힣0-9_-]+$/.test(label))throw Error('INVALID_RECORD_LABEL');
const sha=value=>createHash('sha256').update(value).digest('hex');
// 중단 전 Python 생성 명령의 투영·키 정렬과 동일하게 비교합니다.
// 다른 검수 실행기의 JSON.stringify 투영을 재사용하면 무변경 DB도 오차단됩니다.
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
const protectedView=p=>({topic:p.topic,period:p.period,candidates:p.candidates,claims:p.claims,sources:p.sources,selectedCandidateIds:p.selectedCandidateIds,storyboard:p.storyboard,semanticReview:p.result?.semanticReview??null,cards:(p.result?.cards??[]).map(card=>Object.fromEntries(['cardId','order','role','title','body','sourceIds','imagePlan','imageAssetId'].map(key=>[key,card[key]??null])))});
const previous=JSON.parse(await readFile(resolve(root,'실행데이터/가독성개선/변경전_보존기준.json'),'utf8'));
const db=new Database(resolve(data,'카드뉴스.sqlite'),{readonly:true,fileMustExist:true});
try{
 db.pragma('query_only=ON');db.exec('BEGIN');
 const tables={};
 for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()){
  const rows=db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').raw().all();
  tables[name]={rows:rows.length,sha256:sha(rows.map(r=>JSON.stringify(r)).sort().join('\n'))};
 }
 const protectedHashes={},projects={};let target;
 for(const {id,payload} of db.prepare('SELECT id,payload FROM projects').all()){
  const p=JSON.parse(payload),settings=db.prepare('SELECT model,version FROM project_model_settings WHERE project_id=?').get(id)??{model:null,version:0};
  p.claudeModel=settings.model;p.modelSettingsVersion=settings.version;
  protectedHashes[id]=sha(canonical(protectedView(p)));
  projects[id]={projectVersion:p.projectVersion,resultVersion:p.result?.version??null,cardCount:p.result?.cards.length??0,finalApprovedVersion:p.result?.finalApprovedVersion??null};
  if(id===targetId)target=p;
 }
 const assets={},assetRows=db.prepare('SELECT id,path,payload FROM assets').all();
 for(const row of assetRows){
  const file=isAbsolute(row.path)?resolve(row.path):resolve(data,row.path),rel=relative(data,file);
  if(rel.startsWith('..')||isAbsolute(rel))throw Error('ASSET_OUTSIDE_DATA_ROOT');
  const hash=sha(await readFile(file));
  if(hash!==JSON.parse(row.payload).sha256)throw Error('ASSET_CONTENT_MISMATCH');
  assets[row.id]=hash;
 }
 const active=db.prepare("SELECT count(*) n FROM runs WHERE status IN ('queued','running','waiting_for_user','cancel_requested')").get().n;
 const modelSettingsHash=sha(canonical(db.prepare('SELECT * FROM project_model_settings ORDER BY project_id').raw().all()));
 const checks={protectedContent:Object.entries(previous.protectedHashes).every(([id,hash])=>protectedHashes[id]===hash),modelSettings:modelSettingsHash===previous.modelSettingsHash,previousAssetCount:Object.keys(previous.assets).length,allPreviousAssets:Object.entries(previous.assets).every(([id,hash])=>assets[id]===hash),sameAssetCount:Object.keys(assets).length===Object.keys(previous.assets).length};
 const record={at:new Date().toISOString(),targetId,projects,protectedHashes,modelSettingsHash,assets,tables,active,quickCheck:db.pragma('quick_check',{simple:true}),matchesInterruptedBaseline:checks};
 await mkdir(output,{recursive:true});const path=resolve(output,label+'_보존.json');
 await writeFile(path,JSON.stringify(record,null,2));
 console.log(JSON.stringify({path,at:record.at,target:projects[targetId],projectCount:Object.keys(projects).length,assetCount:assetRows.length,active,quickCheck:record.quickCheck,checks}));
 if(active||record.quickCheck!=='ok'||!checks.allPreviousAssets||!checks.protectedContent||!checks.modelSettings)process.exitCode=1;
}finally{db.close();}
