/** Default expense categories — seeded as system defaults (userId = null). */

export interface DefaultCategory {
  name: string;
  type: "expense" | "income";
  icon: string;
  color: string;
}

export const defaultCategories: DefaultCategory[] = [
  { name: "אוכל בסופר", type: "expense", icon: "🛒", color: "#5B8DEF" },
  { name: "אוכל בחוץ / מסעדות / משלוחים", type: "expense", icon: "🍔", color: "#E8663B" },
  { name: "דלק", type: "expense", icon: "⛽", color: "#B98A20" },
  { name: "רכב וטיפולים", type: "expense", icon: "🚗", color: "#8D99AE" },
  { name: "תחבורה ציבורית", type: "expense", icon: "🚌", color: "#0D9488" },
  { name: "סיגריות", type: "expense", icon: "🚬", color: "#B76D68" },
  { name: "שכירות / משכנתא", type: "expense", icon: "🏠", color: "#7768AE" },
  { name: "חשמל", type: "expense", icon: "💡", color: "#B99F1F" },
  { name: "מים", type: "expense", icon: "💧", color: "#4EA5D9" },
  { name: "ארנונה", type: "expense", icon: "🏛️", color: "#9A8C98" },
  { name: "אינטרנט וסלולר", type: "expense", icon: "📶", color: "#2BA3CC" },
  { name: "ביטוחים", type: "expense", icon: "🛡️", color: "#5390D9" },
  { name: "ילדים / גנים / חוגים", type: "expense", icon: "🧒", color: "#F72585" },
  { name: "קניות לבית", type: "expense", icon: "🧺", color: "#3F9D46" },
  { name: "בגדים", type: "expense", icon: "👕", color: "#A855F7" },
  { name: "פארם ובריאות", type: "expense", icon: "💊", color: "#2FA875" },
  { name: "בילויים", type: "expense", icon: "🎉", color: "#FF6D00" },
  { name: "מנויים חודשיים", type: "expense", icon: "🔁", color: "#7B2CBF" },
  { name: "הלוואות", type: "expense", icon: "🏦", color: "#D62828" },
  { name: "ריבית ועמלות בנק", type: "expense", icon: "🏧", color: "#C1121F" },
  { name: "חיסכון", type: "expense", icon: "🐷", color: "#2EC4B6" },
  { name: "העברות בנקאיות", type: "expense", icon: "🔄", color: "#6C757D" },
  { name: "משיכות מזומן", type: "expense", icon: "🏧", color: "#7C8794" },
  { name: "מתנות", type: "expense", icon: "🎁", color: "#FF4D6D" },
  { name: "בעלי חיים", type: "expense", icon: "🐾", color: "#A98467" },
  { name: "לימודים", type: "expense", icon: "📚", color: "#3A86FF" },
  { name: "בריאות", type: "expense", icon: "🩺", color: "#43AA8B" },
  { name: "חופשות", type: "expense", icon: "✈️", color: "#0E93AF" },
  { name: "הוצאות עסק (סני)", type: "expense", icon: "💼", color: "#F59E0B" },
  { name: "שונות / לא מסווג", type: "expense", icon: "❓", color: "#6D6875" },
];
