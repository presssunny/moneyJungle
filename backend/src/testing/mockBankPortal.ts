// The bank's signed-in app as public code shows it, served offline: every request is answered
// here or aborted, so nothing reaches the bank. Shared by the discovery and loan follow-up tests.
import type { Browser, HTTPRequest, Page } from "puppeteer";

export const ORIGIN = "https://online.fibi.co.il";
export const PORTAL = `${ORIGIN}/Resources/PortalNG/shell`;
export const LOGIN_AGAIN = `${ORIGIN}/MatafLoginService/MatafLoginServlet`;
export const LOANS = "Online/OnLoansMortgageMenu/OnLoans/AuthLoansDetails";

// A shell whose menu holds in-app routes and portal pages, among links that must never be followed.
export const MENU = [
  ["#/Online/OnLoans/Loan/58213", "הלוואה 12-345678 דנה כהן"],
  ["#/Online/OnLoans/LoanRequest", "בקשת הלוואה"],
  [`#/${LOANS}`, "הלוואות ומשכנתאות"],
  ["/wps/myportal/FibiMenu/Online/OnCreditCardsMenu/AuthCreditCardsDetails/!ut/p/z1/04_Sj9CP", "כרטיסי אשראי"],
  ["/wps/myportal/FibiMenu/Online/OnCreditCardsMenu/AuthCreditCardsDetails", "כרטיסי אשראי"],
  ["#/Online/OnStandingOrders/AuthStandingOrders", "הוראות קבע"],
  ["#/Online/OnCheques/OrderChequeBook", "הזמנת פנקס שיקים"],
  ["javascript:openCheques()", "שיקים"],
  ["https://evil.example/wps/myportal/FibiMenu/Online/OnDeposits/AuthDeposits", "פיקדונות"],
  ["#/Online/OnDeposits/AuthDeposits", "פיקדונות וחסכונות"],
  ["#/Online/OnTransfers/AuthTransfer", "העברה בין חשבונות"],
  ["/wps/myportal/FibiMenu/Online/Logout", "יציאה"],
];

// Every route the app opens is reported to /seen; the loans route loads its data the way the real app would;
// standing orders bounce to the home route; deposits find her signed out. The recorder reports any input on the page.
export const LOANS_DATA = `fetch("${ORIGIN}/appsng/bff-loans/api/v1/loans/58213?acct=12-345678", { method: "POST", body: "secret-body-9f" })`;
export function shell(onLoans = LOANS_DATA, onStanding = `location.hash = "#/Online/Home"`) {
  return `<meta charset="utf-8"><nav>${MENU.map(([href, label]) => `<a href="${href}">${label}</a>`).join("")}</nav><p>שלום דנה כהן, חשבון 12-345678</p><script>
    function route() {
      const at = location.hash.slice(2);
      if (!at) return;
      fetch("${ORIGIN}/seen?route=" + encodeURIComponent(at));
      if (at === "${LOANS}") ${onLoans};
      if (at.endsWith("AuthStandingOrders")) ${onStanding};
      if (at.endsWith("AuthDeposits")) location.replace("${LOGIN_AGAIN}?returnUrl=/Resources/PortalNG/shell");
    }
    addEventListener("hashchange", route); route();
    for (const type of ["input", "change", "click", "keydown", "submit", "focusin"]) addEventListener(type, () => fetch("${ORIGIN}/__event/" + type), true);
  </script>`;
}

/** The shell for `portal`, a 500 for the card page, a login page for any other document, `{}` for data calls. */
export async function answerPortal(page: Page, portal: string, requested: string[]): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (request: HTTPRequest) => {
    const url = request.url();
    requested.push(url);
    if (!request.isNavigationRequest()) return void request.respond({ status: 200, contentType: "application/json", body: "{}" });
    if (url.startsWith(PORTAL)) return void request.respond({ status: 200, contentType: "text/html", body: portal });
    if (url.includes("AuthCreditCardsDetails")) return void request.respond({ status: 500, contentType: "text/html", body: "<p>error</p>" });
    void request.respond({ status: 200, contentType: "text/html", body: "<p>login</p>" });
  });
}

/** Routes the shell reported opening, in order. */
export const seenRoutes = (requested: string[]) => requested.filter((url) => url.startsWith(`${ORIGIN}/seen`)).map((url) => new URL(url).searchParams.get("route"));

/** The library's success patterns as far as these tests need them: the shell or the portal's online area. */
export const signedIn = (url: string) => [/Resources\/PortalNG\/shell/, /FibiMenu\/Online/].some((pattern) => pattern.test(url));

/** A tab already signed in on the shell, as the library's page is after the checking fetch. */
export async function signedInPage(browser: Browser, portal = shell()) {
  const requested: string[] = [];
  const page = await browser.newPage();
  await answerPortal(page, portal, requested);
  await page.goto(PORTAL);
  return { page, requested };
}
