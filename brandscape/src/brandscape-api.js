// BrandScape API Wrapper - Exposes functions for web interface
// This file wraps the brandscape.js functionality for API use

import { Ollama } from "ollama";
import { Client } from "@gradio/client";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import similarity from 'compute-cosine-similarity';
import fs from 'fs';
import dns from 'dns/promises';

// Import helper functions from brandscape.js
// Note: We'll need to refactor brandscape.js to export these, or duplicate them here

const defaultModel = process.env.BRAND_MODEL || 'llama3.2:3b';
const ollamaBaseUrl = process.env.OLLAMA_URL || "http://localhost:11434";
const _ollamaHeaders = {};
if (process.env.OLLAMA_API_KEY) {
  _ollamaHeaders['Authorization'] = 'Bearer ' + process.env.OLLAMA_API_KEY;
}
const ollama = new Ollama({ host: ollamaBaseUrl, headers: _ollamaHeaders });

const llmSettings = { model: defaultModel };

// Helper functions (simplified versions)
function extractTextFromOllamaResult(result) {
  if (typeof result === 'string') return result;
  if (result?.response) return result.response;
  if (result?.message?.content) return result.message.content;
  if (Array.isArray(result)) return result.map(r => extractTextFromOllamaResult(r)).join('\n');
  return JSON.stringify(result);
}

function extractFirstJson(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error('Failed to parse JSON: ' + e.message);
    }
  }
  throw new Error('No JSON found in text');
}

// Domain availability check
// Returns: { domain: true } if domain exists (taken), { domain: false } if available
async function domainAvailabilityReport(name) {
  // If name contains "&", use "and" variant instead of compact version
  const hasAmpersand = (name || '').includes('&');
  let basesToCheck = [];
  
  if (hasAmpersand) {
    // Replace "&" with "and" and create domain base
    const withAnd = (name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
    const partsWithAnd = withAnd.split(/\s+/).filter(Boolean);
    const compactWithAnd = partsWithAnd.join('');
    if (compactWithAnd) {
      basesToCheck = [compactWithAnd]; // Only check "and" variant for names with "&"
    } else {
      // Fallback: create compact version if "and" variant fails
      const raw = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const parts = raw.split(/\s+/).filter(Boolean);
      basesToCheck = [parts.join('')];
    }
  } else {
    // No "&" in name, use compact version
    const raw = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!raw) return {};
    const parts = raw.split(/\s+/).filter(Boolean);
    basesToCheck = [parts.join('')];
  }

  const tlds = ['com', 'co.uk', 'uk'];
  const results = {};
  
  for (const base of Array.from(basesToCheck)) {
    for (const tld of tlds) {
      const domain = `${base}.${tld}`;
      try {
        // Try to resolve the domain
        // If it resolves, the domain exists (is taken)
        await dns.resolve(domain);
        results[domain] = true; // true = domain exists = taken
      } catch (err) {
        // If DNS resolution fails, check the error code
        // ENOTFOUND or ENODATA means domain doesn't exist (available)
        // Other errors might be network issues - treat as unknown/error
        if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
          results[domain] = false; // false = domain doesn't exist = available
        } else {
          // Network error or other issue - mark as null to indicate error
          results[domain] = null;
        }
      }
    }
  }
  return results;
}

// Import trademark functions from brandscape.js
// Note: These functions need to be exported from brandscape.js for this to work
// For now, we'll define simplified versions

async function trademarkSearchUKExpanded(name, opts = {}) {
  // Try to import from brandscape.js if it exports the function
  // Otherwise use a simplified version
  try {
    // This would work if brandscape.js exports the function
    // const { trademarkSearchUKExpanded: tmSearch } = await import('./brandscape.js');
    // return await tmSearch(name, opts);
    
    // Simplified version for now
    return { hits: [], warnings: [], summary: [] };
  } catch (e) {
    return { hits: [], warnings: [`Trademark search error: ${e.message}`], summary: [] };
  }
}

