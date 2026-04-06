{
  description = "Psysonic dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-25.11-darwin";
    nix-darwin.url = "github:nix-darwin/nix-darwin/nix-darwin-25.11";
    rust-overlay.url = "github:oxalica/rust-overlay";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils, nix-darwin }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs { inherit system overlays; };

        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" ];
        };

        linuxDeps = pkgs.lib.optionals pkgs.stdenv.isLinux (with pkgs; [
          webkitgtk_4_1
          libayatana-appindicator
          librsvg
          libsoup_3
          gtk3
          glib
          cairo
          pango
          gdk-pixbuf
          atk
          openssl
          dbus
          xdotool
        ]);

        darwinDeps = pkgs.lib.optionals pkgs.stdenv.isDarwin [ pkgs.libiconv ];
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            rustToolchain
            nodejs_22
            pnpm
            pkg-config
            openssl
          ] ++ linuxDeps ++ darwinDeps;

          env = {
            RUST_SRC_PATH = "${rustToolchain}/lib/rustlib/src/rust/library";
          } // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
            WEBKIT_DISABLE_COMPOSITING_MODE = "1";
            GDK_BACKEND = "x11";
          };

          shellHook = ''
            echo "🎵 Psysonic dev environment"
            echo "   Node: $(node --version)"
            echo "   Rust: $(rustc --version)"
          '';
        };
      }
    );
}
