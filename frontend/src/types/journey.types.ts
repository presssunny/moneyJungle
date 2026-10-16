import type { FinancialPicture, Situation } from "./picture.types";
export interface ReviewItem {key:string;title:string;to:string;blocking:boolean;fingerprint:string}
export interface Commitment {key:string;date:string;name:string;amount:number|null;kind:string;fingerprint:string;decision:string|null;note:string|null;to:string}
export interface Profile {situation?:Situation|null;onboarding:string;scope:{accountsListed:boolean;cardsListed:boolean;commitmentsListed:boolean;manualOnly:boolean}|null;cashBuffer:string;essentialReserve:string;savedReserve:string}
export interface FinancialStatus {
 picture?:FinancialPicture;quietSourceKeys?:string[];
 sources:Array<{key:string;name:string;kind:string;asOf:string|null;observedFrom:string|null;observedTo:string|null;limitation:string}>;
 hasActivity:boolean;
 today:string;end:string;dataVersion:string;profile:Profile;
 balances:Array<{id:number;name:string;balance:number;explanation:string;anchor:{coverageTo:string;fileName:string}|null}>;
 cards:Array<{id:number;name:string}>;events:Commitment[];issues:ReviewItem[];blockers:string[];coverageAcknowledged:boolean;
 allowance:{amount:number|null;shortfall:number|null;state:string;cash:number;reserves:number;essentialReserve:number;formula:string;assumptions:string[]};
}
/** A fixed monthly debit found in a bank statement and not tracked yet. */
export interface DetectedCommitment {key:string;kind:"loan"|"recurring";name:string;amount:number;dayOfMonth:number;months:number;lastDate:string;nextDate:string;loanNumber:string|null}
export interface ImportSession {
 error?:string|null;
 id:string;fileName:string;kind:string;status:string;version:number;answers:Record<string,string|number>;
 preview:{rows:Array<{date:string|null;name:string;amount:number}>;count:number;total:number;warnings:string[];questions:string[];previousImportId?:number;blockingIssues?:string[];details?:string[];validation?:{balanceChecked:boolean;balanceMismatchCount:number;rejectedRowCount:number;reviewRowCount:number;balanceMode?:"per_transaction"|"daily"};commitments?:DetectedCommitment[]};
 result:{creditImportId?:number;accountId?:number;statementImportId?:number;details?:{loanId?:number;expenseIds?:number[];commitments?:DetectedCommitment[]}}|null;
}
export interface CheckInView {draft:{id:string;step:number}|null;previousCompletedAt:string|null;due:boolean;token:string;action:{title:string;to:string;reason?:string};status:FinancialStatus & {upcoming:Commitment[]};comparison:{baseline:boolean;added:number|null;late:number|null;changed:number|null;removed:number|null;cashChange:number|null;limited:boolean;historyChanged:boolean|null}}
export interface JourneyAction {id:string;topic:string;title:string;reason:string;to:string;priority:number}
export interface HomeStatus extends FinancialStatus {actions:JourneyAction[];actionCount:number;upcoming:Commitment[]}

export interface FundingSource {
  sourceKey: string;
  name: string;
  kind: string;
  assignedAccountId: number | null;
  suggestedAccountId: number | null;
  suggestionReason: string | null;
}

export interface FundingOverview {
  accounts: Array<{ id: number; name: string }>;
  spendingAccountId: number | null;
  savedReserve: number;
  savedReserveLocation: "spending" | "elsewhere" | null;
  sources: FundingSource[];
}

export interface FundingInput {
  spendingAccountId?: number | null;
  savedReserveLocation?: "spending" | "elsewhere" | null;
  assignments?: Array<{ sourceKey: string; bankAccountId: number | null }>;
}
