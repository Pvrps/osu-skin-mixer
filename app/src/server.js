// Starting and stopping the mixer's server.

const { spawn } = require("node:child_process");
const net = require("node:net");

/** How long the server is given to start. The first run is the slow one, as it unpacks its own runtime. */
const STARTUP_PATIENCE = 60_000;

/** Asks the system for a port nobody is using. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Whether something is answering on a port. */
function answers(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Server {
  /**
   * @param {import("node:child_process").ChildProcess} process
   * @param {number} port
   */
  constructor(process, port) {
    this.process = process;
    /** Where the interface is served. Only this machine can reach it. */
    this.address = `http://127.0.0.1:${port}/`;
  }

  /**
   * Starts the server and waits until it is answering.
   *
   * @param {string} program Where the server's executable is.
   */
  static async start(program) {
    const port = await freePort();

    // The server watches its input, and stops once that is closed. It closes when this program ends, however
    // it ends, so the server never outlives the window.
    const process = spawn(program, ["--attached"], {
      env: { ...globalThis.process.env, PORT: String(port) },
      stdio: ["pipe", "ignore", "inherit"],
      windowsHide: true,
    });

    let failure = null;

    process.once("error", (error) => {
      failure = new Error(`The mixer's server (${program}) could not be started: ${error.message}`);
    });
    process.once("exit", (code) => {
      failure ??= new Error(`The mixer's server stopped as soon as it was started (exit code ${code}).`);
    });

    const started = Date.now();

    while (!(await answers(port))) {
      if (failure) throw failure;

      if (Date.now() - started > STARTUP_PATIENCE) {
        process.kill();
        throw new Error("The mixer's server took too long to start.");
      }

      await pause(50);
    }

    return new Server(process, port);
  }

  stop() {
    this.process.stdin?.end();
    this.process.kill();
  }
}

module.exports = { Server };
