# API Map - Project TODO

## Completed ✅

### Refactoring
- [x] Create modular project structure with separate folders
- [x] Implement Internal Message Format for unified request/response handling
- [x] Create provider base classes and registry
- [x] Implement OpenAI and Anthropic format transformers
- [x] Create configuration manager with YAML support and backup system
- [x] Implement logging system with unrouted request capture
- [x] Create pattern-based router

### GUI (SvelteKit)
- [x] Set up SvelteKit project structure
- [x] Create dashboard with real-time statistics
- [x] Implement unrouted requests view with one-click route creation
- [x] Create provider configuration page with pre-filled options
- [x] Implement routes editor with pattern testing
- [x] Create YAML configuration editor
- [x] Implement backup/restore functionality
- [x] Create request logs viewer

### Documentation
- [x] Update README with new project structure
- [x] Create default configuration file

## In Progress 🚧

### Testing
- [ ] Test provider transformations
- [ ] Test routing with various patterns
- [ ] Test streaming responses
- [ ] Test GUI API integration

### GUI Enhancements
- [ ] Add dark mode support
- [ ] Add real-time request feed via WebSocket
- [ ] Add request replay functionality
- [ ] Add provider health checks

## Planned 📋

### Features
- [ ] Add OAuth/API key management for GUI
- [ ] Add request caching layer
- [ ] Add rate limiting per provider
- [ ] Add request retry with fallback providers
- [ ] Add metrics and alerting
- [ ] Add model cost tracking

### Providers
- [ ] Add Google Gemini transformer
- [ ] Add Ollama native format support
- [ ] Add Azure OpenAI support
- [ ] Add Bedrock support

### GUI
- [ ] Add request graph visualization
- [ ] Add provider usage analytics
- [ ] Add route performance metrics

## Known Issues 🐛

None reported yet
