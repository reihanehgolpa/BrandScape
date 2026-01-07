# BrandScape Web Interface

few beautiful web interface for the BrandScape AI brand generator, running locally on your computer.

## 🚀 Quick Start

1. **Start the server:**
   ```bash
   bun run server.js
   ```

2. **Open your browser:**
   Navigate to `http://localhost:3000`

3. **Use the interface:**
   - Fill in your business description
   - Add visual elements and brand values
   - Select from generated names
   - Choose a color palette
   - Generate and download your logo

## 📁 File Structure

```
project/
├── server.js              # Bun server with API endpoints
├── src/
│   ├── brandscape.js      # Original CLI script
│   └── brandscape-api.js  # API wrapper functions
├── public/
│   ├── index.html         # Main web interface
│   ├── style.css          # Styling
│   └── app.js             # Frontend JavaScript
└── logos/                 # Generated logos stored here
```

## 🔧 Requirements

- Bun runtime
- Ollama running locally (or configured via OLLAMA_URL)
- Environment variables (same as CLI version):
  - `SERPAPI_KEY` (optional, for web searches)
  - `OLLAMA_API_KEY` (optional)
  - `BRAND_MODEL` (optional, defaults to 'llama3.2:3b')

## 🌐 API Endpoints

- `POST /api/generate-names` - Generate business name suggestions
- `POST /api/generate-colors` - Generate color palette recommendations
- `POST /api/generate-logo` - Generate logo image
- `POST /api/check-trademark` - Check trademark availability
- `POST /api/check-domain` - Check domain availability
- `GET /api/logo/:filename` - Serve generated logo images

## 🎨 Features

- ✅ Beautiful, modern UI
- ✅ Step-by-step wizard interface
- ✅ Real-time name generation with domain/trademark screening
- ✅ Color palette visualization
- ✅ Logo preview and download
- ✅ Responsive design (works on mobile too!)

## 📝 Notes

- The API wrapper (`brandscape-api.js`) is a simplified version k t may need refinement
- For full functionality, consider refactoring `brandscape.js` to export its functions
- All processing happens locally - your data stays on your computer
- Generated logos are saved in the `logos/` directory

## 🐛 Troubleshooting

**Server won't start:**
- Make sure Bun is installed: `bun --version`
- Check if port 3000 is available

**API errors:**
- Verify Ollama is running: `ollama list`
- Check environment variables in `.env` file
- Ensure `logos/` directory exists

**Logo generation fails:**
- Check if `sharp` package is installed for PNG conversion
- Verify Gradio client connection to FLUX.1-dev model

## 🔄 Next Steps

To improve the API wrapper:
1. Refactor `brandscape.js` to export functions instead of running CLI
2. Import actual functions in `brandscape-api.js`
3. Add better error handling and validation
4. Add progress updates via WebSockets or Server-Sent Events

Enjoy your new web interface! 🎉










