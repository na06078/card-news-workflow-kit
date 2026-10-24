import express,{type ErrorRequestHandler} from 'express';import {ZodError}from'zod';import {readFile}from'node:fs/promises';import {createHash,randomUUID}from'node:crypto';
import * as C from '../shared/포트.js';import {localSecurity}from'./보안.js';import {DomainError,requireThat as must}from'./도메인.js';
import type {ConnectionService} from './연결.js';
import {ConnectionProviderSchema,ConnectionRequestSchema,ConnectionCancelRequestSchema,ConnectionCodeRequestSchema} from '../shared/연결계약.js';
export const createApp=(options:C.AppOptions & {connections?:ConnectionService})=>{
 const app=express();app.disable('x-powered-by');app.set('trust proxy',false);app.use(localSecurity(options));app.use(express.json({limit:'256kb',strict:true}));
 const connections=options.connections;
 if(connections){
  app.get('/api/connections',(_req,res)=>res.json({data:connections.list()}));
  for(const action of ['check','login','cancel','code'] as const)app.post(`/api/connections/:provider/${action}`,(req,res)=>{
   const p=ConnectionProviderSchema.parse(req.params.provider);
   const out=action==='cancel'?connections.cancel(p,ConnectionCancelRequestSchema.parse(req.body)):action==='code'?connections.code(p,ConnectionCodeRequestSchema.parse(req.body)):connections.start(p,action,ConnectionRequestSchema.parse(req.body));
   if(out.replayed)res.set('Idempotency-Replayed','true');res.status(action==='check'||action==='login'?202:200).json({data:out.state});
  });
  // Do not enqueue production or resume an SDK while an account operation is pending.
  app.use((req,_res,next)=>{if(req.method==='POST'&&connections.busy()&&/^\/api\/(?:projects\/[^/]+\/(?:research|selection|answers|approve|revisions)|runs\/[^/]+\/retry)$/.test(req.path))return next(new DomainError('RUN_ACTIVE',null,null,'계정 연결 작업을 마치거나 취소해 주세요.'));next();});
 }
 const param=(v:unknown)=>C.IdSchema.parse(v);
 const reply=(res:express.Response,out:C.HttpReply<unknown>)=>{if(out.replayed)res.set('Idempotency-Replayed','true');res.status(out.status).json(out.body);};
 app.post('/api/projects',async(req,res)=>reply(res,await options.store.createProject(C.CreateProjectRequestSchema.parse(req.body))));
 app.get('/api/projects/:id',async(req,res)=>res.json({data:await options.store.getProject(param(req.params.id))}));
 for(const name of ['research','selection','answers','approve','revisions']as const)app.post(`/api/projects/:id/${name}`,async(req,res)=>reply(res,await options.store.mutate(name,{projectId:param(req.params.id)},C.RequestSchemas[name].parse(req.body))));
 app.post('/api/projects/:id/cards/:cardId/approve',async(req,res)=>reply(res,await options.store.mutate('cardApprove',{projectId:param(req.params.id),cardId:param(req.params.cardId)},C.CardApproveRequestSchema.parse(req.body))));
 app.get('/api/runs/:id',async(req,res)=>res.json({data:await options.store.getRun(param(req.params.id))}));
 for(const name of ['cancel','retry']as const)app.post(`/api/runs/:id/${name}`,async(req,res)=>{const runId=param(req.params.id),r=await options.store.getRun(runId);reply(res,await options.store.mutate(name,{projectId:r.projectId,runId},C.RequestSchemas[name].parse(req.body)));});
 app.get('/api/projects/:id/events',async(req,res)=>{const value=req.query.after??'0';must(typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value)),'VALIDATION_ERROR');res.json({data:await options.store.getEvents(param(req.params.id),Number(value))});});
 app.get('/api/projects/:id/exports',async(req,res)=>res.json({data:await options.store.getExports(param(req.params.id))}));
 const bytes=async(a:C.VerifiedAsset)=>{const b=await readFile(a.absolutePath);must(b.length===a.bytes&&createHash('sha256').update(b).digest('hex')===a.sha256,'ASSET_INVALID');return b;};
 app.get('/api/projects/:id/assets/:assetId',async(req,res)=>{const a=await options.store.getAsset(param(req.params.id),param(req.params.assetId));res.type(a.mimeType).send(await bytes(a));});
 app.get('/api/projects/:id/exports/:exportId/download',async(req,res)=>{const pid=param(req.params.id),eid=param(req.params.exportId);const a=await options.store.getDownload(pid,eid),list=await options.store.getExports(pid),entry=list.entries.find(e=>e.exportId===eid);must(entry,'EXPORT_STALE',pid);const buffer=await bytes(a);await options.store.getDownload(pid,eid);res.attachment(entry.filename).type(a.mimeType).send(buffer);});
 if(options.staticDir)app.use(express.static(options.staticDir,{dotfiles:'deny',fallthrough:true,index:'index.html'}));
 app.use((_req,_res,next)=>next(new DomainError('NOT_FOUND')));
 const errors:ErrorRequestHandler=(err,_req,res,_next)=>{
  if(err instanceof DomainError){res.status(err.status).json({error:err.error});return;}
  if(err instanceof ZodError){const e=new DomainError('VALIDATION_ERROR');e.error.details={field:err.issues[0]?.path.join('.')||'body'};res.status(e.status).json({error:e.error});return;}
  const code=err?.type==='entity.too.large'?'PAYLOAD_TOO_LARGE':err?.type==='entity.parse.failed'?'INVALID_JSON':err?.code==='SQLITE_BUSY'?'STORAGE_BUSY':null;
  if(code){const e=new DomainError(code);res.status(e.status).json({error:e.error});return;}
  res.status(500).json({error:{code:'INTERNAL_ERROR',message:'내부 저장/처리 오류입니다.',retryable:false,nextActions:['contact_user'],projectId:null,runId:null,currentVersion:null,details:{reason:randomUUID()}}});
 };app.use(errors);return app;
};
