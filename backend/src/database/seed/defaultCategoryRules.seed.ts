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
  { keyword: "פרטנר", categoryName: "אינטרנט וסלולר" },
  { keyword: "hot", categoryName: "אינטרנט וסלולר" },
  { keyword: "בזק", categoryName: "אינטרנט וסלולר" },
  // סופרמרקטים ומכולות
  { keyword: "פרשמרקט", categoryName: "אוכל בסופר" },
  { keyword: "carrefour", categoryName: "אוכל בסופר" },
  { keyword: "קרפור", categoryName: "אוכל בסופר" },
  { keyword: "סיטי מרקט", categoryName: "אוכל בסופר" },
  { keyword: "מיני מקס", categoryName: "אוכל בסופר" },
  { keyword: "מיני מרקט", categoryName: "אוכל בסופר" },
  { keyword: "מינימרקט", categoryName: "אוכל בסופר" },
  { keyword: "היפר", categoryName: "אוכל בסופר" },
  { keyword: "רוזנפלד", categoryName: "אוכל בסופר" },
  { keyword: "סופרטל", categoryName: "אוכל בסופר" },
  { keyword: "סופר רפי", categoryName: "אוכל בסופר" },
  { keyword: "סופר ברוך", categoryName: "אוכל בסופר" },
  { keyword: "בוסתן המושבה", categoryName: "אוכל בסופר" },
  { keyword: "אטליז", categoryName: "אוכל בסופר" },
  { keyword: "בוארון", categoryName: "אוכל בסופר" },
  { keyword: "פירות וירקות", categoryName: "אוכל בסופר" },
  { keyword: "צמרת-שפע", categoryName: "אוכל בסופר" },
  { keyword: "מכולת", categoryName: "אוכל בסופר" },
  { keyword: "מרכול", categoryName: "אוכל בסופר" },
  { keyword: "משקאות", categoryName: "אוכל בסופר" },
  // אוכל בחוץ / בתי קפה / מסעדות
  { keyword: "שווארמה", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "פלאפל", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "פיצה", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "בורגר", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "המבורגר", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "אגאדיר", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "קפה", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "אספרסו", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "לנדוור", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "מאפי", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "מאפיית", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "גלידר", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "ממתק", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "שומשום בר", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "טורקי", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "קיוסק", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  { keyword: "בר בריא", categoryName: "אוכל בחוץ / מסעדות / משלוחים" },
  // בריאות
  { keyword: "מכבי", categoryName: "בריאות" },
  { keyword: "כללית", categoryName: "בריאות" },
  { keyword: "לאומית", categoryName: "בריאות" },
  { keyword: "מאוחדת", categoryName: "בריאות" },
  { keyword: "מנורה מבטחים", categoryName: "בריאות" },
  // ביטוחים
  { keyword: "הראל", categoryName: "ביטוחים" },
  { keyword: "כלל ביטוח", categoryName: "ביטוחים" },
  { keyword: "איילון", categoryName: "ביטוחים" },
  { keyword: "הפניקס", categoryName: "ביטוחים" },
  // פארם
  { keyword: "סופר פארם", categoryName: "פארם ובריאות" },
  { keyword: "ניו פארם", categoryName: "פארם ובריאות" },
  // דלק נוסף
  { keyword: "מנטה", categoryName: "דלק" },
  { keyword: "סדש", categoryName: "דלק" },
  { keyword: "דור אלון", categoryName: "דלק" },
  // הוצאות עסק (סני)
  { keyword: "anthropic", categoryName: "הוצאות עסק (סני)" },
  { keyword: "claude", categoryName: "הוצאות עסק (סני)" },
  // תחבורה ציבורית
  { keyword: "רב-פס", categoryName: "תחבורה ציבורית" },
  { keyword: "רב פס", categoryName: "תחבורה ציבורית" },
  { keyword: "lime", categoryName: "תחבורה ציבורית" },
  // Current-account wording. A bank statement names the *mechanism* (an ATM, a
  // cheque, a transfer), never a business, so without these rules every such row
  // lands in "לא מסווג" — 15 of the 28 imported rows did exactly that.
  { keyword: "כספומט", categoryName: "משיכות מזומן" },
  { keyword: "בנקט", categoryName: "משיכות מזומן" },
  { keyword: "כספונט", categoryName: "משיכות מזומן" },
  { keyword: "משיכת מזומן", categoryName: "משיכות מזומן" },
  { keyword: "משיכת שיק", categoryName: "שיקים והמחאות" },
  { keyword: "הזמנת שיקים", categoryName: "שיקים והמחאות" },
  // No bare "שיק" rule: it is a substring of ordinary business names (שיקגו…),
  // and mislabelling a restaurant as a cheque is worse than leaving it unmatched.
  { keyword: "פרעון שיק", categoryName: "שיקים והמחאות" },
  { keyword: "העברה מהחשבון", categoryName: "העברות בנקאיות" },
  { keyword: "העברה לחשבון", categoryName: "העברות בנקאיות" },
  { keyword: "העברת כספים", categoryName: "העברות בנקאיות" },
  { keyword: "מסלקה", categoryName: "העברות בנקאיות" },
];
