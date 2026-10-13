const imageState = {
    drawCooldowns: new Map(),
    pendingDrawChoices: new Map(),
    IMAGE_MODEL_CHOICES: [
        { number: '1', label: 'GPT-image-2.5-Sunburst', description: 'Most capable overall', kind: 'azure', envName: 'AZURE_OPENAI_IMAGE_DEPLOYMENT_SUNBURST', defaultDeployment: 'gpt-image-2.5-sunburst' },
        { number: '2', label: 'GPT-image-2', description: 'Strong general image generation', kind: 'azure', envName: 'AZURE_OPENAI_IMAGE_DEPLOYMENT', defaultDeployment: 'gpt-image-2' },
        { number: '3', label: 'Pollinations', description: 'Free fallback', kind: 'pollinations' }
    ],
    drawGenerationInProgress: false,
    lastDrawAt: 0,
    analyzeCooldowns: new Map()
};

module.exports = imageState;
