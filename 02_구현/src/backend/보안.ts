import {randomBytes,timingSafeEqual} from 'node:crypto';import type {RequestHandler} from 'express';import type {AppOptions}from'../shared/포트.js';import {DomainError}from'./도메인.js';
export function localSecurity(options:AppOptions):RequestHandler{
 const sessions=new Map<string,string>();const cookieName='cardnews_session';
 const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
 return(req,res,next)=>{try{
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  const host=req.get('host'),origin=req.get('origin'),site=req.get('sec-fetch-site');
  if(!host||!options.allowedHosts.includes(host)||origin&&!options.allowedOrigins.includes(origin)||site==='cross-site')throw new DomainError('LOCAL_REQUEST_DENIED');
  if(origin){res.set({'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Vary':'Origin'});}
  if(req.method==='OPTIONS'){if(!origin||req.get('Access-Control-Request-Method')!=='POST'&&req.get('Access-Control-Request-Method')!=='GET')throw new DomainError('LOCAL_REQUEST_DENIED');const headers=(req.get('Access-Control-Request-Headers')??'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);if(headers.some(h=>!['content-type','x-csrf-token'].includes(h)))throw new DomainError('LOCAL_REQUEST_DENIED');res.set({'Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Content-Type, X-CSRF-Token'}).status(204).end();return;}
  const raw=(req.get('cookie')??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='));let sid=raw?.slice(cookieName.length+1);let token=sid?sessions.get(sid):undefined;
  if(req.path==='/api/bootstrap'&&req.method==='GET'){
   if(!token){sid=randomBytes(32).toString('hex');token=randomBytes(32).toString('hex');sessions.set(sid,token);res.cookie(cookieName,sid,{httpOnly:true,sameSite:'strict',path:'/',secure:false});}
   res.json({data:{csrfToken:token,contractVersion:'CN-1'}});return;
  }
  if(req.path.startsWith('/api/')){
   if(!token)throw new DomainError('LOCAL_REQUEST_DENIED');
   if(req.method!=='GET'&&req.method!=='HEAD'){if(req.method!=='POST'||!origin||!req.is('application/json')||!equal(req.get('X-CSRF-Token')??'',token))throw new DomainError('LOCAL_REQUEST_DENIED');}
  }next();
 }catch(e){next(e);}};
}
