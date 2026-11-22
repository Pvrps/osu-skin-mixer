// Linux.

const path = require("node:path");

module.exports = {
  serverFileName: "osu-skin-mixer-server",

  // Nothing to do: Electron picks between Wayland and X11 by itself.
  prepare() {},

  /** On Linux a window carries its own icon. */
  windowIcon: (folder) => path.join(folder, "icon.png"),
};
