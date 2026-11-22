import test from 'node:test';
import assert from 'node:assert/strict';
import {faceTrack,framedUpperRight,webcamLayout} from '../vision.mjs';
import {overlaps} from '../layout.mjs';

const face={x:.82,y:.64,w:.08,h:.19,score:.95};

test('face recorrente num canto vira webcam e fica fora da gameplay',()=>{
 const layout=webcamLayout([[face],[{...face,x:.80}],[{...face,y:.65}],[]],16/9);
 assert.equal(layout.frame,'split');
 assert.equal(layout.autoLayout,true);
 assert.ok(!overlaps(layout.camera,layout.gameplay));
 assert.ok(layout.camera.x<face.x&&layout.camera.x+layout.camera.w>face.x+face.w);
});

test('rosto passageiro, rosto no centro e duas câmeras ambíguas preservam o quadro inteiro',()=>{
 assert.equal(webcamLayout([[face],[],[],[]],16/9).frame,'full');
 assert.equal(webcamLayout(Array(4).fill([{...face,x:.42,y:.35}]),16/9).frame,'full');
 const other={...face,x:.05,y:.15};
 assert.equal(webcamLayout(Array(4).fill([face,other]),16/9).frame,'full');
});

test('moldura estável no canto confirma a webcam mesmo com o rosto oculto',()=>{
 const width=640,height=360,frame=Buffer.alloc(width*height*3,95);
 for(let y=34;y<111;y++)for(let x=501;x<638;x++){
  const border=y<36||y>=109||x<503;
  const at=(y*width+x)*3;
  frame[at]=border?245:45;frame[at+1]=border?230:84;frame[at+2]=border?20:110;
 }
 const plain=Buffer.alloc(frame.length,95);
 assert.equal(framedUpperRight([plain,plain,plain],width,height).frame,'full');
 const layout=framedUpperRight([frame,frame,frame],width,height);
 assert.equal(layout.frame,'split');
 assert.ok(Math.abs(layout.camera.x-501/640)<.012);
 assert.ok(Math.abs(layout.camera.y-34/360)<.015);
});

test('câmera cheia segue o rosto entre quadros e ignora uma detecção isolada',()=>{
 const faceAt=x=>({...face,x,y:.24,w:.18,h:.36});
 const samples=[{time:1,faces:[faceAt(.18)]},{time:3,faces:[]},{time:4,faces:[faceAt(.42)]},{time:6,faces:[faceAt(.62)]}];
 const points=faceTrack(samples);
 assert.equal(points.length,3);
 assert.ok(points[0].x<points[1].x&&points[1].x<points[2].x);
 assert.equal(faceTrack(samples.slice(0,2)),null);
});
