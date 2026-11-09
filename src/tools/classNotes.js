const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_NOTE_BYTES = 20 * 1024 * 1024;
const DEFAULT_STORAGE_ROOT = path.join(__dirname, '..', '..', 'data', 'class-notes');
const ALLOWED_TYPES = {
    '.pdf': ['application/pdf'],
    '.doc': ['application/msword', 'application/vnd.ms-word'],
    '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    '.ppt': ['application/vnd.ms-powerpoint'],
    '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    '.xls': ['application/vnd.ms-excel'],
    '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    '.txt': ['text/plain'],
    '.jpg': ['image/jpeg'],
    '.jpeg': ['image/jpeg'],
    '.png': ['image/png']
};

function getRootDir(rootDir = DEFAULT_STORAGE_ROOT) {
    return path.resolve(rootDir);
}

function getClassNotesDirectory(className, options = {}) {
    const rootDir = getRootDir(options.rootDir);
    const classKey = crypto.createHash('sha256').update(String(className || '')).digest('hex');
    return path.join(rootDir, classKey);
}

function getDisplayFilename(note) {
    const provided = String(note?.fileName || note?.title || 'class-notes').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    let base = path.basename(provided).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    const storedExtension = getExtension(note?.storedName);
    if (storedExtension && !getExtension(base)) base += storedExtension;
    return base || `class-notes${storedExtension || ''}`;
}

function resolveClassNotePath(className, note, options = {}) {
    const storedName = String(note?.storedName || '');
    if (!/^[a-f0-9]{32}\.(pdf|docx?|pptx?|xlsx?|txt|jpe?g|png)$/i.test(storedName)) {
        throw new Error('Invalid class note file reference.');
    }
    const directory = getClassNotesDirectory(className, options);
    const resolved = path.resolve(directory, storedName);
    if (path.dirname(resolved) !== directory) throw new Error('Invalid class note file reference.');
    return resolved;
}

function getExtension(filename) {
    return path.extname(String(filename || '')).toLowerCase();
}

function decodeMedia(media, maxBytes = MAX_NOTE_BYTES) {
    if (!media || typeof media.data !== 'string') throw new Error('The attachment could not be read. Please send it again.');
    const base64 = media.data.replace(/^data:[^;]+;base64,/i, '').replace(/\s/g, '');
    if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('The attachment data is invalid.');
    if (base64.length > Math.ceil(maxBytes * 4 / 3) + 4) throw new Error('Files must be 20 MB or smaller.');
    const data = Buffer.from(base64, 'base64');
    if (!data.length) throw new Error('The attachment is empty.');
    return data;
}

async function saveClassNoteFile(className, media, options = {}) {
    const filename = getDisplayFilename({ fileName: media?.filename || 'class-notes' });
    const extension = getExtension(filename);
    const permittedMimes = ALLOWED_TYPES[extension];
    const mimeType = String(media?.mimetype || '').split(';')[0].trim().toLowerCase();
    if (!permittedMimes || (mimeType && mimeType !== 'application/octet-stream' && !permittedMimes.includes(mimeType))) {
        throw new Error('Unsupported file type. Use a PDF, Word, PowerPoint, Excel, TXT, JPG, or PNG file.');
    }
    const maxBytes = Number(options.maxBytes) || MAX_NOTE_BYTES;
    const data = decodeMedia(media, maxBytes);
    if (data.length > maxBytes) throw new Error('Files must be 20 MB or smaller.');

    const directory = getClassNotesDirectory(className, options);
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    const storedName = `${crypto.randomBytes(16).toString('hex')}${extension}`;
    const filePath = path.join(directory, storedName);
    await fs.promises.writeFile(filePath, data, { flag: 'wx', mode: 0o600 });
    return { storedName, mimeType: mimeType || permittedMimes[0], sizeBytes: data.length };
}

async function deleteClassNoteFile(className, note, options = {}) {
    const filePath = resolveClassNotePath(className, note, options);
    try {
        await fs.promises.unlink(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    return filePath;
}

module.exports = {
    MAX_NOTE_BYTES,
    getClassNotesDirectory,
    saveClassNoteFile,
    resolveClassNotePath,
    deleteClassNoteFile,
    getDisplayFilename
};
