using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Realms;

namespace OsuSkinMixer;

public record SkinFileDto(string Name, string Hash);

public record SkinDto(string Id, string Name, string Creator, bool IsMix, List<SkinFileDto> Files);

public record ApplyRequest(List<SkinFileDto> Files, string SkinIni);

public record ApplyResult(string Id, bool Created, int FileCount, string? Backup);

public class UserFacingException(string message) : Exception(message);

/// <summary>
/// Access to an osu!lazer data directory: the realm database plus the content-addressed file store.
/// </summary>
/// <remarks>
/// The realm is opened in dynamic mode, so the schema is always taken from the file itself and can never be
/// migrated or altered by this tool. Instances are opened per operation and closed straight away so the game
/// is free to compact or migrate its database whenever it wants to.
/// </remarks>
public partial class OsuStore(string osuDir, string mixName, string stateDir)
{
    private const string legacy_skin_type = "osu.Game.Skinning.LegacySkin, osu.Game";

    // Matches lazer's SkinImporter.HashableFileTypes.
    private static readonly string[] hashable_file_types = [".ini", ".json"];

    private readonly Lock writeLock = new();
    private bool backedUpThisSession;

    public string OsuDir => osuDir;
    public string MixName => mixName;

    private string realmPath => Path.Combine(osuDir, "client.realm");
    private string filesPath => Path.Combine(osuDir, "files");

    [GeneratedRegex("^[0-9a-f]{64}$")]
    private static partial Regex hashRegex();

    public static bool IsValidHash(string hash) => hashRegex().IsMatch(hash);

    public string GetStoragePath(string hash) => Path.Combine(filesPath, hash[..1], hash[..2], hash);

    private Realm open(bool readOnly)
    {
        if (!File.Exists(realmPath))
            throw new UserFacingException($"No osu!lazer database found at {realmPath}. Set OSU_DIR to your osu!lazer data directory.");

        return Realm.GetInstance(new RealmConfiguration(realmPath) { IsDynamic = true, IsReadOnly = readOnly });
    }

