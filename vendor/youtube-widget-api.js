(function(){'use strict';var n,aa=typeof Object.create=="function"?Object.create:function(a){function b(){}
b.prototype=a;return new b},p=typeof Object.defineProperties=="function"?Object.defineProperty:function(a,b,c){if(a==Array.prototype||a==Object.prototype)return a;
a[b]=c.value;return a};
function ba(a){a=["object"==typeof globalThis&&globalThis,a,"object"==typeof window&&window,"object"==typeof self&&self,"object"==typeof global&&global];for(var b=0;b<a.length;++b){var c=a[b];if(c&&c.Math==Math)return c}throw Error("Cannot find global object");}
var q=ba(this);function r(a,b){if(b)a:{var c=q;a=a.split(".");for(var e=0;e<a.length-1;e++){var h=a[e];if(!(h in c))break a;c=c[h]}a=a[a.length-1];e=c[a];b=b(e);b!=e&&b!=null&&p(c,a,{configurable:!0,writable:!0,value:b})}}
var t;if(typeof Object.setPrototypeOf=="function")t=Object.setPrototypeOf;else{var v;a:{var ca={a:!0},da={};try{da.__proto__=ca;v=da.a;break a}catch(a){}v=!1}t=v?function(a,b){a.__proto__=b;if(a.__proto__!==b)throw new TypeError(a+" is not extensible");return a}:null}var ea=t;
function fa(a){var b=0;return function(){return b<a.length?{done:!1,value:a[b++]}:{done:!0}}}
function x(a){var b=typeof Symbol!="undefined"&&Symbol.iterator&&a[Symbol.iterator];if(b)return b.call(a);if(typeof a.length=="number")return{next:fa(a)};throw Error(String(a)+" is not an iterable or ArrayLike");}
r("Symbol",function(a){function b(k){if(this instanceof b)throw new TypeError("Symbol is not a constructor");return new c(e+(k||"")+"_"+h++,k)}
function c(k,f){this.h=k;p(this,"description",{configurable:!0,writable:!0,value:f})}
if(a)return a;c.prototype.toString=function(){return this.h};
var e="jscomp_symbol_"+(Math.random()*1E9>>>0)+"_",h=0;return b});
r("Symbol.iterator",function(a){if(a)return a;a=Symbol("Symbol.iterator");p(Array.prototype,a,{configurable:!0,writable:!0,value:function(){return ha(fa(this))}});
return a});
function ha(a){a={next:a};a[Symbol.iterator]=function(){return this};
return a}
r("Promise",function(a){function b(f){this.i=0;this.j=void 0;this.h=[];this.A=!1;var d=this.l();try{f(d.resolve,d.reject)}catch(g){d.reject(g)}}
function c(){this.h=null}
function e(f){return f instanceof b?f:new b(function(d){d(f)})}
if(a)return a;c.prototype.i=function(f){if(this.h==null){this.h=[];var d=this;this.j(function(){d.m()})}this.h.push(f)};
var h=q.setTimeout;c.prototype.j=function(f){h(f,0)};
c.prototype.m=function(){for(;this.h&&this.h.length;){var f=this.h;this.h=[];for(var d=0;d<f.length;++d){var g=f[d];f[d]=null;try{g()}catch(l){this.l(l)}}}this.h=null};
c.prototype.l=function(f){this.j(function(){throw f;})};
b.prototype.l=function(){function f(l){return function(m){g||(g=!0,l.call(d,m))}}
var d=this,g=!1;return{resolve:f(this.L),reject:f(this.m)}};
b.prototype.L=function(f){if(f===this)this.m(new TypeError("A Promise cannot resolve to itself"));else if(f instanceof b)this.N(f);else{a:switch(typeof f){case "object":var d=f!=null;break a;case "function":d=!0;break a;default:d=!1}d?this.K(f):this.u(f)}};
b.prototype.K=function(f){var d=void 0;try{d=f.then}catch(g){this.m(g);return}typeof d=="function"?this.O(d,f):this.u(f)};
b.prototype.m=function(f){this.B(2,f)};
b.prototype.u=function(f){this.B(1,f)};
b.prototype.B=function(f,d){if(this.i!=0)throw Error("Cannot settle("+f+", "+d+"): Promise already settled in state"+this.i);this.i=f;this.j=d;this.i===2&&this.M();this.C()};
b.prototype.M=function(){var f=this;h(function(){if(f.J()){var d=q.console;typeof d!=="undefined"&&d.error(f.j)}},1)};
b.prototype.J=function(){if(this.A)return!1;var f=q.CustomEvent,d=q.Event,g=q.dispatchEvent;if(typeof g==="undefined")return!0;typeof f==="function"?f=new f("unhandledrejection",{cancelable:!0}):typeof d==="function"?f=new d("unhandledrejection",{cancelable:!0}):(f=q.document.createEvent("CustomEvent"),f.initCustomEvent("unhandledrejection",!1,!0,f));f.promise=this;f.reason=this.j;return g(f)};
b.prototype.C=function(){if(this.h!=null){for(var f=0;f<this.h.length;++f)k.i(this.h[f]);this.h=null}};
var k=new c;b.prototype.N=function(f){var d=this.l();f.D(d.resolve,d.reject)};
b.prototype.O=function(f,d){var g=this.l();try{f.call(d,g.resolve,g.reject)}catch(l){g.reject(l)}};
b.prototype.then=function(f,d){function g(w,z){return typeof w=="function"?function(P){try{l(w(P))}catch(Q){m(Q)}}:z}
var l,m,u=new b(function(w,z){l=w;m=z});
this.D(g(f,l),g(d,m));return u};
b.prototype.catch=function(f){return this.then(void 0,f)};
b.prototype.D=function(f,d){function g(){switch(l.i){case 1:f(l.j);break;case 2:d(l.j);break;default:throw Error("Unexpected state: "+l.i);}}
var l=this;this.h==null?k.i(g):this.h.push(g);this.A=!0};
b.resolve=e;b.reject=function(f){return new b(function(d,g){g(f)})};
b.race=function(f){return new b(function(d,g){for(var l=x(f),m=l.next();!m.done;m=l.next())e(m.value).D(d,g)})};
b.all=function(f){var d=x(f),g=d.next();return g.done?e([]):new b(function(l,m){function u(P){return function(Q){w[P]=Q;z--;z==0&&l(w)}}
var w=[],z=0;do w.push(void 0),z++,e(g.value).D(u(w.length-1),m),g=d.next();while(!g.done)})};
return b});
function y(a,b){return Object.prototype.hasOwnProperty.call(a,b)}
var ia=typeof Object.assign=="function"?Object.assign:function(a,b){if(a==null)throw new TypeError("No nullish arg");a=Object(a);for(var c=1;c<arguments.length;c++){var e=arguments[c];if(e)for(var h in e)y(e,h)&&(a[h]=e[h])}return a};
r("Object.assign",function(a){return a||ia});
r("Symbol.dispose",function(a){return a?a:Symbol("Symbol.dispose")});
r("WeakMap",function(a){function b(g){this.h=(d+=Math.random()+1).toString();if(g){g=x(g);for(var l;!(l=g.next()).done;)l=l.value,this.set(l[0],l[1])}}
function c(){}
function e(g){var l=typeof g;return l==="object"&&g!==null||l==="function"}
function h(g){if(!y(g,f)){var l=new c;p(g,f,{value:l})}}
function k(g){var l=Object[g];l&&(Object[g]=function(m){if(m instanceof c)return m;Object.isExtensible(m)&&h(m);return l(m)})}
if(function(){if(!a||!Object.seal)return!1;try{var g=Object.seal({}),l=Object.seal({}),m=new a([[g,2],[l,3]]);if(m.get(g)!=2||m.get(l)!=3)return!1;m.delete(g);m.set(l,4);return!m.has(g)&&m.get(l)==4}catch(u){return!1}}())return a;
var f="$jscomp_hidden_"+Math.random();k("freeze");k("preventExtensions");k("seal");var d=0;b.prototype.set=function(g,l){if(!e(g))throw Error("Invalid WeakMap key");h(g);if(!y(g,f))throw Error("WeakMap key fail: "+g);g[f][this.h]=l;return this};
b.prototype.get=function(g){return e(g)&&y(g,f)?g[f][this.h]:void 0};
b.prototype.has=function(g){return e(g)&&y(g,f)&&y(g[f],this.h)};
b.prototype.delete=function(g){return e(g)&&y(g,f)&&y(g[f],this.h)?delete g[f][this.h]:!1};
return b});
r("Map",function(a){function b(){var d={};return d.previous=d.next=d.head=d}
function c(d,g){var l=d[1];return ha(function(){if(l){for(;l.head!=d[1];)l=l.previous;for(;l.next!=l.head;)return l=l.next,{done:!1,value:g(l)};l=null}return{done:!0,value:void 0}})}
function e(d,g){var l=g&&typeof g;l=="object"||l=="function"?k.has(g)?l=k.get(g):(l=""+ ++f,k.set(g,l)):l="p_"+g;var m=d[0][l];if(m&&y(d[0],l))for(d=0;d<m.length;d++){var u=m[d];if(g!==g&&u.key!==u.key||g===u.key)return{id:l,list:m,index:d,entry:u}}return{id:l,list:m,index:-1,entry:void 0}}
function h(d){this[0]={};this[1]=b();this.size=0;if(d){d=x(d);for(var g;!(g=d.next()).done;)g=g.value,this.set(g[0],g[1])}}
if(function(){if(!a||typeof a!="function"||!a.prototype.entries||typeof Object.seal!="function")return!1;try{var d=Object.seal({x:4}),g=new a(x([[d,"s"]]));if(g.get(d)!="s"||g.size!=1||g.get({x:4})||g.set({x:4},"t")!=g||g.size!=2)return!1;var l=g.entries(),m=l.next();if(m.done||m.value[0]!=d||m.value[1]!="s")return!1;m=l.next();return m.done||m.value[0].x!=4||m.value[1]!="t"||!l.next().done?!1:!0}catch(u){return!1}}())return a;
var k=new WeakMap;h.prototype.set=function(d,g){d=d===0?0:d;var l=e(this,d);l.list||(l.list=this[0][l.id]=[]);l.entry?l.entry.value=g:(l.entry={next:this[1],previous:this[1].previous,head:this[1],key:d,value:g},l.list.push(l.entry),this[1].previous.next=l.entry,this[1].previous=l.entry,this.size++);return this};
h.prototype.delete=function(d){d=e(this,d);return d.entry&&d.list?(d.list.splice(d.index,1),d.list.length||delete this[0][d.id],d.entry.previous.next=d.entry.next,d.entry.next.previous=d.entry.previous,d.entry.head=null,this.size--,!0):!1};
h.prototype.clear=function(){this[0]={};this[1]=this[1].previous=b();this.size=0};
h.prototype.has=function(d){return!!e(this,d).entry};
h.prototype.get=function(d){return(d=e(this,d).entry)&&d.value};
h.prototype.entries=function(){return c(this,function(d){return[d.key,d.value]})};
h.prototype.keys=function(){return c(this,function(d){return d.key})};
h.prototype.values=function(){return c(this,function(d){return d.value})};
h.prototype.forEach=function(d,g){for(var l=this.entries(),m;!(m=l.next()).done;)m=m.value,d.call(g,m[1],m[0],this)};
h.prototype[Symbol.iterator]=h.prototype.entries;var f=0;return h});
r("Set",function(a){function b(c){this.h=new Map;if(c){c=x(c);for(var e;!(e=c.next()).done;)this.add(e.value)}this.size=this.h.size}
if(function(){if(!a||typeof a!="function"||!a.prototype.entries||typeof Object.seal!="function")return!1;try{var c=Object.seal({x:4}),e=new a(x([c]));if(!e.has(c)||e.size!=1||e.add(c)!=e||e.size!=1||e.add({x:4})!=e||e.size!=2)return!1;var h=e.entries(),k=h.next();if(k.done||k.value[0]!=c||k.value[1]!=c)return!1;k=h.next();return k.done||k.value[0]==c||k.value[0].x!=4||k.value[1]!=k.value[0]?!1:h.next().done}catch(f){return!1}}())return a;
b.prototype.add=function(c){c=c===0?0:c;this.h.set(c,c);this.size=this.h.size;return this};
b.prototype.delete=function(c){c=this.h.delete(c);this.size=this.h.size;return c};
b.prototype.clear=function(){this.h.clear();this.size=0};
b.prototype.has=function(c){return this.h.has(c)};
b.prototype.entries=function(){return this.h.entries()};
b.prototype.values=function(){return this.h.values()};
b.prototype.keys=b.prototype.values;b.prototype[Symbol.iterator]=b.prototype.values;b.prototype.forEach=function(c,e){var h=this;this.h.forEach(function(k){return c.call(e,k,k,h)})};
return b});
r("Array.prototype.find",function(a){return a?a:function(b,c){a:{var e=this;e instanceof String&&(e=String(e));for(var h=e.length,k=0;k<h;k++){var f=e[k];if(b.call(c,f,k,e)){b=f;break a}}b=void 0}return b}});
r("Array.from",function(a){return a?a:function(b,c,e){c=c!=null?c:function(d){return d};
var h=[],k=typeof Symbol!="undefined"&&Symbol.iterator&&b[Symbol.iterator];if(typeof k=="function"){b=k.call(b);for(var f=0;!(k=b.next()).done;)h.push(c.call(e,k.value,f++))}else for(k=b.length,f=0;f<k;f++)h.push(c.call(e,b[f],f));return h}});/*

 Copyright The Closure Library Authors.
 SPDX-License-Identifier: Apache-2.0
*/
var A=this||self;function B(a){var b=typeof a;return b=="object"&&a!=null||b=="function"}
function ja(a){return Object.prototype.hasOwnProperty.call(a,C)&&a[C]||(a[C]=++ka)}
var C="closure_uid_"+(Math.random()*1E9>>>0),ka=0;function D(a,b){a=a.split(".");for(var c=A,e;a.length&&(e=a.shift());)a.length||b===void 0?c[e]&&c[e]!==Object.prototype[e]?c=c[e]:c=c[e]={}:c[e]=b}
function la(a,b){function c(){}
c.prototype=b.prototype;a.I=b.prototype;a.prototype=new c;a.prototype.constructor=a;a.X=function(e,h,k){for(var f=Array(arguments.length-2),d=2;d<arguments.length;d++)f[d-2]=arguments[d];return b.prototype[h].apply(e,f)}}
;var ma=Array.prototype.indexOf?function(a,b){return Array.prototype.indexOf.call(a,b,void 0)}:function(a,b){if(typeof a==="string")return typeof b!=="string"||b.length!=1?-1:a.indexOf(b,0);
for(var c=0;c<a.length;c++)if(c in a&&a[c]===b)return c;return-1},E=Array.prototype.forEach?function(a,b,c){Array.prototype.forEach.call(a,b,c)}:function(a,b,c){for(var e=a.length,h=typeof a==="string"?a.split(""):a,k=0;k<e;k++)k in h&&b.call(c,h[k],k,a)};
function na(a,b){b=ma(a,b);b>=0&&Array.prototype.splice.call(a,b,1)}
function oa(a){return Array.prototype.concat.apply([],arguments)}
function pa(a){var b=a.length;if(b>0){for(var c=Array(b),e=0;e<b;e++)c[e]=a[e];return c}return[]}
;function qa(a,b){this.j=a;this.l=b;this.i=0;this.h=null}
qa.prototype.get=function(){if(this.i>0){this.i--;var a=this.h;this.h=a.next;a.next=null}else a=this.j();return a};function ra(a){A.setTimeout(function(){throw a;},0)}
;function F(){this.i=this.h=null}
F.prototype.add=function(a,b){var c=sa.get();c.set(a,b);this.i?this.i.next=c:this.h=c;this.i=c};
F.prototype.remove=function(){var a=null;this.h&&(a=this.h,this.h=this.h.next,this.h||(this.i=null),a.next=null);return a};
var sa=new qa(function(){return new G},function(a){return a.reset()});
function G(){this.next=this.scope=this.h=null}
G.prototype.set=function(a,b){this.h=a;this.scope=b;this.next=null};
G.prototype.reset=function(){this.next=this.scope=this.h=null};var H,I=!1,ta=new F;function ua(a){H||va();I||(H(),I=!0);ta.add(a,void 0)}
function va(){var a=Promise.resolve(void 0);H=function(){a.then(wa)}}
function wa(){for(var a;a=ta.remove();){try{a.h.call(a.scope)}catch(c){ra(c)}var b=sa;b.l(a);b.i<100&&(b.i++,a.next=b.h,b.h=a)}I=!1}
;function J(){this.j=this.j;this.l=this.l}
J.prototype.j=!1;J.prototype.dispose=function(){this.j||(this.j=!0,this.F())};
J.prototype[Symbol.dispose]=function(){this.dispose()};
J.prototype.addOnDisposeCallback=function(a,b){this.j?b!==void 0?a.call(b):a():(this.l||(this.l=[]),b&&(a=a.bind(b)),this.l.push(a))};
J.prototype.F=function(){if(this.l)for(;this.l.length;)this.l.shift()()};function xa(a){var b={},c;for(c in a)b[c]=a[c];return b}
;var ya=/&/g,za=/</g,Aa=/>/g,Ba=/"/g,Ca=/'/g,Da=/\x00/g,Ea=/[\x00&<>"']/;/*

 Copyright Google LLC
 SPDX-License-Identifier: Apache-2.0
*/
function K(a){this.h=a}
K.prototype.toString=function(){return this.h};
var Fa=new K("about:invalid#zClosurez");function L(a){this.R=a}
function M(a){return new L(function(b){return b.substr(0,a.length+1).toLowerCase()===a+":"})}
var Ga=[M("data"),M("http"),M("https"),M("mailto"),M("ftp"),new L(function(a){return/^[^:]*([/?#]|$)/.test(a)})],Ha=/^\s*(?!javascript:)(?:[\w+.-]+:|[^:/?#]*(?:[/?#]|$))/i;var Ia={W:0,U:1,V:2,0:"FORMATTED_HTML_CONTENT",1:"EMBEDDED_INTERNAL_CONTENT",2:"EMBEDDED_TRUSTED_EXTERNAL_CONTENT"};function N(a,b){b=Error.call(this,a+" cannot be used with intent "+Ia[b]);this.message=b.message;"stack"in b&&(this.stack=b.stack);this.type=a;this.name="TypeCannotBeUsedWithIframeIntentError"}
var O=Error;N.prototype=aa(O.prototype);N.prototype.constructor=N;if(ea)ea(N,O);else for(var R in O)if(R!="prototype")if(Object.defineProperties){var Ja=Object.getOwnPropertyDescriptor(O,R);Ja&&Object.defineProperty(N,R,Ja)}else N[R]=O[R];N.I=O.prototype;function Ka(a){Ea.test(a)&&(a.indexOf("&")!=-1&&(a=a.replace(ya,"&amp;")),a.indexOf("<")!=-1&&(a=a.replace(za,"&lt;")),a.indexOf(">")!=-1&&(a=a.replace(Aa,"&gt;")),a.indexOf('"')!=-1&&(a=a.replace(Ba,"&quot;")),a.indexOf("'")!=-1&&(a=a.replace(Ca,"&#39;")),a.indexOf("\x00")!=-1&&(a=a.replace(Da,"&#0;")));return a}
;function S(a){J.call(this);this.A=1;this.m=[];this.u=0;this.h=[];this.i={};this.B=!!a}
la(S,J);n=S.prototype;n.subscribe=function(a,b,c){var e=this.i[a];e||(e=this.i[a]=[]);var h=this.A;this.h[h]=a;this.h[h+1]=b;this.h[h+2]=c;this.A=h+3;e.push(h);return h};
n.unsubscribe=function(a,b,c){if(a=this.i[a]){var e=this.h;if(a=a.find(function(h){return e[h+1]==b&&e[h+2]==c}))return this.G(a)}return!1};
n.G=function(a){var b=this.h[a];if(b){var c=this.i[b];this.u!=0?(this.m.push(a),this.h[a+1]=function(){}):(c&&na(c,a),delete this.h[a],delete this.h[a+1],delete this.h[a+2])}return!!b};
n.H=function(a,b){var c=this.i[a];if(c){var e=Array(arguments.length-1),h=arguments.length,k;for(k=1;k<h;k++)e[k-1]=arguments[k];if(this.B)for(k=0;k<c.length;k++)h=c[k],La(this.h[h+1],this.h[h+2],e);else{this.u++;try{for(k=0,h=c.length;k<h&&!this.j;k++){var f=c[k];this.h[f+1].apply(this.h[f+2],e)}}finally{if(this.u--,this.m.length>0&&this.u==0)for(;c=this.m.pop();)this.G(c)}}return k!=0}return!1};
function La(a,b,c){ua(function(){a.apply(b,c)})}
n.clear=function(a){if(a){var b=this.i[a];b&&(b.forEach(this.G,this),delete this.i[a])}else this.h.length=0,this.i={}};
n.F=function(){S.I.F.call(this);this.clear();this.m.length=0};var Ma=RegExp("^(?:([^:/?#.]+):)?(?://(?:([^\\\\/?#]*)@)?([^\\\\/?#]*?)(?::([0-9]+))?(?=[\\\\/?#]|$))?([^?#]+)?(?:\\?([^#]*))?(?:#([\\s\\S]*))?$");function Na(a){var b=a.match(Ma);a=b[1];var c=b[2],e=b[3];b=b[4];var h="";a&&(h+=a+":");e&&(h+="//",c&&(h+=c+"@"),h+=e,b&&(h+=":"+b));return h}
function Oa(a,b,c){if(Array.isArray(b))for(var e=0;e<b.length;e++)Oa(a,String(b[e]),c);else b!=null&&c.push(a+(b===""?"":"="+encodeURIComponent(String(b))))}
var Pa=/#|$/;var T={},Qa=[],U=new S,V={};function Ra(){var a=x(Qa),b=a.next(),c;try{for(;!b.done;b=a.next()){var e=b.value;e()}}finally{b&&!b.done&&(c=a.return)&&c.call(a)}}
function W(a,b){return a.tagName.toLowerCase().substring(0,3)==="yt:"?a.getAttribute(b):a.dataset?a.dataset[b]:a.getAttribute("data-"+b)}
function Sa(a){U.H.apply(U,arguments)}
;function Ta(a){return(a.search("cue")===0||a.search("load")===0)&&a!=="loadModule"}
function Ua(a){return a.search("get")===0||a.search("is")===0}
;var Va=window;
function X(a,b){this.v={};this.playerInfo={};this.videoTitle="";this.l=this.h=null;this.i=0;this.u=!1;this.m=[];this.j=null;this.C={};this.options=null;this.B=this.S.bind(this);if(!a)throw Error("YouTube player element ID required.");this.id=ja(this);b=Object.assign({title:"video player",videoId:"",width:640,height:360},b||{});var c=document;if(a=typeof a==="string"?c.getElementById(a):a){c=a.tagName.toLowerCase()==="iframe";b.host||(b.host=c?Na(a.src):"https://www.youtube.com");this.options=b||{};
b=[this.options,window.YTConfig||{}];for(var e=0;e<b.length;e++)b[e].host&&(b[e].host=b[e].host.toString().replace("http://","https://"));if(!c){b=document.createElement("iframe");c=a.attributes;e=0;for(var h=c.length;e<h;e++){var k=c[e].value;k!=null&&k!==""&&k!=="null"&&b.setAttribute(c[e].name,k)}b.setAttribute("frameBorder","0");b.setAttribute("allowfullscreen","");b.setAttribute("allow","accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");b.setAttribute("referrerPolicy",
"strict-origin-when-cross-origin");b.setAttribute("title","YouTube "+Y(this,"title"));(c=Y(this,"width"))&&b.setAttribute("width",c.toString());(c=Y(this,"height"))&&b.setAttribute("height",c.toString());this.l=a;(c=a.parentNode)&&c.replaceChild(b,a);a=Wa(this,b);c=""+Y(this,"host")+Xa(this)+"?";e=[];for(var f in a)Oa(f,a[f],e);f=c+e.join("&");if(Va.yt_embedsEnableIframeSrcWithIntent){var d=d===void 0?Ga:d;a:if(d=d===void 0?Ga:d,f instanceof K)d=f;else{for(a=0;a<d.length;++a)if(c=d[a],c instanceof
L&&c.R(f)){d=new K(f);break a}d=void 0}d=d||Fa;b.removeAttribute("srcdoc");f="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation".split(" ");b.setAttribute("sandbox","");for(a=0;a<f.length;a++)b.sandbox.supports&&!b.sandbox.supports(f[a])||b.sandbox.add(f[a]);if(d instanceof K)if(d instanceof K)d=d.h;else throw Error("");else d=Ha.test(d)?d:void 0;d!==void 0&&(b.src=d);b.sandbox.add("allow-presentation","allow-top-navigation")}else b.src=
f;a=b}this.h=a;this.h.id||(this.h.id="widget"+ja(this.h));T[this.h.id]=this;if(window.postMessage){this.j=new S;Ya(this);b=Y(this,"events");for(var g in b)b.hasOwnProperty(g)&&this.addEventListener(g,b[g]);for(var l in V)V.hasOwnProperty(l)&&Za(this,l)}}}
n=X.prototype;n.setSize=function(a,b){this.h.width=a.toString();this.h.height=b.toString();return this};
n.getIframe=function(){return this.h};
n.addEventListener=function(a,b){var c=b;typeof b==="string"&&(c=function(){window[b].apply(window,arguments)});
if(!c)return this;this.j.subscribe(a,c);$a(this,a);return this};
function Za(a,b){b=b.split(".");if(b.length===2){var c=b[1];"player"===b[0]&&$a(a,c)}}
n.destroy=function(){this.h&&this.h.id&&(T[this.h.id]=null);var a=this.j;a&&typeof a.dispose=="function"&&a.dispose();if(this.l){a=this.l;var b=this.h,c=b.parentNode;c&&c.replaceChild(a,b)}else(a=this.h)&&a.parentNode&&a.parentNode.removeChild(a);Z&&(Z[this.id]=null);this.options=null;this.h&&this.A&&this.h.removeEventListener("load",this.A);this.l=this.h=null};
function ab(a,b,c){c=c||[];c=Array.prototype.slice.call(c);b={event:"command",func:b,args:c};a.u?a.sendMessage(b):a.m.push(b)}
n.S=function(){bb(this)||clearInterval(this.i)};
function bb(a){if(!a.h||!a.h.contentWindow)return!1;a.sendMessage({event:"listening"});return!0}
function Ya(a){cb(a,a.id,String(Y(a,"host")));var b=Number(Va.yt_embedsWidgetPollIntervalMs)||250;a.i=setInterval(a.B,b);a.h&&(a.A=function(){clearInterval(a.i);a.i=setInterval(a.B,b)},a.h.addEventListener("load",a.A))}
function db(a){var b=a.getBoundingClientRect();a=Math.max(0,Math.min(b.bottom,window.innerHeight||document.documentElement.clientHeight)-Math.max(b.top,0))*Math.max(0,Math.min(b.right,window.innerWidth||document.documentElement.clientWidth)-Math.max(b.left,0));a=(b=b.height*b.width)?a/b:0;return document.visibilityState==="hidden"||a<.5?1:a<.75?2:a<.85?3:a<.95?4:a<1?5:6}
function $a(a,b){a.C[b]||(a.C[b]=!0,ab(a,"addEventListener",[b]))}
n.sendMessage=function(a){a.id=this.id;a.channel="widget";a=JSON.stringify(a);var b=Na(this.h.src||"").replace("http:","https:");if(this.h.contentWindow)try{this.h.contentWindow.postMessage(a,b)}catch(c){if(c.name&&c.name==="SyntaxError")c.message&&c.message.indexOf("target origin ''")>0||console&&console.warn&&console.warn(c);else throw c;}else console&&console.warn&&console.warn("The YouTube player is not attached to the DOM. API calls should be made after the onReady event. See more: https://developers.google.com/youtube/iframe_api_reference#Events")};
function Xa(a){if((a=String(Y(a,"videoId")))&&(a.length!==11||!a.match(/^[a-zA-Z0-9\-_]+$/)))throw Error("Invalid video id");return"/embed/"+a}
function Wa(a,b){var c=Y(a,"playerVars");c?c=xa(c):c={};window!==window.top&&document.referrer&&(c.widget_referrer=document.referrer.substring(0,256));var e=Y(a,"embedConfig");if(e){if(B(e))try{e=JSON.stringify(e)}catch(h){console.error("Invalid embed config JSON",h)}c.embed_config=e}c.enablejsapi=window.postMessage?1:0;window.location.host&&(c.origin=window.location.protocol+"//"+window.location.host);c.widgetid=a.id;window.location.href&&E(["debugjs","debugcss"],function(h){var k=window.location.href;
var f=k.search(Pa);b:{var d=0;for(var g=h.length;(d=k.indexOf(h,d))>=0&&d<f;){var l=k.charCodeAt(d-1);if(l==38||l==63)if(l=k.charCodeAt(d+g),!l||l==61||l==38||l==35)break b;d+=g+1}d=-1}if(d<0)k=null;else{g=k.indexOf("&",d);if(g<0||g>f)g=f;d+=h.length+1;k=decodeURIComponent(k.slice(d,g!==-1?g:0).replace(/\+/g," "))}k!==null&&(c[h]=k)});
window.location.href&&(c.forigin=window.location.href);a=window.location.ancestorOrigins;c.aoriginsup=a===void 0?0:1;a&&a.length>0&&(c.aorigins=Array.from(a).join(","));window.document.referrer&&(c.gporigin=window.document.referrer);b&&(c.vf=db(b));return c}
function eb(a,b){if(B(b)){for(var c in b)b.hasOwnProperty(c)&&(a.playerInfo[c]=b[c]);a.playerInfo.hasOwnProperty("videoData")&&(b=a.playerInfo.videoData,b.hasOwnProperty("title")&&b.title?(b=b.title,b!==a.videoTitle&&(a.videoTitle=b,a.h.setAttribute("title",b))):(a.videoTitle="",a.h.setAttribute("title","YouTube "+Y(a,"title"))))}}
function fb(a,b){b=x(b);var c=b.next(),e;try{for(var h={};!c.done;h={o:void 0},c=b.next())h.o=c.value,a[h.o]||(h.o==="getCurrentTime"?a[h.o]=function(){var k=this.playerInfo.currentTime;if(this.playerInfo.playerState===1){var f=(Date.now()/1E3-this.playerInfo.currentTimeLastUpdated_)*this.playerInfo.playbackRate;f>0&&(k+=Math.min(f,1))}return k}:Ta(h.o)?a[h.o]=function(k){return function(){this.playerInfo={};
this.v={};ab(this,k.o,arguments);return this}}(h):Ua(h.o)?a[h.o]=function(k){return function(){var f=k.o,d=0;
f.search("get")===0?d=3:f.search("is")===0&&(d=2);return this.playerInfo[f.charAt(d).toLowerCase()+f.substring(d+1)]}}(h):a[h.o]=function(k){return function(){ab(this,k.o,arguments);
return this}}(h))}finally{c&&!c.done&&(e=b.return)&&e.call(b)}}
n.getVideoEmbedCode=function(){var a=""+Y(this,"host")+Xa(this),b=Number(Y(this,"width")),c=Number(Y(this,"height"));if(isNaN(b)||isNaN(c))throw Error("Invalid width or height property");b=Math.floor(b);c=Math.floor(c);var e=this.videoTitle;a=Ka(a);e=Ka(e!=null?e:"YouTube video player");return'<iframe width="'+b+'" height="'+c+'" src="'+a+'" title="'+(e+'" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>')};
n.getOptions=function(a){return this.v.namespaces?a?this.v[a]?this.v[a].options||[]:[]:this.v.namespaces||[]:[]};
n.getOption=function(a,b){if(this.v.namespaces&&a&&b&&this.v[a])return this.v[a][b]};
function Y(a,b){a=[a.options,window.YTConfig||{}];for(var c=0;c<a.length;c++){var e=a[c][b];if(e!==void 0)return e}return null}
var Z=null,gb=null;function hb(a){if(a.tagName.toLowerCase()!=="iframe"){var b=W(a,"videoid");b&&(b={videoId:b,width:W(a,"width"),height:W(a,"height")},new X(a,b))}}
function cb(a,b,c){Z||(Z={},gb=new Set,ib.addEventListener("message",function(e){a:if(gb.has(e.origin)){try{var h=JSON.parse(e.data)}catch(d){break a}var k=Z[h.id];if(k&&e.origin===k.P)switch(e=k.T,e.u=!0,e.u&&(E(e.m,e.sendMessage,e),e.m.length=0),k=h.event,h=h.info,k){case "apiInfoDelivery":if(B(h))for(var f in h)h.hasOwnProperty(f)&&(e.v[f]=h[f]);break;case "infoDelivery":eb(e,h);break;case "initialDelivery":B(h)&&(clearInterval(e.i),e.playerInfo={},e.v={},fb(e,h.apiInterface),eb(e,h));break;case "alreadyInitialized":clearInterval(e.i);
break;case "readyToListen":bb(e);break;default:e.j.j||(f={target:e,data:h},e.j.H(k,f),Sa("player."+k,f))}}}));
Z[b]={T:a,P:c};gb.add(c)}
var ib=window;D("YT.PlayerState.UNSTARTED",-1);D("YT.PlayerState.ENDED",0);D("YT.PlayerState.PLAYING",1);D("YT.PlayerState.PAUSED",2);D("YT.PlayerState.BUFFERING",3);D("YT.PlayerState.CUED",5);D("YT.get",function(a){return T[a]});
D("YT.scan",Ra);D("YT.subscribe",function(a,b,c){U.subscribe(a,b,c);V[a]=!0;for(var e in T)T.hasOwnProperty(e)&&Za(T[e],a)});
D("YT.unsubscribe",function(a,b,c){U.unsubscribe(a,b,c)});
D("YT.Player",X);X.prototype.destroy=X.prototype.destroy;X.prototype.setSize=X.prototype.setSize;X.prototype.getIframe=X.prototype.getIframe;X.prototype.addEventListener=X.prototype.addEventListener;X.prototype.getVideoEmbedCode=X.prototype.getVideoEmbedCode;X.prototype.getOptions=X.prototype.getOptions;X.prototype.getOption=X.prototype.getOption;Qa.push(function(a){var b=a;b||(b=document);a=pa(b.getElementsByTagName("yt:player"));b=pa((b||document).querySelectorAll(".yt-player"));E(oa(a,b),hb)});
typeof YTConfig!=="undefined"&&YTConfig.parsetags&&YTConfig.parsetags!=="onload"||Ra();var jb=A.onYTReady;jb&&jb();var kb=A.onYouTubeIframeAPIReady;kb&&kb();var lb=A.onYouTubePlayerAPIReady;lb&&lb();}).call(this);
