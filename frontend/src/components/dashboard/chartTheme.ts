/** Reads chart chrome colors from the active theme's CSS variables. */
export function chartChrome() {
  const styles = getComputedStyle(document.documentElement);
  const v = (name: string) => styles.getPropertyValue(name).trim();
  return {
    text: v("--text-muted"),
    grid: v("--border"),
    card: v("--bg-card"),
    success: v("--success"),
    danger: v("--danger"),
    primary: v("--primary"),
    secondary: v("--secondary"),
  };
}

export const tooltipStyle = () => ({
  background: chartChrome().card,
  border: `1px solid ${chartChrome().grid}`,
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "Heebo, sans-serif",
  direction: "rtl" as const,
});
