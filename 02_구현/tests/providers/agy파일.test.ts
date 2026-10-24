import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {PNG} from 'pngjs';
import {createHash} from 'node:crypto';
import type {AgyInput} from '../../src/shared/포트.js';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
import {createAgyAdapter,createOfflineAgyAdapter, type AgySpawn,type AgyProcessResult} from '../../src/providers/agy.js';
const permission={inference:false,search:false,image:false} as const;
const envelope=(response='image.png에 저장했습니다.')=>JSON.stringify({conversation_id:'synthetic-conversation',status:'SUCCESS',response,duration_seconds:1,num_turns:1,usage:{input_tokens:0}});
let dir:string;let input:AgyInput;
beforeEach(async()=>{await mkdir('실행데이터/연결준비/공급자회귀/임시',{recursive:true});dir=await mkdtemp(resolve('실행데이터/연결준비/공급자회귀/임시/agy-'));input={projectId:I.project,runId:I.run,attempt:1,card:createMockSnapshot('review').result!.cards[0],size:'1080x1080',attemptDir:dir,prompt:'[OFFLINE 합성] test; $(not-a-command)\n그림 안 글자 없음',expectedFilename:'image.png'};});
afterEach(async()=>{await rm(dir,{recursive:true,force:true});});
function fixtureSpawn(effect:()=>Promise<AgyProcessResult>){const cancel=vi.fn(async()=>{}),spawn:AgySpawn=vi.fn((_exe,_args,_options)=>({result:effect(),cancel}));return {spawn,cancel};}
const syntheticPng=()=>PNG.sync.write(new PNG({width:3,height:2}));
const opts=()=>({executablePath:resolve('실행데이터/연결준비/공급자회귀/fake-agy-not-executable.exe'),livePermission:permission});
describe('OFFLINE agy subprocess fake + 합성 로컬 PNG — 실제 생성 아님',()=>{
 it('production 게이트는 false/임의 승인 true에서도 실행하지 않음',async()=>{
  for(const livePermission of [permission,{inference:true,search:true,image:true,approvalReference:'test'}] as const){const a=createAgyAdapter({...opts(),livePermission});await expect(a.generate(input,new AbortController().signal)).rejects.toMatchObject({code:'TOOL_PERMISSION_DENIED'});await a.dispose();}
 });
 it('natural-language -p / shell:false / 독립 envelope + 실제 decode/hash',async()=>{
  const png=syntheticPng(),f=fixtureSpawn(async()=>{await writeFile(join(dir,'image.png'),png);return {exitCode:0,stdout:envelope(),stderr:''};});
  const a=createOfflineAgyAdapter(opts(),f.spawn);const out=await a.generate(input,new AbortController().signal);
  expect(f.spawn).toHaveBeenCalledOnce();const [,argv,options]=vi.mocked(f.spawn).mock.calls[0];
  expect(argv[0]).toBe('-p');expect(argv).toContain('--output-format');expect(argv[1]).toContain(JSON.stringify(input.prompt).slice(1,-1));expect(argv.join(' ')).not.toContain('--dangerously-skip-permissions');expect(options.shell).toBe(false);
  expect(argv[1]).toContain('상위 앱에서');expect(argv[1]).toContain('새 프로젝트를 만드는 작업이 아닙니다');
  expect(argv[1]).toContain('PNG 변환은 상위 앱');
  const agent=await readFile(join(dir,'.agents/agents/cardnews-image/agent.md'),'utf8');expect(agent).toContain('generate_image');expect(agent).toContain('subagent: false');expect(agent).toContain('model: inherit');expect(agent).not.toContain('  - invoke_subagent');expect(agent).not.toContain('  - run_command');expect(agent).toContain('commandExecutionPolicy: off');
  expect(out.asset).toMatchObject({kind:'image',mimeType:'image/png',width:3,height:2,bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')});
  expect(out.provenance).toMatchObject({illustrative:true,usageConditionsVerified:false,toolVersion:'OFFLINE_TEST_FAKE'});expect(await readFile(out.asset.absolutePath)).toEqual(png);await a.dispose();
 });
 it.each([{stdout:envelope(),stderr:'',exitCode:1},{stdout:'not-json',stderr:'',exitCode:0},{stdout:JSON.stringify({session_id:'wrong-format',result:'success'}),stderr:'',exitCode:0},{stdout:envelope('Permission denied. No image generated.'),stderr:'',exitCode:0},{stdout:envelope(),stderr:'Permission denied for generate_image',exitCode:0}])('exit0/JSON/soft deny만으로 성공 금지 %j',async result=>{
  const f=fixtureSpawn(async()=>{await writeFile(join(dir,'image.png'),syntheticPng());return result;});const a=createOfflineAgyAdapter(opts(),f.spawn);await expect(a.generate(input,new AbortController().signal)).rejects.toHaveProperty('code');
 });
 it('공식 stream-json의 종료 result를 해석하고 이미지 도구 실제 완료 메타데이터를 기록한다',async()=>{
  const f=fixtureSpawn(async()=>{await writeFile(join(dir,'image.png'),syntheticPng());return {exitCode:0,stderr:'',stdout:[{event:'init',conversation_id:'11111111-1111-4111-8111-111111111111',init:{tools:['generate_image','write_to_file'],permission_mode:'request-review'}},{event:'step_update',step_update:{step_index:1,state:'DONE',step_type:'tool',tool_name:'generate_image',tool_info:{output:'DO_NOT_LOG_RAW_TOOL_OUTPUT'}}},{event:'result',result:{...JSON.parse(envelope()),conversation_id:'11111111-1111-4111-8111-111111111111'}}].map(x=>JSON.stringify(x)).join('\n')};});
  const a=createOfflineAgyAdapter(opts(),f.spawn);expect((await a.generate(input,new AbortController().signal)).asset.kind).toBe('image');
  const text=await readFile(join(dir,'이미지진단.json'),'utf8');expect(JSON.parse(text)).toMatchObject({imageToolCompleted:true});expect(text).not.toContain('DO_NOT_LOG_RAW_TOOL_OUTPUT');await a.dispose();
 });
 it('이미지 파일이 있어도 native init/result conversation이 다르면 채택하지 않는다',async()=>{
  const f=fixtureSpawn(async()=>{await writeFile(join(dir,'image.png'),syntheticPng());return {exitCode:0,stderr:'',stdout:[{event:'init',conversation_id:'11111111-1111-4111-8111-111111111111',init:{tools:['generate_image'],permission_mode:'request-review'}},{event:'result',result:{...JSON.parse(envelope()),conversation_id:'22222222-2222-4222-8222-222222222222'}}].map(x=>JSON.stringify(x)).join('\n')};});
  const a=createOfflineAgyAdapter(opts(),f.spawn);await expect(a.generate(input,new AbortController().signal)).rejects.toMatchObject({code:'PROVIDER_PROTOCOL_ERROR'});await a.dispose();
 });
 it('이미지 실패 진단에는 계약/파일 상태만 쓰고 원시 응답과 인증값은 쓰지 않는다',async()=>{
  const marker='DO_NOT_PERSIST_RAW_RESPONSE';const f=fixtureSpawn(async()=>({exitCode:0,stdout:envelope(marker+' cannot save image.png'),stderr:marker}));
  const a=createOfflineAgyAdapter(opts(),f.spawn);await expect(a.generate(input,new AbortController().signal)).rejects.toHaveProperty('code');
  const text=await readFile(join(dir,'이미지진단.json'),'utf8');const diagnostic=JSON.parse(text);
  expect(diagnostic).toMatchObject({exitCode:0,jsonParsed:true,envelopeValid:true,expectedPng:false,failureCode:'IMAGE_GENERATION_FAILED'});
  expect(text).not.toContain(marker);expect(diagnostic).not.toHaveProperty('stdout');expect(diagnostic).not.toHaveProperty('response');await a.dispose();
 });
 it.each(['missing','corrupt','wrong-path','preexisting','oversize-header'])('PNG/경로 불일치 거절: %s',async kind=>{
  if(kind==='preexisting')await writeFile(join(dir,'image.png'),syntheticPng());
  const f=fixtureSpawn(async()=>{
   if(kind==='corrupt')await writeFile(join(dir,'image.png'),'not a png');
   if(kind==='oversize-header'){const png=syntheticPng();png.writeUInt32BE(99999,16);await writeFile(join(dir,'image.png'),png);}
   if(kind==='wrong-path')await writeFile(join(dir,'image.png'),syntheticPng());

   return {exitCode:0,stdout:envelope(kind==='wrong-path'?'`../outside.png`로 저장했습니다.':'image.png 저장 완료'),stderr:''};
  });const a=createOfflineAgyAdapter(opts(),f.spawn);await expect(a.generate(input,new AbortController().signal)).rejects.toHaveProperty('code');
  if(kind==='preexisting')expect(f.spawn).not.toHaveBeenCalled();
 });
 it('실제 파일 symlink 거절 — OS 권한 없으면 명시 skip',async({skip})=>{
  await writeFile(join(dir,'other.png'),syntheticPng());
  try{await symlink(join(dir,'other.png'),join(dir,'link.png'));}catch(error){if((error as NodeJS.ErrnoException).code==='EPERM')return skip('Windows symlink 생성 권한 없음; 설정 변경/권한 상승하지 않음');throw error;}
  const f=fixtureSpawn(async()=>{await rename(join(dir,'link.png'),join(dir,'image.png'));return {exitCode:0,stdout:envelope(),stderr:''};});
  await expect(createOfflineAgyAdapter(opts(),f.spawn).generate(input,new AbortController().signal)).rejects.toMatchObject({code:'ASSET_INVALID'});
 });
 it('실제 Windows junction을 PNG로 수집하지 않음',async()=>{
  const target=join(dir,'junction-target');await mkdir(target);
  const f=fixtureSpawn(async()=>{await symlink(target,join(dir,'image.png'),'junction');return {exitCode:0,stdout:envelope(),stderr:''};});
  await expect(createOfflineAgyAdapter(opts(),f.spawn).generate(input,new AbortController().signal)).rejects.toMatchObject({code:'ASSET_INVALID'});
 });
 it('이미 중단/UNC/상대 attempt은 spawn0',async()=>{
  const f=fixtureSpawn(async()=>({exitCode:0,stdout:envelope(),stderr:''})),a=createOfflineAgyAdapter(opts(),f.spawn);const ac=new AbortController();ac.abort();
  await expect(a.generate(input,ac.signal)).rejects.toHaveProperty('code');
  for(const attemptDir of ['relative','//server/share/test'])await expect(a.generate({...input,attemptDir},new AbortController().signal)).rejects.toHaveProperty('code');expect(f.spawn).not.toHaveBeenCalled();
 });
 it('cancel(runId)는 소유 handle에만 전달하고 result 종료까지 기다림',async()=>{
  let finish:(result:AgyProcessResult)=>void=()=>{};
  const result=new Promise<AgyProcessResult>(r=>{finish=r;});const cancel=vi.fn(async()=>{finish({exitCode:null,stdout:'',stderr:''});});
  const spawn:AgySpawn=vi.fn(()=>({result,cancel}));const a=createOfflineAgyAdapter(opts(),spawn);
  const pending=a.generate(input,new AbortController().signal);const rejection=expect(pending).rejects.toHaveProperty('code');
  await vi.waitFor(()=>expect(spawn).toHaveBeenCalledOnce());await a.cancel('unrelated-run');expect(cancel).not.toHaveBeenCalled();await a.cancel(I.run);await rejection;expect(cancel).toHaveBeenCalledOnce();await a.dispose();
 });
 it('동일 run 동시 generate는 비동기 준비 중에도 spawn 한 번만',async()=>{
  let finish:(value:AgyProcessResult)=>void=()=>{};const result=new Promise<AgyProcessResult>(r=>{finish=r;});
  const cancel=vi.fn(async()=>finish({exitCode:null,stdout:'',stderr:''}));const spawn:AgySpawn=vi.fn(()=>({result,cancel}));const a=createOfflineAgyAdapter(opts(),spawn);
  const first=a.generate(input,new AbortController().signal);const firstRejected=expect(first).rejects.toHaveProperty('code');
  const second=a.generate(input,new AbortController().signal);const secondRejected=expect(second).rejects.toMatchObject({code:'IMAGE_GENERATION_FAILED'});
  await vi.waitFor(()=>expect(spawn).toHaveBeenCalledOnce());await a.cancel(I.run);await Promise.all([firstRejected,secondRejected]);expect(spawn).toHaveBeenCalledOnce();
 });
});