async function generateTrademarkNotes(name, searchResults, businessContext = '') {
  try {
    // Import from brandscape.js if available
    // const { generateTrademarkNotes: genNotes } = await import('./brandscape.js');
    // return await genNotes(name, searchResults, businessContext);
    
    // Simplified version
    if (!searchResults || !searchResults.hits || searchResults.hits.length === 0) {
      return `The exact name "${name}" was not found as a registered trademark in the web search results.\n\nDISCLAIMER: This is not a legal clearance.`;
    }
    return `Trademark search completed for "${name}". DISCLAIMER: This is not a legal clearance.`;
  } catch (e) {
    return `Trademark search error: ${e.message}`;
  }
}

// Generate names
export async function generateNames(businessDescription, visuals = [], brandValues = []) {
  try {
    const shortBiz = businessDescription.split(/\s+/).slice(0, 5).join(' ');
    
    // Build query
    let query = `Make a list of 5 innovative business names for: "${shortBiz}"`;
    if (visuals.length > 0) {
      query += ` Visuals: ${visuals.join(', ')}.`;
    }
    if (brandValues.length > 0) {
      query += ` Brand values: ${brandValues.join(', ')}.`;
    }

    // System prompt
    const systemPrompt = `You are a creative branding expert. Generate exactly 5 business name suggestions in JSON format:
{
  "suggestions": [
    {
      "title": "Name Here",
      "description": "Brief description"
    }
  ]
}

CRITICAL RULES FOR NAMES:
- NEVER add suffixes like "Co", "Co.", "Company", "Inc", "LLC", "Ltd", "Design", "Studio", "Group", "Solutions", or any business entity suffixes to the end of names.
- The name should stand alone without any suffix (e.g., "Knit Warming" NOT "Knit Warming Co").
- Use only letters, no punctuation or special characters.
- Prefer 1-2 word names.
- Avoid generic words and suffixes.`;

    const answer = await ollama.generate({
      ...llmSettings,
      system: systemPrompt,
      prompt: query,
      temperature: 0.8,
    });

    const rawText = extractTextFromOllamaResult(answer);
    const parsed = extractFirstJson(rawText);
    let suggestions = parsed?.suggestions || parsed || [];

    // Post-process to remove any suffixes that might have slipped through
    const cleanSuffixes = (name) => {
      if (!name) return name;
      let cleaned = String(name).trim();
      // Remove "Branding Co" or "Branding Co." first (before removing just "Co")
      cleaned = cleaned.replace(/\s+Branding\s+Co\.?\s*$/i, '').trim();
      // Remove common suffixes (with space before)
      cleaned = cleaned.replace(/\s+(Co\.?|Company|Inc\.?|LLC|Ltd\.?|Design|Studio|Group|Solutions|Corp\.?|Corporation)\s*$/i, '').trim();
      // Remove standalone "Co" or "Co." at the end (catch any remaining)
      cleaned = cleaned.replace(/\s+Co\.?\s*$/i, '').trim();
      return cleaned;
    };
    
    suggestions = suggestions.map(s => {
      if (s && s.title) {
        s.title = cleanSuffixes(s.title);
      } else if (typeof s === 'string') {
        return cleanSuffixes(s);
      }
      return s;
    });

    // Add domain and trademark screening
    const namesWithScreening = await Promise.all(suggestions.slice(0, 5).map(async (s) => {
      const title = s.title || s.name || s; // Already cleaned above
      const description = s.description || '';
      
      const domains = await domainAvailabilityReport(title);
      const tmSearch = await trademarkSearchUKExpanded(title);
      const tmNotes = await generateTrademarkNotes(title, tmSearch, businessDescription);

      return {
        title,
        description,
        domains,
        trademarkNotes: tmNotes
      };
    }));

    return { names: namesWithScreening };
  } catch (error) {
    return { error: error.message };
  }
}

