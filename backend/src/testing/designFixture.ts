/** Disposable real-API data for the visual audit. Never modifies existing users. */
import crypto from 'node:crypto';
import { prisma } from '../config/database';
const marker = '__design_audit';
async function main() {
 const [action, value] = process.argv.slice(2);
 if(action==='remove') {
  await prisma.user.deleteMany({where:{id:Number(value),name:marker}});
  return;
 }
 if(action!=='create'||!['empty','partial','dense'].includes(value))throw new Error('Expected create empty|partial|dense or remove id');
 const today=new Date().toISOString().slice(0,10);const month=today.slice(0,7);
 const user=await prisma.user.create({data:{name:marker,email:`design-${crypto.randomUUID()}@example.test`}});
 try {
  const userId=user.id;const token=crypto.randomBytes(32).toString('hex');
  await prisma.gateSession.create({data:{userId,tokenHash:crypto.createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
  await prisma.settings.create({data:{userId,theme:'light',activeMonth:month,monthlyTarget:12500}});
  await prisma.financialProfile.create({data:{userId,onboarding:value==='dense'?'completed':'pending'}});
  if(value!=='empty'){
   const categories=await Promise.all(['מזון וקניות לבית','תחבורה ורכב','בריאות וטיפולים לכל המשפחה','בילוי ופנאי','חשבונות ותקשורת'].map((name,i)=>prisma.category.create({data:{userId,name,color:['#357b66','#5579b9','#956cb3','#bc8130','#707a86'][i],icon:['🛒','🚗','💊','☕','🏠'][i]}})));
   const method=await prisma.paymentMethod.create({data:{userId,name:'העברה מהחשבון המשפחתי',type:'bank_transfer'}});
   const merchants=['שופרסל שלי — קניות לבית','בית קפה השכונה','רכבת ישראל','מרפאת מומחים וטיפולי שיניים למשפחה — סניף מרכז העיר','חשמל ומים','ספרים וציוד לבית הספר'];
   for(let offset=0;offset<(value==='dense'?6:1);offset++){
    const date=new Date(`${month}-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()-offset);const m=date.toISOString().slice(0,7);
    await prisma.income.create({data:{userId,amount:18500+offset*200,type:'salary',description:'משכורת חודשית',incomeDate:new Date(`${m}-01`),isRecurring:true}});
    await prisma.expense.createMany({data:Array.from({length:value==='dense'?86:3},(_,i)=>({userId,businessName:merchants[i%merchants.length],amount:i%17===0?-79.9:18+(i*37%610)+.9,expenseDate:new Date(`${m}-${String(i%20+1).padStart(2,'0')}`),categoryId:i%11===0?null:categories[i%5].id,paymentMethodId:method.id,isRecurring:i%13===0,description:i%17===0?'זיכוי על החזרה':'',source:'manual' as const}))});
   }
   await prisma.bankAccount.create({data:{userId,bankName:'הבנק שלי',accountName:'החשבון המשפחתי',initialBalance:26480.5,anchorBalance:value==='dense'?26480.5:null,anchorDate:value==='dense'?new Date(today):null}});
   if(value==='dense'){
    for(let i=0;i<categories.length;i++)await prisma.budget.create({data:{userId,categoryId:categories[i].id,year:Number(month.slice(0,4)),month:Number(month.slice(5)),amount:2200+i*100}});
    const card=await prisma.creditCard.create({data:{userId,name:'כרטיס משפחתי',issuer:'ישראכרט',lastFour:'4582',billingDay:25}});
    const report=await prisma.creditImport.create({data:{userId,fileName:'פירוט אשראי משפחתי.xlsx',importMonth:Number(month.slice(5)),importYear:Number(month.slice(0,4)),status:'confirmed'}});
    await prisma.creditTransaction.createMany({data:Array.from({length:32},(_,i)=>({userId,cardId:card.id,creditImportId:report.id,businessName:merchants[i%6],amount:i===0?-125:42+i*9.9,transactionDate:new Date(`${month}-${String(i%20+1).padStart(2,'0')}`),billingDate:new Date(`${month}-${String(i%20+1).padStart(2,'0')}`),chargeDate:new Date(`${month}-25`),categoryId:categories[i%5].id}))});
    await prisma.savingsGoal.create({data:{userId,goalName:'קרן חירום משפחתית',targetAmount:50000,currentAmount:18000,monthlyTarget:1500}});
    await prisma.asset.create({data:{userId,name:'קרן השתלמות',assetType:'investment',currentValue:86400,asOfDate:new Date(today)}});
    const loan=await prisma.loan.create({data:{userId,loanName:'הלוואה לשיפוץ הבית',loanType:'bank',lenderName:'הבנק שלי',originalAmount:60000,currentBalance:42000,annualInterestRate:5.2,monthlyPayment:1280,startDate:new Date('2025-01-01'),scheduleSource:'computed'}});
    await prisma.loanScheduleEntry.createMany({data:Array.from({length:12},(_,i)=>{const d=new Date(`${month}-25`);d.setUTCMonth(d.getUTCMonth()+i);return {loanId:loan.id,paymentNumber:i+1,paymentDate:d,principal:1000,interest:280,total:1280,balanceAfter:41000-i*1000};})});
    await prisma.reminder.create({data:{userId,title:'ביטוח הרכב — חידוש שנתי',eventDate:new Date(`${month}-27`),estimatedAmount:2800,type:'expected_expense'}});
    await prisma.alert.create({data:{userId,type:'budget_overrun',title:'כדאי לבדוק את תקציב המזון',message:'ההוצאות החודש גבוהות מהתכנון. אפשר לעבור על התנועות ולעדכן את התקציב.',severity:'warning'}});
   }
  }
  console.log(JSON.stringify({userId,token,month}));
 }catch(error){await prisma.user.delete({where:{id:user.id}});throw error;}
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>prisma.$disconnect());
