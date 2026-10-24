// Minimal QR Code generator (byte mode, error correction M, versions 1-3 = up to 42 characters).
// Enough for token numbers such as "GM-048". No external library needed.
const QR=(()=>{
 const V={1:{dc:16,ec:10},2:{dc:28,ec:16},3:{dc:44,ec:26}};
 const EXP=new Array(512),LOG=new Array(256);
 (()=>{let x=1;for(let i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&256)x^=0x11d}for(let i=255;i<512;i++)EXP[i]=EXP[i-255]})();
 const mul=(a,b)=>a&&b?EXP[LOG[a]+LOG[b]]:0;
 function rs(data,n){let g=[1];
  for(let i=0;i<n;i++){const ng=new Array(g.length+1).fill(0);for(let j=0;j<g.length;j++){ng[j]^=g[j];ng[j+1]^=mul(g[j],EXP[i])}g=ng}
  const r=new Array(n).fill(0);
  for(const b of data){const f=b^r[0];r.shift();r.push(0);for(let i=0;i<n;i++)r[i]^=mul(g[i+1],f)}
  return r}
 function encode(text){
  const bytes=[...new TextEncoder().encode(text)];
  let v=0;for(const k of [1,2,3]){if(bytes.length<=V[k].dc-2){v=k;break}}
  if(!v)throw new Error("QR text too long");
  const {dc,ec}=V[v],bits=[],put=(val,len)=>{for(let i=len-1;i>=0;i--)bits.push((val>>i)&1)};
  put(4,4);put(bytes.length,8);bytes.forEach(b=>put(b,8));put(0,Math.min(4,dc*8-bits.length));
  while(bits.length%8)bits.push(0);
  const cw=[];for(let i=0;i<bits.length;i+=8){let b=0;for(let j=0;j<8;j++)b=b<<1|bits[i+j];cw.push(b)}
  for(let p=0xEC;cw.length<dc;p^=0xEC^0x11)cw.push(p);
  const all=cw.concat(rs(cw,ec)),n=17+4*v;
  const m=Array.from({length:n},()=>new Array(n).fill(false)),fn=Array.from({length:n},()=>new Array(n).fill(false));
  const set=(x,y,d)=>{m[y][x]=d;fn[y][x]=true};
  const finder=(cx,cy)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=n||y>=n)continue;const d=Math.max(Math.abs(dx),Math.abs(dy));set(x,y,d!==2&&d!==4)}};
  finder(3,3);finder(n-4,3);finder(3,n-4);
  for(let i=8;i<n-8;i++){set(6,i,i%2===0);set(i,6,i%2===0)}
  if(v>=2){const p=n-7;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(p+dx,p+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1)}
  const fmt=(put,mask)=>{let r=mask;for(let i=0;i<10;i++)r=(r<<1)^((r>>9)*0x537);const bits=((mask<<10)|r)^0x5412,b=i=>((bits>>i)&1)===1;
   for(let i=0;i<=5;i++)put(8,i,b(i));put(8,7,b(6));put(8,8,b(7));put(7,8,b(8));for(let i=9;i<15;i++)put(14-i,8,b(i));
   for(let i=0;i<8;i++)put(n-1-i,8,b(i));for(let i=8;i<15;i++)put(8,n-15+i,b(i));put(8,n-8,true)};
  fmt(set,0); // reserve format areas
  const db=[];all.forEach(b=>{for(let i=7;i>=0;i--)db.push((b>>i)&1)});
  let k=0;
  for(let right=n-1;right>=1;right-=2){if(right===6)right=5;
   for(let vert=0;vert<n;vert++)for(let j=0;j<2;j++){const x=right-j,up=((right+1)&2)===0,y=up?n-1-vert:vert;
    if(!fn[y][x]&&k<db.length)m[y][x]=db[k++]===1}}
  const MASK=[(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,(x,y)=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,(x,y)=>x*y%2+x*y%3===0,(x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
  const pen=g=>{let p=0;
   for(let t=0;t<2;t++)for(let a=0;a<n;a++){let run=1,s="";
    for(let b=0;b<n;b++){const c=t?g[b][a]:g[a][b];s+=c?"1":"0";if(b){const pr=t?g[b-1][a]:g[a][b-1];if(c===pr){run++;if(run===5)p+=3;else if(run>5)p++}else run=1}}
    p+=40*((s.match(/1011101(?=0000)|(?<=0000)1011101/g)||[]).length)}
   for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++){const c=g[y][x];if(c===g[y][x+1]&&c===g[y+1][x]&&c===g[y+1][x+1])p+=3}
   let dark=0;g.forEach(r=>r.forEach(c=>{if(c)dark++}));return p+10*Math.floor(Math.abs(dark*20-n*n*10)/(n*n))};
  let best=null,bp=1e9;
  for(let mk=0;mk<8;mk++){const g=m.map(r=>r.slice());
   for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(!fn[y][x]&&MASK[mk](x,y))g[y][x]=!g[y][x];
   fmt((x,y,d)=>{g[y][x]=d},mk);const p=pen(g);if(p<bp){bp=p;best=g}}
  return best}
 const svg=(text,px=220)=>{const g=encode(text),n=g.length,q=4;let d="";
  g.forEach((r,y)=>r.forEach((c,x)=>{if(c)d+=`M${x+q},${y+q}h1v1h-1z`}));
  const safe=String(text).replace(/[&<>"']/g,"");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n+2*q} ${n+2*q}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${safe}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`};
 return{encode,svg}})();
if(typeof module!=="undefined")module.exports=QR;