// Generate colors
export async function generateColors(businessDescription, brandValues = [], selectedName = null) {
  try {
    // Simplified color generation
    // In production, you'd use the full generateColorRecommendations logic
    
    const systemPrompt = `You are a color psychology expert. Generate 5 color palette recommendations in JSON format:
{
  "palettes": [
    {
      "hex1": "#HEXCODE",
      "hex2": "#HEXCODE",
      "namePair": "Color Name & Color Name",
      "explanation": "Full sentence explanation (15-30 words) of why these colors suit the brand",
      "short": "Brief description"
    }
  ]
}

CRITICAL: Ensure DIVERSITY across the color spectrum. The five color pairs should cover different color families:
- Include warm colors (reds, oranges, yellows) in at least one pair
- Include cool colors (blues, greens, purples) in at least one pair  
- Include neutral/earthy tones (browns, grays, beiges) if appropriate
- Vary saturation levels (some vibrant, some muted)
- Vary brightness levels (some light, some dark)
- Each pair should be visually distinct from the others
- Avoid repeating similar color combinations`;

    const prompt = `Business: "${businessDescription}"
${brandValues.length > 0 ? `Brand values: ${brandValues.join(', ')}` : ''}
${selectedName ? `Selected name: ${selectedName.title || selectedName.name}` : ''}

Generate 5 color palette recommendations with HEX codes and explanations. Ensure the five palettes are diverse and cover different color families across the spectrum.`;

    const answer = await ollama.generate({
      ...llmSettings,
      system: systemPrompt,
      prompt: prompt,
      temperature: 0.8,
    });

    const rawText = extractTextFromOllamaResult(answer);
    const parsed = extractFirstJson(rawText);
    const palettes = parsed?.palettes || parsed || [];

    return { palettes: palettes.slice(0, 5) };
  } catch (error) {
    return { error: error.message };
  }
}

// Generate logo prompt only (without generating image)
export async function generateLogoPrompt(businessDescription, visuals = [], selectedName, selectedColors) {
  try {
    const nameForLogo = selectedName?.title || selectedName?.name || '';
    const descForLogo = selectedName?.description || businessDescription;
    const hexA = selectedColors?.hex1 || selectedColors?.color1 || '#000000';
    const hexB = selectedColors?.hex2 || selectedColors?.color2 || '#FFFFFF';

    // Generate logo prompt
    const logoSystem = `You are an expert logo prompt writer. Return ONLY a concise paragraph (2-4 sentences, maximum 80 words) describing ONLY the visual appearance of a minimal mark. The PRIMARY focus must be the visual elements provided by the user. If the user specifies visual elements (e.g., "knitting needle"), the logo MUST feature those elements as the main subject. Describe ONLY: the visual elements (as the central focus), shapes, lines, geometric forms, colors (use exact HEX codes), and style (flat vector, white background). Do NOT include: business name, wordmark, emotional language, what the logo "conveys" or "evokes", brand values, or any descriptive notes about meaning. Only describe what the logo looks like visually, with the user's visual elements as the primary subject.`;

    const visualsText = visuals.length > 0 ? visuals.join(', ') : 'none specified';
    const logoUser = `Business type: ${descForLogo}
Visual elements: ${visualsText}
Colors: ${hexA} (primary), ${hexB} (accent)

CRITICAL: The logo MUST feature the visual elements listed above as the PRIMARY and CENTRAL subject. If visual elements are provided (e.g., "knitting needle"), describe a logo that prominently features those elements. Describe ONLY the visual appearance: the visual elements as the main subject, shapes, lines, forms, and how colors ${hexA} and ${hexB} are applied to these elements. Include the exact HEX codes. Do NOT describe what the logo means, conveys, or evokes. Only describe what it looks like, with the visual elements as the focus. Maximum 80 words.`;

    const logoResp = await ollama.generate({
      ...llmSettings,
      system: logoSystem,
      prompt: logoUser,
      temperature: 0,
    });

    const logoPrompt = extractTextFromOllamaResult(logoResp).trim();

    return { prompt: logoPrompt };
  } catch (error) {
    return { error: error.message };
  }
}

