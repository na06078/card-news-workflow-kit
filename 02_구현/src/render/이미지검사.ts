import {PNG} from 'pngjs';
import {localBytes,dataRoot,sha256} from './파일경계.js';
export function decodePng(bytes:Buffer){
 if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('PNG magic 오류');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(width<1||height<1||width>4096||height>4096)throw new Error('PNG 크기 상한 초과');
 return PNG.sync.read(bytes,{checkCRC:true});
}
export async function verifiedPng(path:string,expectedHash:string){
 const bytes=await localBytes(path,dataRoot);if(sha256(bytes)!==expectedHash)throw new Error('이미지 SHA256 불일치');
 const decoded=decodePng(bytes);return {bytes,decoded};
}
