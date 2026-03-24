import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Get API port from environment variable (set by server.ts) or default to 3000
const API_PORT = process.env.API_PORT || '3000';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 3001,
		allowedHosts: true,
		proxy: {
			// Proxy API requests to the API server
			'/admin': {
				target: `http://localhost:${API_PORT}`,
				changeOrigin: true,
			},
			// Also proxy WebSocket requests
			'/ws': {
				target: `ws://localhost:${API_PORT}`,
				ws: true,
			},
		},
	},
	css: {
		devSourcemap: true,
	},
});
