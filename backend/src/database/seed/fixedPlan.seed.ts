/**
 * Sample fixed monthly plan, seeded as recurring payments so a fresh install has
 * something to show. Illustrative figures only — replace them with your own from
 * the recurring page.
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
  { name: "שכר דירה", amount: 4000, paymentMethodName: "העברה בנקאית", categoryName: "שכירות / משכנתא", day: 1 },
  { name: "חשמל", amount: 400, paymentMethodName: "הוראת קבע", categoryName: "חשמל", day: 10 },
  { name: "מים", amount: 150, paymentMethodName: "הוראת קבע", categoryName: "מים", day: 10 },
  { name: "ארנונה", amount: 500, paymentMethodName: "הוראת קבע", categoryName: "ארנונה", day: 1 },
  { name: "קניות בסופר", amount: 2500, paymentMethodName: "כרטיס אשראי", categoryName: "אוכל בסופר", day: 10 },
  { name: "אינטרנט", amount: 100, paymentMethodName: "כרטיס אשראי", categoryName: "אינטרנט וסלולר", day: 10 },
  { name: "סלולר", amount: 120, paymentMethodName: "כרטיס אשראי", categoryName: "אינטרנט וסלולר", day: 10 },
  { name: "ביטוח בריאות", amount: 250, paymentMethodName: "הוראת קבע", categoryName: "ביטוחים", day: 5 },
  { name: "ביטוח רכב", amount: 300, paymentMethodName: "כרטיס אשראי", categoryName: "ביטוחים", day: 10 },
  { name: "דלק", amount: 600, paymentMethodName: "כרטיס אשראי", categoryName: "דלק", day: 10 },
  { name: "חוגים לילדים", amount: 450, paymentMethodName: "הוראת קבע", categoryName: "ילדים / גנים / חוגים", day: 5 },
  { name: "מנויים דיגיטליים", amount: 90, paymentMethodName: "כרטיס אשראי", categoryName: "מנויים חודשיים", day: 15 },
  { name: "חיסכון חודשי", amount: 800, paymentMethodName: "הוראת קבע", categoryName: "חיסכון", day: 1 },
];
