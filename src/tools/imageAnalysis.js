const MAX_IMAGE_ANALYSIS_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
]);

function createImageAnalysisError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function buildImageAnalysisContent(media, question = '') {
    if (!media || typeof media.data !== 'string' || media.data.trim() === '') {
        throw createImageAnalysisError(
            'IMAGE_ANALYSIS_MEDIA_MISSING',
            'The WhatsApp image could not be downloaded.'
        );
    }

    const mimeType = String(media.mimetype || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();

    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
        throw createImageAnalysisError(
            'IMAGE_ANALYSIS_UNSUPPORTED_TYPE',
            'Please send a JPEG, PNG, WebP, or GIF image.'
        );
    }

    const base64Data = media.data.replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data) || base64Data.length % 4 === 1) {
        throw createImageAnalysisError(
            'IMAGE_ANALYSIS_INVALID_DATA',
            'The WhatsApp image data could not be read.'
        );
    }

    const normalizedData = base64Data.padEnd(
        base64Data.length + ((4 - (base64Data.length % 4)) % 4),
        '='
    );
    const encodedSizeLimit = Math.ceil(MAX_IMAGE_ANALYSIS_BYTES * 4 / 3) + 4;
    if (normalizedData.length > encodedSizeLimit) {
        throw createImageAnalysisError(
            'IMAGE_ANALYSIS_TOO_LARGE',
            'Please send an image smaller than 10 MB.'
        );
    }

    const paddingBytes = normalizedData.endsWith('==') ? 2 : normalizedData.endsWith('=') ? 1 : 0;
    const decodedSize = Math.max(0, (normalizedData.length / 4) * 3 - paddingBytes);
    const reportedSize = Number(media.filesize);
    const imageSize = Number.isFinite(reportedSize) && reportedSize > 0
        ? Math.max(decodedSize, reportedSize)
        : decodedSize;

    if (imageSize > MAX_IMAGE_ANALYSIS_BYTES) {
        throw createImageAnalysisError(
            'IMAGE_ANALYSIS_TOO_LARGE',
            'Please send an image smaller than 10 MB.'
        );
    }

    const prompt = String(question || '').trim() ||
        'Describe the image clearly and mention details that are uncertain.';
    return [
        { type: 'text', text: prompt },
        {
            type: 'image_url',
            image_url: {
                url: 'data:' + mimeType + ';base64,' + normalizedData,
                detail: 'auto'
            }
        }
    ];
}

module.exports = {
    MAX_IMAGE_ANALYSIS_BYTES,
    buildImageAnalysisContent
};
