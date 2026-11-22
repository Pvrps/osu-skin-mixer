// The mixer's window.
//
// The mixer is two programs. This one is what the user starts: it starts the server (the `server` folder), which
// reads and writes osu!'s database and serves the interface as a web page on a port only this machine can reach,
// and shows that page in a window. Electron is used for the window because it brings its own copy of Chromium:
// the preview is drawn with WebGL, which the web views built into Linux desktops are too slow at.

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const path = require("node:path");

const platform = require("./platform");
const { Server } = require("./server");

/** @type {Server | null} */
let server = null;
/** @type {BrowserWindow | null} */
let window = null;

// The preview has sound, which should be heard from the start rather than after a first click.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
platform.prepare(app);

// Starting the app a second time brings up the window which is already open.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;

    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(open);
}

async function open() {
  // The interface has its own controls for everything, and none of the browser's menus apply to it.
  Menu.setApplicationMenu(null);

  try {
    server = await Server.start(platform.locateServer(app));
  } catch (error) {
    dialog.showErrorBox("osu! skin mixer couldn't start", String(error.message ?? error));
    app.quit();
    return;
  }

  window = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    title: "osu! skin mixer",
    backgroundColor: "#0d0c12",
    icon: platform.windowIcon(path.join(__dirname, "..", "icons")),
    // Shown once there is something to see, rather than as an empty frame.
    show: false,
    webPreferences: {
      // The page is an ordinary web page. It is given no way into this program or the machine.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window?.show());
  window.on("closed", () => {
    window = null;
  });

  // The window only ever shows the mixer. Anything else is handed to the user's own browser.
  const home = new URL(server.address).origin;

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== home) event.preventDefault();
  });

  await window.loadURL(server.address);
}

app.on("window-all-closed", () => app.quit());

app.on("quit", () => {
  server?.stop();
  server = null;
});
