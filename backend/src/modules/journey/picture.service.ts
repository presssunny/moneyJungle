/** Product guidance derived from evidence. No financial writes or inferred payments. */
export interface Situation { bankAccounts: number | null; creditCards: number | null; loans: number | null; cashActivity: boolean | null }
export interface PictureAction { id:string; title:string; reason:string; to:string; priority:number }
export interface PictureSource {
 key:string; kind:string; name:string; status:'known'|'missing'|'review'|'update'|'estimate';
 summary:string; months:string[]; gaps:string[]; asOf:string|null; count:number; to:string;
}
interface Base {
 today:string; hasActivity:boolean; coverageAcknowledged:boolean;
 profile:{situation:unknown;scope:unknown;onboarding:string};
 sources:Array<{key:string;name:string;kind:string;asOf:string|null}>;
 balances:Array<{id:number;name:string;anchor:{coverageTo:string}|null}>;
 cards:Array<{id:number;name:string}>;
 issues:Array<{key:string;title:string;to:string;blocking:boolean}>;
 events:Array<{key:string;name:string;decision:string|null;amount:number|null;date:string}>;
 quietSourceKeys?:string[];blockers:string[];allowance:{amount:number|null};
}
export interface PictureEvidence {
 bankRows:Array<{bankAccountId:number;transactionDate:Date;lineKind:string;linkedLoanId:number|null;resolution:string|null}>;
 creditRows:Array<{cardId:number|null;transactionDate:Date;creditImport:{importMonth:number;importYear:number}}>;
 expenses:Array<{expenseDate:Date;source:string}>;
 incomes:Array<{incomeDate:Date}>;
 loans:Array<{id:number;loanName:string;scheduleSource:string;monthlyPayment:unknown;schedule:Array<{paymentDate:Date}>}>;
 sessions:Array<{id:string;fileName:string;status:string}>;
}
export function situationOf(value:unknown):Situation|null {
 if(!value || typeof value!=='object') return null;
 return value as Situation;
}
export function inventoryGaps(situation:Situation|null, counts:{bankAccounts:number;creditCards:number;loans:number}) {
 if(!situation) return [];
 const labels={bankAccounts:'חשבונות בנק',creditCards:'כרטיסי אשראי',loans:'הלוואות'};
 return (Object.keys(labels) as Array<keyof typeof labels>).flatMap(key=>situation[key]!==null && situation[key]>counts[key] ? [`חסרים ${situation[key]-counts[key]} ${labels[key]} שציינת שיש לך`] : []);
}
const date=(value:Date)=>value.toISOString().slice(0,10);
function periods(dates:string[]) {
 const months=[...new Set(dates.map(d=>d.slice(0,7)))].sort();
 const gaps:string[]=[];
 // Only holes BETWEEN observed months; neither range endpoints nor upload dates
 // prove continuous coverage. No invented gaps before the first observed month.
 if(months.length>1){
  const cursor=new Date(`${months[0]}-01T00:00:00Z`);const last=months.at(-1)!;
  for(let i=0;i<1200;i++){
   cursor.setUTCMonth(cursor.getUTCMonth()+1);const month=cursor.toISOString().slice(0,7);
   if(month>=last)break;if(!months.includes(month))gaps.push(month);
  }
 }
 return {months,gaps};
}
export function buildPicture(state:Base,evidence:PictureEvidence) {
 const situation=situationOf(state.profile.situation);
 const sources:PictureSource[]=[];const actions:PictureAction[]=[];
 const add=(id:string,title:string,reason:string,to:string,priority:number)=>actions.push({id,title,reason,to,priority});
 const previous=new Date(`${state.today.slice(0,7)}-01T00:00:00Z`);previous.setUTCMonth(previous.getUTCMonth()-1);
 const previousMonth=previous.toISOString().slice(0,7);
 const pendingSessions=evidence.sessions.filter(s=>!['completed','cancelled','rolled_back'].includes(s.status));
 for(const s of pendingSessions)add(`session:${s.id}`,`נמשיך עם ${s.fileName}`,s.status==='review'?'המידע נוסף; נותר לבדוק את התוצאה.':'הדוח נשמר, אבל התהליך עדיין לא הסתיים.',`/imports?session=${s.id}`,0);
 for(const issue of state.issues.filter(i=>i.blocking&&!i.key.startsWith('session:')))add(issue.key,issue.title,'כדי שכל תשלום ייספר פעם אחת ובמקום הנכון.',issue.to,2);
 for(const b of state.balances){
  const rows=evidence.bankRows.filter(r=>r.bankAccountId===b.id);const p=periods(rows.map(r=>date(r.transactionDate)));
  const asOf=b.anchor?.coverageTo??null;
  sources.push({key:`bank:${b.id}`,kind:'bank',name:b.name,count:rows.length,...p,asOf,to:`/imports?kind=bank&accountId=${b.id}`,status:!asOf?'missing':asOf!==state.today?'update':'known',summary:asOf?`יתרה לפי הבנק ל־${asOf}`:'היתרה בבנק עדיין לא ידועה'});
  if(!rows.length&&!asOf)add(`bank-data:${b.id}`,`נוסיף מידע על ${b.name}`,'דף חשבון יוסיף תנועות ויתרה. אפשר גם לרשום יתרה עדכנית ידנית.',`/imports?kind=bank&accountId=${b.id}`,15);
  else if(asOf!==state.today)add(`balance:${b.id}`,`נעדכן את היתרה ב${b.name}`,'התנועות נשמרו. לתכנון מהיום צריך לדעת כמה כסף יש כרגע.',`/data#balance-${b.id}`,30);
 }
 for(const c of state.cards){
  const rows=evidence.creditRows.filter(r=>r.cardId===c.id);
  const p=periods(rows.map(r=>`${r.creditImport.importYear}-${String(r.creditImport.importMonth).padStart(2,'0')}-01`));
  const stale=!!p.months.length&&p.months.at(-1)!<previousMonth&&!state.coverageAcknowledged;
  sources.push({key:`credit:${c.id}`,kind:'credit',name:c.name,count:rows.length,...p,asOf:null,to:`/imports?kind=credit&cardId=${c.id}`,status:!rows.length?'missing':stale?'update':'known',summary:rows.length?'עסקאות מדוחות שאושרו; חיוב הבנק נבדק בנפרד':'עוד אין פירוט עסקאות מאושר'});
  if(!rows.length)add(`card-data:${c.id}`,`נשלים את ${c.name}`,'חיוב האשראי בבנק אינו מפרט מה קנית. נוסיף דוח או נציין שאין חיובים.',`/data#source-credit-${c.id}`,15);
  else if(stale)add(`card-update:${c.id}`,`יש דוח חדש ל${c.name}?`,`הדוח האחרון ברשימה הוא ${p.months.at(-1)}. אפשר להוסיף דוח או לבדוק שהמידע עדיין עדכני.`,`/data#source-credit-${c.id}`,25);
 }
 for(const loan of evidence.loans){
  const p=periods(loan.schedule.map(s=>date(s.paymentDate)));const estimated=loan.scheduleSource!=='bank_file';
  sources.push({key:`loan:${loan.id}`,kind:'loan',name:loan.loanName,count:loan.schedule.length,...p,asOf:null,to:`/imports?kind=loan_schedule&loanId=${loan.id}`,status:estimated?'estimate':'known',summary:estimated?'תכנון לפי פרטי ההלוואה שהוזנו; לוח מהבנק ישפר את הדיוק':'לוח תשלומים מהבנק; תאריך שעבר אינו אישור שהתשלום בוצע'});
  if(estimated)add(`schedule:${loan.id}`,`אפשר לדייק את ${loan.loanName}`,'לוח תשלומים מהבנק הוא שיפור אפשרי; ההלוואה כבר רשומה.',`/imports?kind=loan_schedule&loanId=${loan.id}`,80);
 }
 const manual=evidence.expenses.filter(e=>['manual','recurring'].includes(e.source));
 if(manual.length||situation?.cashActivity||((state.profile.scope as {manualOnly?:boolean}|null)?.manualOnly))sources.push({key:'manual',kind:'manual',name:'מזומן והוצאות נוספות',count:manual.length,...periods(manual.map(e=>date(e.expenseDate))),asOf:null,to:'/transactions?tab=expenses',status:manual.length?'known':'missing',summary:manual.length?'הוצאות שנרשמו ידנית או מגיליון; יש לבדוק שאינן כבר בדוח אשראי':'אפשר לרשום הוצאות שלא מופיעות בבנק או באשראי'});
 if(evidence.incomes.length)sources.push({key:'income',kind:'income',name:'הכנסות',count:evidence.incomes.length,...periods(evidence.incomes.map(e=>date(e.incomeDate))),asOf:null,to:'/transactions?tab=incomes',status:'known',summary:'הכנסות שנרשמו; הכנסה עתידית אינה כסף שכבר התקבל'});
 const counts={bankAccounts:state.balances.length,creditCards:state.cards.length,loans:evidence.loans.length};
 const inventory=inventoryGaps(situation,counts);
 const inventoryKnown=!!state.profile.scope||!!situation&&Object.values(situation).every(v=>v!==null);
 if(!inventoryKnown)add('situation','מה יש בתמונה שלך?','כמה חשבונות וכרטיסים יש לך, והאם יש הלוואות או הוצאות במזומן?','/onboarding#situation',5);
 const areas=[
  {key:'bankAccounts',title:'חשבונות בנק',actual:counts.bankAccounts,expected:situation?.bankAccounts??null,to:'/accounts?tab=bank',importTo:'/imports?kind=bank',why:'דף חשבון מראה כסף שנכנס ויצא ואת היתרה בבנק.'},
  {key:'creditCards',title:'כרטיסי אשראי',actual:counts.creditCards,expected:situation?.creditCards??null,to:'/accounts?tab=credit',importTo:'/imports?kind=credit',why:'דוח כרטיס מפרט רכישות וחיובים עתידיים. הוא משלים את דף הבנק.'},
  {key:'loans',title:'הלוואות',actual:counts.loans,expected:situation?.loans??null,to:'/accounts?tab=loans',importTo:'/imports?kind=loan_schedule',why:'פרטי ההלוואה ולוח התשלומים עוזרים לתכנן החזרים.'},
 ].map(a=>({...a,applicable:a.actual>0||a.expected!==0,status:a.actual>0?'represented':a.expected===0?'not_applicable':a.expected===null?'unknown':'missing'}));
 for(const area of areas)if(area.expected!==null&&area.expected>area.actual)add(`inventory:${area.key}`,`נוסיף ${area.title} לתמונה`,`${area.actual} מתוך ${area.expected} ברשימה. ${area.why}`,area.actual?area.to:area.importTo,10);
 // A bank reference is a clue, not proof of a card or a loan's identity/count.
 if(evidence.bankRows.some(r=>r.lineKind==='credit_card_payment'&&r.resolution!=='credit_card_settled')&&!state.cards.length)add('card-clue','נבדוק את חיובי האשראי בבנק','נמצאו חיובים שעשויים להיות של כרטיס. דוח הכרטיס יאפשר להבין אותם בלי לספור רכישות פעמיים.','/accounts?tab=reconcile',3);
 if(evidence.bankRows.some(r=>r.lineKind.startsWith('loan_')&&!r.linkedLoanId)&&!evidence.loans.length)add('loan-clue','נבדוק את החזרי ההלוואה בבנק','נמצאו תשלומים שעשויים להיות החזר הלוואה. צריך לזהות למה הם שייכים.','/accounts?tab=reconcile',3);
 if(situation?.cashActivity&&!manual.length)add('manual','נוסיף הוצאות במזומן','רק הוצאות שעדיין לא מופיעות בדוחות. גם רישום ידני אחד מאפשר להתחיל מעקב.','/transactions?tab=expenses',20);
 const open=state.events.find(e=>!e.decision||(e.amount===null&&e.decision==='unpaid'));
 if(open)add('commitments','נבדוק את התשלומים הצפויים',`יש תשלום שצריך לברר: ${open.name}. תאריך שעבר לא מוכיח שהוא שולם.`,'/commitments',25);
 if(!state.coverageAcknowledged&&state.profile.scope)add('acknowledge','מבט אחרון על המידע','נבדוק אם חסר משהו שלא מופיע בדוחות, ונאשר מה עדכני להיום.','/data#confirm-picture',40);
 if(!state.profile.scope&&inventoryKnown)add('scope','נבדוק שלא נשאר משהו בחוץ','נבדוק את רשימת החשבונות והתשלומים ואת הכסף שצריך להשאיר בצד.','/data#picture-scope',35);
 for(const source of sources)if(source.gaps.length)add(`history:${source.key}`,`אפשר להשלים היסטוריה של ${source.name}`,`אין תנועות רשומות בחודשים ${source.gaps.join(', ')}. ייתכן שלא היתה פעילות. זה לא מונע מעקב מהיום.`,source.to,90);
 const hasUsefulData=state.hasActivity||state.balances.some(b=>!!b.anchor)||evidence.loans.length>0;
 const emptyCards=sources.filter(s=>s.kind==='credit'&&s.count===0);
 const quiet=(state as Base&{quietSourceKeys?:string[]}).quietSourceKeys??[];
 for(const card of emptyCards.filter(c=>quiet.includes(c.key))){card.status='known';card.summary='לפי האישור שלך, אין בכרטיס חיובים שצריך לכלול היום';const index=actions.findIndex(a=>a.id===`card-data:${card.key.split(':')[1]}`);if(index>=0)actions.splice(index,1);}
 const requiredGaps=[...inventory,...emptyCards.filter(c=>!quiet.includes(c.key)).map(c=>`אין פירוט חיובים או אישור שאין פעילות עבור ${c.name}`)];
 const reviewPending=state.issues.some(i=>i.blocking);
 const sufficient=inventoryKnown&&requiredGaps.length===0&&!reviewPending&&state.coverageAcknowledged;
 const stage=sufficient?'reviewed':!hasUsefulData?'empty':state.profile.onboarding==='completed'||state.profile.onboarding==='legacy'?'maintain':'building';
 const next=actions.sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id))[0]??null;
 return {stage,situation,inventoryKnown,hasUsefulData,sufficient,requiredGaps,areas,sources,next,actions,
  capabilities:[
   {key:'tracking',title:'מעקב אחרי מה שנרשם',available:hasUsefulData,reason:hasUsefulData?'אפשר לעקוב אחרי המידע הקיים. סיכומים אינם הוכחה שכל הפעילות נרשמה.':'נוסיף פעילות או יתרה כדי להתחיל.'},
   {key:'balances',title:'יתרות בנק להיום',available:!!state.balances.length&&state.balances.every(b=>b.anchor?.coverageTo===state.today),reason:state.balances.length?'רק יתרה מהבנק לתאריך של היום נחשבת עדכנית.':'לא רשום חשבון בנק. אין להסיק מכך שהיתרה היא אפס.'},
   {key:'commitments',title:'מעקב אחרי תשלומים צפויים',available:state.events.length>0,reason:state.events.length?'מציגים את התשלומים הידועים; סכום או מצב תשלום חסר יישארו מסומנים.':'עוד לא רשומים תשלומים צפויים. ייתכן שמידע חסר.'},
   {key:'daily',title:'אומדן להוצאה יומית',available:state.allowance.amount!==null&&requiredGaps.length===0,reason:requiredGaps[0]??state.blockers[0]??'אומדן לפי היתרות, התשלומים והמידע שאישרת להיום.'},
  ]};
}
