import {it,expect} from 'vitest';
import {buildAgyArgs} from '../../src/providers/agy.js';
const approved={inference:true,search:true,image:true,approvalReference:'t_dc7d2a44'} as const;
it('실제 agy 경로는 명시 승인 후 documented session flags만 구성 — 실행 없음',()=>{
 const args=buildAgyArgs('합성 fixture; $(not-a-shell)',approved);
 expect(args).toEqual(['-p','합성 fixture; $(not-a-shell)','--agent','cardnews-image','--output-format','stream-json','--mode','accept-edits','--sandbox','--disable-slash-commands','--print-timeout','10m']);
 expect(args.join(' ')).not.toMatch(/dangerously|--continue|--model|--conversation/);
});
it('승인 false면 native agy argv 실행 경로를 열지 않음',()=>{
 expect(()=>buildAgyArgs('fixture',{inference:false,search:false,image:false})).toThrowError(expect.objectContaining({code:'TOOL_PERMISSION_DENIED'}));
});
