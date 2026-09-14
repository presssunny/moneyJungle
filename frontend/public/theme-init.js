// Apply the saved theme before React paints; storage may be unavailable.
try {
  const theme = localStorage.getItem("app_theme");
  if (theme) document.documentElement.setAttribute("data-theme", theme);
} catch {
  // The stylesheet's default theme remains available.
}
