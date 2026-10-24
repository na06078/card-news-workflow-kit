import {unzipSync} from 'fflate';
import {crc32} from 'node:zlib';
/** fflate unzipSync는 CRC 검증을 보장하지 않으므로 생성한 STORE ZIP의 양쪽 헤더와 실제 CRC를 대조. */
export function verifyZip(bytes:Uint8Array,expectedNames:readonly string[]):Record<string,Uint8Array>{
 const b=Buffer.from(bytes);const end=b.length-22;
 if(end<0||b.readUInt32LE(end)!==0x06054b50||b.readUInt16LE(end+20)!==0||b.readUInt16LE(end+4)!==0||b.readUInt16LE(end+6)!==0)throw new Error('ZIP EOCD 오류');
 const count=b.readUInt16LE(end+10);if(count!==expectedNames.length||b.readUInt16LE(end+8)!==count)throw new Error('ZIP 수량 오류');
 const start=b.readUInt32LE(end+16);if(start+b.readUInt32LE(end+12)!==end)throw new Error('ZIP 중앙 디렉터리 크기 오류');
 const contents=unzipSync(b);if(Object.keys(contents).length!==count)throw new Error('ZIP 중복/수량 오류');
 let p=start;let nextLocal=0;
 for(const name of expectedNames){
  if(p+46>end||b.readUInt32LE(p)!==0x02014b50)throw new Error('ZIP 중앙 헤더 오류');
  const nl=b.readUInt16LE(p+28),el=b.readUInt16LE(p+30),cl=b.readUInt16LE(p+32);
  const actual=b.subarray(p+46,p+46+nl).toString('utf8');const offset=b.readUInt32LE(p+42);const size=b.readUInt32LE(p+24);const crc=b.readUInt32LE(p+16);
  if(actual!==name||offset!==nextLocal||!contents[name]||b.readUInt16LE(p+10)!==0||b.readUInt32LE(p+20)!==size||contents[name].length!==size||crc32(contents[name])!==crc)throw new Error('ZIP 순서·크기·CRC 불일치');
  if(offset+30>start||b.readUInt32LE(offset)!==0x04034b50||b.readUInt16LE(offset+8)!==0||b.readUInt32LE(offset+14)!==crc||b.readUInt32LE(offset+18)!==size||b.readUInt32LE(offset+22)!==size)throw new Error('ZIP 로컬 헤더 불일치');
  const lnl=b.readUInt16LE(offset+26),lel=b.readUInt16LE(offset+28);const dataStart=offset+30+lnl+lel;
  if(b.subarray(offset+30,offset+30+lnl).toString('utf8')!==name||dataStart+size>start||!b.subarray(dataStart,dataStart+size).equals(Buffer.from(contents[name])))throw new Error('ZIP payload 불일치');
  nextLocal=dataStart+size;p+=46+nl+el+cl;
 }
 if(p!==end||nextLocal!==start||Object.keys(contents).some((n,i)=>n!==expectedNames[i]))throw new Error('ZIP 순서/끝 경계 오류');
 return contents;
}
