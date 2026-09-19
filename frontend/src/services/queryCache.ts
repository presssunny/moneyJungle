import { api } from "./api";
import { sessionUser } from "./sessionState";
const reads=new Map<string,{expires:number;promise:Promise<unknown>}>();
window.addEventListener("money-jungle:changed",event=>{if((event as CustomEvent<{domain:string}>).detail?.domain!=="appearance")reads.clear();});
/** Short shared reads coalesce table/analysis requests. Every successful mutation
 * invalidates them before subscribers reload; keys also isolate signed-in users. */
export function sharedGet<T>(url:string,params?:Record<string,unknown>):Promise<T> {
 const key=JSON.stringify([sessionUser()?.id,url,params]);
 const hit=reads.get(key);
 if(hit&&hit.expires>Date.now())return hit.promise as Promise<T>;
 const promise=api.get<T>(url,{params}).then(response=>response.data);
 reads.set(key,{expires:Date.now()+5000,promise});
 promise.catch(()=>{if(reads.get(key)?.promise===promise)reads.delete(key);});
 return promise;
}
