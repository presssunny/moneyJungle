import { api } from "./api";
import type { ReviewItem, Commitment, Profile, FinancialStatus, ImportSession, CheckInView, JourneyAction, HomeStatus } from "../types/journey.types";
export type { ReviewItem, Commitment, Profile, FinancialStatus, ImportSession, CheckInView, JourneyAction, HomeStatus } from "../types/journey.types";
export async function getFinancialStatus():Promise<FinancialStatus>{return (await api.get('/journey/status')).data;}
export async function getProfile():Promise<Profile>{return (await api.get('/journey/profile')).data;}
export async function saveProfile(input:unknown):Promise<Profile>{return (await api.patch('/journey/profile',input)).data;}
export async function confirmCoverage(dataVersion:string,sourceKeys:string[]){return (await api.post('/journey/coverage',{dataVersion,sourceKeys,confirmed:true})).data;}
export async function finishOnboarding(noActivity:boolean){return (await api.post('/journey/onboarding/complete',{reviewed:true,noActivity})).data;}
export async function getReview():Promise<ReviewItem[]>{return (await api.get('/journey/review')).data;}
export async function getCommitments():Promise<Commitment[]>{return (await api.get('/journey/commitments')).data;}
export async function decideCommitment(input:unknown){return (await api.post('/journey/commitments/decision',input)).data;}
export async function listImportSessions():Promise<Array<Pick<ImportSession,'id'|'fileName'|'status'|'kind'>>>{return (await api.get('/imports/sessions')).data;}
export async function getImportSession(id:string):Promise<ImportSession>{return (await api.get(`/imports/sessions/${id}`)).data;}
export async function uploadSession(file:File,answers:unknown):Promise<ImportSession>{const form=new FormData();form.append('file',file);form.append('answers',JSON.stringify(answers));return (await api.post('/imports/sessions',form)).data;}
export async function answerSession(session:ImportSession,answers:unknown):Promise<ImportSession>{return (await api.patch(`/imports/sessions/${session.id}/answers`,{version:session.version,answers})).data;}
export async function actOnSession(session:ImportSession,action:'commit'|'complete'|'cancel'):Promise<ImportSession>{return (await api.post(`/imports/sessions/${session.id}/${action}`,{version:session.version})).data;}
export async function getCheckIn():Promise<CheckInView>{return (await api.get('/journey/check-in')).data;}
export async function startCheckIn(){return (await api.post('/journey/check-in')).data;}
export async function advanceCheckIn(id:string,step:number){return (await api.patch(`/journey/check-in/${id}`,{step})).data;}
export async function completeCheckIn(id:string,token:string){return (await api.post(`/journey/check-in/${id}/complete`,{token})).data;}

export async function getHomeStatus():Promise<HomeStatus>{return (await api.get("/journey/home")).data;}
export async function getJourneyActions():Promise<JourneyAction[]>{return (await api.get("/journey/actions")).data;}
