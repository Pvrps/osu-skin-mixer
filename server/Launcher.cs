using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace OsuSkinMixer;

/// <summary>
/// What makes the mixer behave like an app rather than a server: finding a port, showing its window, and
/// going away again once that window is closed.
/// </summary>
public static class Launcher
{
    public const int DEFAULT_PORT = 5727;

    /// <summary>What the mixer answers a ping with, so a second copy can tell the first is already running.</summary>
    public const string PING_REPLY = "osu-skin-mixer";

    private static readonly string[] app_window_browsers_windows =
    [
        @"Microsoft\Edge\Application\msedge.exe",
        @"Google\Chrome\Application\chrome.exe",
        @"BraveSoftware\Brave-Browser\Application\brave.exe",
    ];

    private static readonly string[] app_window_browsers_unix =
    [
        "chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "brave", "brave-browser", "microsoft-edge", "microsoft-edge-stable",
    ];

    public static bool IsPortFree(int port)
    {
        try
        {
            using var listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }

    public static int FindFreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    /// <summary>Whether whatever is listening on a port is another copy of the mixer.</summary>
    public static bool IsMixerRunningOn(int port)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            return http.GetStringAsync($"http://127.0.0.1:{port}/api/ping").GetAwaiter().GetResult() == PING_REPLY;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>
    /// Shows the mixer: in a window of its own where a browser which can do that is installed, and otherwise as a
    /// tab in the default browser.
    /// </summary>
    public static void Open(string url, bool preferWindow)
    {
        if (preferWindow && findAppWindowBrowser() is string browser && start(browser, $"--app={url}", "--new-window", "--autoplay-policy=no-user-gesture-required"))
            return;

        if (OperatingSystem.IsWindows())
            start(new ProcessStartInfo(url) { UseShellExecute = true });
        else
            start(OperatingSystem.IsMacOS() ? "open" : "xdg-open", url);
    }

    private static string? findAppWindowBrowser()
    {
        if (OperatingSystem.IsWindows())
        {
            var roots = new[] { Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.LocalApplicationData }
                        .Select(Environment.GetFolderPath)
                        .Where(root => root.Length > 0);

            return roots.SelectMany(root => app_window_browsers_windows.Select(relative => Path.Combine(root, relative))).FirstOrDefault(File.Exists);
        }

        if (OperatingSystem.IsMacOS())
            return null;

        string[] path = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty).Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);

        return app_window_browsers_unix.SelectMany(name => path.Select(dir => Path.Combine(dir, name))).FirstOrDefault(File.Exists);
    }

    private static bool start(string program, params string[] arguments)
    {
        var info = new ProcessStartInfo(program) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };

        foreach (string argument in arguments)
            info.ArgumentList.Add(argument);

        return start(info);
    }

    private static bool start(ProcessStartInfo info)
    {
        try
        {
            using var process = Process.Start(info);

            if (process == null)
                return false;

            // Whatever the browser has to say is of no interest, but its pipes must not fill up.
            if (info.RedirectStandardOutput)
            {
                process.OutputDataReceived += static (_, _) => { };
                process.ErrorDataReceived += static (_, _) => { };
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
            }

            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }
}

/// <summary>
/// Keeps count of the pages which have the mixer open, and shuts it down once the last one has been gone a while.
/// </summary>
public class Sessions(IHostApplicationLifetime lifetime, bool exitWhenClosed)
{
    // Long enough to cover a page reload, during which the count briefly drops to nothing.
    private static readonly TimeSpan grace_period = TimeSpan.FromSeconds(8);

    // How long to wait for the first page to show up before concluding that no window ever opened.
    private static readonly TimeSpan startup_period = TimeSpan.FromMinutes(2);

    private readonly Lock gate = new();
    private int open;
    private int generation;

    public void WatchStartup() => exitIfStillClosedAfter(startup_period);

    public void Enter()
    {
        lock (gate)
        {
            open++;
            generation++;
        }
    }

    public void Leave()
    {
        lock (gate)
            open--;

        exitIfStillClosedAfter(grace_period);
    }

    private void exitIfStillClosedAfter(TimeSpan delay)
    {
        if (!exitWhenClosed)
            return;

        int seen;

        lock (gate)
            seen = generation;

        _ = Task.Delay(delay).ContinueWith(_ =>
        {
            lock (gate)
            {
                // Someone having come (and perhaps gone again) since means another check is already on its way.
                if (open > 0 || generation != seen)
                    return;
            }

            lifetime.StopApplication();
        });
    }
}
