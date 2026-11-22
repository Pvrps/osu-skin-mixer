using System.Reflection;
using System.Text.Json;

namespace OsuSkinMixer;

/// <summary>
/// Finds out whether a newer version of the mixer has been released than the one which is running, so that the
/// interface can say so. Nothing is downloaded or replaced: the user is pointed at the release and fetches it.
/// </summary>
/// <remarks>
/// This is the one thing the mixer asks of the internet without being asked to. It is a single request to GitHub
/// each time the mixer starts, which says nothing about the user, and MIXER_NO_UPDATE_CHECK=1 turns it off.
/// </remarks>
public class Updates
{
    /// <summary>Where the latest release is to be had.</summary>
    public const string DOWNLOAD_URL = "https://github.com/Pvrps/osu-skin-mixer/releases/latest";

    private const string latest_release = "https://api.github.com/repos/Pvrps/osu-skin-mixer/releases/latest";

    private readonly Version? current;
    private readonly bool enabled;
    private Task<string?>? newer;

    public Updates()
        : this(Assembly.GetExecutingAssembly().GetName().Version, Environment.GetEnvironmentVariable("MIXER_NO_UPDATE_CHECK") != "1")
    {
    }

    public Updates(Version? current, bool enabled)
    {
        this.current = current;
        this.enabled = enabled;
    }

    /// <summary>
    /// The version of the latest release if it is newer than this one, and null otherwise: when this is the latest,
    /// when it can't be told, and when this was built from source and so has no version to compare.
    /// </summary>
    public Task<string?> Newer() => newer ??= look();

    private async Task<string?> look()
    {
        // A build from source is version 0.0.0. Only a release is given a version, from its tag.
        if (!enabled || current == null || current.Major + current.Minor + current.Build == 0)
            return null;

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
            // GitHub turns away requests which don't say what is making them.
            client.DefaultRequestHeaders.UserAgent.ParseAdd("osu-skin-mixer");

            using var release = JsonDocument.Parse(await client.GetStringAsync(latest_release));

            return NewerOf(current, release.RootElement.GetProperty("tag_name").GetString());
        }
        catch (Exception)
        {
            // Offline, or GitHub isn't answering. There is always next time.
            return null;
        }
    }

    /// <summary>The version a release's tag names, such as "v1.2.0", if that is newer than the one given.</summary>
    public static string? NewerOf(Version current, string? tag)
    {
        string name = (tag ?? "").TrimStart('v');

        if (!Version.TryParse(name, out var latest))
            return null;

        // Only the three parts a release is numbered with are compared.
        var running = new Version(current.Major, current.Minor, Math.Max(0, current.Build));

        return new Version(latest.Major, latest.Minor, Math.Max(0, latest.Build)) > running ? name : null;
    }
}
