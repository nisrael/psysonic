// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Copy, PartialEq)]
enum GpuVendor {
    Nvidia,
    Intel,
    Amd,
}

#[cfg(target_os = "linux")]
fn detect_gpu_vendor() -> Option<GpuVendor> {
    use std::fs;
    use std::process::Command;

    // Check for NVIDIA driver presence (most reliable for proprietary drivers)
    if fs::metadata("/proc/driver/nvidia/version").is_ok() {
        return Some(GpuVendor::Nvidia);
    }

    // Check sysfs DRM vendor IDs (works for most integrated/discrete GPUs)
    let vendor_paths = [
        "/sys/class/drm/card0/device/vendor",
        "/sys/class/drm/card1/device/vendor",
    ];

    for path in &vendor_paths {
        if let Ok(vendor_id) = fs::read_to_string(path) {
            let vendor_id = vendor_id.trim();
            // PCI vendor IDs: NVIDIA=0x10de, Intel=0x8086, AMD=0x1002/0x1022
            match vendor_id {
                "0x10de" => return Some(GpuVendor::Nvidia),
                "0x8086" => return Some(GpuVendor::Intel),
                "0x1002" | "0x1022" => return Some(GpuVendor::Amd),
                _ => {}
            }
        }
    }

    // Fallback: try lspci to detect GPU vendor (requires pciutils)
    if let Ok(output) = Command::new("lspci").args(["-nn"]).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let line_lower = line.to_lowercase();
                // Only match VGA/Display controllers, not audio or other devices
                let is_display = line_lower.contains("vga")
                    || line_lower.contains("display")
                    || line_lower.contains("3d controller");

                if is_display && line_lower.contains("nvidia") {
                    return Some(GpuVendor::Nvidia);
                }
                if is_display
                    && (line_lower.contains("intel") || line_lower.contains("i915"))
                {
                    return Some(GpuVendor::Intel);
                }
                if is_display && (line_lower.contains("amd") || line_lower.contains("radeon"))
                {
                    return Some(GpuVendor::Amd);
                }
            }
        }
    }

    // Last resort: glxinfo (requires active display / X11 session)
    if let Ok(output) = Command::new("glxinfo").args(["-B"]).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            if stdout.contains("nvidia") {
                return Some(GpuVendor::Nvidia);
            }
            if stdout.contains("intel") {
                return Some(GpuVendor::Intel);
            }
            if stdout.contains("amd") || stdout.contains("radeon") {
                return Some(GpuVendor::Amd);
            }
        }
    }

    None
}

fn main() {
    // WebKitGTK on Wayland is unstable — force X11/XWayland on all Linux packages.
    // Users can still override by setting these vars before launch.
    //
    // Safety: set_var modifies global process state. These calls are safe here
    // because we're in main() before the Tauri runtime starts — no other threads
    // exist yet. If this code moves to lazy init or a plugin context, it would
    // need synchronization or marking as unsafe (Rust 2024+).
    #[cfg(target_os = "linux")]
    {
        if std::env::var("GDK_BACKEND").is_err() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
        if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }

        // Detect GPU vendor and configure DMA-BUF renderer appropriately.
        // NVIDIA proprietary drivers have issues with DMA-BUF in WebKitGTK,
        // so we disable it for NVIDIA. Mesa drivers (Intel/AMD) handle it well.
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            match detect_gpu_vendor() {
                Some(GpuVendor::Nvidia) => {
                    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
                }
                Some(GpuVendor::Intel) | Some(GpuVendor::Amd) => {
                    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "0");
                }
                None => {
                    // Unknown GPU: default to safe mode (disable DMA-BUF)
                    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
                }
            }
        }
    }

    let args: Vec<String> = std::env::args().collect();
    if psysonic_lib::cli::wants_version(&args) {
        psysonic_lib::cli::print_version();
        return;
    }
    if psysonic_lib::cli::wants_help(&args) {
        psysonic_lib::cli::print_help(
            args.first().map(|s| s.as_str()).unwrap_or("psysonic"),
        );
        return;
    }
    if let Some(code) = psysonic_lib::cli::try_completions_dispatch(&args) {
        std::process::exit(code);
    }
    if psysonic_lib::cli::wants_info(&args) {
        psysonic_lib::cli::run_info_and_exit(&args);
    }

    psysonic_lib::run();
}
