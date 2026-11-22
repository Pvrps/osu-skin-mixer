using System.Text.Json;
using System.Text.RegularExpressions;

namespace OsuSkinMixer;

/// <summary>
/// A local cache of the classic skin lazer falls back to, fetched lazily from the public osu-resources repository.
/// </summary>
/// <remarks>
/// Only used to make the preview match the game when a skin leaves an element out. Nothing is sent upstream
/// besides the name of the asset being requested, and everything degrades to "missing" when offline.
/// </remarks>
public partial class DefaultSkinCache(string cacheDir)
{
    private const string listing_url = "https://api.github.com/repos/ppy/osu-resources/contents/osu.Game.Resources/Skins/Legacy";
    private const string raw_url = "https://raw.githubusercontent.com/ppy/osu-resources/master/osu.Game.Resources/Skins/Legacy/";

    private static readonly HttpClient http = createClient();

    private readonly SemaphoreSlim gate = new(1, 1);
    private List<string>? index;
    private DateTime lastIndexAttempt;

    [GeneratedRegex(@"^[A-Za-z0-9@_\-]+\.(png|jpg|wav|ogg|mp3)$")]
    private static partial Regex nameRegex();

    private static HttpClient createClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("osu-skin-mixer");
        return client;
    }

    public async Task<List<string>> GetIndex()
    {
        await gate.WaitAsync();

        try
        {
            if (index != null)
                return index;

            string indexPath = Path.Combine(cacheDir, "index.json");

            if (File.Exists(indexPath))
                return index = JsonSerializer.Deserialize<List<string>>(await File.ReadAllTextAsync(indexPath)) ?? [];

            // Don't hammer the API when it is unreachable or rate limited.
            if (DateTime.UtcNow - lastIndexAttempt < TimeSpan.FromMinutes(5))
                return [];

            lastIndexAttempt = DateTime.UtcNow;

            try
            {
                using var doc = JsonDocument.Parse(await http.GetStringAsync(listing_url));

                var names = doc.RootElement.EnumerateArray()
                               .Where(e => e.GetProperty("type").GetString() == "file")
                               .Select(e => e.GetProperty("name").GetString()!)
                               .Where(name => nameRegex().IsMatch(name))
                               .ToList();

                Directory.CreateDirectory(cacheDir);
                await File.WriteAllTextAsync(indexPath, JsonSerializer.Serialize(names));
                return index = names;
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException or KeyNotFoundException)
            {
                return [];
            }
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<string?> GetFile(string name)
    {
        if (!nameRegex().IsMatch(name))
            return null;

        string path = Path.Combine(cacheDir, name);

        if (File.Exists(path))
            return path;

        if (!(await GetIndex()).Contains(name))
            return null;

        try
        {
            byte[] data = await http.GetByteArrayAsync(raw_url + Uri.EscapeDataString(name));

            Directory.CreateDirectory(cacheDir);
            string temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
            await File.WriteAllBytesAsync(temp, data);
            File.Move(temp, path, overwrite: true);
            return path;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return null;
        }
    }
}
