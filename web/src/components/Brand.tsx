/** The mixer's icon and name, as they head every screen. They lead to the site the mixer comes from. */
export function Brand() {
  return (
    // Opened outside the mixer's own window, in the user's browser.
    <a className="brand" href="https://osu.purps.ca" target="_blank" rel="noreferrer" title="osu.purps.ca">
      <img src="/favicon.svg" alt="" />
      osu! skin mixer
    </a>
  );
}
