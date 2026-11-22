using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using OsuSkinMixer;

// Started plainly, the mixer is an app: it shows its own window and goes away when that is closed.
// "--no-open" leaves it running as a plain local server instead, and "--browser" uses a tab in the default browser.
bool open = !args.Contains("--no-open");
bool preferWindow = !args.Contains("--browser");

// osu!lazer and the mixer both keep their data where each platform expects applications to.
string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
string osuHome, stateHome;

if (OperatingSystem.IsWindows())
{
    osuHome = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
    stateHome = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
}
else if (OperatingSystem.IsMacOS())
    osuHome = stateHome = Path.Combine(home, "Library", "Application Support");
else
    osuHome = stateHome = Environment.GetEnvironmentVariable("XDG_DATA_HOME") is { Length: > 0 } xdg ? xdg : Path.Combine(home, ".local", "share");

string stateDir = Environment.GetEnvironmentVariable("MIXER_STATE_DIR") ?? Path.Combine(stateHome, "osu-skin-mixer");
string locationPath = Path.Combine(stateDir, "osu-location.txt");

// Where osu! keeps its data: wherever the user said, or the folder a running osu! is using, or else the first of
// the usual places which has a database. Failing all of those, the usual place is named so the user can be asked.
string locateOsu() => resolveOsuDir(
    Environment.GetEnvironmentVariable("OSU_DIR")
    ?? (File.Exists(locationPath) ? File.ReadAllText(locationPath).Trim() : null)
    ?? remember(OsuLocator.FromRunningGame())
    ?? OsuLocator.UsualPlaces(home, osuHome).Select(resolveOsuDir).FirstOrDefault(hasDatabase)
    ?? Path.Combine(osuHome, "osu"));

// A folder found through the running game couldn't be found again once the game is closed, so it is kept.
string? remember(string? found)
{
    if (found != null)
    {
        Directory.CreateDirectory(stateDir);
        File.WriteAllText(locationPath, found);
    }

    return found;
}

string osuDir = locateOsu();
string? webRoot = Environment.GetEnvironmentVariable("WEB_ROOT");

int port;

if (int.TryParse(Environment.GetEnvironmentVariable("PORT"), out int wanted))
    port = wanted;
else if (Launcher.IsPortFree(Launcher.DEFAULT_PORT))
    port = Launcher.DEFAULT_PORT;
else if (Launcher.IsMixerRunningOn(Launcher.DEFAULT_PORT))
{
    // Starting the mixer a second time brings up the one which is already running.
    if (open)
        Launcher.Open($"http://127.0.0.1:{Launcher.DEFAULT_PORT}", preferWindow);

    return;
}
else
    port = Launcher.FindFreePort();

string url = $"http://127.0.0.1:{port}";

Directory.CreateDirectory(stateDir);

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls(url);
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.Services.AddResponseCompression();
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

var app = builder.Build();
app.UseResponseCompression();

var generated = new GeneratedFiles(Path.Combine(stateDir, "generated"));
var store = createStore();
var defaults = new DefaultSkinCache(Path.Combine(stateDir, "default-skin"));
var contentTypes = new FileExtensionContentTypeProvider();
var sessions = new Sessions(app.Lifetime, exitWhenClosed: open);
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

app.MapGet("/api/ping", () => Launcher.PING_REPLY);

// Every open page holds one of these for as long as it is open, which is how the mixer knows when to go away.
app.MapGet("/api/session", async (HttpContext context) =>
{
    context.Response.ContentType = "text/event-stream";
    context.Response.Headers.CacheControl = "no-store";
    sessions.Enter();

    try
    {
        while (!context.RequestAborted.IsCancellationRequested)
        {
            await context.Response.WriteAsync(": still here\n\n", context.RequestAborted);
            await context.Response.Body.FlushAsync(context.RequestAborted);
            await Task.Delay(TimeSpan.FromSeconds(15), context.RequestAborted);
        }
    }
    catch (OperationCanceledException)
    {
    }
    finally
    {
        sessions.Leave();
    }
});

