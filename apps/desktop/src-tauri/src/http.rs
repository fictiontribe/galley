//! A minimal HTTP/1.1 client for the one server this app talks to: its own,
//! on 127.0.0.1. A full HTTP stack would be most of this app's build size for
//! three requests (meta, the sites list, open a site).

use std::{
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    time::Duration,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
}

impl Response {
    pub fn json(&self) -> Result<serde_json::Value, String> {
        serde_json::from_slice(&self.body)
            .map_err(|e| format!("the server's answer wasn't JSON: {e}"))
    }

    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

pub fn request(
    port: u16,
    method: &str,
    path: &str,
    token: &str,
    json: Option<&str>,
    timeout: Duration,
) -> Result<Response, String> {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&address, timeout).map_err(|e| e.to_string())?;

    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| e.to_string())?;
    stream
        .write_all(&encode_request(port, method, path, token, json))
        .map_err(|e| e.to_string())?;
    let mut raw = Vec::new();

    stream.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    parse_response(&raw)
}

pub fn encode_request(
    port: u16,
    method: &str,
    path: &str,
    token: &str,
    json: Option<&str>,
) -> Vec<u8> {
    let mut head = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nAccept: application/json\r\nConnection: close\r\n"
    );

    if let Some(body) = json {
        head.push_str(&format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            body.len()
        ));
    }
    head.push_str("\r\n");
    let mut bytes = head.into_bytes();

    if let Some(body) = json {
        bytes.extend_from_slice(body.as_bytes());
    }
    bytes
}

pub fn parse_response(raw: &[u8]) -> Result<Response, String> {
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("no end of headers")?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| "headers aren't text")?;
    let body = &raw[split + 4..];
    let mut lines = head.split("\r\n");
    let status_line = lines.next().ok_or("empty response")?;
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .filter(|_| status_line.starts_with("HTTP/1."))
        .ok_or_else(|| format!("bad status line {status_line:?}"))?;
    let header = |name: &str| {
        head.split("\r\n").skip(1).find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.trim()
                .eq_ignore_ascii_case(name)
                .then(|| value.trim().to_string())
        })
    };
    let body = if header("transfer-encoding")
        .is_some_and(|v| v.to_ascii_lowercase().contains("chunked"))
    {
        decode_chunked(body)?
    } else if let Some(length) = header("content-length") {
        let length: usize = length.parse().map_err(|_| "bad Content-Length")?;
        body.get(..length)
            .ok_or("the response ended early")?
            .to_vec()
    } else {
        body.to_vec()
    };

    Ok(Response { status, body })
}

pub fn decode_chunked(mut data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();

    loop {
        let line_end = data
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or("unterminated chunk size")?;
        let size_text = std::str::from_utf8(&data[..line_end]).map_err(|_| "bad chunk size")?;
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|_| "bad chunk size")?;

        data = &data[line_end + 2..];
        if size == 0 {
            return Ok(out);
        }
        out.extend_from_slice(
            data.get(..size)
                .ok_or("the response ended inside a chunk")?,
        );
        data = data.get(size + 2..).ok_or("missing chunk terminator")?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_content_length_response() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\ncontent-length: 13\r\n\r\n{\"desktop\":1}extra";
        let response = parse_response(raw).unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.json().unwrap()["desktop"], 1);
    }

    #[test]
    fn decodes_chunked_bodies() {
        let raw = b"HTTP/1.1 403 Forbidden\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{\"a\"\r\n3;ext=1\r\n:1}\r\n0\r\n\r\n";
        let response = parse_response(raw).unwrap();
        assert_eq!(response.status, 403);
        assert!(!response.ok());
        assert_eq!(response.body, b"{\"a\":1}");
    }

    #[test]
    fn reads_to_close_without_a_length() {
        let response = parse_response(b"HTTP/1.0 204 No Content\r\n\r\n").unwrap();
        assert_eq!(response.status, 204);
        assert!(response.body.is_empty());
    }

    #[test]
    fn refuses_garbage() {
        assert!(parse_response(b"SSH-2.0-OpenSSH\r\n\r\n").is_err());
        assert!(parse_response(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort").is_err());
        assert!(parse_response(b"HTTP/1.1 200 OK").is_err());
        assert!(decode_chunked(b"zz\r\n").is_err());
    }

    #[test]
    fn requests_carry_the_bearer_token_and_a_loopback_host() {
        let bytes = encode_request(
            4455,
            "POST",
            "/api/sites/open",
            "tok",
            Some("{\"path\":\"/x\"}"),
        );
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with("POST /api/sites/open HTTP/1.1\r\nHost: 127.0.0.1:4455\r\n"));
        assert!(text.contains("Authorization: Bearer tok\r\n"));
        assert!(text.ends_with("Content-Length: 13\r\n\r\n{\"path\":\"/x\"}"));
    }
}
