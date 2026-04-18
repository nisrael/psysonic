# Installing Psysonic on NixOS (flake)

This guide is for **NixOS** users who want **Psysonic from the upstream Git flake** (`github:Psychotoxical/psysonic`). Supported systems match the flake: **`x86_64-linux`** and **`aarch64-linux`**.

## Prerequisites

**Flakes** enabled (e.g. in `configuration.nix`):

```nix
nix.settings.experimental-features = [ "nix-command" "flakes" ];
```

## Binary cache (Cachix)

The project publishes store paths to a public Cachix cache so you can **substitute** binaries instead of compiling Psysonic locally on every machine.

- **Cache page:** [psysonic.cachix.org](https://psysonic.cachix.org)
- **Substituter URL:** `https://psysonic.cachix.org`
- **Public key** (trust this only if it matches what you expect from the cache owners):

  ```text
  psysonic.cachix.org-1:M9cQyQ7tgvUWOQ5Pyt8ozlMoPLtOZir6MfRuTH9/VYA=
  ```

### NixOS (`configuration.nix` or a flake module)

Add the substituter **and** its signing key under `nix.settings`. Keep `cache.nixos.org` in the list so ordinary `nixpkgs` binaries still resolve:

```nix
{
  nix.settings = {
    substituters = [
      "https://psysonic.cachix.org"
      "https://cache.nixos.org/"
    ];
    trusted-public-keys = [
      "psysonic.cachix.org-1:M9cQyQ7tgvUWOQ5Pyt8ozlMoPLtOZir6MfRuTH9/VYA="
      "cache.nixos.org-1:6NCHdSuAYQQOxGEKTGXLN9WWRXoSBT8GRiSnR6IdfGW="
    ];
  };
}
```

After `nixos-rebuild switch`, builds that hit the cache will download from Cachix. More background: [Cachix — Getting started](https://docs.cachix.org/getting-started).

## Install on NixOS (flake configuration)

Add the repo as an **input**, then reference **`packages.<system>.psysonic`** (or **`default`**, which is the same package).

### Example: top-level `flake.nix` + `nixosConfigurations`

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    psysonic.url = "github:Psychotoxical/psysonic";
  };

  outputs = { self, nixpkgs, ... }@inputs: let
    system = "x86_64-linux";
  in {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      inherit system;
      modules = [
        ./configuration.nix
        {
          environment.systemPackages = [
            inputs.psysonic.packages.${system}.psysonic
          ];
        }
      ];
    };
  };
}
```

Inside a **module** where you already have `pkgs` and flake `inputs` in scope, a common pattern is:

```nix
environment.systemPackages = with pkgs; [
  # …
  inputs.psysonic.packages.${pkgs.stdenv.hostPlatform.system}.psysonic
];
```

### Pinning a revision or tag

Follow **`main`** (above) to track the moving branch, or pin for reproducibility:

```nix
psysonic.url = "github:Psychotoxical/psysonic?ref=app-v1.34.13";  # example: release tag
```

Use a tag or commit SHA that exists on GitHub; the release workflow keeps **`flake.lock`** and **`nix/upstream-sources.json`** (`npmDepsHash`) in sync on tagged releases.

### Apply configuration

- **NixOS flake host**

  ```bash
  sudo nixos-rebuild switch --flake .#my-host
  ```

- **Home Manager** (if used separately)

  ```bash
  home-manager switch --flake .#my-user@my-host
  ```

## Home Manager

If you manage packages with [Home Manager](https://github.com/nix-community/home-manager), add the same package to `home.packages`:

```nix
home.packages = [
  inputs.psysonic.packages.${pkgs.stdenv.hostPlatform.system}.psysonic
];
```

(Adjust how `inputs` / `pkgs` are passed into your Home Manager module.)

## Desktop entry

The flake package installs a **`.desktop`** file and icon via `copyDesktopItems`; after `nixos-rebuild switch` (or a Home Manager activation that includes the package), Psysonic should appear in your application launcher like any other desktop app.

## Troubleshooting (Linux / WebKit)

Some GPU / compositor setups show a black window or broken scrolling under Wayland/EGL. The upstream Help / FAQ documents workarounds (e.g. running under **X11** and compositor-related env vars). Those apply to the Nix-built binary as well as other Linux builds.

## More detail in-repo

- **`flake.nix`** — package outputs, `devShell`, supported systems (see comments there for `nix build` / `nix develop`).
- **`nix/psysonic.nix`** — how the app is built from this source tree.
- **`.github/workflows/release.yml`** — `verify-nix` job: refreshes lock/npm hash and pushes store paths to Cachix on release tags.
