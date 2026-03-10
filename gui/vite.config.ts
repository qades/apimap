import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 3001,
		allowedHosts: true,
		proxy: {
			'/admin': {
				target: 'http://localhost:3000',
				changeOrigin: true
			},
			'/v1': {
				target: 'http://localhost:3000',
				changeOrigin: true
			},
			'/ws': {
				target: 'ws://localhost:3000',
				ws: true,
				changeOrigin: true
			}
		}
	},
	css: {
		devSourcemap: true
	}
});
