import {test,expect} from 'vitest';
import {CardRevisionSchema} from '../../src/shared/포트.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
const card=createMockSnapshot('review').result!.cards[0];
test('layout은 하위 호환 선택 필드이며 정확한 세 enum만 허용한다',()=>{
 expect(CardRevisionSchema.parse(card)).toEqual(card);
 const layout={fontScale:'small',textAlign:'center',placement:'top'};
 expect(CardRevisionSchema.parse({...card,layout})).toEqual({...card,layout});
 for(const bad of [{fontScale:'small'},{...layout,css:'display:none'},{...layout,fontScale:'url(x)'},{...layout,textAlign:'right'},{...layout,placement:'fixed'}])expect(CardRevisionSchema.safeParse({...card,layout:bad}).success).toBe(false);
});
