import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {다운로드} from '../../src/frontend/화면/다운로드.js';
import {App} from '../../src/frontend/App.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {FrontendClient} from '../../src/shared/포트.js';
import type {WorkspaceClient} from '../../src/shared/작업공간계약.js';

const createDescriptor=Object.getOwnPropertyDescriptor(URL,'createObjectURL');
const revokeDescriptor=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL');
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();
 if(createDescriptor)Object.defineProperty(URL,'createObjectURL',createDescriptor);else Reflect.deleteProperty(URL,'createObjectURL');
 if(revokeDescriptor)Object.defineProperty(URL,'revokeObjectURL',revokeDescriptor);else Reflect.deleteProperty(URL,'revokeObjectURL');
});

it('출처 JSON 기록은 오류 JSON과 구별해 실제 파일 저장 동작으로 연결한다',async()=>{
 const p=createMockSnapshot('export'),blob=new Blob(['{"sources":[]}'],{type:'application/json'});
 p.exports=p.exports.map(e=>({...e,kind:'records',filename:'출처기록.json',mimeType:'application/json',bytes:blob.size}));
 const client={getExports:vi.fn(async()=>({resultVersion:p.result!.version,entries:p.exports,exportRun:null})),downloadExport:vi.fn(async()=>blob)} as unknown as FrontendClient;
 const create=vi.fn(()=> 'blob:isolated-test');Object.defineProperty(URL,'createObjectURL',{value:create,configurable:true});Object.defineProperty(URL,'revokeObjectURL',{value:vi.fn(),configurable:true});
 const save=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 render(<다운로드 p={p} busy={false} developmentMock={false} client={client} send={vi.fn()} onRefresh={vi.fn()}/>);
 await userEvent.click(await screen.findByRole('button',{name:'RECORDS 내려받기'}));
 await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(create).toHaveBeenCalledWith(blob);
 expect(screen.queryByRole('alert')).toBeNull();
});

it('App의 내려받기는 주입된 동일 HTTP 클라이언트를 사용한다',async()=>{
 const p=createMockSnapshot('export');
 const client={bootstrap:vi.fn(async()=>({csrfToken:'local-test',contractVersion:'CN-1'})),getProject:vi.fn(async()=>p),getEvents:vi.fn(async()=>({events:[],nextSeq:0,hasMore:false})),getExports:vi.fn(async()=>({resultVersion:p.result!.version,entries:p.exports,exportRun:null})),downloadExport:vi.fn(),mutate:vi.fn(),getRun:vi.fn(),createProject:vi.fn()} as unknown as FrontendClient;
 const status={refreshing:false,models:{status:'ready',checkedAt:null,models:[],error:null},providers:[]};
 const workspace={listProjects:vi.fn(async()=>({projects:[]})),providerStatus:vi.fn(async()=>status),refreshProviders:vi.fn(async()=>status),setProjectModel:vi.fn(),deleteProject:vi.fn()} as unknown as WorkspaceClient;
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('UNEXPECTED_REAL_FETCH');}));
 render(<App client={client} workspaceClient={workspace} initialProjectId={p.projectId}/>);
 await waitFor(()=>expect(client.getExports).toHaveBeenCalledWith(p.projectId));
 expect((await screen.findByRole('button',{name:'ZIP 내려받기'}) as HTMLButtonElement).disabled).toBe(false);
});
