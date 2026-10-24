import {afterEach}from'vitest';import type {Express}from'express';import type {Server}from'node:http';
const servers:Server[]=[];
export async function listenLocal(app:Express){return new Promise<Server>((resolve,reject)=>{const server=app.listen(0,'127.0.0.1',()=>{servers.push(server);resolve(server);});server.once('error',reject);});}
afterEach(async()=>{for(const s of servers.splice(0))if(s.listening)await new Promise<void>((resolve,reject)=>s.close(e=>e?reject(e):resolve()));});
