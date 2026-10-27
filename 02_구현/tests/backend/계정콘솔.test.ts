import {test,expect,vi} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openNativeAccountConsole} from '../../src/backend/계정콘솔.js';
test('inspect 진행 중 도착한 busy가 캐시 ready보다 우선한다',async()=>{
 const root=await mkdtemp(join(process.env.TMPDIR!,'native-race-'));let duringInspect:(()=>Promise<void>)|null=null;
 const control=async(action:string)=>{if(action==='launch')return {pid:12345,executable:resolve('C:/fixture/agy.exe'),createdAt:'134000000000000000'};if(action==='inspect'&&duringInspect){const write=duringInspect;duringInspect=null;await write();}return {alive:true};};
 const h=await openNativeAccountConsole({appRoot:root,cwd:root,executable:'C:/fixture/agy.exe',control});
 try{
  const dir=join(h.env.HOME!,(await readdir(h.env.HOME!)).find(n=>n.startsWith('관측-'))!);const file=join(dir,'현재계정.json');
  const record={operationId:h.env.CARDNEWS_ACCOUNT_OPERATION,timestamp:Date.now(),accountId:'current@example.test',ready:true};
  await writeFile(file,JSON.stringify(record));expect((await h.read())?.ready).toBe(true);
  duringInspect=()=>writeFile(file,JSON.stringify({...record,timestamp:Date.now(),ready:false}));
  expect((await h.read())?.ready).toBe(false);
 }finally{await h.close();await rm(root,{recursive:true,force:true});}
});
test.each(['busy','operation','expired','dead','malformed'])('새 %s 관측은 과거 ready를 되살리지 않는다',async kind=>{
 const root=await mkdtemp(join(process.env.TMPDIR!,'native-cache-'));
 let alive=true;
 const control=vi.fn(async(action:string)=>action==='launch'?{pid:12345,executable:resolve('C:/fixture/agy.exe'),createdAt:'134000000000000000'}:{alive});
 const h=await openNativeAccountConsole({appRoot:root,cwd:root,executable:'C:/fixture/agy.exe',control});
 try{
  expect(await h.read()).toBeNull();expect(await h.read()).toBeNull();
  expect(control.mock.calls.filter(c=>c[0]==='inspect')).toHaveLength(0);
  const dir=join(h.env.HOME!,(await readdir(h.env.HOME!)).find(n=>n.startsWith('관측-'))!);
  const file=join(dir,'현재계정.json');
  const record={operationId:h.env.CARDNEWS_ACCOUNT_OPERATION,timestamp:Date.now(),accountId:'current@example.test',ready:true};
  await writeFile(file,JSON.stringify(record));expect((await h.read())?.ready).toBe(true);
  if(kind==='dead')alive=false;
  else await writeFile(file,kind==='malformed'?'{':JSON.stringify({...record,ready:kind!=='busy',operationId:kind==='operation'?'old':record.operationId,timestamp:kind==='expired'?Date.now()-31000:Date.now()}));
  const next=await h.read();expect(next?.ready??false).toBe(false);
  expect((await h.read())?.ready??false).toBe(false);
 }finally{await h.close();await rm(root,{recursive:true,force:true});}
});
test('다음 계정 확인은 앱 전용 최초 설정을 보존하고 관측 작업만 새로 분리한다',async()=>{
 const root=await mkdtemp(join(process.env.TMPDIR!,'native-account-profile-'));
 const control=async(action:string)=>action==='launch'?{pid:12345,executable:resolve('C:/fixture/agy.exe'),createdAt:'134000000000000000'}:{alive:true};
 try{
  const first=await openNativeAccountConsole({appRoot:root,cwd:root,executable:'C:/fixture/agy.exe',control});
  const home=first.env.HOME!;
  const settingsFile=join(home,'.gemini/antigravity-cli/settings.json');
  const settings=JSON.parse(await readFile(settingsFile,'utf8'));
  await writeFile(settingsFile,JSON.stringify({...settings,colorScheme:'dark',trustedWorkspaces:['fixture-only']}));
  await first.close();
  const second=await openNativeAccountConsole({appRoot:root,cwd:root,executable:'C:/fixture/agy.exe',control});
  try{
   expect(second.env.HOME).toBe(home);
   expect(JSON.parse(await readFile(settingsFile,'utf8'))).toMatchObject({colorScheme:'dark',trustedWorkspaces:['fixture-only']});
   expect(second.env.CARDNEWS_ACCOUNT_OPERATION).not.toBe(first.env.CARDNEWS_ACCOUNT_OPERATION);
  }finally{await second.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});
test('CLI 기본 argv 전달의 CMD statusLine은 한글·공백을 보존하고 최소 필드만 쓴다',async()=>{
 const root=await mkdtemp(join(process.env.TMPDIR!,'native 한글 공백-'));
 const h=await openNativeAccountConsole({appRoot:process.cwd(),cwd:root,executable:'C:/fixture/agy.exe',control:async action=>action==='launch'?{pid:12345,executable:resolve('C:/fixture/agy.exe'),createdAt:'134000000000000000'}:{alive:true}});
 try{
  const settings=JSON.parse(await readFile(join(h.env.HOME!,'.gemini/antigravity-cli/settings.json'),'utf8'));
  const result=await new Promise<{exit:number|null;out:string;err:string}>((ok,fail)=>{
   const p=spawn('cmd.exe',['/d','/s','/c',settings.statusLine.command],{env:h.env,windowsHide:true});
   let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);p.on('error',fail);p.on('close',exit=>ok({exit,out,err}));
   p.stdin.end(JSON.stringify({agent_state:'idle',email:'current@example.test',transcript_path:'do-not-store',token:'do-not-store',context_window:{total_input_tokens:99}}));
  });
  expect(result).toEqual({exit:0,out:'계정 연결 확인 중... 인증 확인 후 자동 종료',err:''});
  const observation=(await readdir(h.env.HOME!)).find(name=>name.startsWith('관측-'))!;
  const contents=JSON.parse(await readFile(join(h.env.HOME!,observation,'현재계정.json'),'utf8'));
  expect(Object.keys(contents).sort()).toEqual(['accountId','operationId','ready','timestamp']);
  expect(await h.read()).toMatchObject({accountId:'current@example.test',ready:true});
 }finally{await h.close();await rm(root,{recursive:true,force:true});}
},15000);
test('격리 HOME의 statusLine만 구성하고 작업별 일회 이메일을 소비·삭제한다',async()=>{
 const root=await mkdtemp(join(process.env.TMPDIR!,'native-account-'));
 try{
  const control=vi.fn(async(action:string)=>action==='launch'?{pid:12345,executable:resolve('C:/fixture/agy.exe'),createdAt:'134000000000000000'}:{alive:true});
  const h=await openNativeAccountConsole({appRoot:root,cwd:root,executable:'C:/fixture/agy.exe',control});
  expect(h.env.HOME).toBe(h.env.USERPROFILE);expect(h.env.HOME).not.toBe(process.env.HOME);
  const settings=JSON.parse(await readFile(join(h.env.HOME!,'.gemini/antigravity-cli/settings.json'),'utf8'));
  const encoded=settings.statusLine.command.match(/-EncodedCommand ([A-Za-z0-9+/=]+)$/)?.[1];
  expect(encoded).toBeTruthy();
  expect(Buffer.from(encoded,'base64').toString('utf16le')).toContain('계정상태수집.cjs');
  expect(settings).not.toHaveProperty('security');
  const observation=(await readdir(h.env.HOME!)).find(name=>name.startsWith('관측-'))!;
  const directory=join(h.env.HOME!,observation);const marker=JSON.parse(await readFile(join(directory,'작업표식.json'),'utf8'));
  const file=join(directory,'현재계정.json');
  await writeFile(file,JSON.stringify({operationId:marker.operationId,timestamp:Date.now(),accountId:'current@example.test',ready:true}));
  expect(await h.read()).toEqual({accountId:'current@example.test',ready:true,timestamp:expect.any(Number)});
  expect(await readdir(directory)).not.toContain('현재계정.json');
  expect(await h.read()).toEqual({accountId:'current@example.test',ready:true,timestamp:expect.any(Number)});
  await h.logout('current@example.test');
  expect(control.mock.calls.filter(c=>c[0]==='logout')).toHaveLength(1);
  await expect(h.logout('current@example.test')).rejects.toThrow('ACCOUNT_MISMATCH');
  await writeFile(file,JSON.stringify({operationId:'older-operation',timestamp:Date.now(),accountId:'stale@example.test',ready:true}));
  expect(await h.read()).toBeNull();
  await h.close();expect(control.mock.calls.map(c=>c[0])).toContain('stop');
  expect((await readdir(h.env.HOME!)).filter(name=>name.startsWith('관측-'))).toHaveLength(0);
 }finally{await rm(root,{recursive:true,force:true});}
});