app.MapGet("/api/state", () =>
{
    // osu! may have been installed, or started, since the mixer last looked.
    if (!hasDatabase(osuDir) && hasDatabase(locateOsu()))
    {
        osuDir = locateOsu();
        store = createStore();
    }

    return state();
});

object state() => new
{
    osuDir,
    // A running osu! can be found wherever it keeps its data, which is worth telling someone who is being asked.
    findsRunningGame = OperatingSystem.IsLinux(),
    // Without a database there is nothing to show yet, and the page asks where osu! is instead.
    missing = !hasDatabase(osuDir),
    blank = new { png = BlankFiles.PngHash, wav = BlankFiles.WavHash },
    skins = hasDatabase(osuDir) ? store.GetSkins() : [],
    selection = File.Exists(selectionPath) ? JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(selectionPath)) : (JsonElement?)null,
};

// For installs which aren't in one of the usual places: the user says where osu!'s data is, and it is remembered.
app.MapPost("/api/location", (LocationRequest request) =>
{
    string given = request.Path.Trim().Trim('"');

    if (given.StartsWith('~'))
        given = home + given[1..];

    // People point at all sorts of things: the folder itself, the database inside it, or its "files" folder.
    string[] candidates = [given, Path.GetDirectoryName(given) ?? given];
    string? found = candidates.Where(c => c.Length > 0).Select(resolveOsuDir).FirstOrDefault(hasDatabase);

    if (found == null)
        throw new UserFacingException($"There is no osu! database (client.realm) in {given}. In osu!, Settings > General > \"Open osu! folder\" shows the right folder.");

    File.WriteAllText(locationPath, found);
    osuDir = found;
    store = createStore();

    return Results.Ok(new { osuDir });
});

// The preview plays real beatmaps where the game has any.
app.MapGet("/api/beatmaps", () => hasDatabase(osuDir) ? store.GetBeatmaps() : []);

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

    // Recoloured images live with the mixer until they are applied.
    if (!File.Exists(path) && generated.GetPath(hash) is string generatedPath)
        path = generatedPath;

    if (!File.Exists(path))
    {
        context.Response.Headers.CacheControl = "no-store";
        return Results.NotFound();
    }

    return Results.File(path, contentTypeFor(name));
});

// Recoloured images are made in the browser, by the same code which decides what goes into the mix.
app.MapGet("/api/generated/{key}", (string key) => generated.Find(key) is string hash ? Results.Ok(new { hash }) : Results.NotFound());

app.MapPost("/api/generated/{key}", async (string key, HttpRequest request) =>
{
    using var body = new MemoryStream();
    await request.Body.CopyToAsync(body);
    return Results.Ok(new { hash = generated.Save(key, body.ToArray()) });
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

// The UI is built into the executable. During development WEB_ROOT points at a fresh build of it instead.
IFileProvider? ui = null;

if (webRoot != null && Directory.Exists(webRoot))
    ui = new PhysicalFileProvider(Path.GetFullPath(webRoot));
else if (Assembly.GetExecutingAssembly().GetManifestResourceNames().Any(name => name.EndsWith("Manifest.xml", StringComparison.Ordinal)))
    ui = new ManifestEmbeddedFileProvider(Assembly.GetExecutingAssembly(), "wwwroot");

if (ui?.GetFileInfo("index.html").Exists == true)
{
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = ui });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = ui });
}
else
    app.MapGet("/", () => "This build of osu-skin-mixer has no user interface in it. Build the web folder, or set WEB_ROOT.");

Console.WriteLine($"osu! data:  {osuDir}");
Console.WriteLine($"listening:  {url}");

if (open)
{
    app.Lifetime.ApplicationStarted.Register(() =>
    {
        Launcher.Open(url, preferWindow);
        sessions.WatchStartup();
    });
}

app.Run();

OsuStore createStore() => new OsuStore(osuDir, stateDir) { ExtraContent = hash => BlankFiles.Get(hash) ?? generated.Get(hash) };

string contentTypeFor(string? name) =>
    name != null && contentTypes.TryGetContentType(name, out string? type) ? type : "application/octet-stream";

static bool hasDatabase(string dir) => OsuLocator.HasDatabase(dir);

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
