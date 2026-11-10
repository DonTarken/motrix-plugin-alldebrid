import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CRC32 table for PKZIP specification compliance
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZipArchive(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const cleanPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(cleanPath, 'utf8');
    const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const crc = crc32(dataBuf);
    const uncompressedSize = dataBuf.length;

    // Raw Deflate compression (no zlib headers)
    const compressedBuf = zlib.deflateRawSync(dataBuf);
    const compressedSize = compressedBuf.length;

    // PKZIP local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Signature
    localHeader.writeUInt16LE(20, 4);         // Minimum version (2.0)
    localHeader.writeUInt16LE(0, 6);          // Flags
    localHeader.writeUInt16LE(8, 8);          // Compression method (8 = Deflate)
    localHeader.writeUInt16LE(0, 10);         // DOS time
    localHeader.writeUInt16LE(0, 12);         // DOS date
    localHeader.writeUInt32LE(crc, 14);       // CRC32
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);         // Extra field length
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compressedBuf);

    // PKZIP central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Signature
    centralHeader.writeUInt16LE(20, 4);          // Version made by
    centralHeader.writeUInt16LE(20, 6);          // Minimum version
    centralHeader.writeUInt16LE(0, 8);           // Flags
    centralHeader.writeUInt16LE(8, 10);          // Compression
    centralHeader.writeUInt16LE(0, 12);          // DOS time
    centralHeader.writeUInt16LE(0, 14);          // DOS date
    centralHeader.writeUInt32LE(crc, 16);        // CRC32
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);          // Extra field length
    centralHeader.writeUInt16LE(0, 32);          // File comment length
    centralHeader.writeUInt16LE(0, 34);          // Disk number
    centralHeader.writeUInt16LE(0, 36);          // Internal attributes
    centralHeader.writeUInt32LE(0, 38);          // External attributes
    centralHeader.writeUInt32LE(offset, 42);     // Relative offset of local header
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);

    offset += localHeader.length + compressedBuf.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const ch of centralHeaders) {
    centralSize += ch.length;
  }

  // End of Central Directory (EOCD - 22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                   // Disk number
  eocd.writeUInt16LE(0, 6);                   // Start disk
  eocd.writeUInt16LE(files.length, 8);        // Disk entries
  eocd.writeUInt16LE(files.length, 10);       // Total entries
  eocd.writeUInt32LE(centralSize, 12);        // Central directory size
  eocd.writeUInt32LE(centralOffset, 16);      // Central directory offset
  eocd.writeUInt16LE(0, 20);                  // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

function build() {
  const rootDir = path.resolve(__dirname, '..');
  const srcJsPath = path.join(rootDir, 'src', 'index.js');
  const distDir = path.join(rootDir, 'dist');
  const pluginJsPath = path.join(distDir, 'plugin.js');
  const manifestPath = path.join(rootDir, 'motrix-plugin.json');
  const localeEnPath = path.join(rootDir, 'locales', 'en-US.json');
  const localeFrPath = path.join(rootDir, 'locales', 'fr-FR.json');

  console.log('📦 Packaging Motrix extension (.moext)...');

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Sync src/index.js to dist/plugin.js
  if (fs.existsSync(srcJsPath)) {
    fs.copyFileSync(srcJsPath, pluginJsPath);
    console.log('🔄 dist/plugin.js synced from src/index.js');
  }

  if (!fs.existsSync(manifestPath)) {
    throw new Error('motrix-plugin.json not found');
  }
  if (!fs.existsSync(pluginJsPath)) {
    throw new Error('dist/plugin.js not found');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`Plugin: ${manifest.id} v${manifest.version}`);

  const filesToPack = [
    { path: 'motrix-plugin.json', data: fs.readFileSync(manifestPath) },
    { path: 'dist/plugin.js', data: fs.readFileSync(pluginJsPath) }
  ];

  if (fs.existsSync(localeEnPath)) {
    filesToPack.push({ path: 'locales/en-US.json', data: fs.readFileSync(localeEnPath) });
  }
  if (fs.existsSync(localeFrPath)) {
    filesToPack.push({ path: 'locales/fr-FR.json', data: fs.readFileSync(localeFrPath) });
  }

  const moextBuffer = createZipArchive(filesToPack);

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const outputVersioned = path.join(distDir, `${manifest.id}-${manifest.version}.moext`);
  const outputLatest = path.join(distDir, `alldebrid-resolver.moext`);

  fs.writeFileSync(outputVersioned, moextBuffer);
  fs.writeFileSync(outputLatest, moextBuffer);

  console.log(`✅ .moext archives created successfully:`);
  console.log(`   - ${outputVersioned} (${moextBuffer.length} bytes)`);
  console.log(`   - ${outputLatest} (${moextBuffer.length} bytes)`);
}

try {
  build();
} catch (err) {
  console.error('❌ Build failed:', err);
  process.exit(1);
}
