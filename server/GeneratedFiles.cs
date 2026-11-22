using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace OsuSkinMixer;

/// <summary>
/// Images made by the mixer itself (recoloured versions of skin elements), kept outside of osu!'s file store
/// until a mix which uses them is applied.
/// </summary>
/// <remarks>
/// Each image is stored under a key describing how it was made, so the same recolour of the same source
/// always resolves to the same bytes, and with them the same hash.
/// </remarks>
public partial class GeneratedFiles
{
    private const int max_length = 64 * 1024 * 1024;

    private static readonly byte[] png_signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    private readonly string dir;
    private readonly ConcurrentDictionary<string, string> hashByKey = new();
    private readonly ConcurrentDictionary<string, string> keyByHash = new();

    [GeneratedRegex("^[0-9a-f]{64}-[a-z]{1,16}-[0-9a-f]{6}$")]
    private static partial Regex keyRegex();

    public GeneratedFiles(string dir)
    {
        this.dir = dir;
        Directory.CreateDirectory(dir);

        foreach (string path in Directory.EnumerateFiles(dir, "*.png"))
        {
            string key = Path.GetFileNameWithoutExtension(path);

            if (keyRegex().IsMatch(key))
                remember(key, Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path))));
        }
    }

    public static bool IsValidKey(string key) => keyRegex().IsMatch(key);

    /// <summary>The hash of the image stored under a key, if there is one.</summary>
    public string? Find(string key) => hashByKey.GetValueOrDefault(key);

    public string? GetPath(string hash) => keyByHash.TryGetValue(hash, out string? key) ? pathFor(key) : null;

    public byte[]? Get(string hash) => GetPath(hash) is string path && File.Exists(path) ? File.ReadAllBytes(path) : null;

    public string Save(string key, byte[] data)
    {
        if (!IsValidKey(key))
            throw new UserFacingException("Invalid key for a generated image.");

        if (data.Length > max_length || !data.AsSpan().StartsWith(png_signature))
            throw new UserFacingException("A generated image must be a PNG.");

        // The first version stored under a key is kept, so its hash never changes under a mix which uses it.
        if (Find(key) is string existing)
            return existing;

        string path = pathFor(key);
        string temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllBytes(temp, data);
        File.Move(temp, path, overwrite: true);

        string hash = Convert.ToHexStringLower(SHA256.HashData(data));
        remember(key, hash);
        return hash;
    }

    private void remember(string key, string hash)
    {
        hashByKey[key] = hash;
        keyByHash[hash] = key;
    }

    private string pathFor(string key) => Path.Combine(dir, key + ".png");
}
