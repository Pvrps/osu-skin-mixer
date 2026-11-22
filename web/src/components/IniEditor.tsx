import { useState } from "react";
import { type IniSection, iniValue } from "../lib/ini";

interface Props {
  /** The skin.ini which will be written, overrides included. */
  result: IniSection[];
  /** The same without any overrides, to show what each one replaces. */
  inherited: IniSection[];
  overrides: Record<string, string>;
  onChange: (path: string, value: string | null) => void;
}

const COMMON_SECTIONS = ["General", "Colours", "Fonts", "CatchTheBeat", "Mania"];

const split = (path: string) => {
  const dot = path.indexOf(".");
  return { section: path.slice(0, dot), key: path.slice(dot + 1) };
};

export function IniEditor({ result, inherited, overrides, onChange }: Props) {
  const [section, setSection] = useState("General");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const entries = Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b));
  const overridden = new Set(Object.entries(overrides).filter(([, v]) => v.trim().length > 0).map(([path]) => path.toLowerCase()));

  const sections = [...new Set([...COMMON_SECTIONS, ...result.map((s) => s.name)])];
  const knownKeys = [...new Set([...inherited, ...result].filter((s) => s.name.toLowerCase() === section.trim().toLowerCase()).flatMap((s) => s.entries.map((e) => e.key)))];

  const canAdd = section.trim().length > 0 && key.trim().length > 0 && value.trim().length > 0 && !section.includes(".");

  const add = () => {
    if (!canAdd) return;

    onChange(`${section.trim()}.${key.trim()}`, value.trim());
    setKey("");
    setValue("");
  };

  return (
    <div className="ini-editor">
      <div className="ini-overrides">
        <h3>Your overrides</h3>
        <p className="muted">
          Any value set here wins over what the chosen skins say. Settings changed from a category's panel show up here too.
        </p>

        {entries.length === 0 && <p className="muted">Nothing overridden yet.</p>}

        {entries.map(([path, current]) => {
          const { section, key } = split(path);
          const original = iniValue(inherited, section, key);

          return (
            <div className="override-row" key={path}>
              <label htmlFor={`override-${path}`}>
                <span className="muted">[{section}]</span> {key}
              </label>
              <input
                id={`override-${path}`}
                type="text"
                spellCheck={false}
                value={current}
                placeholder={original ?? "not set"}
                onChange={(e) => onChange(path, e.target.value)}
              />
              <button className="clear" title={original === undefined ? "Remove" : `Back to ${original}`} onClick={() => onChange(path, null)}>
                ×
              </button>
            </div>
          );
        })}

        <form
          className="override-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input type="text" list="ini-sections" aria-label="Section" placeholder="Section" spellCheck={false} value={section} onChange={(e) => setSection(e.target.value)} />
          <datalist id="ini-sections">
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <input type="text" list="ini-keys" aria-label="Key" placeholder="Key, e.g. SliderBorder" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
          <datalist id="ini-keys">
            {knownKeys.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          <input type="text" aria-label="Value" placeholder="Value" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} />
          <button type="submit" disabled={!canAdd}>
            Add
          </button>
        </form>
      </div>

      <div className="ini-result">
        <h3>Resulting skin.ini</h3>
        <pre>
          {result
            .filter((s) => s.entries.length > 0)
            .map((s, i) => (
              <span key={i}>
                {i > 0 && "\n"}
                <span className="ini-section">[{s.name}]</span>
                {"\n"}
                {s.entries.map((e, j) => (
                  <span key={j} className={overridden.has(`${s.name}.${e.key}`.toLowerCase()) ? "ini-overridden" : undefined}>
                    {e.key}: {e.value}
                    {"\n"}
                  </span>
                ))}
              </span>
            ))}
        </pre>
      </div>
    </div>
  );
}
