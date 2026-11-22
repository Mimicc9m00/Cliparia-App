import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const cloudFiles=['lives.json','continuo.json','publicacoes.json','cortes-gerados.json','contas.dat','panel-results.json'];
export function cloudKey(){
 const value=process.env.CLIPARIA_VAULT_KEY||'';
 if(!/^[a-f0-9]{64}$/i.test(value))throw Error('Defina CLIPARIA_VAULT_KEY com 64 caracteres hexadecimais.');
 return Buffer.from(value,'hex');
}
export function seal(data,key){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const encrypted=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data))),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]);
}
export function unseal(bytes,key){
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
 decipher.setAuthTag(bytes.subarray(12,28));
 return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
}
export function collectCloudFiles(dir){
 return Object.fromEntries(cloudFiles.filter(name=>fs.existsSync(path.join(dir,name))).map(name=>[name,fs.readFileSync(path.join(dir,name)).toString('base64')]));
}
export function restoreCloudFiles(dir,files){
 if(!files||Object.keys(files).some(name=>!cloudFiles.includes(name))||!files['contas.dat'])throw Error('O estado do Cliparia na nuvem é inválido.');
 for(const name of cloudFiles)if(typeof files[name]==='string')fs.writeFileSync(path.join(dir,name),Buffer.from(files[name],'base64'),{mode:0o600});
}
