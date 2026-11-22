export function region(value){
 if(!value)return null;
 const {x,y,w,h}=value;
 if(![x,y,w,h].every(Number.isFinite)||x<0||y<0||w<.02||h<.02||x+w>1.000001||y+h>1.000001)return null;
 return {x,y,w,h};
}
export function overlaps(a,b){
 return Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1e-5&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1e-5;
}
export function adjoiningRegion(camera,gameplay){
 if(gameplay)return overlaps(camera,gameplay)?null:gameplay;
 const {x,y,w,h}=camera;
 // A wide webcam in a chat layout has no useful automatic gameplay panel.
 if(w>=.52&&h>=.40)return null;
 return [{x:0,y:0,w:x,h:1},{x:x+w,y:0,w:1-x-w,h:1},{x:0,y:0,w:1,h:y},{x:0,y:y+h,w:1,h:1-y-h}]
  .filter(r=>r.w>=.45&&r.h>=.42&&r.w*r.h>=.30)
  .sort((a,b)=>b.w*b.h-a.w*a.h)[0]||null;
}
export function cropRegion(r){
 const even=term=>"'max(2,trunc("+term+"/2)*2)'";
 return 'crop=w='+even('iw*'+r.w)+':h='+even('ih*'+r.h)+':x=trunc(iw*'+r.x+'/2)*2:y=trunc(ih*'+r.y+'/2)*2';
}
