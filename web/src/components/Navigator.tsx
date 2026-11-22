import { memo, useCallback, useMemo, useState } from "react";
import { CATEGORIES, type CategoryDef, type CategoryId, SECTIONS } from "../lib/categories";
import { type ElementEntry, type ElementIndex, representative, sortedEntries } from "../lib/elements";
import { DEFAULT_ID, NONE_ID, type RecolourLookup, type Selection } from "../lib/mix";
import type { Recolour } from "../lib/recolour";
import { type Skin, fileUrl } from "../lib/skins";
import { Thumb } from "./Thumb";

export interface Target {
  group: CategoryId;
  /** The element being looked at, or null for the group as a whole. */
  element: string | null;
}

interface Props {
  index: ElementIndex;
  selection: Selection;
  skinsById: Map<string, Skin>;
  lookup: RecolourLookup;
  colourOf: (skinId: string) => string;
  target: Target | null;
  onTarget: (target: Target) => void;
}

interface GroupProps {
  category: CategoryDef;
  entries: ElementEntry[];
  /** The skin the group comes from, where that isn't the one the mix started as. */
  groupSource: string | undefined;
  elementSources: Record<string, string> | undefined;
  recolours: Record<string, Recolour> | undefined;
  /** Images changed in the editor, by the hash of the file they were made from. */
  edits: Record<string, string>;
  base: string;
  skinsById: Map<string, Skin>;
  lookup: RecolourLookup;
  colourOf: (skinId: string) => string;
  expanded: boolean;
  /** Undefined when nothing in this group is selected, null when the group itself is. */
  active: string | null | undefined;
  onTarget: (target: Target) => void;
  onToggle: (group: CategoryId) => void;
}

const Group = memo(function Group({ category, entries, groupSource, elementSources, recolours, edits, base, skinsById, lookup, colourOf, expanded, active, onTarget, onToggle }: GroupProps) {
  const fallback = groupSource && skinsById.has(groupSource) ? groupSource : base;
  const hasEdits = Object.keys(edits).length > 0;

  // Whether any of the files an element is made of, in the skin it is taken from, has been edited by hand.
  const isEdited = (entry: ElementEntry) => {
    if (!hasEdits) return false;

    const override = elementSources?.[entry.element];
    return (entry.bySkin.get(override && skinsById.has(override) ? override : fallback) ?? []).some((file) => edits[file.hash] !== undefined);
  };

  const changed = new Set([...Object.keys(elementSources ?? {}), ...Object.keys(recolours ?? {}), ...entries.filter(isEdited).map((e) => e.element)]).size;

  return (
    <div className={`nav-group${expanded ? " expanded" : ""}`}>
      <button
        className={`nav-group-head${active === null ? " active" : ""}`}
        aria-expanded={expanded}
        onClick={() => {
          // The first click on a group opens it and selects it; clicking the selected group again folds it away.
          if (active === null || !expanded) onToggle(category.id);
          onTarget({ group: category.id, element: null });
        }}
      >
        <svg className="chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="nav-group-label">{category.label}</span>
        {fallback !== base && <span className="dot" style={{ "--skin": colourOf(fallback) } as React.CSSProperties} title={`All from ${skinsById.get(fallback)?.name}`} />}
        {changed > 0 && <span className="count changed">{changed} changed</span>}
        {changed === 0 && entries.length > 0 && <span className="count">{entries.length}</span>}
      </button>

      {expanded &&
        entries.map((entry) => {
          const override = elementSources?.[entry.element];
          const sourceId = override && skinsById.has(override) ? override : fallback;
          const files = entry.bySkin.get(sourceId);
          const recolour = recolours?.[entry.element];

          let url: string | null = null;

          if (files && sourceId !== NONE_ID) {
            const shown = representative(files);
            const edited = edits[shown.hash];
            const recoloured = recolour && entry.kind === "image" ? lookup(edited ?? shown.hash, recolour) : undefined;

            url = fileUrl(recoloured ? { name: "recoloured.png", hash: recoloured } : edited ? { name: "edited.png", hash: edited } : shown.source);
          }

          const differs = sourceId !== base || recolour !== undefined || isEdited(entry);
          const state = sourceId === NONE_ID ? (entry.kind === "audio" ? "silent" : "hidden") : !files ? (sourceId === DEFAULT_ID ? "game default" : "not in mix") : null;

          return (
            <button
              key={entry.element}
              className={`nav-row${active === entry.element ? " active" : ""}${files ? "" : " absent"}`}
              title={entry.element}
              onClick={() => onTarget({ group: category.id, element: entry.element })}
            >
              <Thumb kind={entry.kind} url={url} size="small" />
              <span className="nav-row-label">{entry.label}</span>
              {state && <span className="nav-row-state">{state}</span>}
              {differs && <span className="dot" style={{ "--skin": recolour ? recolour.colour : colourOf(sourceId) } as React.CSSProperties} />}
            </button>
          );
        })}
    </div>
  );
});

/** The list of everything a skin is made of, grouped by where it shows up in the game. */
export function Navigator({ index, selection, skinsById, lookup, colourOf, target, onTarget }: Props) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<CategoryId>>(() => new Set(target ? [target.group] : []));

  const sorted = useMemo(() => new Map(CATEGORIES.map((c) => [c.id, sortedEntries(index.get(c.id)!)])), [index]);
  const total = useMemo(() => [...sorted.values()].reduce((sum, entries) => sum + entries.length, 0), [sorted]);

  const needle = filter.trim().toLowerCase();

  const toggle = useCallback(
    (group: CategoryId) =>
      setExpanded((current) => {
        const next = new Set(current);

        if (next.has(group)) next.delete(group);
        else next.add(group);

        return next;
      }),
    [],
  );

  let matches = 0;

  const sections = SECTIONS.map((section) => {
    const groups = CATEGORIES.filter((c) => c.section === section).flatMap((category) => {
      const all = sorted.get(category.id)!;
      const groupMatches = needle !== "" && category.label.toLowerCase().includes(needle);
      const entries = needle === "" || groupMatches ? all : all.filter((e) => e.label.includes(needle) || e.element.includes(needle));

      // Groups with nothing in them are only worth listing when they hold settings, like the combo colours.
      const settingsOnly = all.length === 0 && Object.keys(category.ini).length > 0;
      if (needle === "" ? all.length === 0 && !settingsOnly : entries.length === 0 && !groupMatches) return [];

      matches += entries.length;
      return [{ category, entries }];
    });

    return { section, groups };
  }).filter((s) => s.groups.length > 0);

  return (
    <nav className="navigator">
      <div className="nav-search">
        <input type="search" placeholder={`Search ${total} elements`} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <div className="nav-scroll">
        {sections.map(({ section, groups }) => (
          <section key={section}>
            <h2>{section}</h2>
            {groups.map(({ category, entries }) => (
              <Group
                key={category.id}
                category={category}
                entries={entries}
                groupSource={selection.overrides[category.id]}
                elementSources={selection.elements[category.id]}
                recolours={selection.recolours[category.id]}
                edits={selection.edits}
                base={selection.base!}
                skinsById={skinsById}
                lookup={lookup}
                colourOf={colourOf}
                // While searching, every group with a match is open, but never so many rows that the page crawls.
                expanded={needle === "" ? expanded.has(category.id) : matches <= 400 || expanded.has(category.id)}
                active={target?.group === category.id ? target.element : undefined}
                onTarget={onTarget}
                onToggle={toggle}
              />
            ))}
          </section>
        ))}
        {sections.length === 0 && <p className="muted nav-empty">Nothing matches "{filter}".</p>}
      </div>
    </nav>
  );
}
