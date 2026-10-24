import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture} from './자료.js';
import {renderCard} from '../../src/render/렌더러.js';
test('긴 실제 기획 형태의 본문과 세 원문을 자르지 않고 1080 카드 안에 배치한다',async()=>{
 const input=await fixture('TEST-긴본문-출처');input.card.role='body';input.card.title='회사가 밝힌 안전장치: 민감한 일은 먼저 묻는다';
 input.card.body='• 메시지 전송·결제·문서 서명·삭제 전에 할 일을 보여주고 승인을 기다림\n• 비밀번호·로그인 토큰을 에이전트가 직접 보지 않도록 설계\n• 카드번호·신분증 정보 유출을 막도록 설계된 전용 분류기\n• 레드팀·외부 침투 테스트, 공개 버그 바운티 적용\n※ 모두 Anthropic의 설명이며 독립 검증 결과가 아니고, 오류나 유출이 없다는 보장도 아닙니다.';
 input.sourceLabels=[{sourceId:randomUUID(),label:'Claude Duet (official announcement)',url:'https://claude.com/blog/claude-duet'},{sourceId:randomUUID(),label:'Claude Duet',url:'https://claude.com/product/claude-duet'},{sourceId:randomUUID(),label:'Anthropic launches Claude Duet AI agent to rival Meta Muse OpenAI Dots',url:'https://aa.com.tr/en/americas/anthropic-launches-claude-duet-ai-agent-to-rival-metas-muse-openais-dots/4096538'}];
 input.card.sourceIds=input.sourceLabels.map(s=>s.sourceId);const before=JSON.stringify(input);const result=await renderCard(input);
 expect(result.checks).toEqual({fontLoaded:true,imageDecoded:true,overflow:false});expect(result.width).toBe(1080);expect(result.height).toBe(1080);expect(JSON.stringify(input)).toBe(before);
},30000);