    /// <summary>
    /// All user skins which are backed by files, i.e. legacy skins. Built-in skins have no files and are skipped.
    /// </summary>
    public List<SkinDto> GetSkins()
    {
        using var realm = open(readOnly: true);

        var result = new List<SkinDto>();

        foreach (var skin in realm.DynamicApi.All("Skin"))
        {
            var d = skin.DynamicApi;

            if (d.Get<bool>("DeletePending") || d.Get<bool>("Protected"))
                continue;

            string type = d.Get<string?>("InstantiationInfo") ?? string.Empty;

            // An empty type is a skin imported before the field existed, which lazer treats as legacy.
            if (type.Length > 0 && !type.StartsWith("osu.Game.Skinning.LegacySkin,", StringComparison.Ordinal))
                continue;

            string name = d.Get<string?>("Name") ?? string.Empty;

            var files = new List<SkinFileDto>();

            foreach (var usage in d.GetList<IRealmObjectBase>("Files"))
            {
                var file = usage.DynamicApi.Get<IRealmObjectBase?>("File");
                string? filename = usage.DynamicApi.Get<string?>("Filename");

                if (file == null || filename == null)
                    continue;

                files.Add(new SkinFileDto(filename, file.DynamicApi.Get<string>("Hash")));
            }

            result.Add(new SkinDto(d.Get<Guid>("ID").ToString(), name, d.Get<string?>("Creator") ?? string.Empty, name == mixName, files));
        }

        return result.OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>
    /// Replace the contents of the mix skin, creating it if it does not exist yet.
    /// </summary>
    public ApplyResult Apply(ApplyRequest request)
    {
        if (request.Files.Count == 0)
            throw new UserFacingException("Refusing to apply an empty skin.");

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var f in request.Files)
        {
            if (!IsValidHash(f.Hash))
                throw new UserFacingException($"Invalid file hash for {f.Name}.");

            if (string.IsNullOrWhiteSpace(f.Name) || f.Name.StartsWith('/') || f.Name.Split('/', '\\').Any(p => p is ".." or "."))
                throw new UserFacingException($"Invalid file name: {f.Name}");

            if (f.Name.Equals("skin.ini", StringComparison.OrdinalIgnoreCase))
                throw new UserFacingException("skin.ini is generated and must not be part of the file list.");

            if (!seen.Add(f.Name))
                throw new UserFacingException($"Duplicate file name: {f.Name}");
        }

        lock (writeLock)
        {
            // The configuration is new content, so it has to be added to the file store...
            byte[] iniBytes = Encoding.UTF8.GetBytes(request.SkinIni);
            string iniHash = Convert.ToHexStringLower(SHA256.HashData(iniBytes));
            writeToStore(iniHash, iniBytes);

            // ...along with the blank stand-ins, the first time a part of the skin is set to "none".
            foreach (string hash in request.Files.Select(f => f.Hash).Distinct())
            {
                if (BlankFiles.Get(hash) is byte[] blank)
                    writeToStore(hash, blank);
            }

            using var realm = open(readOnly: false);

            foreach (var f in request.Files)
            {
                if (BlankFiles.Get(f.Hash) != null)
                    continue;

                if (realm.DynamicApi.Find("File", f.Hash) == null || !File.Exists(GetStoragePath(f.Hash)))
                    throw new UserFacingException($"{f.Name} points at a file which is not in the osu! file store. Refresh and try again.");
            }

            string? backup = backupOnce(realm);

            bool created = false;
            Guid id = default;
            int count = 0;

            realm.Write(() =>
            {
                IRealmObjectBase? skin = realm.DynamicApi.All("Skin").Filter("Name == $0 && DeletePending == false && Protected == false", mixName).FirstOrDefault();

                if (skin == null)
                {
                    created = true;
                    skin = realm.DynamicApi.CreateObject("Skin", Guid.NewGuid());
                    skin.DynamicApi.Set("Name", mixName);
                    skin.DynamicApi.Set("Creator", "osu-skin-mixer");
                    skin.DynamicApi.Set("InstantiationInfo", legacy_skin_type);
                    skin.DynamicApi.Set("Protected", false);
                    skin.DynamicApi.Set("DeletePending", false);
                }

                id = skin.DynamicApi.Get<Guid>("ID");

                var files = skin.DynamicApi.GetList<IRealmObjectBase>("Files");
                files.Clear();

                var iniFile = realm.DynamicApi.Find("File", iniHash) ?? realm.DynamicApi.CreateObject("File", iniHash);

                addUsage("skin.ini", iniFile);

                foreach (var f in request.Files)
                    addUsage(f.Name, realm.DynamicApi.Find("File", f.Hash) ?? realm.DynamicApi.CreateObject("File", f.Hash));

                skin.DynamicApi.Set("Hash", computeHash(request.Files.Append(new SkinFileDto("skin.ini", iniHash))));
                count = files.Count;

                void addUsage(string filename, IRealmObjectBase file)
                {
                    var usage = realm.DynamicApi.AddEmbeddedObjectToList(files);
                    usage.DynamicApi.Set("Filename", filename);
                    usage.DynamicApi.Set("File", RealmValue.Object(file));
                }
            });

            return new ApplyResult(id.ToString(), created, count, backup);
        }
    }

    /// <summary>
    /// Mirrors RealmArchiveModelImporter.ComputeHash: SHA-256 over every hashable file, ordered by filename.
    /// </summary>
    private string computeHash(IEnumerable<SkinFileDto> files)
    {
        using var hashable = new MemoryStream();

        foreach (var f in files.Where(f => hashable_file_types.Any(ext => f.Name.EndsWith(ext, StringComparison.OrdinalIgnoreCase))).OrderBy(f => f.Name))
        {
            using var s = File.OpenRead(GetStoragePath(f.Hash));
            s.CopyTo(hashable);
        }

        return Convert.ToHexStringLower(SHA256.HashData(hashable.ToArray()));
    }

    private void writeToStore(string hash, byte[] data)
    {
        string path = GetStoragePath(hash);

        if (File.Exists(path) && new FileInfo(path).Length == data.Length)
            return;

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        string temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllBytes(temp, data);
        File.Move(temp, path, overwrite: true);
    }

    /// <summary>
    /// Take a consistent copy of the database before the first write of this session, keeping the newest few.
    /// </summary>
    private string? backupOnce(Realm realm)
    {
        if (backedUpThisSession)
            return null;

        string dir = Path.Combine(stateDir, "backups");
        Directory.CreateDirectory(dir);

        string path = Path.Combine(dir, $"client-{DateTime.Now:yyyyMMdd-HHmmss}.realm");
        realm.WriteCopy(new RealmConfiguration(path));
        backedUpThisSession = true;

        foreach (string old in Directory.GetFiles(dir, "client-*.realm").OrderDescending().Skip(3))
        {
            try
            {
                File.Delete(old);
            }
            catch (IOException)
            {
            }
        }

        return path;
    }
}
