import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getProfile } from "../services/journey.service";
import { useAsync } from "../hooks/useAsync";
import { AsyncSection } from "../components/common/AsyncSection";
import { Loading } from "../components/common/Loading";
/** Progress is server-owned; imports, review and manual entry remain accessible. */
export function RequireOnboarding({children}:{children:ReactNode}){
 const location=useLocation();
 return location.pathname==='/'?<HomeGate>{children}</HomeGate>:<>{children}</>;
}
function HomeGate({children}:{children:ReactNode}){
 const profile=useAsync(getProfile,[]);
 return <AsyncSection resource={profile} errorTitle="לא ניתן לטעון את ההתקדמות" skeleton={<Loading/>}>{data=>data.onboarding==='pending'?<Navigate to="/onboarding" replace/>:<>{children}</>}</AsyncSection>;
}
