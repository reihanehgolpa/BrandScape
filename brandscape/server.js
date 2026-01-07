// BrandScape Web Server using Bun's built-in server
import { file } from 'bun';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

// Import brandscape functions (we'll need to refactor them)
// For now, we'll create API endpoints that can call the functions

const PORT = process.env.PORT || 3000;

// Helper to get MIME type
function getMimeType(path) {
  const ext = path.split('.').pop().toLowerCase();
  const mimeTypes = {
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'webp': 'image/webp',
    'svg': 'image/svg+xml'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Serve static files (HTML, CSS, JS)
    if (pathname === '/' || pathname === '/index.html') {
      const filePath = join(import.meta.dir, 'public', 'index.html');
      if (existsSync(filePath)) {
        return new Response(file(filePath), {
          headers: { ...corsHeaders, 'Content-Type': 'text/html' }
        });
      }
      return new Response('index.html not found', { status: 404 });
    }

    if (pathname.startsWith('/public/')) {
      const filePath = join(import.meta.dir, pathname);
      if (existsSync(filePath)) {
        const fileContent = file(filePath);
        return new Response(fileContent, {
          headers: { ...corsHeaders, 'Content-Type': getMimeType(pathname) }
        });
      }
      return new Response('File not found', { status: 404 });
    }

    // Serve logo images
    if (pathname.startsWith('/api/logo/')) {
      const filename = pathname.split('/').pop();
      const filePath = join(import.meta.dir, 'logos', filename);
      if (existsSync(filePath)) {
        const fileContent = file(filePath);
        return new Response(fileContent, {
          headers: { ...corsHeaders, 'Content-Type': getMimeType(filename) }
        });
      }
      return new Response('Logo not found', { status: 404 });
    }

    // API endpoints
    if (pathname === '/api/generate-names' && req.method === 'POST') {
      try {
        const body = await req.json();
        const { businessDescription, visuals, brandValues } = body;

        // Import and call brandscape function
        const { generateNames } = await import('./src/brandscape-api.js');
        const result = await generateNames(businessDescription, visuals, brandValues);
        
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (pathname === '/api/generate-colors' && req.method === 'POST') {
      try {
        const body = await req.json();
        const { businessDescription, brandValues, selectedName } = body;

        const { generateColors } = await import('./src/brandscape-api.js');
        const result = await generateColors(businessDescription, brandValues, selectedName);
        
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (pathname === '/api/generate-logo-prompt' && req.method === 'POST') {
      try {
        const body = await req.json();
        const { businessDescription, visuals, selectedName, selectedColors } = body;

        const { generateLogoPrompt } = await import('./src/brandscape-api.js');
        const result = await generateLogoPrompt(businessDescription, visuals, selectedName, selectedColors);
        
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (pathname === '/api/generate-logo' && req.method === 'POST') {
      try {
        const body = await req.json();
        const { businessDescription, visuals, selectedName, selectedColors } = body;

        const { generateLogo } = await import('./src/brandscape-api.js');
        const result = await generateLogo(businessDescription, visuals, selectedName, selectedColors);
        
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (pathname === '/api/check-trademark' && req.method === 'POST') {
      try {
        const body = await req.json();
        const { name, businessContext } = body;

        const { checkTrademark } = await import('./src/brandscape-api.js');
        const result = await checkTrademark(name, businessContext);
        
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (pathname === '/api/check-domain' && req.method === 'POST') {
      try {
        const body = await req.json();
        const { name } = body;

        const { checkDomain } = await import('./src/brandscape-api.js');
        const result = await checkDomain(name);
        
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (pathname === '/api/check-logo-trademark' && req.method === 'POST') {
      try {
        const body = await req.json();
        const { imageUrl } = body;

        const { checkLogoTrademark } = await import('./src/brandscape-api.js');
        const result = await checkLogoTrademark(imageUrl);
        
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 404 for unknown routes
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
});

console.log(`🚀 BrandScape server running at http://localhost:${PORT}`);
console.log(`📱 Open http://localhost:${PORT} in your browser`);

