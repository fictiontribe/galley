//! The loopback port and the session token the server is started with.

use std::net::{Ipv4Addr, TcpListener};

/// Ports below this need privileges, or belong to well-known services.
const MIN_PORT: u16 = 1024;

pub fn port_is_free(port: u16) -> bool {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok()
}

/// The preferred port when it is usable and free, otherwise one the OS
/// hands out. Reusing the same port across launches keeps the UI on the same
/// origin, so what it keeps in the browser's storage survives a restart.
pub fn pick_port(preferred: Option<u16>) -> std::io::Result<u16> {
    if let Some(port) = preferred.filter(|port| *port >= MIN_PORT) {
        if port_is_free(port) {
            return Ok(port);
        }
    }
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;

    Ok(listener.local_addr()?.port())
}

pub fn parse_port(text: &str) -> Option<u16> {
    text.trim()
        .parse::<u16>()
        .ok()
        .filter(|port| *port >= MIN_PORT)
}

/// 32 random bytes, hex-encoded: the server requires at least 16 characters.
pub fn mint_token() -> String {
    let mut bytes = [0u8; 32];

    getrandom::fill(&mut bytes).expect("the operating system has no random source");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_free_preferred_port() {
        let port = pick_port(None).unwrap();
        assert!(port >= MIN_PORT);
        assert_eq!(pick_port(Some(port)).unwrap(), port);
    }

    #[test]
    fn moves_off_a_busy_preferred_port() {
        let busy = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let taken = busy.local_addr().unwrap().port();
        let picked = pick_port(Some(taken)).unwrap();
        assert_ne!(picked, taken);
        assert!(port_is_free(picked));
    }

    #[test]
    fn ignores_privileged_preferences() {
        assert_ne!(pick_port(Some(80)).unwrap(), 80);
        assert_eq!(parse_port("80"), None);
        assert_eq!(parse_port(" 47110\n"), Some(47110));
        assert_eq!(parse_port("70000"), None);
        assert_eq!(parse_port("port"), None);
    }

    #[test]
    fn tokens_are_long_random_and_url_safe() {
        let (a, b) = (mint_token(), mint_token());
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
