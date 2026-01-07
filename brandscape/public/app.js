// BrandScape Frontend JavaScript
let currentStep = 0; // Start at 0 for welcome screen
let formData = {
    businessDescription: '',
    visuals: [],
    brandValues: [],
    selectedName: null,
    selectedColors: null,
    generatedLogo: null
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    showStep(0); // Show welcome screen first
});

// Start the journey - hide welcome, show header and first step
function startJourney() {
    const welcomeSection = document.getElementById('welcome');
    const mainHeader = document.getElementById('mainHeader');
    
    welcomeSection.style.display = 'none';
    mainHeader.style.display = 'block';
    
    showStep(1); // Show first step (business description)
}

function showStep(step) {
    // Hide all steps
    document.querySelectorAll('.step').forEach(s => {
        s.classList.remove('active');
        if (s.id !== 'welcome') {
            s.style.display = 'none';
        }
    });
    
    // Show current step
    const stepElement = document.getElementById(`step${step}`);
    if (stepElement) {
        stepElement.classList.add('active');
        stepElement.style.display = 'block';
        currentStep = step;
    } else if (step === 0) {
        // Welcome screen
        const welcomeElement = document.getElementById('welcome');
        if (welcomeElement) {
            welcomeElement.classList.add('active');
            welcomeElement.style.display = 'block';
        }
    }
}

function nextStep(step) {
    // Validate and save current step data
    if (step === 1) {
        const desc = document.getElementById('businessDescription').value.trim();
        if (!desc) {
            alert('Please enter a business description');
            return;
        }
        formData.businessDescription = desc;
        showStep(2);
    } else if (step === 2) {
        const visuals = document.getElementById('visualElements').value.trim();
        formData.visuals = visuals ? visuals.split(',').map(v => v.trim()).filter(Boolean) : [];
        showStep(3);
    } else if (step === 3) {
        const brandValues = document.getElementById('brandValues').value.trim();
        formData.brandValues = brandValues ? brandValues.split(',').map(v => v.trim()).filter(Boolean) : [];
        generateNames();
    }
}

function previousStep(step) {
    if (step === 2) {
        showStep(1);
    } else if (step === 3) {
        showStep(2);
    } else if (step === 5) {
        showStep(4);
    } else if (step === 6) {
        showStep(5);
    }
}

async function generateNames() {
    showStep(4);
    const loadingDiv = document.getElementById('loadingNames');
    const suggestionsDiv = document.getElementById('nameSuggestions');
    const refreshBtn = document.getElementById('refreshNamesBtn');
    
    loadingDiv.style.display = 'block';
    suggestionsDiv.innerHTML = '';
    refreshBtn.style.display = 'none';

    try {
        const response = await fetch('/api/generate-names', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                businessDescription: formData.businessDescription,
                visuals: formData.visuals,
                brandValues: formData.brandValues
            })
        });

        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }

        loadingDiv.style.display = 'none';
        refreshBtn.style.display = 'inline-block';

        if (data.names && data.names.length > 0) {
            displayNameSuggestions(data.names);
        } else {
            suggestionsDiv.innerHTML = '<p class="error-message">No names generated. Please try again.</p>';
        }
    } catch (error) {
        loadingDiv.style.display = 'none';
        suggestionsDiv.innerHTML = `<p class="error-message">Error: ${error.message}</p>`;
    }
}

function displayNameSuggestions(names) {
    const suggestionsDiv = document.getElementById('nameSuggestions');
    suggestionsDiv.innerHTML = '';

    names.forEach((name, index) => {
        const card = document.createElement('div');
        card.className = 'name-card';
        card.onclick = () => selectName(name);

        const title = document.createElement('div');
        title.className = 'name-title';
        title.textContent = name.title || name.name || `Name ${index + 1}`;

        const description = document.createElement('div');
        description.className = 'name-description';
        description.textContent = name.description || '';

        card.appendChild(title);
        card.appendChild(description);

        // Domain availability
        // Note: In the API, true = domain exists (taken), false = domain doesn't exist (available), null = error
        if (name.domains) {
            const domainDiv = document.createElement('div');
            Object.entries(name.domains).forEach(([domain, status]) => {
                const domainSpan = document.createElement('span');
                
                if (status === null) {
                    // Error checking domain
                    domainSpan.className = 'domain-status domain-error';
                    domainSpan.textContent = `${domain} ⚠ Error`;
                } else {
                    const isAvailable = !status; // Invert: true means taken, so available = !taken
                    domainSpan.className = `domain-status ${isAvailable ? 'domain-available' : 'domain-taken'}`;
                    domainSpan.textContent = `${domain} ${isAvailable ? '✓ Available' : '✗ Taken'}`;
                }
                
                domainDiv.appendChild(domainSpan);
            });
            card.appendChild(domainDiv);
        }

        // Trademark notes
        if (name.trademarkNotes) {
            const tmDiv = document.createElement('div');
            tmDiv.className = 'trademark-notes';
            tmDiv.textContent = name.trademarkNotes;
            card.appendChild(tmDiv);
        }

        suggestionsDiv.appendChild(card);
    });
}

