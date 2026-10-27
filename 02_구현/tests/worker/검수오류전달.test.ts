import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {setup} from '../backend/도움.js';
import {draft} from '../backend/의미검수대역.js';
import {options,confirmed} from './도움.js';
import {createWorker} from '../../src/worker/작업자.js';
import {ProviderFailure} from '../../src/providers/오류.js';
import type {ProjectSnapshot} from '../../src/shared/포트.js';
it.each(['SUBSCRIPTION_QUOTA','MODEL_UNAVAILABLE'] as const)('검수 제공자의 안전한 %s 원인을 일반 사실 오류로 감추지 않는다',async code=>{
 const h=await setup('1080x1080',[{text:'합성',kind:'uncertain',sourceIds:[],availability:'unknown',conditions:[]}]),o=options({store:h.s,dataDir:h.options.dataDir,pid:h.target.projectId});let runId='';
 o.createClaudeAdapter=({bridge})=>({async *start(c,input){runId=c.runId;yield await bridge.publishResult(c,draft((input as {snapshot:ProjectSnapshot}).snapshot));},answer:async()=>{},status:id=>h.s.getRun(id),cancel:async id=>confirmed(id),dispose:async()=>[confirmed(runId)]});
 o.createSemanticReviewer=()=>({review:async()=>{throw new ProviderFailure(code);},cancel:async id=>confirmed(id),dispose:async()=>[confirmed(runId)]});
 const w=createWorker(o);try{const p=await h.s.getProject(h.target.projectId);await h.s.mutate('factReview',h.target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:[p.storyboard!.cards[0]!.cardId]});await w.tick();const after=await h.s.getProject(p.projectId);expect(after.lastRun!.error!.code).toBe(code);expect(after.factReview!.proposal).toBeNull();}finally{await w.dispose();await h.s.close();}
});
