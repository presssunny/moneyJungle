import { Navigate, useLocation } from "react-router-dom";
export function LegacyRedirect({to}:{to:string}) {
 const location=useLocation();
 const [path,query]=to.split("?");
 const params=new URLSearchParams(location.search);
 params.delete("tab");
 new URLSearchParams(query).forEach((value,key)=>params.set(key,value));
 return <Navigate to={`${path}${params.size?`?${params}`:""}${location.hash}`} state={location.state} replace/>;
}
