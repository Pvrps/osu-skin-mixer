using System.Diagnostics;

namespace OsuSkinMixer.Platforms;

/// <summary>
/// Everything which differs from one operating system to the next. The rest of the mixer asks this and never
/// checks which system it is running on itself.
/// </summary>
public abstract class Platform
{
    public static Platform Current { get; } =
        OperatingSystem.IsWindows() ? new WindowsPlatform()
        : OperatingSystem.IsMacOS() ? new MacPlatform()
        : new LinuxPlatform();

    protected static string Home => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    /// <summary>The folder osu!lazer creates its "osu" data folder in.</summary>
    public abstract string OsuDataHome { get; }

    /// <summary>The folder applications keep their own data in, where the mixer's goes.</summary>
    public abstract string AppDataHome { get; }

    /// <summary>
    /// The places osu!'s data is found in practice, most likely first. They may or may not exist.
    /// </summary>
    public virtual IEnumerable<string> OsuDataCandidates() => [Path.Combine(OsuDataHome, "osu")];

    /// <summary>Whether <see cref="FindRunningGame"/> can do anything here.</summary>
    public virtual bool CanFindRunningGame => false;

    /// <summary>The data folder of an osu! which is running right now, where that can be told.</summary>
    public virtual string? FindRunningGame() => null;

    /// <summary>
    /// A browser which can show a page in a bare window of its own, without tabs or an address bar, if one is
    /// installed. Browsers built on Chromium can, when started with "--app".
    /// </summary>
    public virtual string? FindAppWindowBrowser() => null;

    /// <summary>How to hand an address to whatever the user's default browser is.</summary>
    public abstract ProcessStartInfo OpenInDefaultBrowser(string url);

    /// <summary>Replaces a leading "~" with the user's home folder, as people type paths that way.</summary>
    public string ExpandHome(string path) => path.StartsWith('~') ? Home + path[1..] : path;
}
