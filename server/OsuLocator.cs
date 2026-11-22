namespace OsuSkinMixer;

/// <summary>
/// Finds where osu!lazer keeps its data.
/// </summary>
/// <remarks>
/// lazer records its data location nowhere but in the data folder itself: the registry on Windows only holds
/// file associations pointing at the executable. So the search is of the places the data ends up in practice,
/// and of the game itself when it happens to be running.
/// </remarks>
public static class OsuLocator
{
    private const string database_name = "client.realm";

    // Where the Windows build keeps its data inside a Wine prefix, with a wildcard for the user's name.
    private static readonly string[] within_prefix = ["drive_c", "users", "*", "AppData", "Roaming", "osu"];

    public static bool HasDatabase(string dir) => File.Exists(Path.Combine(dir, database_name));

    /// <summary>The data folder of a running osu!, which has its database open for as long as it runs.</summary>
    public static string? FromRunningGame()
    {
        if (!OperatingSystem.IsLinux())
            return null;

        try
        {
            foreach (string process in Directory.EnumerateDirectories("/proc"))
            {
                if (!int.TryParse(Path.GetFileName(process), out int pid) || pid == Environment.ProcessId)
                    continue;

                try
                {
                    string commandLine = File.ReadAllText(Path.Combine(process, "cmdline"));

                    // Reading every process's open files would be slow, and the mixer itself opens the database too.
                    if (!commandLine.Contains("osu", StringComparison.OrdinalIgnoreCase) || commandLine.Contains("osu-skin-mixer", StringComparison.OrdinalIgnoreCase))
                        continue;

                    foreach (string descriptor in Directory.EnumerateFiles(Path.Combine(process, "fd")))
                    {
                        string? target = File.ResolveLinkTarget(descriptor, returnFinalTarget: false)?.FullName;

                        if (target != null && Path.GetFileName(target) == database_name && Path.GetDirectoryName(target) is string dir && HasDatabase(dir))
                            return dir;
                    }
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException)
                {
                    // Other users' processes, and ones which ended while being looked at.
                }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
        }

        return null;
    }

    /// <summary>
    /// The places osu!'s data is usually found, most likely first. They may or may not exist.
    /// </summary>
    public static IEnumerable<string> UsualPlaces(string home, string dataHome)
    {
        yield return Path.Combine(dataHome, "osu");

        if (!OperatingSystem.IsLinux())
            yield break;

        // A Flatpak install keeps its data in a sandbox of its own.
        yield return Path.Combine(home, ".var", "app", "sh.ppy.osu", "data", "osu");

        // The Windows build run through Wine keeps its data inside whichever prefix it was installed into.
        string[][] prefixes =
        [
            [home, ".wine"],
            [home, "Games", "*"],
            [home, ".local", "share", "lutris", "runners", "*"],
            [home, ".local", "share", "bottles", "bottles", "*"],
            [home, ".var", "app", "com.usebottles.bottles", "data", "bottles", "bottles", "*"],
            [home, ".steam", "steam", "steamapps", "compatdata", "*", "pfx"],
            [home, ".local", "share", "Steam", "steamapps", "compatdata", "*", "pfx"],
        ];

        foreach (string[] prefix in prefixes)
        {
            foreach (string found in expand([.. prefix, .. within_prefix]))
                yield return found;
        }
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
