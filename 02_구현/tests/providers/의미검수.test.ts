import {test,expect} from 'vitest';
import {createSemanticReviewer,reviewPrompt} from '../../src/providers/의미검수.js';
test('factory is lazy and forbidden mode blocks inference before filesystem or child',async()=>{
 const r=createSemanticReviewer({selection:{provider:'agy',model:'gemini-3.8-flash-high'},livePermission:{inference:true,approvalReference:'test'}});
 await expect(r.review({projectId:'x',runId:'x',attempt:1,cwd:'missing'},{} as never)).rejects.toMatchObject({code:'AUTH_PATH_FORBIDDEN'});
 expect(await r.dispose()).toEqual([]);
});
test('prompt compares full publication and treats excerpts as untrusted data',()=>{
 const p=reviewPrompt({projectId:'x',cards:[],claims:[],sources:[]});
 for(const s of ['title','body','subject','number','unit','time','negation','attribution','untrusted','truth guarantee'])expect(p).toContain(s);
});
