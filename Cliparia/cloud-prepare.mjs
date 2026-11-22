import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {collectCloudFiles,seal} from './cloud-state.mjs';
import {openVault,cloudVault} from './social.mjs';
import {createCloudState} from './drive.mjs';

const dir=process.env.CLIPARIA_DATA||path.join(process.env.LOCALAPPDATA||os.homedir(),'Cliparia');
const marker=path.join(dir,'cloud-detached');
const credentialsFile=path.join(dir,'cloud-secrets.json');
const flags=new Set(process.argv.slice(2));
const lock=http.createServer((_req,res)=>{res.writeHead(503);res.end();});
try{
 if([...flags].some(flag=>!['--continuous','--posting'].includes(flag))||!flags.size)throw Error('Escolha --continuous, --posting ou os dois.');
 await new Promise((resolve,reject)=>{lock.once('error',reject);lock.listen(43871,'127.0.0.1',resolve);});
 if(fs.existsSync(marker)||fs.existsSync(credentialsFile))throw Error('Já existe uma preparação de nuvem nesta base.');
 const files=collectCloudFiles(dir);
 const decode=(name,fallback)=>files[name]?JSON.parse(Buffer.from(files[name],'base64')):fallback;
 const encode=(name,value)=>{files[name]=Buffer.from(JSON.stringify(value)).toString('base64');};
 const jobs=decode('lives.json',[]);
 if(jobs.some(job=>job.running||job.resumeOnRestart||job.clips.some(clip=>clip.safety?.status==='checking'||Object.values(clip.posts).some(post=>post.state==='Enviando'))))throw Error('Finalize as tarefas em andamento e feche o Cliparia antes de transferir.');
 if(jobs.some(job=>job.clips.some(clip=>Number.isSafeInteger(clip.posting?.order)&&clip.posting.targets.length&&!clip.drive)))throw Error('Há clipes na fila que ainda estão apenas no disco local.');
 const continuous=decode('continuo.json',{sources:[]});
 const publications=decode('publicacoes.json',{nextAt:0,slot:null,records:{},automatic:{configs:{}}});
 if(flags.has('--continuous')&&!continuous.sources.length)throw Error('Cadastre pelo menos uma fonte no Contínuo.');
 if(flags.has('--posting')&&!Object.keys(publications.automatic?.configs||{}).length)throw Error('Configure os destinos da fila antes de transferir.');
 continuous.enabled=flags.has('--continuous');
 publications.automatic={...publications.automatic,configs:publications.automatic?.configs||{},enabled:flags.has('--posting')};
 encode('continuo.json',continuous);
 encode('publicacoes.json',publications);
 openVault(dir);
 const key=randomBytes(32);
 files['contas.dat']=cloudVault(key).toString('base64');
 const bootstrap=cloudVault(key,true).toString('base64');
 const id=await createCloudState(seal({version:1,files},key));
 fs.writeFileSync(credentialsFile,JSON.stringify({CLIPARIA_CLOUD_FILE_ID:id,CLIPARIA_VAULT_KEY:key.toString('hex'),CLIPARIA_CLOUD_DRIVE:bootstrap},null,2),{flag:'wx',mode:0o600,flush:true});
 fs.writeFileSync(marker,id,{flag:'wx',flush:true});
 console.log('Estado protegido salvo no Drive. Segredos para as Actions em '+credentialsFile);
}catch(error){
 console.error(error.code==='EADDRINUSE'?'Feche o servidor do Cliparia antes de transferir a base.':error.message);
 process.exitCode=1;
}finally{lock.close();}
