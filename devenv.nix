{
  pkgs,
  lib,
  ...
}: {
  languages.dotnet = {
    enable = true;
    package = pkgs.dotnet-sdk_10;
  };

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
  };

  packages = [pkgs.electron pkgs.just];

  env = {
    # Realm ships a prebuilt native library that needs libstdc++ and zlib.
    LD_LIBRARY_PATH = lib.makeLibraryPath [pkgs.stdenv.cc.cc.lib pkgs.zlib];

    # The Electron which npm downloads is built for ordinary distributions and won't start on NixOS, so the
    # one from nixpkgs is used in its place: to run the app from source, and to package it locally.
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    MIXER_ELECTRON_DIST = "${pkgs.electron}/libexec/electron";
    MIXER_ELECTRON_VERSION = pkgs.electron.version;

    DOTNET_CLI_TELEMETRY_OPTOUT = "1";
    DOTNET_NOLOGO = "1";
  };
}
