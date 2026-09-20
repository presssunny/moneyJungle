export interface Situation {bankAccounts:number|null;creditCards:number|null;loans:number|null;cashActivity:boolean|null}
export interface PictureAction {id:string;title:string;reason:string;to:string;priority:number}
export interface FinancialPicture {
 stage:'empty'|'building'|'maintain'|'reviewed';situation:Situation|null;inventoryKnown:boolean;hasUsefulData:boolean;sufficient:boolean;requiredGaps:string[];
 next:PictureAction|null;actions:PictureAction[];
 areas:Array<{key:string;title:string;actual:number;expected:number|null;applicable:boolean;status:string;to:string;importTo:string;why:string}>;
 sources:Array<{key:string;kind:string;name:string;status:string;summary:string;months:string[];gaps:string[];asOf:string|null;count:number;to:string}>;
 capabilities:Array<{key:string;title:string;available:boolean;reason:string}>;
}
