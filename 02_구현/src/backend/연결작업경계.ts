import Database from 'better-sqlite3';
/** Read-only metadata boundary: no schema, credentials, projects or run state are changed. */
export function hasActiveConnectionRuns(dbPath:string):boolean{
 const db=new Database(dbPath,{readonly:true,fileMustExist:true});
 try{return !!db.prepare("SELECT 1 FROM runs WHERE status IN ('queued','running','waiting_for_user','cancel_requested') LIMIT 1").get();}finally{db.close();}
}
