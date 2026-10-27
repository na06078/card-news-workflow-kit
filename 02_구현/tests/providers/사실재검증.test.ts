import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {captureFetchReceipt} from '../../src/providers/사실재검증.js';
const url='https://example.com/report',at='2026-10-26T00:00:00.000Z';

it.each([
 [{url,code:403,codeText:'Forbidden',bytes:3,result:'no',durationMs:1},false,'blocked'],
 [{url,code:200,codeText:'OK',bytes:0,result:'x',durationMs:1},false,'empty'],
 [{url,code:200,codeText:'OK',bytes:1,result:' ',durationMs:1},false,'empty'],
 [{url,code:200,codeText:'OK',bytes:1,result:'x',durationMs:1},true,'failed'],
 [{url:'https://other.com/x',code:200,codeText:'OK',bytes:1,result:'x',durationMs:1},false,'unconfirmed'],
 ['search snippet',false,'unconfirmed'],
 [{url,code:900,codeText:'bad',bytes:1,result:'x',durationMs:1},false,'unconfirmed'],
 [{url,code:200,codeText:'OK',bytes:Number.MAX_SAFE_INTEGER+1,result:'x',durationMs:1},false,'unconfirmed']
])('SDK 실패/빈값/불명은 승격하지 않는다 %j',(output,failed,outcome)=>{const r=captureFetchReceipt('f1',url,output,failed as boolean,at);expect(r.outcome).toBe(outcome);expect(r.evidenceSha256).toBeNull();});

describe('SDK 처리 결과 관측',()=>{
 it('동일 요청의 실제 구조화 2xx 처리 결과만 opened/hash',()=>{
 const r=captureFetchReceipt('fetch-1',url,{url,code:200,codeText:'OK',bytes:20,result:'발표자는 10을 발표했다.',durationMs:5},false,at);
 expect(r.outcome).toBe('opened');expect(r.evidenceSha256).toBe(createHash('sha256').update('발표자는 10을 발표했다.').digest('hex'));
 });
});
