import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {다운로드} from '../../src/frontend/화면/다운로드.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {ExportEntry,FrontendClient} from '../../src/shared/포트.js';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function setup(){const p=createMockSnapshot('review');p.result!.finalApprovedVersion=p.result!.version;p.stage='export';p.allowedActions=['rebuild_exports'];const entry:ExportEntry={exportId:crypto.randomUUID(),projectId:p.projectId,resultVersion:p.result!.version,kind:'zip',cardId:null,cardRevision:null,filename:'결과.zip',mimeType:'application/zip',bytes:8,sha256:'a'.repeat(64),downloadUrl:'/never-use'};const client={getExports:vi.fn().mockResolvedValue({resultVersion:p.result!.version,entries:[entry],exportRun:null}),downloadExport:vi.fn().mockRejectedValue({status:500,error:{code:'EXPORT_FAILED',message:'내보내기 파일 검증 실패'}})} as unknown as FrontendClient;return {p,entry,client};}
it('snapshot 파일 대신 검증된 getExports를 사용하고 다운로드 오류를 앱에 남긴다',async()=>{const {p,client}=setup();render(<다운로드 p={p} busy={false} onRefresh={vi.fn()} developmentMock={false} client={client} send={vi.fn()}/>);fireEvent.click(await screen.findByRole('button',{name:'ZIP 내려받기'}));expect(await screen.findByRole('alert')).toHaveTextContent('내보내기 파일 검증 실패');expect(client.downloadExport).toHaveBeenCalled();expect(screen.queryByRole('link',{name:'ZIP 내려받기'})).not.toBeInTheDocument();});
it('잘못된 JSON 목록 응답과 조회 실패를 완료로 표시하지 않는다',async()=>{const {p,client}=setup();vi.mocked(client.getExports).mockResolvedValue({entries:'not-json'} as never);render(<다운로드 p={p} busy={false} onRefresh={vi.fn()} developmentMock={false} client={client}/>);expect(await screen.findByRole('alert')).toHaveTextContent(/응답|형식/);expect(screen.queryByRole('button',{name:'ZIP 내려받기'})).not.toBeInTheDocument();});
it('파일 재생성은 별도 mutation이며 승인과 콘텐츠를 변경하지 않는다',async()=>{const {p,client}=setup(),send=vi.fn();vi.mocked(client.getExports).mockResolvedValue({resultVersion:p.result!.version,entries:[],exportRun:null});render(<다운로드 p={p} busy={false} onRefresh={vi.fn()} developmentMock={false} client={client} send={send}/>);fireEvent.click(await screen.findByRole('button',{name:'승인 유지 · 파일만 다시 생성'}));expect(send).toHaveBeenCalledWith('rebuildExports');expect(p.result!.finalApprovedVersion).toBe(p.result!.version);});
it('모의 경고에서는 실제 다운로드·자동 파일 조회를 하지 않는다',()=>{const {p,client}=setup();render(<다운로드 p={p} busy={false} onRefresh={vi.fn()} developmentMock client={client}/>);expect(screen.getByText(/모의 모드에서는 실제 파일/)).toBeVisible();expect(client.getExports).not.toHaveBeenCalled();});

it('화면을 떠난 뒤 도착한 다운로드는 저장 창을 열지 않는다',async()=>{
 const {p,client}=setup();let finish!:(value:Blob)=>void;vi.mocked(client.downloadExport!).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const create=vi.fn(()=> 'blob:late');vi.stubGlobal('URL',class extends URL {static createObjectURL=create;static revokeObjectURL=vi.fn();});
 const view=render(<다운로드 p={p} busy={false} onRefresh={vi.fn()} developmentMock={false} client={client}/>);
 fireEvent.click(await screen.findByRole('button',{name:'ZIP 내려받기'}));await waitFor(()=>expect(client.downloadExport).toHaveBeenCalled());view.unmount();finish(new Blob(['file'],{type:'application/zip'}));await new Promise(resolve=>setTimeout(resolve,5));expect(create).not.toHaveBeenCalled();vi.unstubAllGlobals();
});

