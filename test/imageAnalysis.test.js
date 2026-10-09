const test = require('node:test');
const assert = require('node:assert/strict');

const {
    MAX_IMAGE_ANALYSIS_BYTES,
    buildImageAnalysisContent
} = require('../src/tools/imageAnalysis');

test('builds a multimodal Azure message from WhatsApp image media', () => {
    const media = {
        mimetype: 'image/jpeg',
        data: Buffer.from('fake image bytes').toString('base64'),
        filesize: 16
    };

    assert.deepEqual(buildImageAnalysisContent(media, 'What is in this picture?'), [
        { type: 'text', text: 'What is in this picture?' },
        {
            type: 'image_url',
            image_url: {
                url: 'data:image/jpeg;base64,' + media.data,
                detail: 'auto'
            }
        }
    ]);
});

test('uses a helpful default question when the command has no prompt', () => {
    const content = buildImageAnalysisContent({
        mimetype: 'image/png',
        data: Buffer.from('image').toString('base64')
    });

    assert.equal(content[0].type, 'text');
    assert.match(content[0].text, /Describe the image/);
});

test('rejects missing and unsupported WhatsApp media', () => {
    assert.throws(
        () => buildImageAnalysisContent(undefined),
        { code: 'IMAGE_ANALYSIS_MEDIA_MISSING' }
    );
    assert.throws(
        () => buildImageAnalysisContent({
            mimetype: 'application/pdf',
            data: Buffer.from('file').toString('base64')
        }),
        { code: 'IMAGE_ANALYSIS_UNSUPPORTED_TYPE' }
    );
});

test('rejects oversized images before sending them to Azure', () => {
    assert.throws(
        () => buildImageAnalysisContent({
            mimetype: 'image/jpeg',
            data: Buffer.from('small').toString('base64'),
            filesize: MAX_IMAGE_ANALYSIS_BYTES + 1
        }),
        { code: 'IMAGE_ANALYSIS_TOO_LARGE' }
    );
});

test('rejects malformed image data', () => {
    assert.throws(
        () => buildImageAnalysisContent({
            mimetype: 'image/jpeg',
            data: 'not base64!'
        }),
        { code: 'IMAGE_ANALYSIS_INVALID_DATA' }
    );
});
