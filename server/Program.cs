using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using OsuSkinMixer;
using OsuSkinMixer.Platforms;

// This is the half of the mixer which reads and writes osu!'s database. The app's window (the app folder) starts
// it with "--attached" and shows the page it serves.
//
// It can also be run by itself, when it opens the page in a browser: in a bare window where one is installed
// which can do that, or in a tab with "--browser". "--no-open" opens nothing, for development.
bool attached = args.Contains("--attached");
bool open = !attached && !args.Contains("--no-open");
bool preferWindow = !args.Contains("--browser");

var platform = Platform.Current;

string stateDir = Environment.GetEnvironmentVariable("MIXER_STATE_DIR") ?? Path.Combine(platform.AppDataHome, "osu-skin-mixer");
Directory.CreateDirectory(stateDir);

string browserProfile = Path.Combine(stateDir, "window");

var location = new OsuLocation(platform, stateDir);
string osuDir = location.Find();
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
        Launcher.Open(platform, $"http://127.0.0.1:{Launcher.DEFAULT_PORT}", preferWindow, browserProfile);

    return;
}
else
    port = Launcher.FindFreePort();

string url = $"http://127.0.0.1:{port}";

var builder = WebApplication.CreateBuilder(args);
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.Services.AddResponseCompression();
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);
builder.WebHost.UseUrls(url);

var app = builder.Build();
app.UseResponseCompression();

var generated = new GeneratedFiles(Path.Combine(stateDir, "generated"));
var store = createStore();
var defaults = new DefaultSkinCache(Path.Combine(stateDir, "default-skin"));
var contentTypes = new FileExtensionContentTypeProvider();
var sessions = new Sessions(app.Lifetime, exitWhenClosed: open);
var updates = new Updates();
string selectionPath = Path.Combine(stateDir, "selection.json");

// For finding out what the interface is asking for, when something isn't showing up.
if (Environment.GetEnvironmentVariable("MIXER_LOG_REQUESTS") == "1")
{
    app.Use(async (context, next) =>
    {
        await next();
        Console.Error.WriteLine($"{context.Response.StatusCode} {context.Request.Method} {context.Request.Path} {context.Request.Headers.Range}");
    });
}

// The page is only ever asked for by its local address. A request naming anything else has been steered here by
// some other site, which must not be able to reach the user's osu! data.
app.Use(async (context, next) =>
{
    string host = context.Request.Host.Host;

    if (host is "127.0.0.1" or "localhost" or "[::1]")
        await next();
    else
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
});

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
    if (!hasDatabase(osuDir) && location.Find() is string found && hasDatabase(found))
    {
        osuDir = found;
        store = createStore();
    }

    return state();
});

object state() => new
{
    osuDir,
    // A running osu! can be found wherever it keeps its data, which is worth telling someone who is being asked.
    findsRunningGame = platform.CanFindRunningGame,
    // Without a database there is nothing to show yet, and the page asks where osu! is instead.
    missing = !hasDatabase(osuDir),
    blank = new { png = BlankFiles.PngHash, wav = BlankFiles.WavHash },
    skins = hasDatabase(osuDir) ? store.GetSkins() : [],
    selection = File.Exists(selectionPath) ? JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(selectionPath)) : (JsonElement?)null,
};

// Whether there is a newer release to tell the user about. The version is null when there isn't.
app.MapGet("/api/update", async () => new { version = await updates.Newer(), url = Updates.DOWNLOAD_URL });

// For installs which aren't in one of the usual places: the user says where osu!'s data is, and it is remembered.
app.MapPost("/api/location", (LocationRequest request) =>
{
    osuDir = location.Set(request.Path)
             ?? throw new UserFacingException($"There is no osu! database (client.realm) in {request.Path.Trim()}. In osu!, Settings > General > \"Open osu! folder\" shows the right folder.");
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

    // Songs are played from here too, and a player asks for a song in pieces as it goes.
    return Results.File(path, contentTypeFor(name), enableRangeProcessing: true);
});

// Recoloured images are made in the browser, by the same code which decides what goes into the mix.
app.MapGet("/api/generated/{key}", (string key) => generated.Find(key) is string hash ? Results.Ok(new { hash }) : Results.NotFound());

app.MapPost("/api/generated/{key}", async (string key, HttpRequest request) =>
{
    using var body = new MemoryStream();
    await request.Body.CopyToAsync(body);
    return Results.Ok(new { hash = generated.Save(key, body.ToArray()) });
});

// Images changed in the editor are kept by the mixer, like recoloured ones, until a mix which uses them is applied.
app.MapPost("/api/edited", async (HttpRequest request) =>
{
    using var body = new MemoryStream();
    await request.Body.CopyToAsync(body);
    return Results.Ok(new { hash = generated.SaveEdited(body.ToArray()) });
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
        Launcher.Open(platform, url, preferWindow, browserProfile);
        sessions.WatchStartup();
    });
}

if (attached)
{
    // The window holds this program's input open for as long as it lives. Once that closes, however the window
    // went away, there is nobody left to serve.
    _ = Task.Run(async () =>
    {
        using var input = Console.OpenStandardInput();
        byte[] buffer = new byte[256];

        while (await input.ReadAsync(buffer) > 0)
        {
        }

        app.Lifetime.StopApplication();
    });
}

app.Run();

OsuStore createStore() => new OsuStore(osuDir, stateDir) { ExtraContent = hash => BlankFiles.Get(hash) ?? generated.Get(hash) };

string contentTypeFor(string? name) =>
    name != null && contentTypes.TryGetContentType(name, out string? type) ? type : "application/octet-stream";

static bool hasDatabase(string dir) => OsuLocation.HasDatabase(dir);
