import type { CategoryDef } from "../lib/categories";
import { type IniSection, iniValue, parseColour } from "../lib/ini";

interface Props {
  category: CategoryDef;
  /** The mix's configuration before any manual values, i.e. what each key inherits from its source skin. */
  inherited: IniSection[];
  overrides: Record<string, string>;
  onChange: (path: string, value: string | null) => void;
}

interface Field {
  section: string;
  key: string;
  colour: boolean;
}

// Settings which belong to no single element stay as the mix started, and can be changed from the last group.
const OTHER_FIELDS: Field[] = [
  { section: "General", key: "Version", colour: false },
  { section: "General", key: "AnimationFramerate", colour: false },
];

function fieldsFor(category: CategoryDef): Field[] {
  if (category.id === "other") return OTHER_FIELDS;

  const fields: Field[] = [];

  // The misspelt key is only kept so old skins carry over; nobody needs to set it by hand.
  for (const key of category.ini.General ?? []) {
    if (key !== "HitCircleOverlayAboveNumer") fields.push({ section: "General", key, colour: false });
  }

  for (const key of category.ini.Colours ?? []) fields.push({ section: "Colours", key, colour: true });
  if (category.font) fields.push({ section: "Fonts", key: category.font.overlapKey, colour: false });

  return fields;
}

const toHex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

const fromHex = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(",");

export function IniPanel({ category, inherited, overrides, onChange }: Props) {
  const fields = fieldsFor(category);

  if (fields.length === 0) return null;

  return (
    <div className="ini">
      <h3>Settings</h3>
      <p className="muted">These come from the skin chosen above. Type a value to set your own.</p>

      {fields.map((field) => {
        const path = `${field.section}.${field.key}`;
        const override = overrides[path];
        const base = iniValue(inherited, field.section, field.key);
        const rgb = field.colour ? parseColour(override ?? base) : null;

        return (
          <div className={`ini-row${override !== undefined ? " overridden" : ""}`} key={path}>
            <label htmlFor={path}>{field.key}</label>
            <div className="ini-input">
              {field.colour && (
                <input
                  type="color"
                  aria-label={`${field.key} colour`}
                  value={rgb ? toHex(rgb) : "#000000"}
                  onChange={(e) => onChange(path, fromHex(e.target.value))}
                />
              )}
              <input
                id={path}
                type="text"
                spellCheck={false}
                value={override ?? ""}
                placeholder={base ?? "not set"}
                onChange={(e) => onChange(path, e.target.value === "" ? null : e.target.value)}
              />
              {override !== undefined && (
                <button className="clear" title="Use the skin's own value" onClick={() => onChange(path, null)}>
                  ×
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
