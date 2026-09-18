import { api } from "./api";
export interface ReviewItem {key:string;title:string;to:string;blocking:boolean;fingerprint:string}
export interface Commitment {key:string;date:string;name:string;amount:number|null;kind:string;fingerprint:string;decision:string|null;note:string|null;to:string}
export interface Profile {onboarding:string;scope:{accountsListed:boolean;cardsListed:boolean;commitmentsListed:boolean;manualOnly:boolean}|null;cashBuffer:string;essentialReserve:string;savedReserve:string}
export interface FinancialStatus {
 sources:Array<{key:string;name:string;kind:string;asOf:string|null;observedFrom:string|null;observedTo:string|null;limitation:string}>;
 hasActivity:boolean;
 today:string;end:string;dataVersion:string;profile:Profile;
 balances:Array<{id:number;name:string;balance:number;explanation:string;anchor:{coverageTo:string;fileName:string}|null}>;
 cards:Array<{id:number;name:string}>;events:Commitment[];issues:ReviewItem[];blockers:string[];
 allowance:{amount:number|null;shortfall:number|null;state:string;cash:number;reserves:number;essentialReserve:number;formula:string;assumptions:string[]};
}
export interface ImportSession {
 error?:string|null;
 id:string;fileName:string;kind:string;status:string;version:number;answers:Record<string,string|number>;
 preview:{rows:Array<{date:string|null;name:string;amount:number}>;count:number;total:number;warnings:string[];questions:string[];previousImportId?:number};
 result:{creditImportId?:number;accountId?:number;statementImportId?:number;details?:{loanId?:number;expenseIds?:number[]}}|null;
}
export interface CheckInView {draft:{id:string;step:number}|null;previousCompletedAt:string|null;due:boolean;token:string;action:{title:string;to:string};status:FinancialStatus;comparison:{baseline:boolean;added:number;late:number;changed:number;removed:number;cashChange:number|null}}
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

export interface JourneyAction {id:string;topic:string;title:string;reason:string;to:string;priority:number}
export interface HomeStatus extends FinancialStatus {actions:JourneyAction[];actionCount:number;upcoming:Commitment[]}
export async function getHomeStatus():Promise<HomeStatus>{return (await api.get("/journey/home")).data;}
export async function getJourneyActions():Promise<JourneyAction[]>{return (await api.get("/journey/actions")).data;}
