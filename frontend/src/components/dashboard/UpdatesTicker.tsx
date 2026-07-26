import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getTicker } from "../../services/updates.service";
import type { TickerItem } from "../../types/dashboard.types";

/**
 * News-flash style marquee. CSS keyframes drive the scroll; content is
 * duplicated so the loop is seamless. Pauses on hover and via the pause
 * button (accessibility).
 */
export function UpdatesTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);
  const [paused, setPaused] = useState(false);
  const navigate = useNavigate();
  const trackRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(30);

  useEffect(() => {
    getTicker()
      .then(setItems)
      .catch(() => {
        // The ticker is an ambient nice-to-have above the real dashboard. It has
        // no state of its own to show, and a failure here is already surfaced by
        // the global toast in `api.ts`; adding a second error strip on top of
        // every page would be noise, so it simply stays hidden.
        setItems([]);
      });
  }, []);

  useEffect(() => {
    // Speed proportional to content width so long feeds don't fly by
    if (trackRef.current) {
      const width = trackRef.current.scrollWidth / 2;
      setDuration(Math.max(18, Math.round(width / 45)));
    }
  }, [items]);

  if (items.length === 0) return null;

  const list = [...items, ...items]; // duplicated for seamless loop

  return (
    <div className={`ticker severity-${items[0]?.severity ?? "info"}`}>
      <button
        className="ticker-pause"
        onClick={() => setPaused((p) => !p)}
        aria-label={paused ? "המשך גלילה" : "השהה גלילה"}
        title={paused ? "המשך" : "השהה"}
      >
        {paused ? "▶" : "⏸"}
      </button>
      <div className="ticker-viewport">
        <div
          ref={trackRef}
          className="ticker-track"
          style={{ animationDuration: `${duration}s`, animationPlayState: paused ? "paused" : "running" }}
        >
          {list.map((item, index) => (
            <button
              key={`${item.id}-${index}`}
              className={`ticker-item ticker-${item.severity}`}
              onClick={() => navigate(item.linkTo)}
              tabIndex={index < items.length ? 0 : -1}
            >
              <span aria-hidden>{item.icon}</span>
              <span>{item.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
