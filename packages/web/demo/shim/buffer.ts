/**
 * Just enough of Node's `Buffer` for the mock backend to run in a browser.
 *
 * The mock (packages/web/mock) keeps every file as a Buffer and was written
 * for Node; the demo build runs it in the visitor's page. Rather than change
 * the mock — whose behaviour for developers must stay exactly as it is — the
 * demo installs this class as `globalThis.Buffer` before the mock loads. It
 * covers what the mock uses and nothing more: building from strings, bytes
 * and arrays, `concat`, `toString` in the encodings the mock asks for,
 * `equals`, `readUInt32BE` and views (`subarray` returns this class through
 * the typed array's species).
 */

export type DemoEncoding = "utf8" | "utf-8" | "base64" | "base64url" | "hex" | "latin1" | "binary" | "ascii";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked: String.fromCharCode with a whole image's bytes overflows the call stack.
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  const padded = clean + "===".slice((clean.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function encode(text: string, encoding: DemoEncoding): Uint8Array {
  switch (encoding) {
    case "base64":
    case "base64url":
      return fromBase64(text);
    case "hex": {
      const out = new Uint8Array(Math.floor(text.length / 2));
      for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    case "latin1":
    case "binary":
    case "ascii": {
      const out = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
      return out;
    }
    default:
      return encoder.encode(text);
  }
}

export class DemoBuffer extends Uint8Array {
  static alloc(size: number, fill = 0): DemoBuffer {
    const out = new DemoBuffer(size);
    if (fill) out.fill(fill);
    return out;
  }

  static concat(list: readonly Uint8Array[], total?: number): DemoBuffer {
    const size = total ?? list.reduce((sum, item) => sum + item.length, 0);
    const out = new DemoBuffer(size);
    let at = 0;
    for (const item of list) {
      if (at >= size) break;
      out.set(item.subarray(0, size - at), at);
      at += item.length;
    }
    return out;
  }

  static isBuffer(value: unknown): value is DemoBuffer {
    return value instanceof DemoBuffer;
  }

  static byteLength(text: string, encoding: DemoEncoding = "utf8"): number {
    return encode(text, encoding).length;
  }

  override toString(encoding: DemoEncoding = "utf8", start = 0, end = this.length): string {
    const view = this.subarray(start, end);
    switch (encoding) {
      case "base64":
        return toBase64(view);
      case "base64url":
        return toBase64(view).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      case "hex":
        return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join("");
      case "latin1":
      case "binary":
      case "ascii": {
        let out = "";
        for (let at = 0; at < view.length; at += 0x8000) out += String.fromCharCode(...view.subarray(at, at + 0x8000));
        return out;
      }
      default:
        return decoder.decode(view);
    }
  }

  equals(other: Uint8Array): boolean {
    if (this === other) return true;
    if (this.length !== other.length) return false;
    for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
    return true;
  }

  readUInt32BE(offset = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset, false);
  }

  readUInt16BE(offset = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(offset, false);
  }

  toJSON(): { type: "Buffer"; data: number[] } {
    return { type: "Buffer", data: Array.from(this) };
  }
}

/** A copy of the bytes as a DemoBuffer. */
function copyOf(bytes: Uint8Array): DemoBuffer {
  const out = new DemoBuffer(bytes.length);
  out.set(bytes);
  return out;
}

/** `Buffer.from`: from a string in an encoding, an ArrayBuffer (a view of it), a typed array or a list of bytes. */
export function bufferFrom(value: string | ArrayBuffer | ArrayLike<number> | Iterable<number>, encodingOrOffset?: DemoEncoding | number, length?: number): DemoBuffer {
  if (typeof value === "string") return copyOf(encode(value, (encodingOrOffset as DemoEncoding | undefined) ?? "utf8"));
  if (value instanceof ArrayBuffer) {
    const offset = typeof encodingOrOffset === "number" ? encodingOrOffset : 0;
    return new DemoBuffer(value, offset, length ?? value.byteLength - offset);
  }
  if (ArrayBuffer.isView(value)) return copyOf(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return copyOf(Uint8Array.from(value as ArrayLike<number>));
}

// Node's `Buffer.from` takes an encoding where a typed array's `from` takes a mapping function, so it
// can't be declared as an override; it replaces the inherited one here, for the mock's `Buffer.from(…)`.
Object.defineProperty(DemoBuffer, "from", { value: bufferFrom, writable: true, configurable: true });

/**
 * A file whose bytes are not in the bundle: the photographs of the sample
 * site are served as files beside the demo (`url`), so the mock holds a
 * stand-in of the right length and the asset shim points `<img>` at `url`.
 */
export class StaticFile extends DemoBuffer {
  url = "";

  static at(url: string, size: number): StaticFile {
    const file = new StaticFile(size);
    file.url = url;
    return file;
  }
}
