//! WebView2 power management: a hidden calendar is suspended and every hidden
//! webview asks the runtime to keep its memory low.

use tauri::WebviewWindow;

#[cfg(windows)]
pub fn set_active(w: &WebviewWindow, active: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, ICoreWebView2_3, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;

    let suspend = w.label() == "main";
    let _ = w.with_webview(move |wv| unsafe {
        let controller = wv.controller();
        let Ok(core) = controller.CoreWebView2() else { return };
        if active {
            if let Ok(c3) = core.cast::<ICoreWebView2_3>() {
                let _ = c3.Resume();
            }
            let _ = controller.SetIsVisible(true);
        }
        if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
            let level = if active { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW };
            let _ = c19.SetMemoryUsageTargetLevel(level);
        }
        if !active {
            let _ = controller.SetIsVisible(false);
            if suspend {
                if let Ok(c3) = core.cast::<ICoreWebView2_3>() {
                    let handler = webview2_com::TrySuspendCompletedHandler::create(Box::new(|_, _| Ok(())));
                    let _ = c3.TrySuspend(&handler);
                }
            }
        }
    });
}

#[cfg(not(windows))]
pub fn set_active(_w: &WebviewWindow, _active: bool) {}
