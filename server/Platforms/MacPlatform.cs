using System.Diagnostics;

namespace OsuSkinMixer.Platforms;

public class MacPlatform : Platform
{
    public override string OsuDataHome => Path.Combine(Home, "Library", "Application Support");
    public override string AppDataHome => OsuDataHome;

    public override ProcessStartInfo OpenInDefaultBrowser(string url) => new("open") { ArgumentList = { url } };
}
