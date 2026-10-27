import {test,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('statusLine 원문에서 작업 ID·시각·유효 이메일·준비 여부만 추출한다',()=>{
 const {accountSnapshot}=require('../../scripts/계정상태수집.cjs');
 expect(accountSnapshot({email:'current@example.test',agent_state:'idle',product:'antigravity',pending_input_count:0,transcript_path:'forbidden',context_window:{total_input_tokens:99},token:'secret'},'operation',123)).toEqual({operationId:'operation',timestamp:123,accountId:'current@example.test',ready:true});
 expect(accountSnapshot({email:'bad\n@example.test',agent_state:'idle'},'operation',123).accountId).toBeNull();
 expect(accountSnapshot({email:'current@example.test',agent_state:'initializing'},'operation',123).ready).toBe(false);
 expect(accountSnapshot({email:'current@example.test',agent_state:'idle',tool_confirmation_pending:true},'operation',123).ready).toBe(false);
 expect(accountSnapshot({email:'current@example.test',agent_state:'idle',pending_input_count:1},'operation',123).ready).toBe(false);
});
