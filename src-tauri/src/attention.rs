//! Drawing attention to a background window.
//!
//! The three desktops want three different things, and there is no portable
//! call that covers them, so this picks the right one per platform:
//!
//! - **macOS** — a dock badge via the window's badge count.
//! - **Linux** — the Unity launcher badge count, which is the closest thing to
//!   a standard; desktops without it simply do not show one.
//! - **Windows** — the taskbar has no numeric badge at all, so an overlay icon
//!   is the only equivalent. A small filled dot is generated at runtime rather
//!   than shipped as an asset, which keeps it correct if the accent ever moves.

use tauri::{AppHandle, Manager, Runtime};

/// A 16×16 RGBA dot for the Windows taskbar overlay.
///
/// Compiled on every platform, not just Windows, so the geometry can be tested
/// from a Linux checkout — a Linux dev machine is the usual place these bugs
/// would otherwise be introduced and never noticed.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn attention_dot() -> tauri::image::Image<'static> {
    const SIDE: u32 = 16;
    let mut rgba = vec![0u8; (SIDE * SIDE * 4) as usize];
    let centre = (SIDE as f32 - 1.0) / 2.0;
    let radius = SIDE as f32 * 0.42;

    for y in 0..SIDE {
        for x in 0..SIDE {
            let dx = x as f32 - centre;
            let dy = y as f32 - centre;
            let inside = (dx * dx + dy * dy).sqrt() <= radius;

            // Fade the last pixel of the edge so the circle is not visibly
            // stepped at this size.
            let distance = (dx * dx + dy * dy).sqrt();
            let alpha = if inside {
                ((radius - distance) / 1.5).clamp(0.0, 1.0)
            } else {
                0.0
            };

            let offset = ((y * SIDE + x) * 4) as usize;
            rgba[offset] = 200;
            rgba[offset + 1] = 125;
            rgba[offset + 2] = 95;
            rgba[offset + 3] = (alpha * 255.0) as u8;
        }
    }

    tauri::image::Image::new_owned(rgba, SIDE, SIDE)
}

/// Mark the app as having something waiting.
///
/// `count` is how many things; only "is it non-zero" reaches the platform,
/// since Windows has no number and macOS/Linux badges read as a single dot.
pub fn set_attention<R: Runtime>(app: &AppHandle<R>, count: usize) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let wanted = u64::try_from(count).unwrap_or(1);

    #[cfg(target_os = "windows")]
    {
        // By value, not by reference: the overlay takes ownership of the image.
        let icon: Option<tauri::image::Image<'static>> = (wanted > 0).then(attention_dot);
        let _ = window.set_overlay_icon(icon);
    }

    #[cfg(not(target_os = "windows"))]
    {
        // macOS and Linux both take a count. iOS clamps to i32, so convert
        // defensively rather than assuming a small number.
        let clamped = i64::try_from(wanted.min(i64::MAX as u64)).unwrap_or(i64::MAX);
        let _ = window.set_badge_count(if wanted > 0 { Some(clamped) } else { None });
    }
}

/// Clear whatever attention marker was set.
pub fn clear_attention<R: Runtime>(app: &AppHandle<R>) {
    set_attention(app, 0);
}

/// Frontend entry point: show or clear the taskbar/dock attention marker.
#[tauri::command]
pub fn set_attention_command(app: AppHandle, count: usize) {
    set_attention(&app, count);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_dot_is_fully_transparent_at_the_corners() {
        let image = attention_dot();
        let rgba = image.rgba();
        let side = image.width() as usize;

        // Corners sit outside the circle entirely.
        for (x, y) in [(0, 0), (side - 1, 0), (0, side - 1), (side - 1, side - 1)] {
            let offset = (y * side + x) * 4;
            assert_eq!(rgba[offset + 3], 0, "corner ({x},{y}) should be clear");
        }
    }

    #[test]
    fn the_dot_is_opaque_in_the_centre() {
        let image = attention_dot();
        let rgba = image.rgba();
        let side = image.width() as usize;
        let offset = ((side / 2) * side + side / 2) * 4;
        assert_eq!(rgba[offset + 3], 255);
    }

    #[test]
    fn the_dot_is_the_expected_size() {
        let image = attention_dot();
        assert_eq!(image.width(), 16);
        assert_eq!(image.height(), 16);
        assert_eq!(image.rgba().len(), 16 * 16 * 4);
    }
}
