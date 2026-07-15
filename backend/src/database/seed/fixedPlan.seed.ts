/**
 * The family's real fixed monthly plan, copied from their Excel sheet
 * ("הוצאות-תכנון חודשי-קבוע"). Seeded as recurring payments so the
 * recurring page and the monthly generation reflect the real plan.
 * Rows without an amount in the sheet (גן, ern, ביטוח לאומי) are omitted.
 */

export interface FixedPlanRow {
  name: string;
  amount: number;
  paymentMethodName: string;
  categoryName: string;
  /** Day of month the payment usually goes out. */
  day: number;
}

export const fixedPlanRows: FixedPlanRow[] = [
  { name: 'שכר דירה (ש"ד)', amount: 4500, paymentMethodName: "צ'קים", categoryName: "שכירות / משכנתא", day: 1 },
  { name: "חשבונות", amount: 1125, paymentMethodName: "כרטיס אשראי", categoryName: "חשמל", day: 10 },
  { name: "סופר", amount: 4000, paymentMethodName: "כרטיס אשראי", categoryName: "אוכל בסופר", day: 10 },
  { name: "פארם", amount: 200, paymentMethodName: "כרטיס אשראי", categoryName: "פארם ובריאות", day: 10 },
  { name: "טיפוח", amount: 100, paymentMethodName: "כרטיס אשראי", categoryName: "פארם ובריאות", day: 10 },
  { name: "מכבי", amount: 250, paymentMethodName: "כרטיס אשראי", categoryName: "בריאות", day: 10 },
  { name: "פרטנר", amount: 150, paymentMethodName: "כרטיס אשראי", categoryName: "אינטרנט וסלולר", day: 10 },
  { name: "פלאפון", amount: 100, paymentMethodName: "כרטיס אשראי", categoryName: "אינטרנט וסלולר", day: 10 },
  { name: "סיגריות", amount: 800, paymentMethodName: "מזומן", categoryName: "סיגריות", day: 1 },
  { name: "ביטוחים", amount: 50, paymentMethodName: "כרטיס אשראי", categoryName: "ביטוחים", day: 10 },
  { name: "דלק", amount: 100, paymentMethodName: "כרטיס אשראי", categoryName: "דלק", day: 10 },
  { name: "ללא ריבית", amount: 1000, paymentMethodName: "הוראת קבע", categoryName: "הלוואות", day: 2 },
  { name: "הבנלאומי", amount: 2248.05, paymentMethodName: "הוראת קבע", categoryName: "הלוואות", day: 2 },
  { name: "שיניים", amount: 250, paymentMethodName: "צ'קים", categoryName: "בריאות", day: 5 },
  { name: "ביטוח רכב", amount: 205, paymentMethodName: "אשראי בתשלומים", categoryName: "ביטוחים", day: 10 },
  { name: "מסך", amount: 1400, paymentMethodName: "אשראי בתשלומים", categoryName: "קניות לבית", day: 10 },
  { name: "אלבס", amount: 333, paymentMethodName: "אשראי בתשלומים", categoryName: "שונות / לא מסווג", day: 10 },
  { name: "משה", amount: 1000, paymentMethodName: "מזומן", categoryName: "שונות / לא מסווג", day: 1 },
];
