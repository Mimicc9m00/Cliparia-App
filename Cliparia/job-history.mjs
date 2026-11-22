import fs from 'node:fs';
import {randomUUID} from 'node:crypto';

function read(file){
 let raw;
 try{raw=fs.readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')return {};throw error;}
 try{
  const jobs=JSON.parse(raw.replace(/^\uFEFF/,''));
  if(Array.isArray(jobs)&&jobs.every(job=>typeof job?.id==='string'&&Array.isArray(job.clips)&&job.clips.every(clip=>clip?.posts&&typeof clip.posts==='object')))return {jobs,raw};
 }catch{}
 return {invalid:true};
}

function write(file,contents){
 fs.writeFileSync(file+'.tmp',contents,{flush:true});
 fs.renameSync(file+'.tmp',file);
}

export function openJobHistory(file){
 let current=read(file);
 if(!current.jobs){
  const pending=read(file+'.tmp'),backup=read(file+'.bak');
  if(pending.jobs||backup.jobs){
   current=pending.jobs?pending:backup;
   if(fs.existsSync(file))fs.copyFileSync(file,file+'.corrupt-'+randomUUID(),fs.constants.COPYFILE_EXCL);
   write(file,current.raw);
   console.warn('Histórico do Cliparia recuperado de uma cópia local.');
  }else if(current.invalid||pending.invalid||backup.invalid){
   throw Error('O histórico lives.json está danificado e nenhuma cópia local válida foi encontrada. Os arquivos foram preservados.');
  }
 }
 const jobs=current.jobs??[];
 let previous=current.raw,lastBackup=0;
 return {jobs,save(){
  const now=Date.now();
  if(previous&&now-lastBackup>=60_000){write(file+'.bak',previous);lastBackup=now;}
  const next=JSON.stringify(jobs);
  write(file,next);
  previous=next;
 }};
}
