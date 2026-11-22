using System.Text.RegularExpressions;
using OsuSkinMixer.Platforms;

namespace OsuSkinMixer;

/// <summary>
/// Works out where osu!lazer keeps its data, and remembers the answer when it took some finding.
/// </summary>
public partial class OsuLocation(Platform platform, string stateDir)
{
    private const string database_name = "client.realm";

    private string rememberedPath => Path.Combine(stateDir, "osu-location.txt");

    [GeneratedRegex(@"^\s*FullPath\s*=\s*(.+?)\s*$")]
    private static partial Regex fullPathRegex();

    public static bool HasDatabase(string dir) => File.Exists(Path.Combine(dir, database_name));

    /// <summary>
    /// The folder to use: wherever the user said, or the one a running osu! is using, or else the first of the
    /// usual places which has a database. Failing all of those, the usual place, so the user can be asked.
    /// </summary>
    public string Find() => FollowRedirect(
        Environment.GetEnvironmentVariable("OSU_DIR")
        ?? (File.Exists(rememberedPath) ? File.ReadAllText(rememberedPath).Trim() : null)
        ?? remember(platform.FindRunningGame())
        ?? platform.OsuDataCandidates().Select(FollowRedirect).FirstOrDefault(HasDatabase)
        ?? Path.Combine(platform.OsuDataHome, "osu"));

    /// <summary>
    /// Takes a folder the user pointed at, returning where osu!'s data turned out to be, or null if it isn't there.
    /// </summary>
    public string? Set(string given)
    {
        given = platform.ExpandHome(given.Trim().Trim('"'));

        // People point at all sorts of things: the folder itself, or the database inside it.
        string[] candidates = [given, Path.GetDirectoryName(given) ?? given];

        return remember(candidates.Where(c => c.Length > 0).Select(FollowRedirect).FirstOrDefault(HasDatabase));
    }

    /// <summary>
    /// lazer lets its data be moved, in which case the original folder only holds a pointer to the new one.
    /// </summary>
    public static string FollowRedirect(string dir)
    {
        string storageIni = Path.Combine(dir, "storage.ini");

        if (!File.Exists(storageIni))
            return dir;

        foreach (string line in File.ReadAllLines(storageIni))
        {
            var match = fullPathRegex().Match(line);

            if (match.Success && Directory.Exists(match.Groups[1].Value))
                return match.Groups[1].Value;
        }

        return dir;
    }

    // A folder found through the running game couldn't be found again once the game is closed, so it is kept.
    private string? remember(string? found)
    {
        if (found != null)
        {
            Directory.CreateDirectory(stateDir);
            File.WriteAllText(rememberedPath, found);
        }

        return found;
    }
}
