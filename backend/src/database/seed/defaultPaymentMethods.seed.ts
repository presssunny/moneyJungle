/** Default payment methods — includes "אשראי בתשלומים" seen in the user's Excel. */

export interface DefaultPaymentMethod {
  name: string;
  type: string;
}

export const defaultPaymentMethods: DefaultPaymentMethod[] = [
  { name: "מזומן", type: "cash" },
  { name: "כרטיס אשראי", type: "credit_card" },
  { name: "אשראי בתשלומים", type: "credit_installments" },
  { name: "העברה בנקאית", type: "bank_transfer" },
  { name: "ביט", type: "bit" },
  { name: "פייבוקס", type: "paybox" },
  { name: "הוראת קבע", type: "standing_order" },
  { name: "צ'קים", type: "check" },
];
