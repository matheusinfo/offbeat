//! Desktop notification when the queue finishes, through the freedesktop
//! notification service on the session D-Bus. zbus already comes with
//! Tauri's plugins, so this adds no new crate, and the WebView gets no new
//! permission: the UI asks the backend.

use crate::error::{AppError, AppResult, ErrorCode};
use std::collections::HashMap;
use zbus::zvariant::Value;

const MAX_TITLE: usize = 100;
const MAX_BODY: usize = 300;

/// Plain text only: no control characters, and no markup, which some
/// notification servers would interpret.
fn clean(text: &str, max: usize) -> String {
    text.chars()
        .filter(|c| !c.is_control() && !matches!(c, '<' | '>' | '&'))
        .take(max)
        .collect::<String>()
        .trim()
        .to_owned()
}

#[tauri::command]
pub async fn notify(title: String, body: String) -> AppResult<()> {
    let title = clean(&title, MAX_TITLE);
    if title.is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidRequest,
            "empty notification",
        ));
    }
    let body = clean(&body, MAX_BODY);
    let failed = |e: zbus::Error| AppError::new(ErrorCode::Io, format!("could not notify: {e}"));
    let conn = zbus::Connection::session().await.map_err(failed)?;
    let hints: HashMap<&str, Value<'_>> = HashMap::new();
    conn.call_method(
        Some("org.freedesktop.Notifications"),
        "/org/freedesktop/Notifications",
        Some("org.freedesktop.Notifications"),
        "Notify",
        // app name, replaces id, icon, summary, body, actions, hints, timeout
        &(
            "Offbeat",
            0u32,
            "offbeat",
            title.as_str(),
            body.as_str(),
            Vec::<&str>::new(),
            hints,
            -1i32,
        ),
    )
    .await
    .map_err(failed)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::clean;

    #[test]
    fn keeps_plain_text_only() {
        assert_eq!(
            clean(" 3 songs <b>ready</b>\n & done ", 100),
            "3 songs bready/b  done"
        );
        assert_eq!(clean("abcdef", 3), "abc");
    }
}
