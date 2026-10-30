const crypto = require('crypto');
const fs = require('fs/promises');
const { promisify } = require('util');
const zlib = require('zlib');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const MAGIC = Buffer.from('CBK1');
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

function getBackupConfig() {
    const containerSasUrl = String(process.env.AZURE_CLASS_BACKUP_CONTAINER_SAS_URL || '').trim();
    if (!containerSasUrl) return null;

    let url;
    try {
        url = new URL(containerSasUrl);
    } catch (_) {
        throw new Error('Azure class backup SAS URL is invalid.');
    }

    if (url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        !url.searchParams.has('sig') ||
        !url.hostname.endsWith('.blob.core.windows.net')) {
        throw new Error('Azure class backup needs an HTTPS Azure Blob container SAS URL.');
    }

    const encodedKey = String(process.env.CLASS_BACKUP_ENCRYPTION_KEY || '').trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey)) {
        throw new Error('CLASS_BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
    }
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32) {
        throw new Error('CLASS_BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
    }

    return { containerUrl: url, key };
}

function buildBlobUrl(containerUrl, blobName) {
    const url = new URL(containerUrl.toString());
    const basePath = url.pathname.replace(/\/$/, '');
    url.pathname = `${basePath}/${blobName}`;
    return url;
}

async function requestBlob(url, options, failureMessage) {
    try {
        return await fetch(url, {
            ...options,
            signal: AbortSignal.timeout(30000)
        });
    } catch (_) {
        throw new Error(failureMessage);
    }
}

function decryptEnvelope(envelope, key) {
    if (envelope.length <= MAGIC.length + 12 + 16 ||
        !envelope.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error('Azure class backup verification failed: invalid encrypted file.');
    }

    const ivStart = MAGIC.length;
    const tagStart = ivStart + 12;
    const ciphertextStart = tagStart + 16;
    const iv = envelope.subarray(ivStart, tagStart);
    const authTag = envelope.subarray(tagStart, ciphertextStart);
    const ciphertext = envelope.subarray(ciphertextStart);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function createVerifiedOffsiteClassDBBackup(localBackupPath) {
    const config = getBackupConfig();
    if (!config) return { configured: false, verified: false };

    const source = await fs.readFile(localBackupPath);
    if (source.length > MAX_BACKUP_BYTES) {
        throw new Error('Azure class backup exceeds the 100 MB safety limit.');
    }

    const parsed = JSON.parse(source.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' ||
        !parsed.classes || typeof parsed.classes !== 'object' || Array.isArray(parsed.classes)) {
        throw new Error('Azure class backup was not created because the local database schema is invalid.');
    }

    const compressed = await gzip(source);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', config.key, iv);
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const envelope = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blobName = `classdb-${timestamp}.json.gz.enc`;
    const blobUrl = buildBlobUrl(config.containerUrl, blobName);
    const requestHeaders = {
        'x-ms-date': new Date().toUTCString(),
        'x-ms-version': '2023-11-03'
    };

    const upload = await requestBlob(blobUrl, {
        method: 'PUT',
        headers: {
            ...requestHeaders,
            'x-ms-blob-type': 'BlockBlob',
            'Content-Type': 'application/octet-stream'
        },
        body: envelope
    }, 'Could not upload the encrypted class backup to Azure Blob Storage.');
    if (!upload.ok) {
        throw new Error(`Azure rejected the encrypted class backup upload (HTTP ${upload.status}).`);
    }

    const download = await requestBlob(blobUrl, {
        method: 'GET',
        headers: requestHeaders
    }, 'Could not download the encrypted class backup for verification.');
    if (!download.ok) {
        throw new Error(`Azure backup verification download failed (HTTP ${download.status}).`);
    }

    const downloaded = Buffer.from(await download.arrayBuffer());
    if (downloaded.length > MAX_BACKUP_BYTES) {
        throw new Error('Azure class backup verification exceeded the 100 MB safety limit.');
    }

    let restored;
    try {
        restored = await gunzip(decryptEnvelope(downloaded, config.key));
    } catch (_) {
        throw new Error('Azure class backup verification failed: decryption or integrity check did not pass.');
    }
    const sourceDigest = crypto.createHash('sha256').update(source).digest();
    const restoredDigest = crypto.createHash('sha256').update(restored).digest();
    if (!crypto.timingSafeEqual(sourceDigest, restoredDigest)) {
        throw new Error('Azure class backup verification failed: downloaded data does not match the local snapshot.');
    }

    let verifiedDb;
    try {
        verifiedDb = JSON.parse(restored.toString('utf8'));
    } catch (_) {
        throw new Error('Azure class backup verification failed: downloaded data is not valid JSON.');
    }
    if (!verifiedDb || typeof verifiedDb !== 'object' ||
        !verifiedDb.classes || typeof verifiedDb.classes !== 'object' || Array.isArray(verifiedDb.classes)) {
        throw new Error('Azure class backup verification failed: downloaded database structure is invalid.');
    }

    return {
        configured: true,
        verified: true,
        blobName,
        encryptedBytes: envelope.length
    };
}

module.exports = { createVerifiedOffsiteClassDBBackup };
