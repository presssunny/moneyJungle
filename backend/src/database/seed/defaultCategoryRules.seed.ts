/** Default auto-categorization rules: keyword (matched against business name) → category name. */

export interface DefaultCategoryRule {
  keyword: string;
  categoryName: string;
}

export const defaultCategoryRules: DefaultCategoryRule[] = [
  // דלק
  { keyword: "yellow", categoryName: "דלק" },
  { keyword: "paz", categoryName: "דלק" },
  { keyword: "delek", categoryName: "דלק" },
  { keyword: "פז", categoryName: "דלק" },
  { keyword: "דלק", categoryName: "דלק" },
  { keyword: "סונול", categoryName: "דלק" },
  // אוכל בחוץ
  { keyword: "wolt", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "ten bis", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "10bis", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "תן ביס", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "מסעדה", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "מקדונלד", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  // סופר
  { keyword: "שופרסל", categoryName: "אוכל בסופר" },
  { keyword: "רמי לוי", categoryName: "אוכל בסופר" },
  { keyword: "ויקטורי", categoryName: "אוכל בסופר" },
  { keyword: "יוחננוף", categoryName: "אוכל בסופר" },
  { keyword: "מגה", categoryName: "אוכל בסופר" },
  // פארם
  { keyword: "super-pharm", categoryName: "פארם ובריאות" },
  { keyword: "סופר פארם", categoryName: "פארם ובריאות" },
  { keyword: "be פארם", categoryName: "פארם ובריאות" },
  // מנויים
  { keyword: "netflix", categoryName: "מנויים חודשיים" },
  { keyword: "spotify", categoryName: "מנויים חודשיים" },
  { keyword: "apple", categoryName: "מנויים חודשיים" },
  { keyword: "icloud", categoryName: "מנויים חודשיים" },
  { keyword: "canva", categoryName: "מנויים חודשיים" },
  { keyword: "openai", categoryName: "מנויים חודשיים" },
  { keyword: "chatgpt", categoryName: "מנויים חודשיים" },
  // סיגריות
  { keyword: "טבק", categoryName: "סיגריות" },
  { keyword: "סיגריות", categoryName: "סיגריות" },
  // תקשורת
  { keyword: "פרטנר", categoryName: "אינטרנט וסלולר" },
  { keyword: "סלקום", categoryName: "אינטרנט וסלולר" },
  { keyword: "פלאפון", categoryName: "אינטרנט וסלולר" },
  { keyword: "hot", categoryName: "אינטרנט וסלולר" },
  { keyword: "בזק", categoryName: "אינטרנט וסלולר" },
];
