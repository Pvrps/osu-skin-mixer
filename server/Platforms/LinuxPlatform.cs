using System.Diagnostics;

namespace OsuSkinMixer.Platforms;

public class LinuxPlatform : Platform
{
    // What the browsers which can show a page in its own window are called, depending on how they were installed.
    private static readonly string[] app_window_browsers =
    [
        "chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "brave", "brave-browser", "microsoft-edge", "microsoft-edge-stable",
    ];

    private const string database_name = "client.realm";

    // Where the Windows build of osu! keeps its data inside a Wine prefix, with a wildcard for the user's name.
    private static readonly string[] within_wine_prefix = ["drive_c", "users", "*", "AppData", "Roaming", "osu"];

    public override string OsuDataHome => dataHome;
    public override string AppDataHome => dataHome;

    private static string dataHome =>
        Environment.GetEnvironmentVariable("XDG_DATA_HOME") is { Length: > 0 } xdg ? xdg : Path.Combine(Home, ".local", "share");

    public override IEnumerable<string> OsuDataCandidates()
    {
        yield return Path.Combine(OsuDataHome, "osu");

        // A Flatpak install keeps its data in a sandbox of its own.
        yield return Path.Combine(Home, ".var", "app", "sh.ppy.osu", "data", "osu");

        // The Windows build run through Wine keeps its data inside whichever prefix it was installed into.
        string[][] prefixes =
        [
            [Home, ".wine"],
            [Home, "Games", "*"],
            [Home, ".local", "share", "lutris", "runners", "*"],
            [Home, ".local", "share", "bottles", "bottles", "*"],
            [Home, ".var", "app", "com.usebottles.bottles", "data", "bottles", "bottles", "*"],
            [Home, ".steam", "steam", "steamapps", "compatdata", "*", "pfx"],
            [Home, ".local", "share", "Steam", "steamapps", "compatdata", "*", "pfx"],
        ];

        foreach (string[] prefix in prefixes)
        {
            foreach (string found in expand([.. prefix, .. within_wine_prefix]))
                yield return found;
        }
    }

    public override string? FindAppWindowBrowser()
    {
        string[] path = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty).Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);

        return app_window_browsers.SelectMany(name => path.Select(dir => Path.Combine(dir, name))).FirstOrDefault(File.Exists);
    }

    public override ProcessStartInfo OpenInDefaultBrowser(string url) => new("xdg-open") { ArgumentList = { url } };

    public override bool CanFindRunningGame => true;

    /// <summary>
    /// A running osu! has its database open, and Linux lets a user see which files their own programs have open.
    /// </summary>
    public override string? FindRunningGame()
    {
        try
        {
            foreach (string process in Directory.EnumerateDirectories("/proc"))
            {
                if (!int.TryParse(Path.GetFileName(process), out int pid) || pid == Environment.ProcessId)
                    continue;

                try
                {
                    string commandLine = File.ReadAllText(Path.Combine(process, "cmdline"));

                    // Reading every program's open files would be slow, and the mixer itself opens the database too.
                    if (!commandLine.Contains("osu", StringComparison.OrdinalIgnoreCase) || commandLine.Contains("osu-skin-mixer", StringComparison.OrdinalIgnoreCase))
                        continue;

                    foreach (string descriptor in Directory.EnumerateFiles(Path.Combine(process, "fd")))
                    {
                        string? target = File.ResolveLinkTarget(descriptor, returnFinalTarget: false)?.FullName;

                        if (target != null && Path.GetFileName(target) == database_name && Path.GetDirectoryName(target) is string dir && File.Exists(target))
                            return dir;
                    }
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException)
                {
                    // Other users' programs, and ones which ended while being looked at.
                }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
        }

        return null;
    }

    /// <summary>Resolves a path whose parts may be "*", standing for any one folder.</summary>
    private static IEnumerable<string> expand(string[] parts)
    {
        IEnumerable<string> paths = [parts[0]];

        foreach (string part in parts.Skip(1))
        {
            paths = part == "*"
                ? paths.SelectMany(subfolders).ToList()
                : paths.Select(path => Path.Combine(path, part)).ToList();
        }

        return paths.Where(Directory.Exists);
    }

    private static IEnumerable<string> subfolders(string path)
    {
        try
        {
            return Directory.Exists(path) ? Directory.GetDirectories(path) : [];
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }
}
