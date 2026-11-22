using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.StaticFiles;
using OsuSkinMixer;

string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
string dataHome = Environment.GetEnvironmentVariable("XDG_DATA_HOME") is { Length: > 0 } xdg ? xdg : Path.Combine(home, ".local", "share");

string osuDir = resolveOsuDir(Environment.GetEnvironmentVariable("OSU_DIR") ?? Path.Combine(dataHome, "osu"));
string mixName = Environment.GetEnvironmentVariable("MIX_SKIN_NAME") is { Length: > 0 } n ? n : "purps - mix";
string stateDir = Environment.GetEnvironmentVariable("MIXER_STATE_DIR") ?? Path.Combine(dataHome, "osu-skin-mixer");
string port = Environment.GetEnvironmentVariable("PORT") ?? "5727";
string webRoot = Environment.GetEnvironmentVariable("WEB_ROOT") ?? Path.Combine(AppContext.BaseDirectory, "wwwroot");

Directory.CreateDirectory(stateDir);

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

var app = builder.Build();

var store = new OsuStore(osuDir, mixName, stateDir);
var defaults = new DefaultSkinCache(Path.Combine(stateDir, "default-skin"));
var contentTypes = new FileExtensionContentTypeProvider();
string selectionPath = Path.Combine(stateDir, "selection.json");

app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (UserFacingException e)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { error = e.Message });
    }
    catch (Exception e) when (!context.Response.HasStarted)
    {
        app.Logger.LogError(e, "Request failed");
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(new { error = e.Message });
    }
});

app.MapGet("/api/state", () => new
{
    mixName,
    osuDir,
    blank = new { png = BlankFiles.PngHash, wav = BlankFiles.WavHash },
    skins = store.GetSkins(),
    selection = File.Exists(selectionPath) ? JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(selectionPath)) : (JsonElement?)null,
});

app.MapPut("/api/selection", async (JsonElement selection) =>
{
    string temp = selectionPath + ".tmp";
    await File.WriteAllTextAsync(temp, selection.GetRawText());
    File.Move(temp, selectionPath, overwrite: true);
    return Results.NoContent();
});

app.MapPost("/api/apply", (ApplyRequest request) => store.Apply(request));

// Files are content-addressed, so they can be cached forever. The trailing name only exists to give the
// browser (and the preview's texture loader) a file extension to work with.
app.MapGet("/api/file/{hash}/{*name}", (string hash, string? name, HttpContext context) =>
{
    if (!OsuStore.IsValidHash(hash))
        return Results.BadRequest();

    context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";

    // The stand-ins for "none" may not have been written to the store yet.
    if (BlankFiles.Get(hash) is byte[] blank)
        return Results.Bytes(blank, contentTypeFor(name));

    string path = store.GetStoragePath(hash);

    if (!File.Exists(path))
    {
        context.Response.Headers.CacheControl = "no-store";
        return Results.NotFound();
    }

    return Results.File(path, contentTypeFor(name));
});

// lazer falls back to its built-in classic skin for anything a legacy skin does not provide.
// Those assets are not on disk, so they are fetched from the osu-resources repository on demand and cached.
app.MapGet("/api/default/index", async () => await defaults.GetIndex());

app.MapGet("/api/default/file/{name}", async (string name, HttpContext context) =>
{
    string? path = await defaults.GetFile(name);

    if (path == null)
        return Results.NotFound();

    context.Response.Headers.CacheControl = "public, max-age=86400";
    return Results.File(path, contentTypeFor(name));
});

if (Directory.Exists(webRoot))
{
    var files = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(Path.GetFullPath(webRoot));
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
}

Console.WriteLine($"osu! data:  {osuDir}");
Console.WriteLine($"mix skin:   {mixName}");
Console.WriteLine($"listening:  http://127.0.0.1:{port}");

app.Run();

string contentTypeFor(string? name) =>
    name != null && contentTypes.TryGetContentType(name, out string? type) ? type : "application/octet-stream";

// lazer lets the data directory be relocated, in which case the default location only holds a pointer.
static string resolveOsuDir(string dir)
{
    string storageIni = Path.Combine(dir, "storage.ini");

    if (!File.Exists(storageIni))
        return dir;

    foreach (string line in File.ReadAllLines(storageIni))
    {
        var match = Regex.Match(line, @"^\s*FullPath\s*=\s*(.+?)\s*$");

        if (match.Success && Directory.Exists(match.Groups[1].Value))
            return match.Groups[1].Value;
    }

    return dir;
}
