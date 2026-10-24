import {fail} from './오류.js';
import {isAbsolute} from 'node:path';
import {statSync} from 'node:fs';
const allowed=new Set(['PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','USERPROFILE','HOME','APPDATA','LOCALAPPDATA','TEMP','TMP']);
/** 호스트는 불변, credential/config/provider/proxy/CA override는 전달하지 않음. 설정 격리 증명은 아님. */
export function childEnvironment(host:Readonly<NodeJS.ProcessEnv>=process.env):Record<string,string> {
 const child:Record<string,string>={};
 for(const [key,value]of Object.entries(host))if(allowed.has(key.toUpperCase()) && value!==undefined)child[key]=value;
 // 기존 native login lookup 위치만 보존. 내용/인증 파일은 읽지 않습니다.
 const config=host.CLAUDE_CONFIG_DIR;
 if(config&&validConfigDirectory(config))child.CLAUDE_CONFIG_DIR=config;
 return child;
}
const sdkMarkers:Readonly<Record<string,string>>={CLAUDE_CODE_ENTRYPOINT:'sdk-ts',CLAUDE_AGENT_SDK_VERSION:'0.3.309',CLAUDE_CODE_SDK_READS_SESSION_STATE:'1',CLAUDE_CODE_SDK_READS_STARTUP_MARKS:'1'};
/** SDK0.3.309 sdk.mjs/core.mjs 실제 자동 추가 marker만 허용. 새 변수·값은 재검토. */
export function assertChildEnvironment(env:Readonly<NodeJS.ProcessEnv>):void {
 for(const [key,value]of Object.entries(env))if(value!==undefined && !allowed.has(key.toUpperCase()) && sdkMarkers[key]!==value && !(key==='CLAUDE_CONFIG_DIR'&&validConfigDirectory(value)))fail('AUTH_PATH_FORBIDDEN');
}
function validConfigDirectory(path:string){try{return isAbsolute(path)&&statSync(path).isDirectory();}catch{return false;}}