function selectName(name) {
    // Remove previous selection
    document.querySelectorAll('.name-card').forEach(card => card.classList.remove('selected'));
    
    // Mark as selected
    event.currentTarget.classList.add('selected');
    
    formData.selectedName = name;
    
    // Show selected name and proceed to colors
    setTimeout(() => {
        generateColors();
    }, 500);
}

async function generateColors() {
    showStep(5);
    
    // Display selected name
    const selectedNameDiv = document.getElementById('selectedNameDisplay');
    selectedNameDiv.textContent = `Selected Name: ${formData.selectedName.title || formData.selectedName.name}`;
    
    const loadingDiv = document.getElementById('loadingColors');
    const palettesDiv = document.getElementById('colorPalettes');
    const refreshBtn = document.getElementById('refreshColorsBtn');
    
    loadingDiv.style.display = 'block';
    palettesDiv.innerHTML = '';
    refreshBtn.style.display = 'none';

    try {
        const response = await fetch('/api/generate-colors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                businessDescription: formData.businessDescription,
                brandValues: formData.brandValues,
                selectedName: formData.selectedName
            })
        });

        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }

        loadingDiv.style.display = 'none';
        refreshBtn.style.display = 'inline-block';

        if (data.palettes && data.palettes.length > 0) {
            displayColorPalettes(data.palettes);
        } else {
            palettesDiv.innerHTML = '<p class="error-message">No color palettes generated. Please try again.</p>';
        }
    } catch (error) {
        loadingDiv.style.display = 'none';
        palettesDiv.innerHTML = `<p class="error-message">Error: ${error.message}</p>`;
    }
}

function displayColorPalettes(palettes) {
    const palettesDiv = document.getElementById('colorPalettes');
    palettesDiv.innerHTML = '';

    palettes.forEach((palette, index) => {
        const paletteCard = document.createElement('div');
        paletteCard.className = 'color-palette';
        paletteCard.onclick = () => selectColors(palette);

        const swatchesDiv = document.createElement('div');
        swatchesDiv.className = 'color-swatches';

        // Color 1
        const swatch1 = document.createElement('div');
        swatch1.className = 'color-swatch';
        swatch1.style.backgroundColor = palette.hex1 || palette.color1;
        swatchesDiv.appendChild(swatch1);

        // Color 2
        const swatch2 = document.createElement('div');
        swatch2.className = 'color-swatch';
        swatch2.style.backgroundColor = palette.hex2 || palette.color2;
        swatchesDiv.appendChild(swatch2);

        paletteCard.appendChild(swatchesDiv);

        // Color info
        const infoDiv = document.createElement('div');
        infoDiv.className = 'color-info';
        
        const hexDiv = document.createElement('div');
        hexDiv.className = 'color-hex';
        hexDiv.textContent = `${palette.hex1 || palette.color1} • ${palette.hex2 || palette.color2}`;
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'color-name';
        nameDiv.textContent = palette.namePair || palette.name || `Palette ${index + 1}`;

        infoDiv.appendChild(hexDiv);
        infoDiv.appendChild(nameDiv);
        paletteCard.appendChild(infoDiv);

        // Explanation
        if (palette.explanation || palette.short) {
            const explanationDiv = document.createElement('div');
            explanationDiv.className = 'color-explanation';
            explanationDiv.textContent = palette.explanation || palette.short;
            paletteCard.appendChild(explanationDiv);
        }

        palettesDiv.appendChild(paletteCard);
    });
}

function selectColors(palette) {
    // Remove previous selection
    document.querySelectorAll('.color-palette').forEach(card => card.classList.remove('selected'));
    
    // Mark as selected
    event.currentTarget.classList.add('selected');
    
    formData.selectedColors = palette;
    
    // Show selected colors and proceed to logo
    setTimeout(() => {
        generateLogo();
    }, 500);
}

async function generateLogo() {
    showStep(6);
    
    // Display selected colors
    const selectedColorsDiv = document.getElementById('selectedColorsDisplay');
    selectedColorsDiv.innerHTML = `
        <strong>Selected Colors:</strong> 
        ${formData.selectedColors.hex1 || formData.selectedColors.color1} • 
        ${formData.selectedColors.hex2 || formData.selectedColors.color2}
    `;
    
    const loadingDiv = document.getElementById('loadingLogo');
    const promptSection = document.getElementById('logoPromptSection');
    const logoDiv = document.getElementById('logoDisplay');
    const backBtn = document.getElementById('backToColorsBtn');
    
    loadingDiv.style.display = 'block';
    promptSection.style.display = 'none';
    logoDiv.innerHTML = '';
    backBtn.style.display = 'none';

    try {
        // First, generate the prompt
        const response = await fetch('/api/generate-logo-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                businessDescription: formData.businessDescription,
                visuals: formData.visuals,
                selectedName: formData.selectedName,
                selectedColors: formData.selectedColors
            })
        });

        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }

        loadingDiv.style.display = 'none';

        if (data.prompt) {
            // Show the prompt section with editable textarea
            const promptTextarea = document.getElementById('logoPromptText');
            promptTextarea.value = data.prompt;
            promptSection.style.display = 'block';
            formData.generatedPrompt = data.prompt;
        } else {
            logoDiv.innerHTML = '<p class="error-message">Prompt generation failed. Please try again.</p>';
        }
    } catch (error) {
        loadingDiv.style.display = 'none';
        logoDiv.innerHTML = `<p class="error-message">Error: ${error.message}</p>`;
    }
}

