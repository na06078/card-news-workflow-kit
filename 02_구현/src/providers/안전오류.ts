/** Native error 객체/그 안 JSON만 읽으며 모델 최종 자연어는 받지 않습니다. */
export function nativeErrorMetadata(value:unknown):{status?:number;errorCode?:string;model?:string;retryAfterSeconds?:number}|undefined {
 if(!value||typeof value!=='object')return;
 let e=value as Record<string,unknown>;
 if(typeof e.message==='string'&&e.message.length<=16384){try{const parsed=JSON.parse(e.message);if(parsed&&typeof parsed==='object')e={...e,...(parsed.error??parsed)};}catch{/* 자연어에서 할당량 추론 금지 */}}
 const out:{status?:number;errorCode?:string;model?:string;retryAfterSeconds?:number}={};
 const code=e.code??e.statusCode;if(typeof code==='number'&&Number.isInteger(code)&&code>=400&&code<=599)out.status=code;
 if(['RESOURCE_EXHAUSTED','UNAUTHENTICATED','PERMISSION_DENIED','INVALID_ARGUMENT','UNAVAILABLE'].includes(String(e.status)))out.errorCode=String(e.status);
 if(typeof e.model==='string'&&/^gemini-[a-z0-9.-]{1,64}$/.test(e.model))out.model=e.model;
 if(typeof e.retryAfterSeconds==='number'&&Number.isFinite(e.retryAfterSeconds)&&e.retryAfterSeconds>=0&&e.retryAfterSeconds<=604800)out.retryAfterSeconds=Math.ceil(e.retryAfterSeconds);
 return Object.keys(out).length?out:undefined;
}
