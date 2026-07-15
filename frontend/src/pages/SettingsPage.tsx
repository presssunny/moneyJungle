import { useEffect, useState } from "react";
import { Card } from "../components/common/Card";
import { THEMES, useTheme } from "../context/ThemeContext";
import { getSettings, updateSettings } from "../services/planning.service";
import type { Settings } from "../types/models";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
  }, []);

  async function saveField(field: keyof Settings, value: string) {
    if (!settings) return;
    const next = { ...settings, [field]: value };
    setSettings(next);
    await updateSettings({ [field]: value });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <>
      <Card title="הגדרות · ערכת נושא">
        <p className="settings-hint">הצבע מתחלף מיידית בכל האפליקציה ונשמר גם אחרי רענון</p>
        <div className="theme-grid">
          {THEMES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`theme-card ${theme === option.id ? "theme-card-active" : ""}`}
              onClick={() => setTheme(option.id)}
            >
              {theme === option.id && <span className="theme-card-check" aria-hidden>✓</span>}
              <span className="theme-swatches">
                {option.swatches.map((color) => (
                  <span key={color} className="theme-swatch" style={{ background: color }} />
                ))}
              </span>
              <span className="theme-card-name">{option.label}</span>
              <span className="theme-card-hint">{option.hint}</span>
            </button>
          ))}
        </div>
      </Card>

      {settings && (
        <Card title="העדפות כלליות">
          {saved && <div className="info-banner">נשמר ✓</div>}
          <div className="settings-rows">
            <label className="settings-row">
              <span>מטבע</span>
              <select
                className="field-input"
                value={settings.currency}
                onChange={(e) => saveField("currency", e.target.value)}
              >
                <option value="ILS">₪ שקל (ILS)</option>
                <option value="USD">$ דולר (USD)</option>
                <option value="EUR">€ אירו (EUR)</option>
              </select>
            </label>
            <label className="settings-row">
              <span>פורמט תאריך</span>
              <select
                className="field-input"
                value={settings.dateFormat}
                onChange={(e) => saveField("dateFormat", e.target.value)}
              >
                <option value="DD/MM/YYYY">31/12/2026</option>
                <option value="YYYY-MM-DD">2026-12-31</option>
              </select>
            </label>
          </div>
        </Card>
      )}
    </>
  );
}