async function generateLogoFromPrompt() {
    const promptTextarea = document.getElementById('logoPromptText');
    const editedPrompt = promptTextarea.value.trim();
    
    if (!editedPrompt) {
        alert('Please enter a prompt for logo generation.');
        return;
    }
    
    const loadingDiv = document.getElementById('loadingLogoGeneration');
    const promptSection = document.getElementById('logoPromptSection');
    const logoDiv = document.getElementById('logoDisplay');
    const backBtn = document.getElementById('backToColorsBtn');
    
    loadingDiv.style.display = 'block';
    promptSection.style.display = 'none';
    logoDiv.innerHTML = '';

    try {
        const response = await fetch('/api/generate-logo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                businessDescription: formData.businessDescription,
                visuals: formData.visuals,
                selectedName: formData.selectedName,
                selectedColors: {
                    ...formData.selectedColors,
                    customPrompt: editedPrompt
                }
            })
        });

        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }

        loadingDiv.style.display = 'none';

        if (data.logoUrl) {
            const img = document.createElement('img');
            img.src = data.logoUrl;
            img.className = 'logo-image';
            img.alt = 'Generated Logo';
            
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'btn btn-primary';
            downloadBtn.textContent = 'Download Logo';
            downloadBtn.onclick = () => {
                const a = document.createElement('a');
                a.href = data.logoUrl;
                a.download = data.filename || 'logo.png';
                a.click();
            };
            
            const regenerateBtn = document.createElement('button');
            regenerateBtn.className = 'btn btn-secondary';
            regenerateBtn.textContent = 'Regenerate Logo';
            regenerateBtn.style.marginLeft = '10px';
            regenerateBtn.onclick = () => {
                generateLogoFromPrompt();
            };
            
            logoDiv.appendChild(img);
            logoDiv.appendChild(document.createElement('br'));
            logoDiv.appendChild(downloadBtn);
            logoDiv.appendChild(regenerateBtn);
            
            // Check logo trademark
            logoDiv.appendChild(document.createElement('br'));
            logoDiv.appendChild(document.createElement('br'));
            const checkingDiv = document.createElement('div');
            checkingDiv.className = 'loading';
            checkingDiv.innerHTML = '<p>Checking for similar trademarks...</p>';
            logoDiv.appendChild(checkingDiv);
            
            // Call logo trademark check
            checkLogoTrademark(data.logoUrl, logoDiv, checkingDiv);
            
            // Show Learn More button
            const learnMoreBtn = document.getElementById('learnMoreBtn');
            if (learnMoreBtn) {
                learnMoreBtn.style.display = 'block';
            }
            
            formData.generatedLogo = data.logoUrl;
            backBtn.style.display = 'inline-block';
        } else {
            logoDiv.innerHTML = '<p class="error-message">Logo generation failed. Please try again.</p>';
        }
    } catch (error) {
        loadingDiv.style.display = 'none';
        logoDiv.innerHTML = `<p class="error-message">Error: ${error.message}</p>`;
    }
}

async function regeneratePrompt() {
    await generateLogo();
}

async function checkLogoTrademark(logoUrl, logoDiv, checkingDiv) {
    try {
        const response = await fetch('/api/check-logo-trademark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: logoUrl })
        });

        const data = await response.json();
        
        checkingDiv.style.display = 'none';
        
        if (data.error) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'trademark-notes';
            errorDiv.textContent = '⚠️ Logo trademark check unavailable: ' + data.error;
            logoDiv.appendChild(errorDiv);
            return;
        }

        // Display trademark notes
        if (data.notes) {
            const tmDiv = document.createElement('div');
            tmDiv.className = 'trademark-notes';
            tmDiv.style.whiteSpace = 'pre-line';
            tmDiv.textContent = data.notes;
            logoDiv.appendChild(tmDiv);
        } else if (data.warnings && data.warnings.length > 0) {
            const warningDiv = document.createElement('div');
            warningDiv.className = 'trademark-notes';
            warningDiv.textContent = '⚠️ ' + data.warnings.join(' | ');
            logoDiv.appendChild(warningDiv);
        }
    } catch (error) {
        checkingDiv.style.display = 'none';
        const errorDiv = document.createElement('div');
        errorDiv.className = 'trademark-notes';
        errorDiv.textContent = '⚠️ Error checking logo trademark: ' + error.message;
        logoDiv.appendChild(errorDiv);
    }
}

async function refreshNames() {
    await generateNames();
}

async function refreshColors() {
    await generateColors();
}

function openLegalNotes() {
    const modal = document.getElementById('legalNotesModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

function closeLegalNotes() {
    const modal = document.getElementById('legalNotesModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Close modal when clicking outside of it
window.onclick = function(event) {
    const modal = document.getElementById('legalNotesModal');
    if (event.target === modal) {
        modal.style.display = 'none';
    }
}

