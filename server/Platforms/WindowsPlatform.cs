using System.Diagnostics;

namespace OsuSkinMixer.Platforms;

/// <remarks>
/// osu!lazer always starts from the roaming application data folder on Windows, leaving a pointer there if its
/// data has been moved. Nothing about the data's location is kept in the registry, so there is nowhere else to look.
/// </remarks>
public class WindowsPlatform : Platform
{
    // Where the browsers which can show a page in its own window install themselves, under the program folders.
    private static readonly string[] app_window_browsers =
    [
        @"Microsoft\Edge\Application\msedge.exe",
        @"Google\Chrome\Application\chrome.exe",
        @"BraveSoftware\Brave-Browser\Application\brave.exe",
    ];

    public override string OsuDataHome => Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
    public override string AppDataHome => Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

    public override string? FindAppWindowBrowser()
    {
        var programFolders = new[] { Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.LocalApplicationData }
                             .Select(Environment.GetFolderPath)
                             .Where(folder => folder.Length > 0);

        return programFolders.SelectMany(folder => app_window_browsers.Select(browser => Path.Combine(folder, browser))).FirstOrDefault(File.Exists);
    }

    /// <summary>Windows opens an address given to it as though it were a file, in whatever handles addresses.</summary>
    public override ProcessStartInfo OpenInDefaultBrowser(string url) => new(url) { UseShellExecute = true };
}
