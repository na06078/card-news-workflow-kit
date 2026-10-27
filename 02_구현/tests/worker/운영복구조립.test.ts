import {test,expect,vi} from 'vitest';
const captured=vi.hoisted(()=>({worker:vi.fn((_options:unknown)=>({dispose:async()=>{}})),agy:vi.fn(()=>({dispose:async()=>[]}))}));
vi.mock('../../src/worker/작업자.js',()=>({createWorker:captured.worker}));
vi.mock('../../src/providers/agy.js',()=>({createAgyAdapter:captured.agy}));
import {createProductionWorker} from '../../src/worker-main.js';
import type {Store,WorkerOptions} from '../../src/shared/포트.js';
test('정상 worker 조립도 별도 inference-only 보완 팩토리를 전달하며 import/생성은 외부 호출하지 않는다',async()=>{
 const runtime=createProductionWorker({} as Store,process.cwd());
 try{const options=captured.worker.mock.calls[0]?.[0] as unknown as WorkerOptions;expect(typeof options.createFactLinkRepairer).toBe('function');expect(options.factLinkRepairerOptions?.livePermission).toMatchObject({inference:true});expect(options.factLinkRepairerOptions?.livePermission).not.toHaveProperty('search');expect(options.factLinkRepairerOptions?.livePermission).not.toHaveProperty('image');}finally{await runtime.close();}
});