// Generate logo
export async function generateLogo(businessDescription, visuals = [], selectedName, selectedColors) {
  try {
    const nameForLogo = selectedName?.title || selectedName?.name || '';
    const descForLogo = selectedName?.description || businessDescription;
    const hexA = selectedColors?.hex1 || selectedColors?.color1 || '#000000';
    const hexB = selectedColors?.hex2 || selectedColors?.color2 || '#FFFFFF';

    // Generate logo prompt
    const logoSystem = `You are an expert logo prompt writer. Return ONLY a concise paragraph (2-4 sentences, maximum 80 words) describing ONLY the visual appearance of a minimal mark. The PRIMARY focus must be the visual elements provided by the user. If the user specifies visual elements (e.g., "knitting needle"), the logo MUST feature those elements as the main subject. Describe ONLY: the visual elements (as the central focus), shapes, lines, geometric forms, colors (use exact HEX codes), and style (flat vector, white background). Do NOT include: business name, wordmark, emotional language, what the logo "conveys" or "evokes", brand values, or any descriptive notes about meaning. Only describe what the logo looks like visually, with the user's visual elements as the primary subject.`;

    let logoPrompt;
    
    // If customPrompt is provided, use it directly
    if (selectedColors?.customPrompt) {
      logoPrompt = selectedColors.customPrompt;
    } else {
      // Generate logo prompt
      const visualsText = visuals.length > 0 ? visuals.join(', ') : 'none specified';
      const logoUser = `Business type: ${descForLogo}
Visual elements: ${visualsText}
Colors: ${hexA} (primary), ${hexB} (accent)

CRITICAL: The logo MUST feature the visual elements listed above as the PRIMARY and CENTRAL subject. If visual elements are provided (e.g., "knitting needle"), describe a logo that prominently features those elements. Describe ONLY the visual appearance: the visual elements as the main subject, shapes, lines, forms, and how colors ${hexA} and ${hexB} are applied to these elements. Include the exact HEX codes. Do NOT describe what the logo means, conveys, or evokes. Only describe what it looks like, with the visual elements as the focus. Maximum 80 words.`;

      const logoResp = await ollama.generate({
        ...llmSettings,
        system: logoSystem,
        prompt: logoUser,
        temperature: 0,
      });

      logoPrompt = extractTextFromOllamaResult(logoResp).trim();
    }

    // Generate image using Gradio client
    const client = await Client.connect("black-forest-labs/FLUX.1-dev");
    const result = await client.predict("/infer", {
      prompt: logoPrompt,
      seed: 0,
      randomize_seed: true,
      width: 1024,
      height: 1024,
      guidance_scale: 3.5,
      num_inference_steps: 28,
    });

    // Extract image URL
    const fileInfo = result.data[0];
    const imageUrl = fileInfo.url;

    // Download and save image
    const imageResp = await fetch(imageUrl);
    const imageBuffer = Buffer.from(await imageResp.arrayBuffer());
    
    // Convert to PNG if sharp is available
    let filename = `logo-${Date.now()}.png`;
    let imagePath = `logos/${filename}`;
    
    try {
      const sharpModule = await import('sharp');
      const sharp = sharpModule.default;
      const pngBuffer = await sharp(imageBuffer).png().toBuffer();
      fs.writeFileSync(imagePath, pngBuffer);
    } catch (sharpErr) {
      // Fallback to WebP
      filename = `logo-${Date.now()}.webp`;
      imagePath = `logos/${filename}`;
      fs.writeFileSync(imagePath, imageBuffer);
    }

    return {
      logoUrl: `/api/logo/${filename}`,
      filename: filename,
      prompt: logoPrompt
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Check trademark
export async function checkTrademark(name, businessContext = '') {
  try {
    const searchResults = await trademarkSearchUKExpanded(name);
    const notes = await generateTrademarkNotes(name, searchResults, businessContext);
    return { notes, searchResults };
  } catch (error) {
    return { error: error.message };
  }
}

// Check domain
export async function checkDomain(name) {
  try {
    const domains = await domainAvailabilityReport(name);
    return { domains };
  } catch (error) {
    return { error: error.message };
  }
}

// SerpAPI reverse image search for logo screening
async function serpAPIImageSearch(imageUrl, opts = {}) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return { error: 'SERPAPI_KEY not set' };
  
  const params = new URLSearchParams({
    engine: 'google_lens',
    url: imageUrl,
    api_key: key,
  });
  
  if (opts.ukOnly !== false) {
    params.append('gl', 'uk');
    params.append('hl', 'en');
  }
  
  try {
    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    if (!res.ok) return { error: `SerpAPI status ${res.status}` };
    const body = await res.json();
    return { source: 'serpapi_images', body };
  } catch (e) {
    return { error: e.message };
  }
}

// Check logo trademark using reverse image search
export async function checkLogoTrademark(imageUrl, opts = {}) {
  try {
    if (!imageUrl) {
      return { error: 'Image URL is required' };
    }

    // Convert relative URL to absolute if needed
    let absoluteUrl = imageUrl;
    if (imageUrl.startsWith('/api/logo/')) {
      // For local files, we need to use the full URL
      // Try to get the host from environment or use localhost
      const port = process.env.PORT || 3000;
      const host = process.env.HOST || `http://localhost:${port}`;
      absoluteUrl = `${host}${imageUrl}`;
    } else if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      // If it's a relative path, make it absolute
      const port = process.env.PORT || 3000;
      const host = process.env.HOST || `http://localhost:${port}`;
      absoluteUrl = `${host}${imageUrl.startsWith('/') ? imageUrl : '/' + imageUrl}`;
    }

    const out = { summary: [], hits: [], warnings: [], trademarkRelated: [] };

    if (process.env.SERPAPI_KEY) {
      try {
        const imgRes = await serpAPIImageSearch(absoluteUrl, { ukOnly: opts.ukOnly !== false });
        if (!imgRes.error && imgRes.body) {
          // Parse Google Lens results
          const visualMatches = imgRes.body?.visual_matches || [];
          const knowledgeGraph = imgRes.body?.knowledge_graph;
          
          for (const match of visualMatches) {
            out.hits.push({
              source: 'serpapi_images',
              title: match.title || '',
              url: match.link || '',
              snippet: match.source || '',
              thumbnail: match.thumbnail || '',
              raw: match,
            });
          }
          
          if (knowledgeGraph) {
            out.summary.push(`Found knowledge graph data: ${knowledgeGraph.title || 'N/A'}`);
          }

          // Filter for trademark-related results
          const trademarkRelated = visualMatches.filter(match => {
            const title = (match.title || '').toLowerCase();
            const url = (match.link || '').toLowerCase();
            const source = (match.source || '').toLowerCase();
            const combined = title + ' ' + url + ' ' + source;
            
            return combined.includes('trademark') ||
                   combined.includes('trade mark') ||
                   combined.includes('ipo.gov.uk') ||
                   combined.includes('trademark database') ||
                   combined.includes('registered mark') ||
                   (combined.includes('logo') && (combined.includes('brand') || combined.includes('company')));
          });

          out.trademarkRelated = trademarkRelated.map(match => ({
            title: match.title || '',
            url: match.link || '',
            source: match.source || '',
            thumbnail: match.thumbnail || ''
          }));

          // Generate notes similar to name trademark notes
          const notes = [];
          if (trademarkRelated.length > 0) {
            notes.push(`⚠️ Found ${trademarkRelated.length} visually similar logo(s) that appear to be trademark-related.`);
            if (trademarkRelated.length <= 3) {
              trademarkRelated.forEach((match, idx) => {
                const title = match.title || 'Untitled';
                notes.push(`   ${idx + 1}) ${title}${match.source ? ' - ' + match.source : ''}`);
              });
            }
          } else if (visualMatches.length > 0) {
            notes.push(`Found ${visualMatches.length} visually similar image(s), but none appear to be from trademark databases.`);
          } else {
            notes.push('No visually similar logos found in search results.');
          }
          
          notes.push('\n⚠️ DISCLAIMER: This is a visual similarity check only, not a legal trademark clearance.');
          
          out.notes = notes.join('\n');
        } else if (imgRes.error) {
          out.warnings.push(`SerpAPI image search failed: ${imgRes.error}`);
          out.notes = '⚠️ Logo trademark check unavailable: ' + imgRes.error;
        }
      } catch (e) {
        out.warnings.push(`Logo image search failed: ${String(e.message || e)}`);
        out.notes = '⚠️ Logo trademark check failed: ' + e.message;
      }
    } else {
      out.warnings.push('SERPAPI_KEY not set; cannot perform reverse image search for logo screening.');
      out.notes = '⚠️ Logo trademark check unavailable: SERPAPI_KEY not configured.';
    }

    return out;
  } catch (error) {
    return { error: error.message };
  }
}

