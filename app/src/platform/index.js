// Everything which differs from one operating system to the next.
//
// Each system has a file of its own here which provides the same things, and exactly one of them is used. The
// rest of the program asks this and never checks which system it is running on.
//
// - `prepare(app)`: anything to be done before the app is ready.
// - `windowIcon(folder)`: the picture for the window's corner and the task bar, where the window sets its own.
// - `serverFileName`: what the server's executable is called.

const path = require("node:path");

const system = { linux: "./linux", win32: "./windows", darwin: "./macos" }[process.platform] ?? "./linux";
const specific = require(system);

/**
 * Finds the server: one pointed at for development, or the one packed alongside the app.
 *
 * @param {import("electron").App} app
 */
function locateServer(app) {
  if (process.env.MIXER_SERVER) return process.env.MIXER_SERVER;

  const folder = app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "..", "..", "server");

  return path.join(folder, specific.serverFileName);
}

module.exports = { ...specific, locateServer };
