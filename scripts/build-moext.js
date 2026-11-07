const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Table CRC32 pour conformité stricte PKZIP
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

    // Compression Deflate sans en-tête zlib (raw)
    const compressedBuf = zlib.deflateRawSync(dataBuf);
    const compressedSize = compressedBuf.length;

    // En-tête local PKZIP (30 octets + nom)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Signature
    localHeader.writeUInt16LE(20, 4);         // Version minimale requise (2.0)
    localHeader.writeUInt16LE(0, 6);          // Flags
    localHeader.writeUInt16LE(8, 8);          // Méthode de compression (Deflate = 8)
    localHeader.writeUInt16LE(0, 10);         // Heure DOS
    localHeader.writeUInt16LE(0, 12);         // Date DOS
    localHeader.writeUInt32LE(crc, 14);       // CRC32
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);         // Longueur extra
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compressedBuf);

    // En-tête central PKZIP (46 octets + nom)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Signature répertoire central
    centralHeader.writeUInt16LE(20, 4);          // Version créateur
    centralHeader.writeUInt16LE(20, 6);          // Version minimale
    centralHeader.writeUInt16LE(0, 8);           // Flags
    centralHeader.writeUInt16LE(8, 10);          // Compression
    centralHeader.writeUInt16LE(0, 12);          // Heure DOS
    centralHeader.writeUInt16LE(0, 14);          // Date DOS
    centralHeader.writeUInt32LE(crc, 16);        // CRC32
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);          // Longueur extra
    centralHeader.writeUInt16LE(0, 32);          // Longueur commentaire
    centralHeader.writeUInt16LE(0, 34);          // Numéro de disque
    centralHeader.writeUInt16LE(0, 36);          // Attributs internes
    centralHeader.writeUInt32LE(0, 38);          // Attributs externes
    centralHeader.writeUInt32LE(offset, 42);     // Décalage en-tête local
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);

    offset += localHeader.length + compressedBuf.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const ch of centralHeaders) {
    centralSize += ch.length;
  }

  // Fin du répertoire central (EOCD - 22 octets)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                   // Numéro de disque
  eocd.writeUInt16LE(0, 6);                   // Disque de début
  eocd.writeUInt16LE(files.length, 8);        // Entrées sur ce disque
  eocd.writeUInt16LE(files.length, 10);       // Total des entrées
  eocd.writeUInt32LE(centralSize, 12);        // Taille du répertoire central
  eocd.writeUInt32LE(centralOffset, 16);      // Décalage du répertoire central
  eocd.writeUInt16LE(0, 20);                  // Longueur du commentaire

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

function build() {
  const rootDir = path.resolve(__dirname, '..');
  const manifestPath = path.join(rootDir, 'motrix-plugin.json');
  const pluginJsPath = path.join(rootDir, 'dist', 'plugin.js');
  const localeEnPath = path.join(rootDir, 'locales', 'en-US.json');
  const localeFrPath = path.join(rootDir, 'locales', 'fr-FR.json');

  console.log('📦 Construction du package Motrix (.moext)...');

  if (!fs.existsSync(manifestPath)) {
    throw new Error('motrix-plugin.json manquant');
  }
  if (!fs.existsSync(pluginJsPath)) {
    throw new Error('dist/plugin.js manquant');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`Plugin : ${manifest.id} v${manifest.version}`);

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

  // Écriture du fichier versionné et du fichier standard
  const distDir = path.join(rootDir, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const outputVersioned = path.join(distDir, `${manifest.id}-${manifest.version}.moext`);
  const outputLatest = path.join(distDir, `alldebrid-resolver.moext`);

  fs.writeFileSync(outputVersioned, moextBuffer);
  fs.writeFileSync(outputLatest, moextBuffer);

  console.log(`✅ Fichiers .moext générés avec succès :`);
  console.log(`   - ${outputVersioned} (${moextBuffer.length} octets)`);
  console.log(`   - ${outputLatest} (${moextBuffer.length} octets)`);
}

try {
  build();
} catch (err) {
  console.error('❌ Échec du build :', err);
  process.exit(1);
}
