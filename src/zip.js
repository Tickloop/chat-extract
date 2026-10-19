// MARK: Zip writer
// A minimal deflate zip writer so bulk exports need no bundled library. Each entry is compressed
// as soon as it is added and only the compressed bytes are kept, so memory tracks the zip's size,
// not the size of every rendered session. ZIP64 is not supported; add() refuses entries past its limits.

const encoder = new TextEncoder();
const VERSION = 20; // 2.0: the first version with deflate
// Info-ZIP unzip (macOS's /usr/bin/unzip) re-reads names from DOS-made archives as CP437 even
// with the UTF-8 flag set, so entries claim a Unix origin, which also requires a Unix file mode.
const MADE_BY = (3 << 8) | VERSION;
const FILE_MODE = 0o100644 << 16;
const FLAG_UTF8 = 0x0800; // titles end up in paths, so names must not be read as CP437
const DEFLATE = 8;
const MAX_ENTRIES = 0xffff;
const MAX_OFFSET = 0xffffffff;

// MARK: CRC-32

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// MARK: Encoding

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** unzip restores this as the file's mtime, which is local wall-clock time with 2s resolution. */
function dosDateTime(d) {
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1980) d = new Date(1980, 0, 1);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** A little-endian record: signature, then [byteWidth, value] fields, then the file name. */
function record(signature, fields, name = new Uint8Array()) {
  const size = fields.reduce((n, [width]) => n + width, 4);
  const buf = new Uint8Array(size + name.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, signature, true);
  let at = 4;
  for (const [width, value] of fields) {
    if (width === 2) view.setUint16(at, value, true);
    else view.setUint32(at, value, true);
    at += width;
  }
  buf.set(name, at);
  return buf;
}

// MARK: Archive

export function createZip() {
  const parts = [];
  const central = [];
  let offset = 0;

  return {
    get count() {
      return central.length;
    },

    /** Safe to call concurrently: everything after the compression await runs without yielding. */
    async add(path, content, modified = new Date()) {
      const data = typeof content === "string" ? encoder.encode(content) : content;
      const packed = await deflateRaw(data);
      if (central.length >= MAX_ENTRIES || offset + packed.length > MAX_OFFSET) {
        throw new Error("Too many chats for one zip file.");
      }
      const name = encoder.encode(path);
      const { time, date } = dosDateTime(modified);
      const shared = [
        [2, VERSION], [2, FLAG_UTF8], [2, DEFLATE], [2, time], [2, date],
        [4, crc32(data)], [4, packed.length], [4, data.length], [2, name.length], [2, 0],
      ];
      const local = record(0x04034b50, shared, name);
      // Central entry: version made by, the shared fields, then comment/disk/internal attrs, mode and where the local header sits.
      central.push(record(0x02014b50, [[2, MADE_BY], ...shared, [2, 0], [2, 0], [2, 0], [4, FILE_MODE], [4, offset]], name));
      parts.push(local, packed);
      offset += local.length + packed.length;
    },

    /** @returns {Blob} */
    finish() {
      const size = central.reduce((n, c) => n + c.length, 0);
      const end = record(0x06054b50, [[2, 0], [2, 0], [2, central.length], [2, central.length], [4, size], [4, offset], [2, 0]]);
      return new Blob([...parts, ...central, end], { type: "application/zip" });
    },
  };
}
