import { UNKNOWN_PLACEHOLDER } from "../../utils/certainty";

/** A value the server sent as null: an em dash marked "חסר", never 0 and never coloured. */
export function MissingValue() {
  return (
    <span className="uncert-value uncert-value-unknown">
      <span className="mono" aria-hidden>
        {UNKNOWN_PLACEHOLDER}
      </span>
      <span className="uncert-badge uncert-badge-unknown" title="הנתון עוד לא ידוע — לא מוצג 0 כדי לא להטעות">
        חסר
      </span>
    </span>
  );
}
